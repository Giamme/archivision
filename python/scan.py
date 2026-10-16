"""archivision's Python reader: the symbols, calls, references, imports and data access of a set of Python files, read
with the standard library's ast only. It never imports, runs or evaluates the code it reads.

Run as `python3 -I -S -B scan.py --memory-mb=N` with a request on stdin (JSON):
  {"files": {"rel/a.py": "<source>", ...}, "tests": ["rel/test_a.py"], "deploy": ["lambda", ...], "pkgdirs": ["src", ...]}
`deploy` are the folders a deployment runs code from (a serverless service, a Docker build context), `pkgdirs` the
package folders a project declares; both are import roots of the files under them. What test files do not resolve is
not counted. The answer goes to stdout as JSON (see `main`). Every relation says how sure it is: exact, inferred,
ambiguous or unresolved.

Imports are resolved per file, through that file's own import roots, in the order Python would search them:
  1. folders its own `sys.path` edits add, when the path is static (built from __file__ and string literals,
     directly or through names assigned once): inferred, since the edit runs at run time;
  2. the folder above its package (the topmost folder of `__init__.py` files holding it): exact;
  3. deployment roots and declared package folders holding it, nearest first: exact;
  4. folders other files' static sys.path edits add, when the file is inside one: inferred (a handler adding its
     folder for the modules it imports);
  5. its own folder (as when it runs as a script) and the repo: inferred.
A module is never matched by its name alone across the repo: two `app.py` in two lambdas stay two.
"""
import ast
import builtins
import json
import posixpath as pp
import re
import sys

# the pattern classes of match statements (ast.MatchAs, …) came with 3.10: on an older Python say so, not AttributeError
if sys.version_info < (3, 10):
    sys.stderr.write("archivision's Python reader needs Python 3.10 or later; this python3 is %d.%d.%d\n" % sys.version_info[:3])
    sys.exit(2)

RANK = {'exact': 0, 'inferred': 1, 'ambiguous': 2, 'unresolved': 3}


def worst(*s):
    return max(s, key=lambda x: RANK[x])


# decorators that return what they decorate (or only mark it), by the module they come from; any other decorator may
# replace it (functools.cache and lru_cache return a wrapper whose cache may answer without running the function), and
# a call to what it decorates is inferred. A decorator counts only when its name is that module's, not a local one
KEEPING = {'staticmethod': 'builtins', 'classmethod': 'builtins', 'abstractmethod': 'abc', 'overload': 'typing', 'override': 'typing',
           'final': 'typing', 'dataclass': 'dataclasses', 'runtime_checkable': 'typing'}
TYPING = ('typing', 'typing_extensions')
KEEP_CANON = {f'{m}.{n}' for n, mod in KEEPING.items() if mod != 'builtins' for m in ((mod,) + (TYPING[1:] if mod == 'typing' else ()))}
BUILTINS = set(dir(builtins))
DBAPI = {'psycopg2', 'psycopg', 'pymysql', 'sqlite3', 'mysql.connector', 'pg8000', 'cx_Oracle', 'oracledb', 'pyodbc', 'MySQLdb', 'pymssql'}
# boto3 operations per service: (reads, writes)
OPS = {
    'dynamodb': ({'get_item', 'query', 'scan', 'batch_get_item'}, {'put_item', 'update_item', 'delete_item', 'batch_writer', 'batch_write_item', 'transact_write_items'}),
    's3': ({'get_object', 'download_file', 'download_fileobj', 'head_object', 'list_objects', 'list_objects_v2', 'get_object_tagging', 'select_object_content'},
           {'put_object', 'upload_file', 'upload_fileobj', 'delete_object', 'delete_objects', 'copy_object', 'put_object_tagging'}),
    'sqs': ({'receive_message', 'receive_messages'}, {'send_message', 'send_message_batch', 'delete_message', 'delete_message_batch', 'change_message_visibility', 'send_messages'}),
}
# boto3 operation names no other common library uses: a call of one on an untraced value is counted, not dropped
UNTRACED = (OPS['s3'][0] | OPS['s3'][1] | OPS['dynamodb'][0] | OPS['dynamodb'][1] | OPS['sqs'][0] | OPS['sqs'][1]) - {'query', 'scan', 'list_objects'}
KIND = {'dynamodb': 'table', 's3': 'bucket', 'sqs': 'queue', 'sql': 'table', 'django': 'table'}
DJANGO_READ = {'get', 'filter', 'all', 'exclude', 'first', 'last', 'count', 'exists', 'values', 'values_list', 'aggregate', 'annotate', 'order_by', 'in_bulk', 'iterator'}
# ORM bases, by the library's own names
DJANGO_BASES = {'django.db.models.Model', 'django.db.models.base.Model'}
SA_BASES = {'sqlalchemy.orm.DeclarativeBase', 'sqlalchemy.orm.DeclarativeBaseNoMeta', 'sqlalchemy.orm.decl_api.DeclarativeBase',
            'sqlalchemy.orm.decl_api.DeclarativeBaseNoMeta'}
SA_MAKERS = {'sqlalchemy.orm.declarative_base', 'sqlalchemy.ext.declarative.declarative_base', 'sqlalchemy.orm.decl_api.declarative_base'}
# SQLAlchemy statements on a model: select(Order), insert(Order) …
SA_STMT = {f'{m}.{f}': op for m in ('sqlalchemy', 'sqlalchemy.sql', 'sqlalchemy.future', 'sqlalchemy.sql.expression', 'sqlmodel')
           for f, op in (('select', 'read'), ('insert', 'write'), ('update', 'write'), ('delete', 'write'))}
SA_RUN = {'execute', 'scalars', 'scalar', 'exec', 'scalar_one', 'scalar_one_or_none'}
# what holds a SQLAlchemy session: the classes, the makers whose calls make one, the engines
SA_SESSIONS = {'sqlalchemy.orm.Session', 'sqlalchemy.orm.session.Session', 'sqlmodel.Session', 'sqlalchemy.ext.asyncio.AsyncSession',
               'sqlalchemy.orm.scoped_session', 'sqlalchemy.orm.scoping.scoped_session', 'sqlalchemy.ext.asyncio.async_scoped_session'}
SA_MAKERS_S = {'sqlalchemy.orm.sessionmaker', 'sqlalchemy.orm.session.sessionmaker', 'sqlalchemy.ext.asyncio.async_sessionmaker'}
SA_ENGINES = {'sqlalchemy.create_engine', 'sqlmodel.create_engine', 'sqlalchemy.ext.asyncio.create_async_engine'}
SA_TEXT = {'sqlalchemy.text', 'sqlalchemy.sql.text', 'sqlalchemy.sql.expression.text'}
DJANGO_WRITE = {'create', 'update', 'delete', 'bulk_create', 'bulk_update', 'get_or_create', 'update_or_create'}
BODIES = ('body', 'orelse', 'finalbody')


def dotted(e):
    """a.b.c for a chain of names, else None"""
    parts = []
    while isinstance(e, ast.Attribute):
        parts.append(e.attr)
        e = e.value
    if isinstance(e, ast.Name):
        parts.append(e.id)
        return '.'.join(reversed(parts))
    return None


def short(s, n):
    s = re.sub(r'\s+', ' ', str(s)).strip()
    return s if len(s) <= n else s[:n - 1] + '…'


def own_nodes(st):
    """the nodes of a statement outside its bodies and outside functions and lambdas it holds"""
    stack = [v for k, v in ast.iter_fields(st) if k not in BODIES + ('handlers', 'cases')]
    while stack:
        x = stack.pop()
        if isinstance(x, list):
            stack.extend(x)
        elif isinstance(x, ast.AST):
            if isinstance(x, (ast.Lambda, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            yield x
            stack.extend(ast.iter_child_nodes(x))


def bound_names(st):
    """the names a statement binds in its own scope: assignment, for, with, except, del and walrus targets, and the
    captures of a match statement's patterns; not the targets of comprehensions (their own scope), nor anything
    inside nested functions, lambdas or classes"""
    roots = [v for k, v in ast.iter_fields(st) if k not in BODIES + ('handlers', 'cases')]
    for c in getattr(st, 'cases', None) or []:
        roots += [c.pattern, c.guard]
    stack = list(roots)
    while stack:
        x = stack.pop()
        if isinstance(x, list):
            stack.extend(x)
        elif isinstance(x, ast.AST):
            if isinstance(x, (ast.Lambda, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            if isinstance(x, ast.comprehension):
                stack.extend([x.iter] + x.ifs)          # its target binds inside the comprehension only
                continue
            if isinstance(x, ast.Name) and isinstance(x.ctx, (ast.Store, ast.Del)):
                yield x.id
            elif isinstance(x, (ast.MatchAs, ast.MatchStar)) and x.name:
                yield x.name
            elif isinstance(x, ast.MatchMapping) and x.rest:
                yield x.rest
            stack.extend(ast.iter_child_nodes(x))


def sub_bodies(st):
    for k in BODIES:
        b = getattr(st, k, None)
        if isinstance(b, list):
            yield [x for x in b if isinstance(x, ast.stmt)]
    for h in getattr(st, 'handlers', None) or []:
        yield h.body
    for c in getattr(st, 'cases', None) or []:
        yield c.body


class Sym:
    __slots__ = ('id', 'file', 'name', 'qname', 'kind', 'line', 'end', 'exported', 'sig', 'doc', 'member', 'parent', 'node', 'decorated', 'bases', 'scope',
                 'cond', 'mro')

    def out(self, canon):
        return {'id': self.id, 'file': self.file, 'name': self.name, 'qname': self.qname, 'kind': self.kind, 'line': self.line, 'end': self.end,
                'exported': self.exported, 'sig': self.sig, 'doc': self.doc, 'member': self.member, 'parent': canon(self.parent) if self.parent else None}


class Scope:
    """the names a module, class or function binds"""
    def __init__(self, kind, owner, parent, file):
        self.kind, self.owner, self.parent, self.file = kind, owner, parent, file
        self.defs = {}        # name -> [symbol id], in order
        self.imports = {}     # name -> ('mod', ref, status) | ('from', ref, attr, status) | ('external', name) | ('unresolved', name)
        self.typing = set()   # names imported only under `if TYPE_CHECKING:`
        self.assigned = {}    # name -> how many times it is bound (a parameter, an assignment, a for target…)
        self.values = {}      # name -> the expression last assigned to it
        self.calls = {}       # name -> the calls assigned to it (x = C(…)), one per binding that is one
        self.consts = {}      # module constants: name -> symbol id
        self.globals = set()
        self.nonlocals = set()
        self.alts = {}        # name -> every import binding of it, in order (an import in both branches of an if)
        self.all_names = None  # a module's __all__, when it is a literal list
        self.star = []        # (ref, status) of modules imported with *
        self.handles = {}     # name -> a data handle (a boto3 client or resource, a table, a DB-API connection or cursor)
        self.instances = {}   # name -> (class symbol id, exactly that class): `x = C()` (yes), a parameter `x: C` (or a subclass)
        self.attrs = None     # a class's scope: self.<attr> -> (class symbol id, exactly), as above


class Reader:
    def __init__(self, req):
        self.src = req['files']
        self.files = sorted(self.src)
        self.fileset = set(self.files)
        self.dirs = set()
        for f in self.files:
            d = pp.dirname(f)
            while d:
                self.dirs.add(d)
                d = pp.dirname(d)
        self.tests = set(req.get('tests') or [])   # test files: what they do not resolve is not counted
        self.roots_extra = sorted({d for d in (req.get('deploy') or []) + (req.get('pkgdirs') or [])}, key=lambda d: (-len(d), d))
        self.deploy = sorted(set(req.get('deploy') or []), key=lambda d: (-len(d), d))
        self.syms, self.order = {}, []
        self.mod = {}             # file -> module Scope
        self.trees, self.lines, self.errors = {}, {}, {}
        self.rel = {}
        self.data = []
        self.imports_of = {}      # file -> [[file, line, status]]
        self.syspath = {}         # file -> [folder] its static sys.path edits add
        self.syspath_lit = {}     # file -> [[folder…]] the folders each literal edit may add (where the program runs is not known)
        self.reassigned = set()   # (class qname or '*', attr): self.m = …, C.m = …, setattr(…, 'm', …)
        self.root_cache = {}
        self.syspath_all = None   # every folder a static sys.path edit adds, deepest first
        self.subs = None
        self.orm = {}             # class symbol id -> the ORM its bases trace to
        self.shadow_scope, self.shadow = None, []   # the walk's scope, and the names lambdas and comprehensions bind there
        self.count = {'call-local': 0, 'call-unknown': 0, 'call-dynamic': 0, 'call-ambiguous': 0, 'call-abstract': 0, 'call-member': 0, 'import-unresolved': 0, 'syspath-not-static': 0, 'data-unknown-name': 0, 'data-untraced': 0}

    # ---------- reading ----------
    def read(self):
        for f in self.files:
            text = self.src[f]
            self.lines[f] = text.split('\n')
            try:
                self.trees[f] = ast.parse(text, filename=f)
            except (SyntaxError, ValueError) as e:
                self.errors[f] = {'message': f'{type(e).__name__}: {getattr(e, "msg", None) or str(e)}', 'line': getattr(e, 'lineno', 0) or 0}
        for f in self.trees:
            self.find_syspath(f)
        for f in self.trees:
            self.declare(f)
        for sid in self.order:
            self.syms[sid].decorated = not all(self.keeps(sid, d) for d in getattr(self.syms[sid].node, 'decorator_list', []))
        # what changes classes at run time, and the module-level names that hold data handles or instances, before
        # any relation: a function's body may use a name the module binds below it
        for f in self.trees:
            self.find_mutations(f)
        for f in self.trees:
            self.module_bindings(f)
        for f in self.trees:
            self.walk(f)

    def col(self, f, line, byte_col):
        """a column as the page counts it (UTF-16 units, from 1), from ast's byte offset"""
        try:
            s = self.lines[f][line - 1].encode('utf-8')[:byte_col].decode('utf-8', 'replace')
        except IndexError:
            return byte_col + 1
        return len(s.encode('utf-16-le')) // 2 + 1

    # ---------- import roots ----------
    def roots_of(self, f):
        if f in self.root_cache:
            return self.root_cache[f]
        out, seen = [], set()

        def add(d, status):
            if d not in seen:
                seen.add(d)
                out.append((d, status))
            elif status == 'exact':           # a folder a sys.path edit adds that the file has anyway
                out[:] = [(x, 'exact' if x == d else st) for x, st in out]
        for d in self.syspath.get(f, []):
            add(d, 'inferred')
        d = pp.dirname(f)
        while d and pp.join(d, '__init__.py') in self.fileset:
            d = pp.dirname(d)
        add(d, 'exact')
        for r in self.roots_extra:
            if r in ('', '.') or f.startswith(r + '/'):
                add('' if r == '.' else r, 'exact')
        # a folder another file puts on sys.path (a handler adding its own folder) is a root, at run time, for the
        # modules inside it that the handler goes on to import
        if self.syspath_all is None:
            self.syspath_all = sorted({d for ds in self.syspath.values() for d in ds}, key=lambda d: (-len(d), d))
        for d in self.syspath_all:
            if d == '' or f.startswith(d + '/'):
                add(d, 'inferred')
        add(pp.dirname(f), 'inferred')
        add('', 'inferred')
        self.root_cache[f] = out
        return out

    def module_at(self, base):
        """the module a path names: a package's __init__.py, a .py file, or a namespace folder"""
        if base in ('', '.'):
            return None
        if pp.join(base, '__init__.py') in self.fileset:
            return ('file', pp.join(base, '__init__.py'))
        if base + '.py' in self.fileset:
            return ('file', base + '.py')
        if base in self.dirs:
            return ('dir', base)
        return None

    def resolve_module(self, f, name, level):
        """(ref, status) for a module a file imports; (None, 'external') when no root holds it, (None, 'unresolved') for a
        relative import that leaves the repo or names nothing"""
        parts = name.split('.') if name else []
        if level:
            d = pp.dirname(f)
            for _ in range(level - 1):
                if not d:
                    return None, 'unresolved'
                d = pp.dirname(d)
            if not parts:
                if pp.join(d, '__init__.py') in self.fileset:
                    return ('file', pp.join(d, '__init__.py')), 'exact'
                return (('dir', d), 'exact') if d else (None, 'unresolved')
            r = self.module_at(pp.join(d, *parts))
            return (r, 'exact') if r else (None, 'unresolved')
        hit, at = None, None
        for root, status in self.roots_of(f):
            r = self.module_at(pp.join(root, *parts) if root else pp.join(*parts))
            if r and hit is None:
                hit, at = (r, status), root
            elif r and r == hit[0] and status == 'exact':
                return r, 'exact'          # a root the file always has finds the same module: no run-time edit needed
        # a literal sys.path edit whose folders, by where the program runs, find different modules: either
        for group in self.syspath_lit.get(f, []):
            if hit and at in group and any((m := self.module_at(pp.join(d, *parts) if d else pp.join(*parts))) and m != hit[0] for d in group):
                return hit[0], 'ambiguous'
        return hit if hit else (None, 'external')

    def sub(self, ref, attr):
        """a submodule of a package or a namespace folder"""
        if ref is None:
            return None
        d = ref[1] if ref[0] == 'dir' else (pp.dirname(ref[1]) if ref[1].endswith('__init__.py') else None)
        return self.module_at(pp.join(d, attr) if d else attr) if d is not None else None

    # ---------- static sys.path edits ----------
    def miss(self, f, what):
        """count something not followed, in code that is not a test"""
        if f not in self.tests:
            self.count[what] += 1

    def find_syspath(self, f):
        def scope(body, outer, params):
            counts, last = {}, {}

            def collect(stmts):
                for st in stmts:
                    if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        counts[st.name] = counts.get(st.name, 0) + 2
                        continue
                    if isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name):
                        counts[st.targets[0].id] = counts.get(st.targets[0].id, 0) + 1
                        last[st.targets[0].id] = st.value
                    else:
                        for n in own_nodes(st):
                            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                                counts[n.id] = counts.get(n.id, 0) + 2
                    for b in sub_bodies(st):
                        collect(b)
            collect(body)
            values = {k: v for k, v in outer.items() if k not in counts and k not in params}
            values.update({k: v for k, v in last.items() if counts.get(k) == 1})

            def visit(stmts):
                for st in stmts:
                    if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        a = st.args
                        scope(st.body, values, {x.arg for x in a.posonlyargs + a.args + a.kwonlyargs + [y for y in (a.vararg, a.kwarg) if y]})
                        continue
                    if isinstance(st, ast.ClassDef):
                        visit(st.body)
                        continue
                    for n in own_nodes(st):
                        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ('insert', 'append') and dotted(n.func.value) == 'sys.path' and n.args:
                            p = self.path_value(f, n.args[-1], values, 0)
                            if isinstance(p, tuple):
                                # a literal path is relative to the folder the program runs from, which the code does not
                                # say: its deployment's root, the repo, or the file's own folder (each inferred); an
                                # absolute one is outside the repo
                                if not re.match(r'^(/|~|[A-Za-z]:[\\/]|\\\\)', p[1]):
                                    group = []
                                    for cwd in self.run_dirs(f):
                                        d = pp.normpath(pp.join(cwd, p[1]))
                                        if d == '.' or (not d.startswith('..') and d in self.dirs):
                                            self.add_syspath(f, d)
                                            group.append('' if d == '.' else d)
                                    self.syspath_lit.setdefault(f, []).append(group)
                            elif isinstance(p, str) and not p.startswith('..'):
                                self.add_syspath(f, p)
                            else:
                                self.miss(f, 'syspath-not-static')
                    for b in sub_bodies(st):
                        visit(b)
            visit(body)
        scope(self.trees[f].body, {}, set())

    def add_syspath(self, f, p):
        lst = self.syspath.setdefault(f, [])
        d = '' if p in ('', '.') else p
        if d not in lst:
            lst.append(d)

    def run_dirs(self, f):
        """the folders a file's program may run from: its deployment's root, the repo, its own folder"""
        out = [d for d in self.deploy[:] if f.startswith(d + '/')][:1] + ['', pp.dirname(f)]
        return list(dict.fromkeys(out))

    def path_value(self, f, e, values, depth):
        """a repo-relative path an expression always has (from __file__, literals and path functions), a ('lit', text)
        for a string literal, or None"""
        if depth > 25 or e is None:
            return None
        v = lambda x: self.path_value(f, x, values, depth + 1)
        text = lambda a: a[1] if isinstance(a, tuple) else a
        if isinstance(e, ast.Constant) and isinstance(e.value, str):
            return ('lit', e.value)
        if isinstance(e, ast.Name):
            if e.id == '__file__':
                return f
            return v(values[e.id]) if e.id in values else None
        if isinstance(e, ast.Call):
            fn = dotted(e.func) or ''
            if isinstance(e.func, ast.Attribute) and e.func.attr in ('resolve', 'absolute') and not e.args:
                return v(e.func.value)
            if e.keywords:
                return None
            args = [v(a) for a in e.args]
            if any(a is None for a in args):
                return None
            if fn in ('os.path.dirname', 'path.dirname', 'dirname') and len(args) == 1 and isinstance(args[0], str):
                return pp.dirname(args[0])
            if fn in ('os.path.abspath', 'os.path.realpath', 'os.path.normpath', 'abspath', 'realpath', 'normpath', 'Path', 'pathlib.Path', 'str', 'os.fspath') and len(args) == 1:
                return pp.normpath(args[0]) if isinstance(args[0], str) else ('lit', pp.normpath(args[0][1]))
            if fn in ('os.path.join', 'path.join', 'join', 'Path', 'pathlib.Path') and args:
                j = pp.normpath(pp.join(text(args[0]), *[text(a) for a in args[1:]]))
                return j if isinstance(args[0], str) else ('lit', j)
            return None
        if isinstance(e, ast.Attribute) and e.attr == 'parent':
            b = v(e.value)
            return pp.dirname(b) if isinstance(b, str) else None
        if isinstance(e, ast.Subscript) and isinstance(e.value, ast.Attribute) and e.value.attr == 'parents' and isinstance(e.slice, ast.Constant) and isinstance(e.slice.value, int):
            b = v(e.value.value)
            if not isinstance(b, str):
                return None
            for _ in range(e.slice.value + 1):
                b = pp.dirname(b)
            return b
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Div):
            a, b = v(e.left), v(e.right)
            if isinstance(a, str) and b is not None:
                return pp.normpath(pp.join(a, text(b)))
        return None

    # ---------- symbols ----------
    def declare(self, f):
        tree, mod = self.trees[f], Scope('module', None, None, f)
        self.mod[f] = mod
        count = {}
        all_names = None
        for st in tree.body:
            if isinstance(st, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '__all__' for t in st.targets) and isinstance(st.value, (ast.List, ast.Tuple)):
                all_names = {x.value for x in st.value.elts if isinstance(x, ast.Constant) and isinstance(x.value, str)}
        mod.all_names = all_names

        def new_id(q):
            k = count.get(q, 0) + 1
            count[q] = k
            return f'{f}#{q}' + (f'#{k}' if k > 1 else '')

        def sig_of(fn):
            try:
                return short('(' + ast.unparse(fn.args) + ')' + (' -> ' + ast.unparse(fn.returns) if fn.returns is not None else ''), 120)
            except Exception:
                return ''

        def doc_of(n):
            try:
                d = ast.get_docstring(n)
            except Exception:
                d = None
            if not d:
                return ''
            d = re.sub(r'\s+', ' ', d).strip()
            m = re.match(r'^(.{20,}?[.!?])\s', d)
            return short(m.group(1) if m else d, 180)

        def add(node, name, qname, kind, member, parent, exported):
            s = Sym()
            s.id, s.file, s.name, s.qname, s.kind = new_id(qname), f, name, qname, kind
            decos = getattr(node, 'decorator_list', [])
            s.line = min([node.lineno] + [d.lineno for d in decos])
            s.end = getattr(node, 'end_lineno', None) or node.lineno
            s.exported, s.member, s.parent, s.node = exported, member, parent, node
            fnlike = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            s.sig = sig_of(node) if fnlike else ''
            s.doc = doc_of(node) if fnlike or isinstance(node, ast.ClassDef) else ''
            s.decorated = None          # decided once the module's imports are known (keeps_function)
            s.bases, s.scope, s.cond, s.mro = None, None, False, None
            self.syms[s.id] = s
            self.order.append(s.id)
            return s

        def bind(scope, name, value):
            if scope.kind == 'class':
                return
            if name in scope.globals:
                scope = mod
            elif name in scope.nonlocals:                 # it rebinds the enclosing function's name
                s = scope.parent
                while s is not None and s.kind == 'class':
                    s = s.parent
                if s is None or s.kind != 'function':
                    return
                scope, value = s, None
            scope.assigned[name] = scope.assigned.get(name, 0) + 1
            if value is not None:
                scope.values[name] = value
                if isinstance(value, ast.Call):
                    scope.calls.setdefault(name, []).append(value)

        def names_in(t):
            if isinstance(t, ast.Name):
                yield t
            elif isinstance(t, (ast.Tuple, ast.List)):
                for x in t.elts:
                    yield from names_in(x)
            elif isinstance(t, ast.Starred):
                yield from names_in(t.value)

        def stmts(body, scope, prefix, parent, exported_parent, in_class, cond=False):
            for st in body:
                stmt(st, scope, prefix, parent, exported_parent, in_class, cond)

        def stmt(st, scope, prefix, parent, exported_parent, in_class, cond=False):
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                q = f'{prefix}.{st.name}' if prefix else st.name
                top = scope.kind == 'module'
                kind = 'class' if isinstance(st, ast.ClassDef) else ('method' if in_class else 'function')
                public = not st.name.startswith('_') or (st.name.startswith('__') and st.name.endswith('__'))
                exported = exported_parent and public and (all_names is None or not top or st.name in all_names)
                s = add(st, st.name, q, kind, not top, parent, exported)
                s.cond = cond and in_class          # a method defined under an if or a try in its class's body
                st._bv = s.id
                scope.defs.setdefault(st.name, []).append(s.id)
                inner = Scope('class' if kind == 'class' else 'function', s.id, scope, f)
                s.scope = inner
                if isinstance(st, ast.ClassDef):
                    stmts(st.body, inner, q, s.id, exported, True)
                else:
                    a = st.args
                    for x in a.posonlyargs + a.args + a.kwonlyargs + [y for y in (a.vararg, a.kwarg) if y]:
                        bind(inner, x.arg, None)
                    stmts(st.body, inner, q, s.id, exported, False)
                return
            if isinstance(st, (ast.Import, ast.ImportFrom)):
                self.imports(f, st, scope)
                return
            if isinstance(st, ast.If) and dotted(st.test) in ('TYPE_CHECKING', 'typing.TYPE_CHECKING'):
                before = set(scope.imports)
                stmts(st.body, scope, prefix, parent, exported_parent, in_class, True)
                scope.typing |= set(scope.imports) - before
                stmts(st.orelse, scope, prefix, parent, exported_parent, in_class, True)
                return
            if isinstance(st, ast.Global):
                scope.globals |= set(st.names)
                return
            if isinstance(st, ast.Nonlocal):
                scope.nonlocals |= set(st.names)
                return
            if isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                value = getattr(st, 'value', None)
                for t in (st.targets if isinstance(st, ast.Assign) else [st.target]):
                    for n in names_in(t):
                        plain = n is t and not isinstance(st, ast.AugAssign)
                        if scope.kind == 'module' and plain and n.id != '__all__' and n.id not in scope.consts and value is not None:
                            s = add(st, n.id, n.id, 'const', False, None, not n.id.startswith('_') and (all_names is None or n.id in all_names))
                            s.line, s.end = st.lineno, st.end_lineno or st.lineno
                            scope.consts[n.id] = s.id
                        bind(scope, n.id, value if plain else None)
                    if scope.kind == 'class':
                        for n in names_in(t):
                            scope.assigned[n.id] = scope.assigned.get(n.id, 0) + 1
                # a walrus in the value binds in this scope too
                if scope.kind != 'class' and value is not None:
                    for x in ast.walk(value):
                        if isinstance(x, ast.NamedExpr) and isinstance(x.target, ast.Name):
                            bind(scope, x.target.id, None)
            elif scope.kind != 'class':
                for n in bound_names(st):
                    bind(scope, n, None)
                for h in getattr(st, 'handlers', None) or []:
                    if h.name:
                        bind(scope, h.name, None)
            for b in sub_bodies(st):
                stmts(b, scope, prefix, parent, exported_parent, in_class, True)

        stmts(tree.body, mod, '', None, True, False)

    def imports(self, f, st, scope):
        if isinstance(st, ast.Import):
            for a in st.names:
                bound = a.asname or a.name.split('.')[0]
                ref, status = self.resolve_module(f, a.name if a.asname else a.name.split('.')[0], 0)
                scope.imports[bound] = ('mod', ref, status) if ref else (status, a.name if a.asname else bound)
                scope.alts.setdefault(bound, []).append(scope.imports[bound])
                full, fstatus = self.resolve_module(f, a.name, 0)
                self.note_import(f, full, st.lineno, fstatus)
            return
        ref, status = self.resolve_module(f, st.module or '', st.level or 0)
        if not ref:
            self.note_import(f, None, st.lineno, status)
        for a in st.names:
            if a.name == '*':
                if ref:
                    scope.star.append((ref, status))
                    self.note_import(f, ref, st.lineno, status)
                continue
            scope.imports[a.asname or a.name] = ('from', ref, a.name, status) if ref else (status, (st.module or '') + '.' + a.name)
            scope.alts.setdefault(a.asname or a.name, []).append(scope.imports[a.asname or a.name])
            if ref:
                self.note_import(f, self.sub(ref, a.name) or ref, st.lineno, status)

    def note_import(self, f, ref, line, status):
        if ref is None:
            if status == 'unresolved':
                self.miss(f, 'import-unresolved')
            return
        if ref[0] == 'file' and ref[1] != f:
            lst = self.imports_of.setdefault(f, [])
            if not any(x[0] == ref[1] for x in lst):
                lst.append([ref[1], line, status])

    # ---------- resolving names ----------
    def keeps(self, sid, d):
        """whether a decorator returns what it decorates: a builtin nothing rebinds, a module's own by its import
        (see KEEPING), read where the decorated def is (a name rebound, or a parameter of that name, is not it), or a
        property's .setter/.getter/.deleter"""
        s = self.syms[sid]
        sc = self.syms[s.parent].scope if s.parent else self.mod[s.file]
        e = d.func if isinstance(d, ast.Call) else d
        n = dotted(e) or ''
        if n.endswith(('.setter', '.getter', '.deleter')):
            # x.setter is a property's only when x is a def of this class decorated with the builtin property
            base = n.rsplit('.', 1)[0]
            if '.' in base or not s.parent or self.syms[s.parent].kind != 'class':
                return False
            return any(isinstance(d2, ast.Name) and d2.id == 'property' and self.holder('property', self.mod[s.file]) is None
                       for p in sc.defs.get(base, []) for d2 in self.syms[p].node.decorator_list)
        if KEEPING.get(n) == 'builtins':
            return self.holder(n, sc) is None
        return self.canon_dotted(e, sc) in KEEP_CANON

    def bindings(self, sc, name):
        """how many times a scope binds a name: definitions, imports, assignments and parameters"""
        return len(sc.defs.get(name, [])) + len(sc.alts.get(name, [])) + sc.assigned.get(name, 0)

    def alternatives(self, sc, name, depth=0):
        """a name a scope binds more than once: each binding that is a symbol, ambiguous; ('local',) when none is one
        (a parameter or an assignment rebinds it)"""
        out = [('sym', d, 'ambiguous') for d in sc.defs.get(name, [])]
        for b in sc.alts.get(name, []):
            r = self.from_bind(b, depth + 1)
            if r and r[0] == 'sym':
                out.append(('sym', r[1], 'ambiguous'))
            elif r and r[0] == 'alts':
                out.extend(r[1])
        if name in sc.consts:
            out.append(('sym', sc.consts[name], 'ambiguous'))
        seen, uniq = set(), []
        for x in out:
            k = self.canon(x[1])
            if k not in seen:
                seen.add(k)
                uniq.append(('sym', k, 'ambiguous'))
        if not uniq:
            return ('local',) if sc.kind == 'function' else ('unresolved',)
        return ('alts', uniq) if len(uniq) > 1 else uniq[0]

    def star_names(self, sc, name, depth):
        """what the modules a module imports with * give `name`: only names they export (their __all__, else names
        without a leading underscore); several: ambiguous"""
        hits = []
        for ref, status in sc.star:
            m = self.mod.get(ref[1]) if ref[0] == 'file' else None
            if m is not None and (name not in m.all_names if m.all_names is not None else name.startswith('_')):
                continue
            r = self.attr_of(ref, name, depth + 1)
            if r and r[0] in ('sym', 'mod'):
                hits.append((r[0], r[1], worst(r[2], status)))
        if len(hits) > 1:
            syms = [h for h in hits if h[0] == 'sym']
            return ('alts', [('sym', self.canon(h[1]), 'ambiguous') for h in syms]) if len(syms) > 1 else (syms[0][0], syms[0][1], 'ambiguous') if syms else None
        return hits[0] if hits else None

    def attr_of(self, ref, attr, depth=0):
        """what `attr` is in a module: ('sym', id, status) | ('mod', ref, status) | None"""
        if depth > 15 or ref is None:
            return None
        sc = self.mod.get(ref[1]) if ref[0] == 'file' else None
        if sc is not None:
            r = self.name_in_module(sc, attr, depth)
            if r and r[0] in ('sym', 'mod', 'alts'):
                return r
        s = self.sub(ref, attr)
        return ('mod', s, 'exact') if s else None

    def name_in_module(self, sc, name, depth):
        if depth > 15:
            return None
        n = self.bindings(sc, name)
        star = self.star_names(sc, name, depth) if sc.star else None
        if n > 1 or (n and star):
            return self.alternatives(sc, name, depth)
        if name in sc.defs:
            return ('sym', sc.defs[name][0], self.def_status(sc, name))
        if name in sc.imports and name not in sc.typing:
            return self.from_bind(sc.imports[name], depth + 1)
        if name in sc.consts:
            return ('sym', sc.consts[name], 'inferred')
        return star

    def def_status(self, sc, name):
        ids = sc.defs[name]
        if len(ids) > 1 and not all(self.syms[i].kind == 'method' for i in ids):
            return 'ambiguous'          # defined twice (a fallback in try/except, a conditional def): either may be bound
        if sc.assigned.get(name) or name in sc.consts:
            return 'ambiguous'          # also assigned
        return 'inferred' if self.syms[ids[0]].decorated else 'exact'

    def from_bind(self, b, depth=0):
        if b[0] == 'mod':
            return ('mod', b[1], b[2])
        if b[0] == 'from':
            r = self.attr_of(b[1], b[2], depth + 1)
            if r and r[0] == 'alts':
                return r
            return (r[0], r[1], worst(r[2], b[3])) if r else ('unresolved',)
        return ('external',) if b[0] == 'external' else ('unresolved',)

    def resolve_name(self, name, scope):
        """a bare name used in a scope: ('sym', id, status) | ('alts', [('sym', id, 'ambiguous')…]) | ('mod', ref, status)
        | ('local',) | ('typing',) | ('external',) | ('unresolved',) | None"""
        # a lambda's parameters and a comprehension's targets, around the code being walked
        if self.shadow_scope is scope and any(name in x for x in self.shadow):
            return ('local',)
        s, first = scope, True
        while s is not None:
            if s.kind == 'class' and not first:
                s = s.parent
                continue
            first = False
            if name in s.globals and s.kind != 'module':
                s = self.mod[s.file]
                continue
            if name in s.nonlocals and s.kind != 'module':      # the enclosing function's name, never the module's
                s = s.parent
                while s is not None and s.kind == 'class':
                    s = s.parent
                if s is None or s.kind == 'module':
                    return ('unresolved',)
                continue
            if s.kind == 'module':
                if name in s.typing and name in s.imports and self.bindings(s, name) == 1:
                    return ('typing',)
                return self.name_in_module(s, name, 0)
            if s.kind == 'function' and self.bindings(s, name) > 1:
                return self.alternatives(s, name) if (name in s.defs or name in s.alts) and not s.assigned.get(name) else ('local',)
            if name in s.defs:
                return ('sym', s.defs[name][0], self.def_status(s, name))
            if name in s.imports:
                return ('typing',) if name in s.typing else self.from_bind(s.imports[name])
            if s.kind == 'function' and name in s.assigned:
                return ('local',)
            s = s.parent
        return None

    def bases_of(self, cid):
        c = self.syms[cid]
        if c.bases is None:
            c.bases = []
            sc = self.syms[c.parent].scope if c.parent else self.mod[c.file]
            for b in c.node.bases:
                if isinstance(b, ast.Name) and b.id == 'object':
                    continue
                r = self.resolve_expr(b, sc)
                c.bases.append(r[1] if r and r[0] == 'sym' and self.syms[r[1]].kind == 'class' else None)
        return c.bases

    def annotated_as(self, e, scope):
        """the library name an annotation gives (Session, Optional[Session], Annotated[Session, …], "Session",
        Session | None), by its import; '' when none"""
        if isinstance(e, ast.Constant) and isinstance(e.value, str):
            try:
                e = ast.parse(e.value, mode='eval').body
            except SyntaxError:
                return ''
        if isinstance(e, ast.Subscript) and (dotted(e.value) or '').split('.')[-1] in ('Optional', 'Annotated'):
            inner = e.slice.elts[0] if isinstance(e.slice, ast.Tuple) else e.slice
            return self.annotated_as(inner, scope)
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.BitOr):
            sides = [x for x in (e.left, e.right) if not (isinstance(x, ast.Constant) and x.value is None)]
            return self.annotated_as(sides[0], scope) if len(sides) == 1 else ''
        return self.canon_dotted(e, scope) if isinstance(e, (ast.Name, ast.Attribute)) else ''

    def class_of_annotation(self, e, scope):
        """the repo class an annotation names: C, mod.C, Optional[C], C | None, "C"; else None"""
        if e is None:
            return None
        if isinstance(e, ast.Constant) and isinstance(e.value, str):
            try:
                e = ast.parse(e.value, mode='eval').body
            except SyntaxError:
                return None
        if isinstance(e, ast.Subscript) and (dotted(e.value) or '').split('.')[-1] == 'Optional':
            return self.class_of_annotation(e.slice, scope)
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.BitOr):
            sides = [x for x in (e.left, e.right) if not (isinstance(x, ast.Constant) and x.value is None)]
            return self.class_of_annotation(sides[0], scope) if len(sides) == 1 else None
        if isinstance(e, (ast.Name, ast.Attribute)):
            r = self.resolve_expr(e, scope)
            if r and r[0] == 'sym' and self.syms[r[1]].kind == 'class':
                return r[1]
        return None

    def attr_class(self, cid, attr, seen=None):
        """the repo class self.<attr> always holds in a class: every assignment to it in the class's methods is C()
        of one class, or it is annotated with one (in a method or the class body); else the nearest base's"""
        seen = seen if seen is not None else set()
        if cid in seen:
            return None
        seen.add(cid)
        c = self.syms[cid]
        if c.scope.attrs is None:
            found = {}
            for st in c.node.body:
                if isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name):
                    a = self.class_of_annotation(st.annotation, c.scope)
                    found.setdefault(st.target.id, set()).add((a, False) if a else None)
            for fn in c.node.body:
                if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) or not hasattr(fn, '_bv'):
                    continue
                msc = self.syms[fn._bv].scope
                for n in ast.walk(fn):
                    tgts = n.targets if isinstance(n, ast.Assign) else [n.target] if isinstance(n, (ast.AnnAssign, ast.AugAssign)) else []
                    for t in tgts:
                        if not (isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == 'self'):
                            continue
                        k = None
                        if isinstance(n, ast.AnnAssign):
                            a = self.class_of_annotation(n.annotation, msc)
                            k = (a, False) if a else None
                        if k is None and isinstance(n, (ast.Assign, ast.AnnAssign)) and isinstance(n.value, ast.Call):
                            r = self.resolve_expr(n.value, msc)
                            k = (r[1], True) if r and r[0] == 'instance' else None
                        found.setdefault(t.attr, set()).add(k)
            # one class for every assignment; an annotation and C() of the same class agree on «C or a subclass»
            c.scope.attrs = {}
            for a, ks in found.items():
                cls = {k[0] for k in ks if k}
                if None not in ks and len(cls) == 1:
                    c.scope.attrs[a] = (cls.pop(), all(k[1] for k in ks))
        if attr in c.scope.attrs:
            return c.scope.attrs[attr]
        for b in self.bases_of(cid):
            r = b and self.attr_class(b, attr, seen)
            if r:
                return r
        return None

    def mro(self, cid, stack=()):
        """a class's method resolution order (C3), with ('ext', …) standing for a base outside the repo; None when it
        cannot be built (a cycle, an inconsistent hierarchy)"""
        c = self.syms[cid]
        if c.mro is not None:
            return c.mro or None
        if cid in stack:
            return None
        seqs = []
        bases = [b if b else ('ext', cid, i) for i, b in enumerate(self.bases_of(cid))]
        for b in bases:
            m = [b] if isinstance(b, tuple) else self.mro(b, stack + (cid,))
            if m is None:
                c.mro = []
                return None
            seqs.append(list(m))
        seqs.append(list(bases))
        out = [cid]
        while any(seqs):
            seqs = [q for q in seqs if q]
            head = next((q[0] for q in seqs if not any(q[0] in r[1:] for r in seqs)), None)
            if head is None:
                c.mro = []
                return None
            out.append(head)
            seqs = [q[1:] if q[0] == head else q for q in seqs]
        c.mro = out
        return out

    def method_info(self, cid, name, after=None):
        """the method `name` a class's instances get, by its MRO (after `after` in it, for super()): (id or None,
        sure) — not sure when a base outside the repo comes first (it may define the name), when the MRO cannot be
        built, or when the method is defined under a condition over an outside base"""
        m = self.mro(cid)
        if m is None:
            return None, False
        if after is not None:
            if after not in m:
                return None, False
            m = m[m.index(after) + 1:]
        open_before = False
        for k in m:
            if isinstance(k, tuple):
                open_before = True
                continue
            sc = self.syms[k].scope
            if sc and name in sc.defs:
                d = sc.defs[name][0]
                return d, not open_before and not (self.syms[d].cond and self.open_bases(k))
            if sc and sc.assigned.get(name):
                return None, False                        # m = lambda …, m = other: a value, not followed
        return None, False

    def method_of(self, cid, name):
        """a class's method `name`, by its MRO"""
        return self.method_info(cid, name)[0]

    def is_stub(self, mid):
        """an abstract method, or one whose body only says it is not there (…, pass, a docstring, raise
        NotImplementedError): its implementation is elsewhere"""
        n = self.syms[mid].node
        if any((dotted(d.func if isinstance(d, ast.Call) else d) or '').split('.')[-1] == 'abstractmethod' for d in getattr(n, 'decorator_list', [])):
            return True
        body = [b for b in getattr(n, 'body', []) if not (isinstance(b, ast.Expr) and isinstance(b.value, ast.Constant) and isinstance(b.value.value, str))]
        return all(isinstance(b, ast.Pass) or (isinstance(b, ast.Expr) and isinstance(b.value, ast.Constant) and b.value.value is Ellipsis)
                   or (isinstance(b, ast.Raise) and b.exc is not None and (dotted(b.exc.func if isinstance(b.exc, ast.Call) else b.exc) or '').endswith('NotImplementedError')) for b in body)

    def is_protocol(self, cid):
        """a typing.Protocol: its implementations need not name it"""
        sc = self.syms[self.syms[cid].parent].scope if self.syms[cid].parent else self.mod[self.syms[cid].file]
        for b in self.syms[cid].node.bases:
            e = b.value if isinstance(b, ast.Subscript) else b
            if (self.canon_dotted(e, sc) or '').split('.')[-1] == 'Protocol' and (self.canon_dotted(e, sc) or '').split('.')[0] in TYPING:
                return True
        return any(b and self.is_protocol(b) for b in self.bases_of(cid))

    def dynamic_class(self, cid, seen=None):
        """a class whose attributes a metaclass may provide (any metaclass but abc's), itself or through a repo base"""
        seen = seen if seen is not None else set()
        if cid in seen:
            return False
        seen.add(cid)
        c = self.syms[cid]
        sc = self.syms[c.parent].scope if c.parent else self.mod[c.file]
        for k in c.node.keywords:
            if k.arg == 'metaclass' and self.canon_dotted(k.value, sc) != 'abc.ABCMeta' and not (dotted(k.value) == 'type' and self.holder('type', sc) is None):
                return True
        return any(b and self.dynamic_class(b, seen) for b in self.bases_of(cid))

    def changed(self, cid, attr):
        """whether code assigns `attr` on a class (or its instances) in its MRO, or with setattr anywhere"""
        if ('*', attr) in self.reassigned:
            return True
        for k in self.mro(cid) or [cid]:
            if not isinstance(k, tuple) and (self.syms[k].qname, attr) in self.reassigned:
                return True
        return False

    def candidates(self, cid, name, exact_class):
        """what `x.name()` may run when x is an instance of class cid (exact_class: made right there with cid(),
        else any subclass too): concrete methods (stubs only when nothing else), and whether the answer is sure"""
        out, sure = [], True
        for k in [cid] + ([] if exact_class else self.subclasses(cid)):
            m, ok = self.method_info(k, name)
            sure = sure and ok
            if m and m not in out:
                out.append(m)
        concrete = [m for m in out if not self.is_stub(m)]
        return (concrete or out), sure

    def find_mutations(self, f):
        """every `C.m = …`, `self.m = …` (in C's methods), `del C.m` and setattr(…, 'm', …), before any call is read"""
        reader = self

        class M(ast.NodeVisitor):
            def __init__(self):
                self.scope, self.cls = reader.mod[f], None

            def visit_FunctionDef(self, node):
                saved = (self.scope, self.cls)
                self.scope = reader.syms[node._bv].scope
                for st in node.body:
                    self.visit(st)
                self.scope, self.cls = saved
            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_ClassDef(self, node):
                saved = (self.scope, self.cls)
                self.scope, self.cls = reader.syms[node._bv].scope, node._bv
                # a method the class body binds again (an assignment, a second def): one symbol stands for both (the
                # first), so its calls are ambiguous
                q, cs = reader.syms[node._bv].qname, self.scope
                for name, ids in cs.defs.items():
                    if cs.assigned.get(name) or len(ids) > 1:
                        reader.reassigned.add((q, name))
                for st in node.body:
                    self.visit(st)
                self.scope, self.cls = saved

            def target(self, t):
                if not isinstance(t, ast.Attribute):
                    for x in getattr(t, 'elts', []) or []:
                        self.target(x)
                    return
                if isinstance(t.value, ast.Name) and t.value.id in ('self', 'cls') and self.cls:
                    reader.reassigned.add((reader.syms[self.cls].qname, t.attr))
                    return
                b = reader.resolve_expr(t.value, self.scope)
                if b and b[0] == 'sym' and reader.syms[b[1]].kind == 'class':
                    reader.reassigned.add((reader.syms[b[1]].qname, t.attr))

            def visit_Assign(self, node):
                for t in node.targets:
                    self.target(t)
                self.generic_visit(node)

            def visit_AugAssign(self, node):
                self.target(node.target)
                self.generic_visit(node)
            visit_AnnAssign = visit_AugAssign

            def visit_Delete(self, node):
                for t in node.targets:
                    self.target(t)

            def visit_Call(self, node):
                if isinstance(node.func, ast.Name) and node.func.id in ('setattr', 'delattr') and len(node.args) >= 2:
                    a = node.args[1]
                    reader.reassigned.add(('*', a.value) if isinstance(a, ast.Constant) and isinstance(a.value, str) else ('*', '*'))
                self.generic_visit(node)
        M().visit(self.trees[f])

    def module_bindings(self, f):
        """the data handles and instances the module's names hold when bound once: functions run after the module, so a
        name bound below a function is known in it"""
        mod = self.mod[f]

        def visit(body):
            for st in body:
                if isinstance(st, (ast.Assign, ast.AnnAssign)) and getattr(st, 'value', None) is not None:
                    for t in (st.targets if isinstance(st, ast.Assign) else [st.target]):
                        if isinstance(t, ast.Name) and mod.assigned.get(t.id) == 1 and t.id not in mod.defs and t.id not in mod.alts:
                            h = self.handle(f, st.value, mod, None)
                            if h:
                                mod.handles[t.id] = h
                            r = self.resolve_expr(st.value, mod) if isinstance(st.value, ast.Call) else None
                            if r and r[0] == 'instance':
                                mod.instances[t.id] = (r[1], True)
                if not isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    for b in sub_bodies(st):
                        visit(b)
        visit(self.trees[f].body)

    def made_by(self, sc, name):
        """the class every binding of a name in a scope makes (x = C(…) in each branch), as (class id, exactly)"""
        vs = sc.calls.get(name, [])
        if not vs or len(vs) != sc.assigned.get(name, 0) or name in sc.defs or name in sc.alts:
            return None
        cs = set()
        for v in vs:
            r = self.resolve_expr(v, sc)
            if not (r and r[0] == 'instance'):
                return None
            cs.add(r[1])
        return (cs.pop(), True) if len(cs) == 1 else None

    def open_bases(self, cid, seen=None):
        """whether a class has a base outside the repo, which may define any method"""
        seen = seen if seen is not None else set()
        if cid in seen:
            return False
        seen.add(cid)
        return any(b is None or self.open_bases(b, seen) for b in self.bases_of(cid))

    def subclasses(self, cid):
        if self.subs is None:
            self.subs = {}
            for sid in self.order:
                if self.syms[sid].kind == 'class':
                    for b in self.bases_of(sid):
                        if b:
                            self.subs.setdefault(b, []).append(sid)
        out, todo = [], list(self.subs.get(cid, []))
        while todo:
            x = todo.pop(0)
            if x not in out:
                out.append(x)
                todo.extend(self.subs.get(x, []))
        return out

    def resolve_expr(self, e, scope):
        if isinstance(e, ast.Name):
            return self.resolve_name(e.id, scope)
        if isinstance(e, ast.Attribute):
            base = self.resolve_expr(e.value, scope)
            if not base or base[0] == 'alts':
                return None
            if base[0] == 'mod':
                r = self.attr_of(base[1], e.attr)
                if r and r[0] == 'alts':
                    return r
                return (r[0], r[1], worst(r[2], base[2])) if r else ('unresolved',)
            if base[0] == 'external':
                return ('external',)
            if base[0] == 'sym' and self.syms[base[1]].kind == 'class':
                m, sure = self.method_info(base[1], e.attr)
                return ('sym', m, base[2] if sure and not self.syms[m].decorated else worst(base[2], 'inferred')) if m else None
            if base[0] == 'instance':                               # C().m(): a method of an instance made right there
                m, sure = self.method_info(base[1], e.attr)
                return ('sym', m, worst(base[2], 'inferred' if sure else 'ambiguous')) if m else None
            return None
        if isinstance(e, ast.Call):
            r = self.resolve_expr(e.func, scope)
            if r and r[0] == 'sym' and self.syms[r[1]].kind == 'class':
                return ('instance', r[1], r[2])
        return None

    # ---------- relations ----------
    def add_rel(self, frm, to, rel, f, line, byte_col, status):
        k = (frm, to, rel)
        site = [line, self.col(f, line, byte_col)]
        r = self.rel.get(k)
        if r is None:
            self.rel[k] = {'from': frm, 'to': to, 'rel': rel, 'sites': [site], 'n': 1, 'status': status}
        else:
            r['sites'].append(site)
            r['n'] += 1
            r['status'] = worst(r['status'], status)

    @staticmethod
    def canon(sid):
        """a later definition of a name stands for the first, as in the TypeScript reader"""
        return re.sub(r'#\d+$', '', sid) if sid.count('#') > 1 else sid

    def top_of(self, sid):
        s = self.syms[sid]
        while s.member and s.parent:
            s = self.syms[s.parent]
        return s.id

    def walk(self, f):
        reader, tree = self, self.trees[f]

        class V(ast.NodeVisitor):
            def __init__(self):
                self.scope, self.owner, self.cls, self.in_type = reader.mod[f], None, None, 0
                self.shadow = []            # names lambdas and comprehensions around the code bind
                self.sync()

            def sync(self):
                reader.shadow_scope, reader.shadow = self.scope, self.shadow

            def visit_FunctionDef(self, node):
                self.enter(node)
            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_ClassDef(self, node):
                self.enter(node)

            def visit_Lambda(self, node):
                a = node.args
                for x in a.defaults + [y for y in a.kw_defaults if y is not None]:
                    self.visit(x)
                self.shadow.append({x.arg for x in a.posonlyargs + a.args + a.kwonlyargs + [y for y in (a.vararg, a.kwarg) if y]})
                self.visit(node.body)
                self.shadow.pop()

            def comp(self, node, parts):
                # the first iterable runs outside; the targets bind inside, for the rest
                gens = node.generators
                self.visit(gens[0].iter)
                names = set()
                for g in gens:
                    names |= {n.id for n in ast.walk(g.target) if isinstance(n, ast.Name)}
                self.shadow.append(names)
                for i, g in enumerate(gens):
                    if i:
                        self.visit(g.iter)
                    for c in g.ifs:
                        self.visit(c)
                for x in parts:
                    self.visit(x)
                self.shadow.pop()

            def visit_ListComp(self, node):
                self.comp(node, [node.elt])
            visit_SetComp = visit_GeneratorExp = visit_ListComp

            def visit_DictComp(self, node):
                self.comp(node, [node.key, node.value])

            def enter(self, node):
                # decorators, defaults and bases run where the definition is
                for d in node.decorator_list:
                    if not isinstance(d, ast.Call) and not (isinstance(d, ast.Attribute) and reader.keeps(node._bv, d)):
                        reader.call(f, d, self.scope, self.owner, self.cls)   # @dec applies dec: a call (a property's .setter is none)
                    self.visit(d)
                if isinstance(node, ast.ClassDef):
                    for b in node.bases + [k.value for k in node.keywords]:
                        self.visit(b)
                else:
                    a = node.args
                    for x in a.defaults + [y for y in a.kw_defaults if y is not None]:
                        self.visit(x)
                    self.in_type += 1
                    for x in a.posonlyargs + a.args + a.kwonlyargs + [y for y in (a.vararg, a.kwarg) if y]:
                        if x.annotation is not None:
                            self.visit(x.annotation)
                    if node.returns is not None:
                        self.visit(node.returns)
                    self.in_type -= 1
                saved = (self.scope, self.owner, self.cls)
                s = reader.syms[node._bv]
                if not isinstance(node, ast.ClassDef):
                    a = node.args
                    for x in a.posonlyargs + a.args + a.kwonlyargs:
                        c = reader.class_of_annotation(x.annotation, self.scope)
                        if c and s.scope.assigned.get(x.arg) == 1:
                            s.scope.instances[x.arg] = (c, False)
                        if s.scope.assigned.get(x.arg) == 1 and reader.annotated_as(x.annotation, self.scope) in SA_SESSIONS:
                            s.scope.handles[x.arg] = ('sa-session',)
                self.scope, self.owner = s.scope, s.id
                if isinstance(node, ast.ClassDef):
                    self.cls = s.id
                shadow, self.shadow = self.shadow, []      # a def's body is a scope of its own
                self.sync()
                for st in node.body:
                    self.visit(st)
                self.scope, self.owner, self.cls = saved
                self.shadow = shadow
                self.sync()

            def visit_AnnAssign(self, node):
                self.in_type += 1
                self.visit(node.annotation)
                self.in_type -= 1
                if node.value is not None:
                    self.visit(node.value)
                    self.track(node.target, node.value)
                self.visit(node.target)

            def visit_Assign(self, node):
                self.visit(node.value)
                for t in node.targets:
                    self.visit(t)
                    self.track(t, node.value)

            def track(self, t, value):
                h = reader.handle(f, value, self.scope, self.cls)
                if isinstance(t, ast.Name):
                    sc = reader.mod[f] if t.id in self.scope.globals else self.scope
                    if h:
                        sc.handles[t.id] = h
                    else:
                        sc.handles.pop(t.id, None)
                    r = reader.resolve_expr(value, self.scope) if isinstance(value, ast.Call) else None
                    if r and r[0] == 'instance':
                        sc.instances[t.id] = (r[1], True)
                    else:
                        sc.instances.pop(t.id, None)
                elif isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == 'self' and self.cls:
                    if h:
                        reader.syms[self.cls].scope.handles['self.' + t.attr] = h

            def visit_With(self, node):
                for it in node.items:
                    self.visit(it.context_expr)
                    if isinstance(it.optional_vars, ast.Name):
                        h = reader.handle(f, it.context_expr, self.scope, self.cls)
                        if h:
                            self.scope.handles[it.optional_vars.id] = h
                        else:
                            self.scope.handles.pop(it.optional_vars.id, None)
                for st in node.body:
                    self.visit(st)
            visit_AsyncWith = visit_With

            def visit_Name(self, node):
                if isinstance(node.ctx, ast.Load):
                    reader.reference(f, node, reader.resolve_name(node.id, self.scope), self.owner, self.in_type)

            def visit_Attribute(self, node):
                if isinstance(node.ctx, ast.Load) and dotted(node):
                    r = reader.resolve_expr(node, self.scope)
                    if r and r[0] == 'sym':
                        reader.reference(f, node, r, self.owner, self.in_type)
                        return
                self.generic_visit(node)

            def visit_Call(self, node):
                reader.call(f, node.func, self.scope, self.owner, self.cls)
                reader.data_use(f, node, self.scope, self.owner, self.cls)
                self.generic_visit(node)

        V().visit(tree)

    def reference(self, f, node, r, owner, in_type):
        """a name that names another file's top-level symbol: a reference (in an annotation: a type reference)"""
        if not r or r[0] != 'sym' or not r[1]:
            return
        t = self.syms[r[1]]
        if t.file == f or t.member:
            return
        frm = self.canon(self.top_of(owner)) if owner else f
        self.add_rel(frm, self.canon(t.id), 'type' if in_type else 'ref', f, node.lineno, node.col_offset if isinstance(node, ast.Name) else node.end_col_offset - len(node.attr.encode('utf-8')), r[2])

    @staticmethod
    def site(fn):
        """the line and byte column of the name a call invokes"""
        if isinstance(fn, ast.Attribute):
            return fn.end_lineno, fn.end_col_offset - len(fn.attr.encode('utf-8'))
        return fn.lineno, fn.col_offset

    def call(self, f, fn, scope, owner, cls):
        frm = self.canon(owner) if owner else f
        line, col = self.site(fn)

        def add(to, status):
            self.add_rel(frm, self.canon(to), 'call', f, line, col, status)

        def several(ms, sure, changed):
            """several targets: each ambiguous; one: inferred, ambiguous when code reassigns it"""
            if len(ms) > 1 or (ms and changed):
                self.miss(f, 'call-ambiguous')
                for m in ms:
                    add(m, 'ambiguous')
            elif ms:
                add(ms[0], 'inferred')
        # super().m(), super(B, self).m(): the next class after this one (or B) in the MRO of each class that may run
        # it (this one and its subclasses; for super(B, obj), B and its subclasses): exact when they all agree, nothing
        # outside the repo comes first and no decorator wraps it
        if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Call) and isinstance(fn.value.func, ast.Name) and fn.value.func.id == 'super' \
                and self.holder('super', scope) is None and not self.shadowed('super', scope) and (cls or fn.value.args):
            a, start = fn.value.args, cls
            if a:
                r = self.resolve_expr(a[0], scope)
                if not (r and r[0] == 'sym' and self.syms[r[1]].kind == 'class'):
                    return self.miss(f, 'call-dynamic')
                start = r[1]
            mine = cls and (not a or (len(a) > 1 and isinstance(a[1], ast.Name) and a[1].id in ('self', 'cls')))
            found, sure = [], True
            pool = ([cls] + self.subclasses(cls)) if mine else [start] + self.subclasses(start)
            for k in pool:
                m, ok = self.method_info(k, fn.attr, after=start)
                sure = sure and ok
                if m and m not in found:
                    found.append(m)
            chg = any(self.changed(k, fn.attr) for k in pool)
            if not found:
                return self.miss(f, 'call-dynamic' if sure else 'call-member')   # missing, or after a base outside the repo
            if len(found) == 1 and sure and not chg:
                return add(found[0], 'inferred' if self.syms[found[0]].decorated else 'exact')
            return several(found, sure, chg)
        # self.m() / cls.m(): never exact; ambiguous when a subclass in the repo overrides m, m is reassigned, or the
        # MRO leaves it open
        if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) and fn.value.id in ('self', 'cls') and cls:
            ms, sure = self.candidates(cls, fn.attr, False)
            if not ms:
                if not self.open_bases(cls):
                    self.miss(f, 'call-dynamic')     # an attribute set at run time, or a missing method
                return
            return several(ms, sure, self.changed(cls, fn.attr))
        # self.x.m(): x always set to C() (exactly C) or annotated C (C or a subclass)
        if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Attribute) and isinstance(fn.value.value, ast.Name) and fn.value.value.id == 'self' and cls:
            c = self.attr_class(cls, fn.value.attr)
            if c:
                return self.typed_call(f, c[0], c[1], fn.attr, several)
        # x.m() where x, bound once, is C() or a parameter annotated C, or where every binding of x is C() of one class
        # (in this scope, an enclosing one or the module)
        if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
            sc = self.holder(fn.value.id, scope)
            c = None if sc is None else sc.instances.get(fn.value.id) if sc.assigned.get(fn.value.id) == 1 else self.made_by(sc, fn.value.id)
            if c:
                return self.typed_call(f, c[0], c[1], fn.attr, several)
        r = self.resolve_expr(fn, scope)
        if r is None:
            if isinstance(fn, ast.Name):
                if fn.id not in BUILTINS:
                    self.miss(f, 'call-unknown')
            elif not isinstance(fn, ast.Attribute):
                self.miss(f, 'call-dynamic')         # f()(), d[k](), getattr(o, n)()
            else:
                # x.m() on a repo class without m (set at run time, or missing); on a value whose type is not known
                # (a parameter, a local); not counted: literals' methods and data handles' operations
                b = self.resolve_expr(fn.value, scope)
                if b and b[0] in ('sym', 'instance') and self.syms[b[1]].kind == 'class':
                    if not self.open_bases(b[1]):
                        self.miss(f, 'call-dynamic')
                elif not isinstance(fn.value, (ast.Constant, ast.JoinedStr, ast.List, ast.Dict, ast.Set, ast.Tuple, ast.ListComp, ast.DictComp, ast.SetComp)) \
                        and not self.handle(f, fn.value, scope, cls):
                    self.miss(f, 'call-member')
            return
        if r[0] == 'alts':
            self.miss(f, 'call-ambiguous')
            for x in r[1]:
                add(x[1], 'ambiguous')
        elif r[0] == 'sym':
            st = r[2]
            t = self.syms[r[1]]
            # a method read from a class (C.m()), or from an instance made right there (C().m())
            if isinstance(fn, ast.Attribute) and t.kind == 'method' and t.parent:
                owner_cls = self.owner_class(fn.value, scope)
                if owner_cls and self.changed(owner_cls, fn.attr):
                    st = 'ambiguous'
                elif owner_cls and self.dynamic_class(owner_cls):
                    st = worst(st, 'inferred')
            add(r[1], st)
        elif r[0] == 'local':
            self.miss(f, 'call-local')
        elif r[0] == 'unresolved':
            self.miss(f, 'call-unknown')

    def shadowed(self, name, scope):
        """whether a lambda or a comprehension around the code being read binds the name"""
        return self.shadow_scope is scope and any(name in x for x in self.shadow)

    def holder(self, name, scope):
        """the scope that binds a name used in `scope` (as resolve_name walks them); None when a lambda or a
        comprehension around the code binds it, or nothing does"""
        if self.shadow_scope is scope and any(name in x for x in self.shadow):
            return None
        s, first = scope, True
        while s is not None:
            if s.kind == 'class' and not first:
                s = s.parent
                continue
            first = False
            if name in s.globals and s.kind != 'module':
                s = self.mod[s.file]
                continue
            if name in s.nonlocals:
                s = s.parent
                continue
            if name in s.assigned or name in s.defs or name in s.imports:
                return s
            s = s.parent
        return None

    def owner_class(self, e, scope):
        """the class a method is read from: C in C.m, C in C().m"""
        r = self.resolve_expr(e, scope)
        return r[1] if r and r[0] in ('sym', 'instance') and self.syms[r[1]].kind == 'class' else None

    def typed_call(self, f, cid, exact_class, name, several):
        """a method of an instance of a repo class: exactly that class (made with C()), else C or any subclass; a
        Protocol's implementations need not name it, and an abstract method's implementation is elsewhere"""
        if not exact_class and self.is_protocol(cid):
            return self.miss(f, 'call-abstract')
        ms, sure = self.candidates(cid, name, exact_class)
        if not ms:
            return
        if all(self.is_stub(m) for m in ms) and not exact_class:
            return self.miss(f, 'call-abstract')
        several(ms, sure, self.changed(cid, name) or self.dynamic_class(cid))

    # ---------- data ----------
    def canon_dotted(self, e, scope):
        """a.b.c with its first name read through the imports, as the library's own name: `import psycopg2 as pg;
        pg.connect` is psycopg2.connect. '' when the first name is not an import of a module outside the repo (a
        parameter called boto3 is not boto3), or is bound more than once"""
        d = dotted(e)
        if not d:
            return ''
        head, _, rest = d.partition('.')
        s = self.holder(head, scope)
        if s is None or head not in s.imports or self.bindings(s, head) != 1:
            return ''
        b = s.imports[head]
        return b[1] + ('.' + rest if rest else '') if b[0] == 'external' else ''

    def name_of(self, e, scope, depth=0):
        """a resource name: ('literal', 'x', file, line) | ('env', 'X', file, line) | ('unknown', None), with the file
        and line that give it (the string, or where the environment variable is read)"""
        if depth > 10 or e is None:
            return ('unknown', None)
        if isinstance(e, ast.Constant) and isinstance(e.value, str):
            return ('literal', e.value, scope.file, e.lineno)

        def env(x):
            return ('env', x.value, scope.file, x.lineno) if isinstance(x, ast.Constant) and isinstance(x.value, str) else ('unknown', None)
        if isinstance(e, ast.Subscript) and dotted(e.value) in ('os.environ', 'environ'):
            return env(e.slice)
        if isinstance(e, ast.Call) and dotted(e.func) in ('os.environ.get', 'os.getenv', 'getenv', 'environ.get') and e.args:
            return env(e.args[0])
        if isinstance(e, ast.Name):
            if self.shadowed(e.id, scope):
                return ('unknown', None)
            s = scope
            while s is not None:
                if e.id in s.imports:
                    r = self.from_bind(s.imports[e.id])
                    if r and r[0] == 'sym' and self.syms[r[1]].kind == 'const':
                        t = self.syms[r[1]]
                        tm = self.mod[t.file]
                        return self.name_of(tm.values.get(t.name), tm, depth + 1) if tm.assigned.get(t.name) == 1 else ('unknown', None)
                    return ('unknown', None)
                if e.id in s.assigned:
                    return self.name_of(s.values.get(e.id), s, depth + 1) if s.assigned[e.id] == 1 else ('unknown', None)
                s = s.parent
        return ('unknown', None)

    def handle(self, f, e, scope, cls):
        """the data handle an expression gives, or None"""
        if isinstance(e, ast.Await):
            e = e.value
        if isinstance(e, ast.Name):
            if self.shadow_scope is scope and any(e.id in x for x in self.shadow):
                return None                               # a lambda's or a comprehension's own name
            s = scope
            while s is not None:
                if e.id in s.handles:
                    return s.handles[e.id]
                if e.id in s.assigned:
                    return None
                s = s.parent
            return None
        if isinstance(e, ast.Attribute) and isinstance(e.value, ast.Name) and e.value.id == 'self' and cls:
            return self.syms[cls].scope.handles.get('self.' + e.attr)
        if isinstance(e, ast.Attribute) and e.attr == 'session' and self.handle(f, e.value, scope, cls) == ('flask-db',):
            return ('sa-session',)                        # Flask-SQLAlchemy's db.session
        if not isinstance(e, ast.Call):
            return None
        fn = self.canon_dotted(e.func, scope)
        if fn in SA_SESSIONS or (isinstance(e.func, (ast.Name, ast.Attribute)) and self.handle(f, e.func, scope, cls) == ('sa-maker',)):
            return ('sa-session',)
        if fn in SA_MAKERS_S:
            return ('sa-maker',)
        if fn == 'flask_sqlalchemy.SQLAlchemy':
            return ('flask-db',)
        attr = e.func.attr if isinstance(e.func, ast.Attribute) else None
        if fn in ('boto3.resource', 'boto3.client') or (attr in ('resource', 'client') and self.handle(f, e.func.value, scope, cls) == ('session',)):
            svc = e.args[0].value if e.args and isinstance(e.args[0], ast.Constant) else None
            if svc is None:
                k = next((x.value for x in e.keywords if x.arg == 'service_name'), None)
                svc = k.value if isinstance(k, ast.Constant) else None
            return (f"{svc}-{'resource' if fn.split('.')[-1] == 'resource' or attr == 'resource' else 'client'}",) if svc in OPS else None
        if fn in ('boto3.Session', 'boto3.session.Session'):
            return ('session',)
        if fn in SA_ENGINES:
            return ('sa-engine',)
        if fn.rpartition('.')[0] in DBAPI and fn.endswith('.connect'):
            return ('db-conn',)
        if attr:
            base = self.handle(f, e.func.value, scope, cls)
            first = e.args[0] if e.args else (e.keywords[0].value if e.keywords else None)
            if base == ('dynamodb-resource',) and attr == 'Table' and first is not None:
                return ('dynamodb-table', self.name_of(first, scope))
            if base == ('s3-resource',) and attr == 'Bucket' and first is not None:
                return ('s3-bucket', self.name_of(first, scope))
            if base == ('sqs-resource',) and attr in ('Queue', 'get_queue_by_name') and first is not None:
                return ('sqs-queue', self.name_of(first, scope))
            if base == ('db-conn',) and attr == 'cursor':
                return ('db-cursor',)
            if base == ('sa-engine',) and attr in ('connect', 'begin'):
                return ('db-conn',)
        return None

    def data_use(self, f, node, scope, owner, cls):
        fn = node.func
        if not isinstance(fn, ast.Attribute):
            return
        frm = self.canon(owner) if owner else f
        line, col = self.site(fn)
        a = fn.attr
        h = self.handle(f, fn.value, scope, cls)
        kw = {k.arg: k.value for k in node.keywords if k.arg}

        def put(store, name, op, at=None, via=None):
            if name[0] == 'unknown':                        # a name from an environment variable is known: $NAME
                self.miss(f, 'data-unknown-name')
            self.data.append({'from': frm, 'store': store, 'kind': KIND[store], 'name': list(name), 'op': op, 'site': [line, self.col(f, line, col)], 'call': a,
                              'at': at or line, 'via': via or ('dbapi' if store == 'sql' else 'boto3')})
        if h is None and a in UNTRACED:
            self.miss(f, 'data-untraced')        # get_object() on a client passed in, built elsewhere, or not boto3
        if h is None:
            # Django: Model.objects.<op>() on a model of the repo (its bases trace to django.db.models.Model)
            if isinstance(fn.value, ast.Attribute) and fn.value.attr == 'objects' and (a in DJANGO_READ or a in DJANGO_WRITE):
                t = self.model_of(fn.value.value, scope)
                if t and t[0] == 'django':
                    put('django', ('literal', t[1]), 'write' if a in DJANGO_WRITE else 'read', via='django')
            # a SQLAlchemy query or statement on a receiver not traced to a session or a connection: counted, not drawn
            q = node.args[0] if node.args else None
            if q is not None and ((a == 'query' and self.model_of(q, scope)) or (a in SA_RUN and (self.sa_statement(q, scope) or (isinstance(q, ast.Call) and self.canon_dotted(q.func, scope) in SA_TEXT)))):
                self.miss(f, 'data-untraced')
            return
        store = h[0].split('-')[0]
        if store in OPS:
            reads, writes = OPS[store]
            if a not in reads and a not in writes:
                return
            op = 'write' if a in writes else 'read'
            if len(h) > 1:                                      # a table, a bucket or a queue object
                return put(store, h[1], op)
            if store == 'dynamodb':
                return put(store, self.name_of(kw.get('TableName'), scope), op)
            if store == 's3':
                # upload_file(Filename, Bucket, Key) and upload_fileobj take the bucket second; download_file(Bucket,
                # Key, Filename) and download_fileobj first
                b = kw.get('Bucket')
                at = {'upload_file': 1, 'upload_fileobj': 1, 'download_file': 0, 'download_fileobj': 0}.get(a)
                if b is None and at is not None and len(node.args) > at:
                    b = node.args[at]
                return put(store, self.name_of(b, scope), op)
            return put(store, self.name_of(kw.get('QueueUrl'), scope), op)
        # SQLAlchemy sessions and connections: session.query(Model), .execute(select(Model)…), .execute(text("…"))
        if h[0] == 'sa-session' and a == 'query' and node.args:
            t = self.model_of(node.args[0], scope)
            return put('sql', ('literal', t[1]), 'read', via='sqlalchemy') if t and t[0] == 'sql' else None
        st = self.sa_statement(node.args[0], scope) if h[0] in ('sa-session', 'db-conn') and a in SA_RUN and node.args else None
        if st:
            t = self.model_of(st[1], scope) if st[1] is not None else None
            return put('sql', ('literal', t[1]) if t and t[0] == 'sql' else ('unknown', None), st[0], via='sqlalchemy')
        if h[0] == 'sa-session' and a in SA_RUN and node.args:
            return self.run_sql(f, node.args[0], scope, put, line, 'sqlalchemy')
        if h[0] in ('db-cursor', 'db-conn') and a in ('execute', 'executemany', 'executescript') and node.args:
            return self.run_sql(f, node.args[0], scope, put, line, 'dbapi')

    def sa_statement(self, q, scope):
        """a SQLAlchemy statement on a model, by its import: select(Order).where(…) -> ('read', the select's first
        argument); text("…") -> ('text', None) is not one (its SQL is read as SQL); None"""
        e = q
        while isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and self.canon_dotted(e.func, scope) not in SA_STMT:
            e = e.func.value                              # select(Order).where(…).order_by(…)
        op = SA_STMT.get(self.canon_dotted(e.func, scope)) if isinstance(e, ast.Call) else None
        return (op, e.args[0] if e.args else None) if op else None

    def run_sql(self, f, q, scope, put, line, via):
        """the tables a SQL text names (a string, or SQLAlchemy's text("…")), each where its query names it; one whose
        name is filled in at run time is unknown"""
        spans = []
        txt = self.sql_text(q, scope, spans=spans)
        if txt is None:
            return put('sql', ('unknown', None), 'read', via=via)
        for t, op in sql_tables(txt):
            put('sql', ('literal', t) if t is not None else ('unknown', None), op, self.named_at(f, spans, t, line) if t is not None else None, via=via)

    def const_value(self, s):
        """what a module constant is bound to, when it is bound once"""
        m = self.mod[s.file]
        return m.values.get(s.name) if self.bindings(m, s.name) == 1 else None

    def orm_of(self, cid, seen=()):
        """the ORM a class's bases trace to through the imports: 'django' (django.db.models.Model), 'sqlalchemy'
        (DeclarativeBase, a declarative_base() made in the repo), 'flask' (db.Model of db = SQLAlchemy(…)), 'sqlmodel';
        None for any other class, whatever its bases are called"""
        if cid in self.orm:
            return self.orm[cid]
        if cid in seen:
            return None
        c = self.syms[cid]
        sc = self.syms[c.parent].scope if c.parent else self.mod[c.file]
        out = None
        for b in c.node.bases:
            n = self.canon_dotted(b, sc)
            if n in DJANGO_BASES:
                out = 'django'
            elif n in SA_BASES:
                out = 'sqlalchemy'
            elif n == 'sqlmodel.SQLModel':
                out = 'sqlmodel'
            else:
                r = self.resolve_expr(b, sc)
                s = self.syms[r[1]] if r and r[0] == 'sym' else None
                if s is not None and s.kind == 'class':
                    out = self.orm_of(s.id, seen + (cid,))
                elif s is not None and s.kind == 'const':
                    v = self.const_value(s)
                    if isinstance(v, ast.Call) and self.canon_dotted(v.func, self.mod[s.file]) in SA_MAKERS:
                        out = 'sqlalchemy'
                elif isinstance(b, ast.Attribute) and b.attr == 'Model':
                    r = self.resolve_expr(b.value, sc)
                    s = self.syms[r[1]] if r and r[0] == 'sym' else None
                    v = self.const_value(s) if s is not None and s.kind == 'const' else None
                    if isinstance(v, ast.Call) and self.canon_dotted(v.func, self.mod[s.file]) == 'flask_sqlalchemy.SQLAlchemy':
                        out = 'flask'
            if out:
                break
        self.orm[cid] = out
        return out

    def table_of(self, s):
        """a model's table: ('sql', name) | ('django', class name) | None (not a model, or an abstract one)"""
        if s.kind != 'class':
            return None
        orm = self.orm_of(s.id)
        if orm is None:
            return None
        body = {t.id: st.value for st in s.node.body if isinstance(st, ast.Assign) for t in st.targets if isinstance(t, ast.Name)}
        const = lambda k: body[k].value if isinstance(body.get(k), ast.Constant) else None
        if orm == 'django':
            meta = next((st for st in s.node.body if isinstance(st, ast.ClassDef) and st.name == 'Meta'), None)
            abstract = meta is not None and any(isinstance(x, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'abstract' for t in x.targets)
                                                and isinstance(x.value, ast.Constant) and x.value.value is True for x in meta.body)
            return None if abstract else ('django', s.name)
        if const('__abstract__') is True:
            return None
        name = const('__tablename__')
        if isinstance(name, str):
            return ('sql', name)
        if orm == 'flask':                                  # Flask-SQLAlchemy names it after the class: OrderItem -> order_item
            return ('sql', re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', '_', s.name).lower())
        if orm == 'sqlmodel' and any(k.arg == 'table' and isinstance(k.value, ast.Constant) and k.value.value is True for k in s.node.keywords):
            return ('sql', s.name.lower())
        return None

    def model_of(self, e, scope):
        """the table of the model an expression names: the class, or one of its columns (Order.id)"""
        r = self.resolve_expr(e, scope)
        t = self.table_of(self.syms[r[1]]) if r and r[0] == 'sym' else None
        return t or (self.model_of(e.value, scope) if isinstance(e, ast.Attribute) else None)

    def sql_text(self, e, scope, depth=0, spans=None):
        """a SQL statement's text, with DYN where a part is filled in at run time (an f-string's fields, %s and {} filled
        by % and .format(), a value added that is not a known string); None when nothing of it is static. `spans`
        collects the lines of the strings it is made of"""
        if depth > 10 or e is None:
            return None
        if isinstance(e, (ast.Constant, ast.JoinedStr)) and spans is not None:
            spans.append((e.lineno, getattr(e, 'end_lineno', None) or e.lineno))
        if isinstance(e, ast.Constant) and isinstance(e.value, str):
            return e.value
        if isinstance(e, ast.JoinedStr):
            return ''.join(v.value if isinstance(v, ast.Constant) else DYN for v in e.values)
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Add):
            a, b = self.sql_text(e.left, scope, depth + 1, spans), self.sql_text(e.right, scope, depth + 1, spans)
            return None if a is None and b is None else (DYN if a is None else a) + (DYN if b is None else b)
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Mod):
            t = self.sql_text(e.left, scope, depth + 1, spans)
            return None if t is None else PCT.sub(lambda m: '%' if m.group() == '%%' else DYN, t)
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and e.func.attr == 'format':
            t = self.sql_text(e.func.value, scope, depth + 1, spans)
            return None if t is None else FMT.sub(lambda m: {'{{': '{', '}}': '}'}.get(m.group(), DYN), t)
        if isinstance(e, ast.Call) and (dotted(e.func) or '').split('.')[-1] in ('text', 'SQL') and e.args:
            return self.sql_text(e.args[0], scope, depth + 1, spans)
        if isinstance(e, ast.Name):
            s = scope
            while s is not None:
                if e.id in s.assigned:
                    return self.sql_text(s.values.get(e.id), s, depth + 1, spans) if s.assigned[e.id] == 1 else None
                s = s.parent
        return None

    def named_at(self, f, spans, name, default):
        """the first line of those spans that names `name` as a word, else `default`"""
        rx = re.compile(r'(?<![\w.])' + re.escape(name) + r'(?!\w)', re.I)
        for a, b in spans:
            for ln in range(a, b + 1):
                if ln - 1 < len(self.lines[f]) and rx.search(self.lines[f][ln - 1]):
                    return ln
        return default

    # ---------- what else a file says ----------
    def finish(self):
        """handlers by convention, programs, and the tables the code declares"""
        self.entries, self.resources = [], []
        for f, tree in self.trees.items():
            for st in tree.body:
                if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)) and st.name in ('lambda_handler', 'handler') and len(st.args.args) == 2:
                    self.entries.append({'kind': 'lambda', 'file': f, 'symbol': st._bv, 'line': st.lineno})
                if isinstance(st, ast.If) and isinstance(st.test, ast.Compare) and dotted(st.test.left) == '__name__' \
                        and any(isinstance(c, ast.Constant) and c.value == '__main__' for c in st.test.comparators):
                    self.entries.append({'kind': 'cli', 'file': f, 'symbol': None, 'line': st.lineno})
        for sid in self.order:
            s = self.syms[sid]
            if s.kind != 'class':
                continue
            t = self.table_of(s)
            if t:
                fields = sum(1 for x in s.node.body if isinstance(x, (ast.Assign, ast.AnnAssign)) and re.search(r'\b(Column|mapped_column|Field|\w+Field)\b', ast.unparse(x)))
                self.resources.append({'store': t[0], 'name': t[1], 'file': s.file, 'line': s.line, 'end': s.end, 'symbol': s.id, 'fields': fields,
                                       'via': 'django' if t[0] == 'django' else 'sqlalchemy'})


DYN = '\x00'        # in a SQL text: a part filled in at run time
PCT = re.compile(r'%%|%(?:\([^)]*\))?[#0\- +]*(?:\*|\d+)?(?:\.(?:\*|\d+))?[hlL]?[diouxXeEfFgGcrsab]')     # what % fills
FMT = re.compile(r'\{\{|\}\}|\{[^{}]*\}')                                                              # what .format() fills
# words that end a table reference (so they are not its alias)
SQL_STOP = {'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'MINUS', 'JOIN', 'INNER', 'LEFT',
            'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'ON', 'USING', 'WINDOW', 'FOR', 'RETURNING', 'SET', 'VALUES', 'SELECT', 'FETCH',
            'QUALIFY', 'WHEN', 'THEN', 'INTO', 'STRAIGHT_JOIN', 'PARTITION', 'TABLESAMPLE', 'START', 'CONNECT', 'PIVOT', 'UNPIVOT', 'OUTPUT',
            'DEFAULT', 'WITH', 'AS', 'LATERAL', 'LOCK', 'USE', 'FORCE', 'IGNORE', 'APPLY', 'OVERRIDING', 'DO', 'FROM', 'AND', 'OR', 'NOT',
            'MATCHED', 'BY', 'IN', 'IS', 'LIKE', 'BETWEEN', 'END', 'ELSE', 'ALL', 'ANY', 'SOME', 'EXISTS', 'ASC', 'DESC', 'NULL', 'DUPLICATE'}
SQL_VERB = {'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'TRUNCATE', 'VALUES', 'TABLE'}
SQL_TOKEN = re.compile(r"""(?P<sp>\s+)|(?P<c1>--[^\n]*)|(?P<c2>/\*.*?(?:\*/|$))|(?P<es>[eE]'(?:[^'\\]|\\.|'')*(?:'|$))|(?P<s>'(?:[^']|'')*(?:'|$))"""
                       r"""|(?P<dq>\$(?:[A-Za-z_]\w*)?\$)|(?P<pp>\$\d+)|(?P<q>"(?:[^"]|"")*(?:"|$)|`(?:[^`]|``)*(?:`|$)|\[[^\]]*\])"""
                       r"""|(?P<w>(?:[^\W\d]|\x00)(?:[\w$]|\x00)*)|(?P<n>\d[\w.]*)|(?P<p>.)""", re.S)


def sql_tokens(text):
    """a SQL text as tokens: ('w', word) | ('q', a quoted name, unquoted) | ('s', '') a string | ('p', punctuation);
    comments and spaces left out. A dollar-quoted string ($$ … $$, $tag$ … $tag$) is a string"""
    out, i, n = [], 0, len(text)
    while i < n:
        m = SQL_TOKEN.match(text, i)
        k, v = m.lastgroup, m.group()
        i = m.end()
        if k in ('sp', 'c1', 'c2'):
            continue
        if k == 'dq':
            j = text.find(v, i)
            i = n if j < 0 else j + len(v)
            out.append(('s', ''))
        elif k in ('s', 'es'):
            out.append(('s', ''))
        elif k == 'q':
            q = v[0]
            body = v[1:-1] if len(v) > 1 and v[-1] == {'[': ']'}.get(q, q) else v[1:]
            out.append(('q', body if q == '[' else body.replace(q + q, q)))
        elif k == 'w':
            out.append(('w', v))
        elif k == 'n':
            out.append(('n', v))
        else:
            out.append(('p', '?' if k == 'pp' else v))
    return out


def sql_tables(text):
    """the tables a SQL text reads and writes, in order: [(name | None, 'read' | 'write')]. None is a table whose
    name is filled in at run time. Each parenthesis is a frame with its own verb and its own CTE names; a statement's
    target is the table right after its DELETE FROM, UPDATE, INSERT/REPLACE/MERGE INTO or TRUNCATE; MERGE's USING source
    is read. A name followed by ( after FROM is a function, a CTE name is not a table, and FROM inside an expression
    (EXTRACT(YEAR FROM x), IS DISTINCT FROM) names none"""
    T = sql_tokens(text)
    out = []
    frame = lambda item=None: {'verb': None, 'ctes': {}, 'item': item}     # ctes: name -> the token it is a CTE from
    frames = [frame()]

    def word(k):
        return T[k][1].upper() if 0 <= k < len(T) and T[k][0] == 'w' else None

    def isp(k, c):
        return 0 <= k < len(T) and T[k] == ('p', c)

    def isname(k):
        return 0 <= k < len(T) and (T[k][0] == 'q' or (T[k][0] == 'w' and (T[k][1].upper() not in SQL_STOP or DYN in T[k][1])))

    def close(k):
        """the index after the parenthesis that closes the one at k"""
        d = 0
        while k < len(T):
            if isp(k, '('):
                d += 1
            elif isp(k, ')'):
                d -= 1
                if d == 0:
                    return k + 1
            k += 1
        return k

    def ref(k, op, more, call):
        """a table reference at k (`schema.name`, a subquery, or a function when `call`), its alias, and with `more`
        the next one after a comma"""
        while word(k) in ('ONLY', 'LATERAL', 'TABLE'):
            k += 1
        if isp(k, '('):
            frames.append(frame((op, more)))
            return k + 1
        parts = []
        while isname(k):
            parts.append(T[k])
            k += 1
            if isp(k, '.') and isname(k + 1):
                k += 1
                continue
            break
        if not parts:
            return k
        if call and isp(k, '('):                         # generate_series(…), unnest(…): not a table
            frames.append(dict(frame((op, more)), fn=True))
            return k + 1
        name = '.'.join(p[1] for p in parts)
        if DYN in name:
            out.append((None, op))
        elif not (len(parts) == 1 and (name.lower() == 'dual' or any(f['ctes'].get(name.lower(), float('inf')) <= k for f in frames))):
            out.append((name, op))
        return tail(k, op, more)

    def tail(k, op, more):
        if word(k) == 'AS':
            k += 1
        if isname(k):
            k += 1
        if isp(k, '(') and op == 'read':                  # column aliases
            k = close(k)
        return ref(k + 1, op, more, op == 'read') if more and isp(k, ',') else k

    k = 0
    while k < len(T):
        t, w, fr = T[k], word(k), frames[-1]
        prev = word(k - 1)
        if t == ('p', '('):
            # at the start of a FROM item in parentheses, another one: ((a JOIN b) JOIN c)
            frames.append(frame(fr['item'] if fr['item'] and fr['verb'] is None and not fr.get('fn') else None))
            k += 1
        elif t == ('p', ')'):
            k += 1
            if len(frames) > 1:
                done = frames.pop()
                if done['item']:
                    k = tail(k, *done['item'])
        elif t == ('p', ';'):
            frames = [frame()]
            k += 1
        elif fr['verb'] is None and fr['item'] and not fr.get('fn') and isname(k) and (w is None or (w not in SQL_VERB and w != 'LATERAL')):
            fr['verb'] = 'FROM'                           # (a JOIN b ON …), ("a b" JOIN c): tables in parentheses, a FROM list
            k = ref(k, fr['item'][0], True, True)
        elif w is None:
            k += 1
        elif w == 'WITH':
            # the CTE names, known to this frame from here on (a recursive one inside its own body too)
            rec = word(k + 1) == 'RECURSIVE'
            j = k + 1 + rec
            while j < len(T) and T[j][0] in ('w', 'q'):
                name = T[j][1].lower()
                j += 1
                if isp(j, '('):
                    j = close(j)
                if word(j) != 'AS':
                    break
                j += 1
                while word(j) in ('NOT', 'MATERIALIZED'):
                    j += 1
                if not isp(j, '('):
                    break
                body = j
                j = close(j)
                fr['ctes'].setdefault(name, body if rec else j)   # a plain CTE's own body reads the table of its name
                if not isp(j, ','):
                    break
                j += 1
            k += 1
        elif fr['verb'] is None and fr['item'] and not fr.get('fn') and w == 'ONLY':
            fr['verb'] = 'FROM'
            k = ref(k, fr['item'][0], True, True)
        elif fr['verb'] is None and w not in SQL_VERB and len(frames) > 1:
            k += 1                                        # an expression in parentheses: EXTRACT(YEAR FROM x)
        else:
            if w in SQL_VERB and fr['verb'] is None:
                fr['verb'] = w
            if w == 'FROM' and not (prev == 'DISTINCT' and word(k - 2) in ('IS', 'NOT')):
                k = ref(k + 1, 'write' if prev == 'DELETE' else 'read', prev != 'DELETE', prev != 'DELETE')
            elif w in ('JOIN', 'APPLY') or (w == 'USING' and not isp(k + 1, '(')):
                k = ref(k + 1, 'read', False, True)
            elif w == 'INTO' and fr['verb'] in ('INSERT', 'REPLACE', 'MERGE'):
                k = ref(k + 1, 'write', False, False)
            elif w == 'UPDATE' and prev not in ('DO', 'KEY', 'FOR', 'THEN') and word(k + 1) != 'SET':
                k = ref(k + 1, 'write', True, False)
            elif w == 'TRUNCATE':
                k = ref(k + 1, 'write', True, False)
            else:
                k += 1
    seen, uniq = set(), []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def rebound(tree):
    """the names a module binds more than once at its top (defs, classes, imports, assignments, del, for and with
    targets, also under if/try/with/for/while), and every name after a star import that may replace it"""
    if tree is None:
        return []
    seen, out, star = {}, set(), []

    def bind(n, line):
        if n in seen:
            out.add(n)
        seen.setdefault(n, line)

    def targets(t, line):
        for x in ast.walk(t):
            if isinstance(x, ast.Name):
                bind(x.id, line)

    def walk(body):
        for st in body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bind(st.name, st.lineno)
            elif isinstance(st, ast.Import):
                for a in st.names:
                    bind(a.asname or a.name.split('.')[0], st.lineno)
            elif isinstance(st, ast.ImportFrom):
                for a in st.names:
                    if a.name == '*':
                        star.append(st.lineno)
                    else:
                        bind(a.asname or a.name, st.lineno)
            elif isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                for t in (st.targets if isinstance(st, ast.Assign) else [st.target]):
                    targets(t, st.lineno)
            elif isinstance(st, ast.Delete):
                for t in st.targets:
                    targets(t, st.lineno)
            elif isinstance(st, (ast.For, ast.AsyncFor)):
                targets(st.target, st.lineno)
            elif isinstance(st, (ast.With, ast.AsyncWith)):
                for it in st.items:
                    if it.optional_vars is not None:
                        targets(it.optional_vars, st.lineno)
            for attr in ('body', 'orelse', 'finalbody'):
                if isinstance(st, (ast.If, ast.Try, ast.With, ast.AsyncWith, ast.For, ast.AsyncFor, ast.While)) and getattr(st, attr, None):
                    walk(getattr(st, attr))
            if isinstance(st, ast.Try):
                for h in st.handlers:
                    walk(h.body)
            for x in ast.walk(st) if not isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else ():
                if isinstance(x, ast.NamedExpr) and isinstance(x.target, ast.Name):
                    bind(x.target.id, st.lineno)
    walk(tree.body)
    if star:
        out |= {n for n, line in seen.items() if line < max(star)}
    return sorted(out)


def main():
    # the memory limit comes first, from the command line, so reading the request is bounded too
    mb = next((int(a.split('=', 1)[1]) for a in sys.argv[1:] if a.startswith('--memory-mb=')), 1024) * 1024 * 1024
    try:
        import resource
        for lim in ('RLIMIT_AS', 'RLIMIT_DATA'):
            try:
                resource.setrlimit(getattr(resource, lim), (mb, mb))
            except (ValueError, OSError, AttributeError):
                pass
    except ImportError:
        pass
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    req = json.load(sys.stdin)
    sys.setrecursionlimit(10000)
    r = Reader(req)
    r.read()
    r.finish()
    json.dump({
        'python': '%d.%d.%d' % sys.version_info[:3],
        'files': {f: {'lines': len(r.lines.get(f, [])), **({'error': r.errors[f]} if f in r.errors else {})} for f in r.files},
        'symbols': [r.syms[i].out(r.canon) for i in r.order],
        'relations': list(r.rel.values()),
        'data': r.data,
        'resources': r.resources,
        'entries': r.entries,
        'imports': r.imports_of,
        'syspath': r.syspath,
        'rebound': {f: n for f in r.files if (n := rebound(r.trees.get(f)))},
        'unresolved': r.count,
    }, sys.stdout, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
