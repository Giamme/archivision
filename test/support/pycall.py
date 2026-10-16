"""Checks Python call sites a page links, on its own reading of the code (not python/scan.py's).

stdin: {"root": repo, "checks": [{"file", "line", "col" (UTF-16, from 1), "name", "target": [file, first, last],
        "status": the link's status or null}]}
stdout: a list, per check, of null (it holds) or why it does not.

A site holds when the name at line:col is what a call (or a decorator) there invokes, it is spelled `name`, the
target's lines declare `def name` or `class name`, and
  - a plain name: it is not a parameter of a lambda or a comprehension around the call, nor bound inside the function
    there other than by an import; what binds it (there, else at the top of the file) names the target: a def or class
    of this file, or an import of `name` from the target's module: that module's own file, or the file it imports
    `name` from in turn (one re-export);
  - `m.name(...)` on a module the file imports: the target is in that module's file (or one re-export); on a name the
    file imports from a module: that module (a submodule, a class of it, or a class it imports in turn), or a base of
    the class it names;
  - `self.name(...)` / `cls.name(...)` in a method of class C: the target is a method of C, of a base of C or of a
    subclass of C, and the link is not exact; `super().name(...)` (and `super(B, self)`): the nearest class after C
    (after B) that defines name, in C's order (C3, by names) or a subclass's, exact only when that is one class;
    `A().name(...)` for a class A of the repo: A or a base of it, exact only for the nearest that has name (classes by
    name, over every file of the repo);
  - a target wrapped by a decorator (other than staticmethod, classmethod, abstractmethod, overload, override, final,
    dataclass, runtime_checkable) is never an exact link;
  - a name bound more than once where it is read (an import then an assignment, a def in both branches of an if) may
    be either, so its link is not exact.
Modules are matched by path: the checker does not know the import roots, so a module is any file whose path ends
with it.
"""
import ast
import json
import os
import re
import stat
import sys

SKIP = {'node_modules', '__pycache__', 'venv', '.venv', 'site-packages', 'dist', 'build'}


def utf16_to_byte(text, col):
    """a 1-based UTF-16 column of a line to ast's byte offset"""
    n, i = 0, 0
    while i < len(text) and n < col - 1:
        n += 2 if ord(text[i]) > 0xFFFF else 1
        i += 1
    return len(text[:i].encode('utf-8'))


def module_path(mod):
    return mod.replace('.', '/')


class Repo:
    """the repo's Python files, read once each"""

    def __init__(self, root):
        self.root, self.trees, self.texts, self._files, self._classes, self._anc = root, {}, {}, None, None, {}
        self._tops, self._mro = {}, {}

    def files(self):
        if self._files is None:
            out = []
            for d, dirs, fs in os.walk(self.root):
                dirs[:] = sorted(x for x in dirs if not x.startswith('.') and x not in SKIP)
                for f in sorted(fs):
                    if f.endswith('.py'):
                        out.append(os.path.relpath(os.path.join(d, f), self.root).replace(os.sep, '/'))
            self._files = out
        return self._files

    def text(self, f):
        # only a regular file inside the repo by its real path (a symlink or a ../ in a page leads nowhere else), of
        # a size a source file has
        if f not in self.texts:
            self.texts[f] = None
            try:
                real, top = os.path.realpath(os.path.join(self.root, f)), os.path.realpath(self.root)
                st = os.stat(real)
                if (real == top or real.startswith(top + os.sep)) and stat.S_ISREG(st.st_mode) and st.st_size <= 8 * 1024 * 1024:
                    with open(real, encoding='utf-8') as fh:
                        self.texts[f] = fh.read()
            except (OSError, ValueError):
                pass
        return self.texts[f]

    def tree(self, f):
        if f not in self.trees:
            t = self.text(f)
            try:
                self.trees[f] = ast.parse(t) if t is not None else None
            except (SyntaxError, ValueError):
                self.trees[f] = None
        return self.trees[f]

    def modules(self, mod, base_dir, level):
        """the files that are module `mod`, imported from a file in base_dir with `level` dots: that path; for an
        absolute import, every file whose path ends with it"""
        if level:
            d = base_dir
            for _ in range(level - 1):
                d = os.path.dirname(d)
            p = os.path.normpath(os.path.join(d, module_path(mod))) if mod else (d or '.')
            p = '' if p == '.' else p
            return {p + '.py', p + '/__init__.py'} if p else {'__init__.py'}
        m = module_path(mod)
        return {f for f in self.files() if ('/' + f).endswith('/' + m + '.py') or ('/' + f).endswith('/' + m + '/__init__.py')}

    def gives(self, mod, base_dir, level, attr):
        """the files where `attr` of module `mod` may be declared: the module's own files, and the files those import
        `attr` from (one re-export)"""
        own = self.modules(mod, base_dir, level)
        out = set(own)
        for f in own:
            t = self.tree(f)
            if t is None:
                continue
            for b in top_bindings(t).get(attr, []):
                if b[0] == 'from':
                    out |= self.modules(b[1], os.path.dirname(f), b[3])
                    out |= self.modules((b[1] + '.' if b[1] else '') + b[2], os.path.dirname(f), b[3])
        return out

    def classes(self):
        """class name -> the last names of its bases, in order, over every file (classes of one name merged)"""
        if self._classes is None:
            idx, meth = {}, {}
            for f in self.files():
                t = self.tree(f)
                if t is None:
                    continue
                for n in ast.walk(t):
                    if isinstance(n, ast.ClassDef):
                        bs = idx.setdefault(n.name, [])
                        bs.extend(x for x in (last_name(b) for b in n.bases) if x and x not in bs)
                        m = meth.setdefault(n.name, set())
                        for st in n.body:
                            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                                m.add(st.name)
                            elif isinstance(st, (ast.Assign, ast.AnnAssign)):
                                m.update(x.id for t2 in (st.targets if isinstance(st, ast.Assign) else [st.target]) for x in ast.walk(t2) if isinstance(x, ast.Name))
            self._classes, self._methods = idx, meth
        return self._classes

    def methods(self, name):
        self.classes()
        return self._methods.get(name, set())

    def mro(self, name, seen=()):
        """C3 linearization by class names (depth first where the names admit no C3 order)"""
        if name in seen:
            return [name]
        bases = self.classes().get(name, [])
        seqs = [self.mro(b, seen + (name,)) for b in bases] + [list(bases)]
        out = [name]
        while True:
            seqs = [q for q in seqs if q]
            if not seqs:
                return out
            h = next((q[0] for q in seqs if not any(q[0] in r[1:] for r in seqs)), None)
            if h is None:
                return out + [x for q in seqs for x in q if x not in out]
            out.append(h)
            seqs = [q[1:] if q[0] == h else q for q in seqs]

    def subclasses(self, name):
        return [k for k in self.classes() if name in self.ancestors(k)]

    # classes by where they are: (file, name), their bases resolved through the imports of their own file
    def top_classes(self, f):
        """a file's module-level classes (also under if/try/with), name -> the last ClassDef"""
        if f not in self._tops:
            out, t = {}, self.tree(f)

            def walk(body):
                for st in body:
                    if isinstance(st, ast.ClassDef):
                        out[st.name] = st
                    for attr in ('body', 'orelse', 'finalbody'):
                        if isinstance(st, (ast.If, ast.Try, ast.With)) and getattr(st, attr, None):
                            walk(getattr(st, attr))
                    if isinstance(st, ast.Try):
                        for h in st.handlers:
                            walk(h.body)
            walk(t.body if t is not None else [])
            self._tops[f] = out
        return self._tops[f]

    def class_files(self, name, f, expr=None):
        """the classes (file, name) a name, or `mod.Name` (expr), means at the top of file f"""
        t = self.tree(f)
        if t is None:
            return set()
        tb, here = top_bindings(t), os.path.dirname(f)
        out = set()
        if isinstance(expr, ast.Attribute) and isinstance(expr.value, ast.Name):
            for b in tb.get(expr.value.id, []):
                mod = b[1] if b[0] == 'import' else (b[1] + '.' if b[1] else '') + b[2] if b[0] == 'from' else None
                if mod is not None:
                    out |= {(x, name) for x in self.gives(mod, here, b[3] if b[0] == 'from' else 0, name) if name in self.top_classes(x)}
            return out
        for b in tb.get(name, []):
            if b[0] == 'def' and name in self.top_classes(f):
                out.add((f, name))
            elif b[0] == 'from':
                out |= {(x, b[2]) for x in self.gives(b[1], here, b[3], b[2]) if b[2] in self.top_classes(x)}
        return out

    def mro_pairs(self, node, f, seen=()):
        """C3 over (file, name); a base the checker cannot place is (None, name), which may define anything"""
        key = (f, node.lineno)
        if key in self._mro:
            return self._mro[key]
        if key in seen:
            return [(f, node.name)]
        bases = []
        for b in node.bases:
            e = b.value if isinstance(b, ast.Subscript) else b
            bn = last_name(e)
            if not bn or bn == 'object':
                continue
            cf = self.class_files(bn, f, e if isinstance(e, ast.Attribute) else None)
            bases.append(next(iter(cf)) if len(cf) == 1 else (None, bn))
        seqs = [self.mro_pairs(self.top_classes(bf)[bc], bf, seen + (key,)) if bf else [(None, bc)] for bf, bc in bases] + [list(bases)]
        out = [(f, node.name)]
        while True:
            seqs = [q for q in seqs if q]
            if not seqs:
                break
            h = next((q[0] for q in seqs if not any(q[0] in r[1:] for r in seqs)), None)
            if h is None:
                out += [x for q in seqs for x in q if x not in out]
                break
            out.append(h)
            seqs = [q[1:] if q[0] == h else q for q in seqs]
        self._mro[key] = out
        return out

    def defines(self, pair, attr):
        f, n = pair
        node = self.top_classes(f).get(n) if f else None
        if node is None:
            return False
        for st in node.body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and st.name == attr:
                return True
            if isinstance(st, (ast.Assign, ast.AnnAssign)) and any(isinstance(x, ast.Name) and x.id == attr for t2 in (st.targets if isinstance(st, ast.Assign) else [st.target]) for x in ast.walk(t2)):
                return True
        return False

    def next_definer(self, pairs, attr, after=None):
        """the first class after `after` in the order that defines attr, and whether one the checker cannot place
        came before it"""
        if after is not None:
            if after not in pairs:
                return None, True
            pairs = pairs[pairs.index(after) + 1:]
        unsure = False
        for q in pairs:
            if q[0] is None:
                unsure = True
            elif self.defines(q, attr):
                return q, unsure
        return None, unsure

    def all_classes(self):
        return [(f, n, node) for f in self.files() for n, node in self.top_classes(f).items()]

    def subclasses_of(self, pair):
        return [(node, f) for f, n, node in self.all_classes() if (f, n) != pair and pair in self.mro_pairs(node, f)]

    def nearest(self, cls, attr, after=None):
        """the first class in cls's order (after `after`, when given) that defines attr, or None"""
        chain = self.mro(cls)
        if after is not None:
            chain = chain[chain.index(after) + 1:] if after in chain else []
        return next((k for k in chain if attr in self.methods(k)), None)

    def ancestors(self, name):
        if name in self._anc:
            return self._anc[name]
        self._anc[name] = seen = set()
        idx, stack = self.classes(), [name]
        while stack:
            for b in idx.get(stack.pop(), ()):
                if b not in seen:
                    seen.add(b)
                    stack.append(b)
        return seen

    def related(self, a, b):
        return a == b or a in self.ancestors(b) or b in self.ancestors(a)

    def class_at(self, f, line):
        """the innermost class that holds the line (a target is a method's lines, or the whole class, from its first
        decorator, when the page links the top-level symbol)"""
        t = self.tree(f)
        best = None
        for n in ast.walk(t) if t is not None else ():
            start = min([n.lineno] + [d.lineno for d in n.decorator_list]) if isinstance(n, ast.ClassDef) else 0
            if isinstance(n, ast.ClassDef) and start <= line <= (n.end_lineno or n.lineno) and (best is None or n.lineno > best.lineno):
                best = n
        return best


# decorators that return what they are given: builtins nothing rebinds, and these by the module they are imported from
BUILTIN_KEEPS = {'staticmethod', 'classmethod'}
TYPING = {'typing', 'typing_extensions'}
KEEP_FROM = {'abstractmethod': {'abc'}, 'overload': TYPING, 'override': TYPING, 'final': TYPING, 'runtime_checkable': TYPING, 'dataclass': {'dataclasses'}}


def keeps(d, tree, cls_node):
    """whether a decorator returns what it decorates, by what binds it at the top of the decorated def's file (or, for
    a property's .setter, a property of the same class)"""
    e = d.func if isinstance(d, ast.Call) else d
    tb = top_bindings(tree)
    if isinstance(e, ast.Name):
        bs = tb.get(e.id, [])
        if e.id in BUILTIN_KEEPS:
            return not bs
        return len(bs) == 1 and bs[0][0] == 'from' and bs[0][1] in KEEP_FROM.get(bs[0][2], ())
    if isinstance(e, ast.Attribute) and isinstance(e.value, ast.Name):
        if e.attr in ('setter', 'getter', 'deleter'):
            return cls_node is not None and any(isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)) and st.name == e.value.id
                                                and any(isinstance(x, ast.Name) and x.id == 'property' for x in st.decorator_list) for st in cls_node.body)
        bs = tb.get(e.value.id, [])
        return len(bs) == 1 and bs[0][0] == 'import' and bs[0][1] in KEEP_FROM.get(e.attr, ())
    return False


def last_name(e):
    if isinstance(e, ast.Name):
        return e.id
    if isinstance(e, ast.Attribute):
        return e.attr
    if isinstance(e, ast.Subscript):
        return last_name(e.value)
    return None


class Bindings(ast.NodeVisitor):
    """names bound in one function body (not in nested functions or classes), how many times, and by what imports"""

    def __init__(self):
        self.count, self.glob, self.imports, self.other = {}, set(), {}, set()

    def bind(self, name, other=True):
        self.count[name] = self.count.get(name, 0) + 1
        if other:
            self.other.add(name)

    def visit_FunctionDef(self, n):
        self.bind(n.name)

    visit_AsyncFunctionDef = visit_ClassDef = visit_FunctionDef

    def visit_Lambda(self, n):
        pass

    def visit_Global(self, n):
        self.glob.update(n.names)

    visit_Nonlocal = visit_Global

    def visit_Name(self, n):
        if isinstance(n.ctx, (ast.Store, ast.Del)):
            self.bind(n.id)

    def visit_Import(self, n):
        for a in n.names:
            b = a.asname or a.name.split('.')[0]
            self.bind(b, False)
            self.imports.setdefault(b, []).append(('import', a.name if a.asname else a.name.split('.')[0]))

    def visit_ImportFrom(self, n):
        for a in n.names:
            b = a.asname or a.name
            self.bind(b, False)
            self.imports.setdefault(b, []).append(('from', n.module or '', a.name, n.level or 0))

    def visit_ExceptHandler(self, n):
        if n.name:
            self.bind(n.name)
        self.generic_visit(n)

    def visit_ListComp(self, n):
        pass

    visit_SetComp = visit_DictComp = visit_GeneratorExp = visit_ListComp


def params(fn):
    a = fn.args
    return [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs + [y for y in (a.vararg, a.kwarg) if y]]


def local_bindings(fn):
    """the names bound in a function (with how many times), and those bound only by imports there (what each is)"""
    b = Bindings()
    for st in fn.body:
        b.visit(st)
    count = {k: v for k, v in b.count.items() if k not in b.glob}
    for p in params(fn):
        count[p] = count.get(p, 0) + 1
    return count, {k: v for k, v in b.imports.items() if k in count and k not in params(fn) and k not in b.other}


def comp_names(n):
    return {x.id for g in n.generators for x in ast.walk(g.target) if isinstance(x, ast.Name)}


def top_bindings(tree):
    """module-level names: what binds each, in order (def, class, import, from-import, assigned)"""
    out = {}

    def walk(body):
        for st in body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                out.setdefault(st.name, []).append(('def', st.name))
            elif isinstance(st, ast.Import):
                for a in st.names:
                    out.setdefault(a.asname or a.name.split('.')[0], []).append(('import', a.name if a.asname else a.name.split('.')[0]))
            elif isinstance(st, ast.ImportFrom):
                for a in st.names:
                    out.setdefault(a.asname or a.name, []).append(('from', st.module or '', a.name, st.level or 0))
            elif isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                for t in (st.targets if isinstance(st, ast.Assign) else [st.target]):
                    for n in ast.walk(t):
                        if isinstance(n, ast.Name):
                            out.setdefault(n.id, []).append(('assign', st.value))
            for attr in ('body', 'orelse', 'finalbody'):
                if isinstance(st, (ast.If, ast.Try, ast.With, ast.For, ast.While)) and getattr(st, attr, None):
                    walk(getattr(st, attr))
            if isinstance(st, ast.Try):
                for h in st.handlers:
                    walk(h.body)
    walk(tree.body)
    return out


def check(R, c):
    f, line, col, name, status = c['file'], c['line'], c['col'], c['name'], c.get('status')
    tf, tl, te = c['target']
    tree, src = R.tree(f), R.text(f)
    if src is None or tree is None:
        return 'cannot read or parse the file'
    L = src.split('\n')
    if line > len(L):
        return 'beyond the file'
    off = utf16_to_byte(L[line - 1], col)
    # the callee at line:col, with the functions, lambdas, comprehensions and classes around it
    hit = None

    def callee(e):
        if isinstance(e, ast.Call):
            e = e.func
        if isinstance(e, ast.Name) and e.lineno == line and e.col_offset == off:
            return ('name', e.id, None)
        if isinstance(e, ast.Attribute) and e.end_lineno == line and e.end_col_offset - len(e.attr.encode('utf-8')) == off:
            return ('member', e.attr, e.value)
        return None

    def visit(n, around):
        nonlocal hit
        if hit:
            return
        if isinstance(n, ast.Call):
            r = callee(n.func)
            if r:
                hit = (r, list(around))
                return
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            for d in n.decorator_list:
                r = callee(d)
                if r:
                    hit = (r, list(around))
                    return
        if isinstance(n, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            visit(n.generators[0].iter, around)       # the first iterable is read outside the comprehension
            for ch in ast.iter_child_nodes(n):
                if ch not in n.generators:
                    visit(ch, around + [n])
            for i, g in enumerate(n.generators):
                for x in [g.target] + g.ifs + ([g.iter] if i else []):
                    visit(x, around + [n])
            return
        inner = around + [n] if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)) else around
        for ch in ast.iter_child_nodes(n):
            visit(ch, inner)

    visit(tree, [])
    text = L[line - 1].strip()[:90]
    if not hit:
        return f'nothing is called at column {col}: {text}'
    (form, spelled, base), around = hit
    T = R.text(tf)
    if T is None:
        return f'the target file {tf} is missing'
    span = '\n'.join(T.split('\n')[tl - 1:te])
    declares = re.search(rf'^\s*(?:async\s+)?(?:def|class)\s+{re.escape(name)}\b', span, re.M)
    if spelled != name and form == 'member':
        return f'{spelled} is called there, not {name}'
    if not declares:
        return f'no def or class {name} in {tf}:{tl}-{te}'
    fdir = os.path.dirname(f)
    # a target a decorator of the repo or a library wraps is what that decorator returns: never an exact link
    tt = R.tree(tf)
    for n in ast.walk(tt) if tt is not None else ():
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == name and tl <= n.lineno <= te:
            odd = [last_name(d.func if isinstance(d, ast.Call) else d) or '?' for d in n.decorator_list if not keeps(d, tt, R.class_at(tf, n.lineno))]
            if odd and status == 'exact':
                return f'{name} in {tf} is decorated (@{odd[0]}), so the link cannot be exact'
            break

    def bound_around(n):
        """what binds a name where the call is: ('param', kind) for a lambda's or a comprehension's, ('local', count,
        imports) inside a function, else ('top', bindings)"""
        for s in reversed(around):
            if isinstance(s, ast.Lambda):
                if n in params(s):
                    return ('param', 'a lambda')
            elif isinstance(s, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
                if n in comp_names(s):
                    return ('param', 'a comprehension')
            elif isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)):
                count, imps = local_bindings(s)
                if n in count:
                    return ('local', count[n], imps.get(n))
        return ('top', top_bindings(tree).get(n, []))     # a class body's names are not seen from its methods

    def method_class():
        """the class of the method the call is made in, and that method's first parameter (self, cls)"""
        for i in range(len(around) - 1, 0, -1):
            s = around[i]
            if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)) and params(s)[:1] and isinstance(around[i - 1], ast.ClassDef):
                return around[i - 1], params(s)[0]
        return None, None

    if form == 'member':
        cls_node = R.class_at(tf, tl)
        if isinstance(base, ast.Call) and isinstance(base.func, ast.Name) and base.func.id == 'super':
            sb = bound_around('super')
            if sb[0] != 'top' or sb[1]:
                return f'super is bound there ({sb[1] if sb[0] == "param" else "by the code around it"}), not the builtin'
            C, first = method_class()
            if C is None:
                return f'super().{name} outside a method'
            # super() and super(B, self) go on after C (after B) in the order of the instance's class: C's, or a
            # subclass's (the scan says so with a status below exact); super(B, x) on another value, after B in B's.
            # Classes are (file, name), their bases found through their own file's imports
            here = (f, C.name)
            if base.args:
                b0 = base.args[0]
                cf = {here} if isinstance(b0, ast.Name) and b0.id == C.name else R.class_files(last_name(b0) or '', f, b0 if isinstance(b0, ast.Attribute) else None)
                if len(cf) != 1:
                    return f'super({ast.unparse(b0)}, …).{name}: the checker cannot tell which class {ast.unparse(b0)} is'
                start = next(iter(cf))
            else:
                start = here
            mine = not base.args or (len(base.args) > 1 and isinstance(base.args[1], ast.Name) and base.args[1].id == first)
            top = (C, f) if mine else (R.top_classes(start[0]).get(start[1]), start[0])
            if top[0] is None:
                return f'super().{name}: no class {start[1]} in {start[0]}'
            pool = [top] + R.subclasses_of((top[1], top[0].name))
            want, unsure = set(), False
            for node, nf in pool:
                q, u = R.next_definer(R.mro_pairs(node, nf), name, after=start)
                unsure = unsure or u
                if q:
                    want.add(q)
            first_one = R.next_definer(R.mro_pairs(*top), name, after=start)[0]
            got = (tf, cls_node.name) if cls_node is not None else None
            if got is None or got not in want:
                return f'super().{name} in {C.name} reaches {first_one[1] + " in " + first_one[0] if first_one else "no method of the repo"} first, not {got[1] + " in " + got[0] if got else tf}'
            if status == 'exact' and (got != first_one or len(want) > 1 or unsure):
                return f'super().{name} in {C.name} may reach {", ".join(sorted(n2 for _, n2 in want))} (subclasses, or bases outside the repo), so the link cannot be exact'
            return None
        if isinstance(base, ast.Call) and last_name(base.func) in R.classes():
            # A().name(): A's method, or its nearest base's that has it; A is the class the name means in this file
            K = last_name(base.func)
            cands = R.class_files(K, f, base.func if isinstance(base.func, ast.Attribute) else None)
            got = (tf, cls_node.name) if cls_node is not None else None
            if not cands:
                return None                                # a class defined in a function: only the declaration is checked
            orders = [R.mro_pairs(R.top_classes(kf)[kn], kf) for kf, kn in cands]
            if got is None or not any(got in o for o in orders):
                return f'{K}().{name} names {got[1] + " in " + got[0] if got else tf}, which is neither the {K} this file means nor a base of it'
            firsts = {R.next_definer(o, name) for o in orders}
            if status == 'exact' and firsts != {(got, False)}:
                return f'{K}().{name} reaches {", ".join(sorted(q[1] + " in " + q[0] for q, _ in firsts if q)) or "no method"} first, so the link to {got[1]} in {got[0]} cannot be exact'
            return None
        if not isinstance(base, ast.Name):
            return None                                    # a.b.name(), f().name(): only the declaration is checked
        C, first = method_class()
        b = bound_around(base.id)
        if C is not None and base.id == first and b[0] == 'local':
            if cls_node is None:
                return f'{base.id}.{name} in {C.name} names {tf}:{tl}, which is no method'
            here, got = (f, C.name), (tf, cls_node.name)
            node_got = R.top_classes(tf).get(cls_node.name)
            if got not in R.mro_pairs(C, f) and not (node_got is not None and here in R.mro_pairs(node_got, tf)):
                return f'{base.id}.{name} in {C.name} names a method of {cls_node.name} in {tf}, which is neither {C.name}, a base of it nor a subclass of it'
            if status == 'exact':
                return f'{base.id}.{name} in {C.name} is the method of whatever class {base.id} is (a subclass may have its own), so the link cannot be exact'
            return None
        if b[0] != 'top':
            return None                                    # a local value of a type the checker does not follow
        mods = [x for x in b[1] if x[0] == 'import']
        if mods:
            ok = set().union(*(R.gives(x[1], fdir, 0, name) for x in mods))
            return None if tf in ok else f'{base.id} is the module {mods[0][1]}, not {tf}'
        froms = [x for x in b[1] if x[0] == 'from']
        if froms:
            ok = set()
            for x in froms:
                sub = (x[1] + '.' if x[1] else '') + x[2]
                ok |= R.gives(sub, fdir, x[3], name) | R.gives(x[1], fdir, x[3], x[2])
            if tf in ok or (cls_node is not None and any(cls_node.name in R.ancestors(x[2]) for x in froms)):
                return None
            # an instance a module makes (`client = Client()`): its class's methods, or its bases'
            for x in froms:
                for mf in R.modules(x[1], fdir, x[3]):
                    mt = R.tree(mf)
                    for y in (top_bindings(mt).get(x[2], []) if mt is not None else []):
                        if y[0] == 'assign' and isinstance(y[1], ast.Call) and cls_node is not None and R.related(cls_node.name, last_name(y[1].func) or ''):
                            return None
            return f'{base.id} is {froms[0][2]} from {froms[0][1] or "."}, which does not give {tf}'
        return None

    # a plain name
    b = bound_around(spelled)
    if b[0] == 'param':
        return f'{spelled} is a parameter of {b[1]} there, not the target {name}'
    if b[0] == 'local':
        if not b[2]:
            return f'{spelled} is bound inside the function there, not the target {name}'
        binds, n = b[2], b[1]
    else:
        binds, n = b[1], len(b[1])
    if not binds:
        return f'{spelled} is declared nowhere in the file (a builtin or a missing name): {text}'
    if n > 1 and status == 'exact':
        return f'{spelled} is bound {n} times where it is called, so the link cannot be exact'
    for x in binds:
        if x[0] == 'def' and tf == f and spelled == name:
            return None
        if x[0] == 'from' and x[2] == name and tf in R.gives(x[1], fdir, x[3], name):
            return None
    kinds = ', '.join(sorted({x[0] for x in binds}))
    return f'{spelled} ({kinds}) does not name {name} in {tf}:{tl}-{te}'


# ---------- data uses ----------
# the operations per store (as the scan knows them), and where each takes its resource
DATA_OPS = {
    's3': {'get_object', 'put_object', 'delete_object', 'delete_objects', 'copy_object', 'head_object', 'list_objects', 'list_objects_v2',
           'upload_file', 'upload_fileobj', 'download_file', 'download_fileobj', 'get_object_tagging', 'put_object_tagging', 'select_object_content'},
    'dynamodb': {'get_item', 'put_item', 'update_item', 'delete_item', 'query', 'scan', 'batch_get_item', 'batch_write_item', 'batch_writer', 'transact_write_items'},
    'sqs': {'send_message', 'send_messages', 'send_message_batch', 'receive_message', 'receive_messages', 'delete_message', 'delete_message_batch', 'change_message_visibility'},
    'sql': {'execute', 'executemany', 'executescript', 'query', 'scalars', 'scalar'},
}
POSITIONAL = {'upload_file': 1, 'upload_fileobj': 1, 'download_file': 0, 'download_fileobj': 0}
HOLDERS = {'s3': {'Bucket': 'Bucket', 'Object': 'bucket_name'}, 'dynamodb': {'Table': 'TableName'}, 'sqs': {'Queue': 'url', 'get_queue_by_name': 'QueueName'}}
KW = {'s3': 'Bucket', 'dynamodb': 'TableName', 'sqs': 'QueueUrl'}
ENV_CALLS = {'os.environ.get', 'os.getenv', 'getenv', 'environ.get'}


def dotted_name(e):
    return dotted_name(e.value) + '.' + e.attr if isinstance(e, ast.Attribute) and dotted_name(e.value) else e.id if isinstance(e, ast.Name) else None


def snake(n):
    return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', n).lower()


def canon(e, tree):
    """an expression's dotted name through the imports at the top of its file: boto3.client, sqlalchemy.orm.Session"""
    if isinstance(e, ast.Attribute):
        b = canon(e.value, tree)
        return b + '.' + e.attr if b else None
    if isinstance(e, ast.Name):
        bs = top_bindings(tree).get(e.id, []) if tree is not None else []
        if len(bs) == 1 and bs[0][0] == 'import':
            return bs[0][1]
        if len(bs) == 1 and bs[0][0] == 'from' and not bs[0][3]:
            return (bs[0][1] + '.' if bs[0][1] else '') + bs[0][2]
        return None if bs else e.id
    return None


SA_SESSION = {'sqlalchemy.orm.Session', 'sqlalchemy.orm.session.Session', 'sqlalchemy.orm.scoped_session', 'sqlalchemy.ext.asyncio.AsyncSession',
              'sqlmodel.Session', 'sqlalchemy.orm.scoping.scoped_session'}
SA_MAKER = {'sqlalchemy.orm.sessionmaker', 'sqlalchemy.ext.asyncio.async_sessionmaker'}
SA_ENGINE = {'sqlalchemy.create_engine', 'sqlalchemy.ext.asyncio.create_async_engine', 'sqlmodel.create_engine'}
DBAPI_MODS = {'psycopg2', 'psycopg', 'pymysql', 'sqlite3', 'mysql.connector', 'pg8000', 'cx_Oracle', 'oracledb', 'pyodbc', 'MySQLdb', 'pymssql'}
# the handles each store's operations run on
RECEIVERS = {'s3': {'s3-client', 's3-resource', 's3-bucket'}, 'dynamodb': {'dynamodb-client', 'dynamodb-table'}, 'sqs': {'sqs-client', 'sqs-queue'},
             'sql': {'db-conn', 'db-cursor', 'sa-session'}}
SQL_KEY = {'FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE', 'USING'}
SQL_END = {'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'ON', 'SET', 'VALUES', 'SELECT', 'RETURNING', 'WINDOW',
           'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'OUTER', 'FOR', 'WHEN', 'DEFAULT', 'DO', 'LATERAL', 'USING'}


def sql_names(text):
    """the tables a SQL text names, by a reading of its own: the name after FROM, JOIN, INTO, UPDATE, TABLE or USING,
    and each one after a comma in a FROM list; strings and comments name none"""
    t = re.sub(r"'(?:[^']|'')*'", "''", text)
    t = re.sub(r'--[^\n]*|/\*.*?\*/', ' ', t, flags=re.S)
    toks = re.findall(r'"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[\w$.\x00]+|[(),;]', t)
    out, want, in_from = set(), False, False
    for k, tok in enumerate(toks):
        up = tok.upper()
        if want:
            if up in ('ONLY', 'LATERAL', 'IF', 'NOT', 'EXISTS'):
                continue
            want = False
            if tok not in '(),;' and up not in SQL_END and not (k + 1 < len(toks) and toks[k + 1] == '('):
                out.add(re.sub(r'^["`\[]|["`\]]$', '', tok).replace('""', '"').lower())
            continue
        if up in SQL_KEY:
            want, in_from = True, up in ('FROM', 'JOIN', 'USING')
        elif tok == ',' and in_from:
            want = True
        elif up in SQL_END or tok in ('(', ')', ';'):
            in_from = False
    return out


def check_data(R, c):
    """a data use holds when the line runs an operation of the store on a handle of that store (a boto3 client,
    resource, table, bucket or queue; a DB-API connection or cursor; a SQLAlchemy session; a Django model's objects),
    and the resource is what the operation is given: its bucket, table or queue argument (or the object it is called
    on), the tables its SQL names, its model; each followed through the assignments that hold at the call, constants,
    imports and os.environ"""
    f, line, store, raw, envs = c['file'], c['line'], c['store'], c['raw'], set(c.get('envs') or [])
    tree = R.tree(f)
    if tree is None:
        return 'cannot read or parse the file'
    parent = {}
    for n in ast.walk(tree):
        for ch in ast.iter_child_nodes(n):
            parent[ch] = n
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.end_lineno == line
             and (n.func.attr in DATA_OPS.get(store, ()) or (store == 'django' and isinstance(n.func.value, ast.Attribute) and n.func.value.attr == 'objects'))]
    if not calls:
        return f'no {store} operation on the line'
    FN = (ast.FunctionDef, ast.AsyncFunctionDef)

    def enclosing(n, kinds):
        while n in parent:
            n = parent[n]
            if isinstance(n, kinds):
                return n
        return None

    def own(owner):
        stack = list(ast.iter_child_nodes(owner))
        while stack:
            n = stack.pop()
            yield n
            if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                stack.extend(ast.iter_child_nodes(n))

    def stmt(n):
        while n is not None and not isinstance(n, ast.stmt):
            n = parent.get(n)
        return n

    def body_of(st):
        p = parent.get(st)
        for attr in ('body', 'orelse', 'finalbody', 'handlers'):
            lst = getattr(p, attr, None)
            if isinstance(lst, list) and st in lst:
                return id(lst)
        return None

    def holding(owner, name, at):
        """the values assigned to a name in a function's (a module's) own code that still hold at node `at`: before
        it, and not replaced later by an assignment in a block `at` is in"""
        here, blocks = stmt(at), set()
        while here is not None:
            blocks.add(body_of(here))
            here = stmt(parent.get(here))
        found = []
        for n in own(owner):
            if isinstance(n, (ast.Assign, ast.AnnAssign, ast.AugAssign)) and n.value is not None and n.lineno < at.lineno:
                if any(isinstance(t, ast.Name) and t.id == name for t in (n.targets if isinstance(n, ast.Assign) else [n.target])):
                    found.append((n, n.value))
            if isinstance(n, (ast.With, ast.AsyncWith)) and n.lineno < at.lineno:
                found += [(n, it.context_expr) for it in n.items if isinstance(it.optional_vars, ast.Name) and it.optional_vars.id == name]
        found.sort(key=lambda x: (x[0].lineno, x[0].col_offset))
        out = []
        for k, (st, v) in enumerate(found):
            if not any(body_of(st2) in blocks for st2, _ in found[k + 1:]) or isinstance(st, ast.AugAssign):
                out.append(v)
        return out

    def scoped(e):
        """whether a lambda or a comprehension between the name and its function binds it"""
        n = e
        while n in parent:
            n = parent[n]
            if isinstance(n, FN):
                return False
            if isinstance(n, ast.Lambda) and e.id in {x.arg for x in n.args.posonlyargs + n.args.args + n.args.kwonlyargs + [y for y in (n.args.vararg, n.args.kwarg) if y]}:
                return True
            if isinstance(n, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)) and any(isinstance(x, ast.Name) and x.id == e.id for g in n.generators for x in ast.walk(g.target)):
                return True
        return False

    def module_values(mf, name, depth):
        mt = R.tree(mf)
        if mt is None:
            return set()
        out = set()
        for b in top_bindings(mt).get(name, [])[-1:]:          # the last binding at the top of the module
            if b[0] == 'assign':
                out |= values(b[1], mf, None, depth + 1)
            elif b[0] == 'from':
                for x in R.gives(b[1], os.path.dirname(mf), b[3], b[2]):
                    out |= module_values(x, b[2], depth + 1)
        if name in R.top_classes(mf):
            out |= model_values(mf, name)
        return out

    def model_values(mf, name):
        node = R.top_classes(mf)[name]
        out = {name, snake(name), name.lower()}
        for st in node.body:
            if isinstance(st, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '__tablename__' for t in st.targets) and isinstance(st.value, ast.Constant):
                out.add(str(st.value.value))
        return out

    def values(e, ef, fn, depth=0):
        """what strings an expression can give: literals, '$NAME' for an environment variable, model names"""
        if e is None or depth > 6:
            return set()
        local = ef == f
        if isinstance(e, ast.Constant) and isinstance(e.value, str):
            return {e.value}
        if isinstance(e, ast.JoinedStr):
            return {''.join(str(x.value) if isinstance(x, ast.Constant) else ' \x00 ' for x in e.values)}
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Add):
            ls, rs = values(e.left, ef, fn, depth + 1) or {' \x00 '}, values(e.right, ef, fn, depth + 1) or {' \x00 '}
            return {a + b for a in sorted(ls)[:8] for b in sorted(rs)[:8]}
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Mod):
            return values(e.left, ef, fn, depth + 1)
        if isinstance(e, ast.IfExp):
            return values(e.body, ef, fn, depth + 1) | values(e.orelse, ef, fn, depth + 1)
        if isinstance(e, ast.Subscript) and dotted_name(e.value) in ('os.environ', 'environ'):
            return {'$' + v for v in values(e.slice, ef, fn, depth + 1)}
        if isinstance(e, ast.Call):
            d = dotted_name(e.func) or ''
            if d in ENV_CALLS and e.args:
                return {'$' + v for v in values(e.args[0], ef, fn, depth + 1)}
            if isinstance(e.func, ast.Attribute) and e.func.attr == 'format':
                return values(e.func.value, ef, fn, depth + 1)
            if d.split('.')[-1] in ('text', 'select', 'insert', 'update', 'delete') and e.args:
                return values(e.args[0], ef, fn, depth + 1)
            if isinstance(e.func, ast.Attribute) and e.func.attr in ('where', 'filter', 'filter_by', 'order_by', 'limit', 'values', 'join', 'options'):
                return values(e.func.value, ef, fn, depth + 1)
            return set()
        if isinstance(e, ast.Name):
            if local and scoped(e):
                return set()
            if fn is not None and local:
                a = fn.args
                params = {x.arg for x in a.posonlyargs + a.args + a.kwonlyargs + [y for y in (a.vararg, a.kwarg) if y]}
                vs = holding(fn, e.id, e)
                if vs:
                    return set().union(*(values(v, ef, enclosing(v, FN), depth + 1) for v in vs))
                if e.id in params or any(isinstance(n, (ast.Assign, ast.AnnAssign)) and any(isinstance(t, ast.Name) and t.id == e.id for t in (n.targets if isinstance(n, ast.Assign) else [n.target])) for n in own(fn)):
                    return set()                                   # a parameter, or a local not yet set
                outer = enclosing(fn, FN)
                if outer is not None:
                    return values(e, ef, outer, depth + 1)
            return module_values(ef, e.id, depth)
        if isinstance(e, ast.Attribute):
            # self.x: what the class's methods assign to it; mod.X: the module's constant; Model.col: the model
            if isinstance(e.value, ast.Name) and e.value.id in ('self', 'cls') and fn is not None and local:
                cls = enclosing(fn, ast.ClassDef)
                out = set()
                for n in ast.walk(cls) if cls is not None else ():
                    if isinstance(n, (ast.Assign, ast.AnnAssign)) and n.value is not None:
                        for t in (n.targets if isinstance(n, ast.Assign) else [n.target]):
                            if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id in ('self', 'cls') and t.attr == e.attr:
                                out |= values(n.value, ef, enclosing(n, FN), depth + 1)
                return out
            out = set()
            for cf, cn in R.class_files(e.attr, ef, e):
                out |= model_values(cf, cn)
            if isinstance(e.value, ast.Name):
                mt = R.tree(ef)
                for b in (top_bindings(mt).get(e.value.id, []) if mt is not None else []):
                    mod = b[1] if b[0] == 'import' else (b[1] + '.' if b[1] else '') + b[2] if b[0] == 'from' else None
                    if mod is not None:
                        for x in R.modules(mod, os.path.dirname(ef), b[3] if b[0] == 'from' else 0):
                            out |= module_values(x, e.attr, depth + 1)
                for cf, cn in R.class_files(e.value.id, ef):
                    out |= model_values(cf, cn)
            return out
        return set()

    def sources(e, fn):
        """what a name (or self.x) holds at e: the values that reach it"""
        if isinstance(e, ast.Name):
            if scoped(e):
                return []
            if fn is not None:
                vs = holding(fn, e.id, e)
                a = fn.args
                if vs or e.id in {x.arg for x in a.posonlyargs + a.args + a.kwonlyargs}:
                    return vs
            return holding(tree, e.id, e) or [v for b in top_bindings(tree).get(e.id, [])[-1:] if b[0] == 'assign' for v in [b[1]]]
        if isinstance(e, ast.Attribute) and isinstance(e.value, ast.Name) and e.value.id == 'self' and fn is not None:
            cls = enclosing(fn, ast.ClassDef)
            return [n.value for n in (ast.walk(cls) if cls is not None else ()) if isinstance(n, ast.Assign)
                    for t in n.targets if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == 'self' and t.attr == e.attr]
        return []

    def origin(e, fn, depth=0):
        """the handles an expression may be: '<service>-client', 's3-bucket', 'db-conn', 'sa-session', …"""
        if e is None or depth > 6:
            return set()
        if isinstance(e, ast.Await):
            return origin(e.value, fn, depth + 1)
        if isinstance(e, ast.Call):
            d = canon(e.func, tree) or ''
            if d in ('boto3.client', 'boto3.resource') or (isinstance(e.func, ast.Attribute) and e.func.attr in ('client', 'resource') and 'session' in origin(e.func.value, fn, depth + 1)):
                svc = e.args[0].value if e.args and isinstance(e.args[0], ast.Constant) else next((k.value.value for k in e.keywords if k.arg == 'service_name' and isinstance(k.value, ast.Constant)), None)
                return {f"{svc}-{d.split('.')[-1] if d.startswith('boto3.') else e.func.attr}"} if svc else set()
            if d in ('boto3.Session', 'boto3.session.Session'):
                return {'session'}
            if d in SA_SESSION:
                return {'sa-session'}
            if d in SA_MAKER:
                return {'sa-maker'}
            if d in SA_ENGINE:
                return {'sa-engine'}
            if d == 'flask_sqlalchemy.SQLAlchemy':
                return {'flask-db'}
            if d.rpartition('.')[0] in DBAPI_MODS and d.endswith('.connect'):
                return {'db-conn'}
            if isinstance(e.func, ast.Attribute):
                base = origin(e.func.value, fn, depth + 1)
                a = e.func.attr
                out = set()
                if 'dynamodb-resource' in base and a == 'Table':
                    out.add('dynamodb-table')
                if 's3-resource' in base and a in ('Bucket', 'Object'):
                    out.add('s3-bucket')
                if 'sqs-resource' in base and a in ('Queue', 'get_queue_by_name'):
                    out.add('sqs-queue')
                if 'db-conn' in base and a == 'cursor':
                    out.add('db-cursor')
                if 'sa-engine' in base and a in ('connect', 'begin'):
                    out.add('db-conn')
                return out
            return {'sa-session'} if 'sa-maker' in origin(e.func, fn, depth + 1) else set()
        if isinstance(e, ast.Attribute) and e.attr == 'session' and 'flask-db' in origin(e.value, fn, depth + 1):
            return {'sa-session'}
        if isinstance(e, ast.Name) and fn is not None and not scoped(e):
            a = fn.args
            for x in a.posonlyargs + a.args + a.kwonlyargs:
                if x.arg == e.id and not holding(fn, e.id, e):
                    return {'sa-session'} if canon(x.annotation, tree) in SA_SESSION else set()
        return set().union(*(origin(v, enclosing(v, FN), depth + 1) for v in sources(e, fn))) if sources(e, fn) else set()

    def held(e, fn, depth=0):
        """the resource of the object an operation is called on: Table("x"), Bucket("x"), or a name or self.x set to one"""
        if depth > 4 or e is None:
            return set()
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and e.func.attr in HOLDERS.get(store, {}):
            kw = HOLDERS[store][e.func.attr]
            arg = e.args[0] if e.args else next((k.value for k in e.keywords if k.arg == kw), None)
            return values(arg, f, enclosing(e, FN))
        return set().union(*(held(v, enclosing(v, FN), depth + 1) for v in sources(e, fn))) if sources(e, fn) else set()

    def matches(vals):
        for v in vals:
            if raw.startswith('$'):
                if v == raw:
                    return True
                continue
            if v == raw or (v.startswith('$') and v[1:] in envs):
                return True
            if store == 'sql' and raw.lower() in sql_names(v):
                return True
        return False

    why = None
    for call in calls:
        fn = enclosing(call, FN)
        op = call.func.attr
        if store == 'django':
            m = call.func.value.value
            if not R.class_files(last_name(m) or '', f, m if isinstance(m, ast.Attribute) else None):
                why = f'{ast.unparse(m)} is no model class of the repo'
                continue
            vals = values(m, f, fn)
        else:
            kinds = origin(call.func.value, fn)
            if not kinds & RECEIVERS.get(store, set()):
                why = f'{ast.unparse(call.func.value)}.{op} is not on a {store} handle the checker can trace ({", ".join(sorted(kinds)) or "nothing"})'
                continue
            if store == 'sql':
                arg = call.args[0] if call.args else None
                vals = values(arg, f, fn)
            else:
                # on a Table, Bucket or Queue object, the object names it (Bucket(b).download_file(key, path): no
                # bucket argument); on a client, its Bucket/TableName/QueueUrl argument
                vals = held(call.func.value, fn) if kinds & {'s3-bucket', 'dynamodb-table', 'sqs-queue'} else set()
                if not vals:
                    kw = next((k.value for k in call.keywords if k.arg == KW[store]), None)
                    if kw is None and op in POSITIONAL and len(call.args) > POSITIONAL[op]:
                        kw = call.args[POSITIONAL[op]]
                    vals = values(kw, f, fn)
        if matches(vals):
            return None
        shown = ', '.join(sorted(v.replace('\x00', '…')[:40] for v in vals)[:4])
        why = f'{raw} is not what the operation is given ({shown or "nothing the checker can follow"})'
    return why

def main():
    req = json.load(sys.stdin)
    R = Repo(req['root'])
    out = []
    for c in req['checks']:
        try:
            out.append(check_data(R, c) if c.get('kind') == 'data' else check(R, c))
        except Exception as e:          # a check that breaks is a failure of that link, with where it broke
            import traceback
            out.append(f'the checker broke: {e!r} at {traceback.extract_tb(e.__traceback__)[-1].lineno}')
    json.dump(out, sys.stdout)


main()
