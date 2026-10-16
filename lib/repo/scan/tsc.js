'use strict';
// TypeScript and JavaScript through the compiler: files, top-level symbols (CommonJS exports too) and class or
// object members, the references between top-level symbols across files (`ref`, `type`), and every call between
// symbols, same-file ones too (`call`: calls, `new`, and JSX elements, which render a component). Each package is
// compiled with its nearest tsconfig.json or jsconfig.json, so its own path aliases resolve. Other adapters that
// read the syntax (Prisma calls) see every node through `hooks`.
const fs = require('fs'), path = require('path');
const ts = require('typescript');
const { rootOf } = require('../roots');
const NAME = 'tsc';
const COVERS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const SCRIPT = { '.tsx': ts.ScriptKind.TSX, '.jsx': ts.ScriptKind.JSX, '.js': ts.ScriptKind.JS, '.mjs': ts.ScriptKind.JS, '.cjs': ts.ScriptKind.JS };
const scriptKind = p => SCRIPT[path.extname(p).toLowerCase()] ?? ts.ScriptKind.TS;
const isJs = p => /\.[cm]?jsx?$/.test(p);

// globals of the language, Node and the browser: a call to one, or to a method of one, is no gap in the map
const GLOBALS = new Set([...Object.getOwnPropertyNames(globalThis), ...'window document navigator location history screen localStorage sessionStorage alert confirm prompt open close print requestAnimationFrame cancelAnimationFrame requestIdleCallback getComputedStyle matchMedia scrollTo IntersectionObserver ResizeObserver MutationObserver HTMLElement Element Node Image Audio FileReader XMLHttpRequest Notification require module exports __dirname __filename process Buffer global'.split(' ')]);
// methods of the built-in types (arrays, strings, promises, maps, dates, responses…): the scan reads no library types,
// so `items.map()` resolves to nothing, and a call of one of these names on a value of unknown type is no gap either
const BUILTIN_METHODS = new Set([Array, String, Promise, Map, Set, WeakMap, Date, Number, Object, RegExp, Response, Request, Headers, URL, URLSearchParams, Blob, FormData, Error, Uint8Array, ArrayBuffer]
  .flatMap(C => Object.getOwnPropertyNames(C.prototype)).filter(n => n !== 'constructor'));
const short = (s, n) => (s = String(s).replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n - 1) + '…' : s;
const isExported = n => !!(ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export);
const isDefault = n => !!(ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Default);
const unwrapE = e => { while (e && (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)))) e = e.expression; return e; };
const isFn = e => !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));
const fnOfInit = d => d && isFn(d.initializer) ? d.initializer : null;
// one part of a qualified name: a member named with a string can hold '.', '#' or '%', which ids reserve
const part = n => String(n).replace(/[%#.]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
// ids by declaration order: path#name, then path#name#2 for the second declaration of the same name
function idMaker(file) {
  const count = new Map(), first = new Map();
  return { id(q) { const k = (count.get(q) || 0) + 1; count.set(q, k); const id = `${file}#${q}${k > 1 ? `#${k}` : ''}`; if (!first.has(q)) first.set(q, id); return id; }, first: q => first.get(q) };
}
// CommonJS: `exports.x =` and `module.exports.x =` name x; `module.exports =` names the module's own export ('')
function cjsTarget(left) {
  if (!ts.isPropertyAccessExpression(left)) return null;
  const e = left.expression;
  if (ts.isIdentifier(e) && e.text === 'module' && left.name.text === 'exports') return '';
  if (ts.isIdentifier(e) && e.text === 'exports') return left.name.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'module' && e.name.text === 'exports') return left.name.text;
  return null;
}
const cjsAssign = s => ts.isExpressionStatement(s) && ts.isBinaryExpression(s.expression) && s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken ? s.expression : null;
// the names a file's top-level statements bind (functions, classes, enums, variables), wherever in the file: the
// bindings a CommonJS export (`exports.x = x`, `module.exports = { x }`) can name, before or after it
function declaredNames(sf) {
  const o = new Set();
  for (const s of sf.statements) {
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) o.add(s.name.text);
    else if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) o.add(d.name.text);
  }
  return o;
}
// whether a function renders JSX (a component in a .js file)
const hasJsx = n => { let found = false; const v = x => { if (found) return; if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) { found = true; return; } ts.forEachChild(x, v); }; if (n) v(n); return found; };

function tscAdapter(ROOT, D, next, hooks = []) {
  const t0 = Date.now(), rel = D.rel, inside = D.inside;
  const codeRoots = D.roots.filter(r => r.role === 'code').map(r => r.path);
  // tests: files in a test root, in a __tests__ folder, or named *.test.* / *.spec.*
  const isTest = r => { const role = D.roleOf(r); return role === 'test' || role === 'e2e' || /(^|\/)__tests__\//.test(r) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(r); };
  // a path inside the repo whose real location is outside it (a symlink leaving the repo) is not read
  const escapes = f => { const a = path.resolve(f); return (a === ROOT || a.startsWith(ROOT + path.sep)) && !inside(a); };
  const sys = { ...ts.sys, readFile: (f, e) => (escapes(f) ? undefined : ts.sys.readFile(f, e)), fileExists: f => !escapes(f) && ts.sys.fileExists(f), directoryExists: d => !escapes(d) && ts.sys.directoryExists(d) };

  // one program per tsconfig (the nearest one above each file), each with that config's options
  const groups = new Map();
  for (const f of [...D.src, ...D.tests].filter(f => COVERS.includes(path.extname(f).toLowerCase()))) { const c = D.configOf(f) || ''; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(f); }
  const programs = [...groups.keys()].sort().map(cfgPath => {
    const cfg = cfgPath && !escapes(cfgPath) ? ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, sys.readFile).config || {}, sys, path.dirname(cfgPath)) : { options: { jsx: ts.JsxEmit.Preserve } };
    // JavaScript is read, never checked; libraries' JavaScript is not read at all
    const options = { ...cfg.options, noLib: true, types: [], incremental: false, noEmit: true, allowJs: true, checkJs: false, maxNodeModuleJsDepth: 0, composite: false, declaration: false };
    const host = ts.createCompilerHost(options);
    Object.assign(host, { readFile: sys.readFile, fileExists: sys.fileExists, directoryExists: sys.directoryExists });
    const program = ts.createProgram(groups.get(cfgPath), options, host);
    return { cfg: cfgPath ? rel(cfgPath) : null, program, checker: program.getTypeChecker(), own: new Set(groups.get(cfgPath).map(rel)) };
  });
  // which program reads each file's symbols and references: the one it is a root of, else the first that reads it
  const owner = new Map();
  for (const P of programs) for (const r of P.own) if (!owner.has(r)) owner.set(r, P);
  // a file the compiler reads besides the roots' own: one outside every root (a script a test imports) is read too;
  // one inside a root that discovery left out (a .d.ts, a .json, build output) is not
  const ROOTS = D.roots.map(x => x.path), found = new Set([...D.src, ...D.tests, ...(D.e2e || [])].map(rel));
  const readable = r => !r.startsWith('..') && !r.includes('node_modules') && (found.has(r) || rootOf(ROOTS, r) === null);
  for (const P of programs) for (const sf of P.program.getSourceFiles()) { const r = rel(sf.fileName); if (readable(r) && !owner.has(r)) owner.set(r, P); }
  const filesOf = P => P.program.getSourceFiles().filter(sf => owner.get(rel(sf.fileName)) === P);
  // a node across programs: two programs parse one file into different nodes at the same positions
  const K = (r, n) => `${r}:${n.pos}:${n.end}`;
  const KN = n => K(rel(n.getSourceFile().fileName), n);

  const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const site = (sf, node) => { const p = sf.getLineAndCharacterOfPosition(node.getStart(sf)); return [p.line + 1, p.character + 1]; };
  function docOf(n) {
    const j = ts.getJSDocCommentsAndTags(n).find(x => ts.isJSDoc(x));
    let c = j && (typeof j.comment === 'string' ? j.comment : (j.comment || []).map(x => x.text).join(''));
    if (!c) return '';
    c = c.replace(/\s+/g, ' ').trim(); const m = c.match(/^(.{20,}?[.!?])\s/); return short(m ? m[1] : c, 180);
  }
  function sigOf(sf, fn) {
    if (!fn || !fn.parameters) return '';
    const ps = fn.parameters.map(p => p.getText(sf)).join(', '), rt = fn.type ? ': ' + fn.type.getText(sf) : '';
    return short(`(${ps})${rt}`, 120);
  }

  /* ---------- files and symbols ---------- */
  const files = {}, symbols = [];
  const topId = new Map();       // top-level statement -> id of the symbol it declares (the last one, as before)
  const declId = new Map();      // a declaration node -> the id of its symbol (top-level declarations and members)
  const symAt = new Map();       // id -> symbol
  // the id every declaration of one compiler symbol stands for: its first (overloads, a getter and its setter)
  const canon = new Map(), canonOf = id => canon.get(id) || id;
  for (const P of programs) for (const sf of filesOf(P)) {
    const r = rel(sf.fileName);
    const text = sf.text, first = sf.statements[0];
    const directive = d => !!(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === d);
    const useServer = directive('use server'), useClient = directive('use client');
    const route = next.routeOf(r);
    const appDir = next.appDirOf(r);
    files[r] = { lang: (path.extname(r).slice(1) || 'none').toLowerCase(), lines: text.split('\n').length, test: isTest(r), pkg: D.pkgOf(r),
      flags: { server: useServer, client: useClient, middleware: next.isMiddleware(r) },
      ...(appDir ? { appDir } : {}), ...(route ? { entry: { kind: route.kind, variant: next.name, route: route.path } } : {}), prov: NAME };
    const ids = idMaker(r);
    // a later declaration of the same compiler symbol in this file stands for the first
    const sameAsFirst = (id, nameNode) => {
      let sym = null; try { sym = nameNode && P.checker.getSymbolAtLocation(nameNode); } catch {}
      const d0 = sym && (sym.declarations || [])[0], first = d0 && d0.getSourceFile() === sf && declId.get(K(r, d0));
      if (first && first !== id) canon.set(id, canonOf(first));
    };
    const add = (stmt, name, kind, node, fn, exported) => {
      const id = ids.id(part(name));
      symbols.push({ id, file: r, name, qname: name, kind, line: lineOf(sf, node.getStart(sf)), end: lineOf(sf, node.getEnd()), exported, sig: sigOf(sf, fn), doc: docOf(stmt), member: false, parent: null, prov: NAME });
      topId.set(K(r, stmt), ids.first(part(name)));   // references point at the first declaration of a name, as they always have
      declId.set(K(r, node), id); if (fn && fn !== node) declId.set(K(r, fn), id); symAt.set(id, symbols[symbols.length - 1]);
      sameAsFirst(id, node.name);
      return symbols[symbols.length - 1];
    };
    // a member: of a class or an object literal; `parent` is the symbol it is declared in
    const member = (owner, m, name, fn, exported, parent) => {
      const q = `${owner}.${part(name)}`, id = ids.id(q);
      symbols.push({ id, file: r, name, qname: q, kind: 'method', line: lineOf(sf, m.getStart(sf)), end: lineOf(sf, m.getEnd()), exported, sig: sigOf(sf, fn), doc: docOf(m), member: true, parent: parent ? canonOf(parent) : null, prov: NAME });
      declId.set(K(r, m), id); if (fn && fn !== m) declId.set(K(r, fn), id); symAt.set(id, symbols[symbols.length - 1]);
      sameAsFirst(id, m.name);
    };
    const ui = /\.(tsx|jsx)$/.test(r);
    const kindFor = (name, fn, exported, def) => {
      if (route && def && (route.kind === 'page' || route.kind === 'layout')) return route.kind;
      if (route && route.kind === 'route' && next.HTTP.test(name)) return 'handler';
      if (useServer && fn && exported) return 'action';
      if (fn && /^use[A-Z]/.test(name)) return 'hook';
      if (fn && /^[A-Z]/.test(name) && (ui || (isJs(r) && hasJsx(fn)))) return 'component';
      return fn ? 'function' : 'const';
    };
    const memberName = m => m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : null;
    // members of a class or an object literal, and of the object literals inside those, at any depth
    const membersOf = (owner, list, exported, parent) => {
      for (const m of list) {
        const nm = ts.isConstructorDeclaration(m) ? 'constructor' : memberName(m); if (!nm) continue;
        if (ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) member(owner, m, nm, m, exported, parent);
        else if (ts.isConstructorDeclaration(m) && m.body) member(owner, m, 'constructor', m, exported, parent);
        else if ((ts.isPropertyDeclaration(m) || ts.isPropertyAssignment(m)) && isFn(m.initializer)) member(owner, m, nm, m.initializer, exported, parent);
        else if ((ts.isPropertyAssignment(m) || ts.isPropertyDeclaration(m)) && m.initializer && ts.isObjectLiteralExpression(m.initializer)) membersOf(`${owner}.${part(nm)}`, m.initializer.properties, exported, parent);
      }
    };
    const markExported = name => { for (const x of symbols) if (x.file === r && !x.member && x.name === name) x.exported = true; };
    // a CommonJS export that names a binding of the file stands for it: `exports.x = x`, `module.exports = { x }`,
    // read once every declaration is known, so the binding may come after the export
    const DECLARED = declaredNames(sf), later = [];
    const local = name => symbols.find(x => x.file === r && !x.member && x.name === name) || null;
    const exportsLocal = (node, name) => later.push(() => { const x = local(name); if (!x) return; markExported(name); declId.set(K(r, node), x.id); });
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && (s.name || isDefault(s))) {
        const ex = isExported(s), def = isDefault(s), nm = s.name ? s.name.text : 'default';
        add(s, nm, kindFor(nm, s, ex, def), s, s, ex);
      } else if (ts.isVariableStatement(s)) {
        const ex = isExported(s);
        for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) {
          const fn = fnOfInit(d), x = add(s, d.name.text, kindFor(d.name.text, fn, ex, false), d, fn, ex);
          if (d.initializer && ts.isObjectLiteralExpression(d.initializer)) membersOf(d.name.text, d.initializer.properties, ex, x.id);
        }
      } else if (ts.isClassDeclaration(s) && s.name) add(s, s.name.text, 'class', s, null, isExported(s));
      else if ((ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) add(s, s.name.text, ts.isEnumDeclaration(s) ? 'enum' : 'type', s, null, isExported(s));
      else if (ts.isExportAssignment(s)) {
        const e = s.expression, fn = isFn(e) ? e : null;
        add(s, ts.isIdentifier(e) ? e.text : 'default', route && (route.kind === 'page' || route.kind === 'layout') ? route.kind : fn ? 'function' : 'const', s, fn, true);
      } else if (cjsAssign(s) && cjsTarget(cjsAssign(s).left) !== null) {
        // CommonJS exports: the compiler names `exports.x` (the left side) as x's declaration
        const { left, right } = cjsAssign(s), nm = cjsTarget(left), fn = isFn(right) ? right : null;
        if (ts.isIdentifier(right) && DECLARED.has(right.text)) exportsLocal(left, right.text);   // exports.alias = x, module.exports = run: x itself
        else if (nm) { const x = add(s, nm, ts.isClassExpression(right) ? 'class' : kindFor(nm, fn, true, false), s, fn, true); declId.set(K(r, left), x.id); }
        else if (ts.isIdentifier(right)) { /* module.exports = an import: nothing of this file */ }
        else if (ts.isObjectLiteralExpression(right)) for (const pr of right.properties) {   // module.exports = { run, total: () => … }
          const pn = memberName(pr);
          if (ts.isShorthandPropertyAssignment(pr)) { if (DECLARED.has(pr.name.text)) exportsLocal(pr, pr.name.text); }
          else if (pn && ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.initializer)) { if (DECLARED.has(pr.initializer.text)) exportsLocal(pr, pr.initializer.text); }
          else if (pn && (ts.isPropertyAssignment(pr) || ts.isMethodDeclaration(pr))) { const f2 = ts.isMethodDeclaration(pr) ? pr : isFn(pr.initializer) ? pr.initializer : null; add(s, pn, kindFor(pn, f2, true, false), pr, f2, true); }
        } else { const x = add(s, (right.name && right.name.text) || 'default', ts.isClassExpression(right) ? 'class' : kindFor('default', fn || (ts.isFunctionExpression(right) ? right : null), true, false), s, fn, true); declId.set(K(r, left), x.id); }
      }
    }
    for (const f of later) f();
    // classes anywhere in the file give their members; a class inside a function or a method is named inside it
    // (outer.Helper.run), so two such classes of one name stay two
    const classes = n => {
      if (ts.isClassLike(n) && n.name) {
        const own = declId.get(K(r, n));
        let at = null; for (let p = n.parent; p && !ts.isSourceFile(p) && !own; p = p.parent) { const id = declId.get(K(r, p)); if (id) { at = id; break; } }
        const scope = at ? symAt.get(at).qname + '.' : '';
        membersOf(scope + part(n.name.text), n.members, ts.isClassDeclaration(n) && n.parent === sf && isExported(n), own || at);
      }
      ts.forEachChild(n, classes);
    };
    classes(sf);
    // `export default Foo` after `function Foo`: Foo is the page or layout
    if (route && (route.kind === 'page' || route.kind === 'layout')) {
      const ea = sf.statements.find(ts.isExportAssignment);
      if (ea && ts.isIdentifier(ea.expression)) { const s = symbols.find(x => x.file === r && !x.member && x.name === ea.expression.text && x.kind !== 'page' && x.kind !== 'layout'); if (s) { s.kind = route.kind; s.exported = true; } }
    }
  }

  /* ---------- dispatch: a call to a method may run another one ---------- */
  // overridden: methods a subclass in the repo overrides; open: method names of classes whose base the scan cannot
  // follow (a mixin, a computed base), which may override any method of that name; abstract: methods with no body
  const overridden = new Set(), open = new Set(), abstract = new Set();
  const resolveIn = (checker, n) => { let sym = null; try { sym = checker.getSymbolAtLocation(n); if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym); } catch { return null; } return sym && (sym.valueDeclaration || (sym.declarations || [])[0]) || null; };
  // the class a class extends, through `const Alias = Base`; undefined when there is a base the scan cannot follow
  const baseIn = (checker, c) => {
    const h = (c.heritageClauses || []).find(x => x.token === ts.SyntaxKind.ExtendsKeyword); let e = h && h.types[0] && unwrapE(h.types[0].expression); if (!e) return null;
    for (let guard = 0; guard < 6; guard++) {
      if (ts.isClassExpression(e)) return e;
      if (!ts.isIdentifier(e) && !ts.isPropertyAccessExpression(e)) return undefined;     // extends mixin(Base), extends f()
      const d = resolveIn(checker, ts.isPropertyAccessExpression(e) ? e.name : e);
      if (!d) return undefined;
      if (ts.isClassLike(d)) return d;
      if (ts.isVariableDeclaration(d) && d.initializer) { e = unwrapE(d.initializer); continue; }
      return undefined;
    }
    return undefined;
  };
  const named = (c, nm) => c.members.find(m => m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isPrivateIdentifier(m.name)) && m.name.text === nm);
  for (const P of programs) {
    const walk = n => {
      if (ts.isClassLike(n)) {
        const b0 = baseIn(P.checker, n);
        for (const m of n.members) {
          const nm = m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : null; if (!nm) continue;
          const id = declId.get(KN(m)); if (id && (ts.isMethodDeclaration(m) && !m.body || (ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Abstract))) abstract.add(id);
          if (b0 === undefined) { open.add(nm); continue; }
          for (let b = b0, guard = 0; b && guard < 20; b = baseIn(P.checker, b), guard++) { const bm = named(b, nm); if (bm && declId.has(KN(bm))) overridden.add(declId.get(KN(bm))); }
        }
      }
      ts.forEachChild(n, walk);
    };
    for (const sf of filesOf(P)) walk(sf);
  }

  /* ---------- references between top-level symbols across files, and calls between symbols ---------- */
  const REL = new Map(), CALLS = { local: 0, unknown: 0, member: 0, dynamic: 0, interface: 0 };
  // calls point at the first declaration of a symbol, like references, from the innermost symbol around them
  const firstOf = canonOf;
  const unwrap = unwrapE;
  const calleeOf = n => unwrap(ts.isCallExpression(n) || ts.isNewExpression(n) ? n.expression : ts.isTaggedTemplateExpression(n) ? n.tag : ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n) ? n.tagName : ts.isDecorator(n) && !ts.isCallExpression(n.expression) ? n.expression : null);
  const addRel = (from, to, rl, sf, at, status) => {
    const k = `${from}|${to}|${rl}`, e = REL.get(k);
    if (e) { e.n++; e.sites.push(site(sf, at)); if (status !== 'exact') e.status = status; } else REL.set(k, { from, to, rel: rl, sites: [site(sf, at)], n: 1, status, prov: NAME });
  };
  // the symbol a declaration belongs to: its own when it is one that is not a member, else the top-level statement's
  const topOf = n => { while (n.parent && !ts.isSourceFile(n.parent)) n = n.parent; return n; };
  // `const { a, b: c } = require('./x')`: the names it binds are imports, like an import statement's
  const isRequireBinding = n => { const b = n.parent; if (!ts.isBindingElement(b)) return false; let v = b.parent; while (v && (ts.isObjectBindingPattern(v) || ts.isArrayBindingPattern(v) || ts.isBindingElement(v))) v = v.parent;
    return !!(v && ts.isVariableDeclaration(v) && v.initializer && ts.isCallExpression(unwrap(v.initializer)) && ts.isIdentifier(unwrap(v.initializer).expression) && unwrap(v.initializer).expression.text === 'require'); };
  const targetOf = d => { const own = declId.get(KN(d)); return own && !symAt.get(own).member ? firstOf(own) : topId.get(KN(topOf(d))); };
  for (const P of programs) {
    const checker = P.checker;
    const resolve = n => resolveIn(checker, n);
    const inType = n => { for (let p = n.parent; p && !ts.isSourceFile(p); p = p.parent) { if (ts.isTypeNode(p) && !ts.isExpressionWithTypeArguments(p)) return true; if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return null; } return false; };
    for (const sf of filesOf(P)) {
      const r = rel(sf.fileName);
      // the innermost symbol around a node (a call's caller), and the innermost one that is not a member (a reference's)
      // a decorator runs when its class is defined, so it belongs to the class, not to the member it decorates
      const ownerOf = n => { for (let p = ts.isDecorator(n) ? n.parent.parent : n.parent; p && !ts.isSourceFile(p); p = p.parent) { const id = declId.get(K(r, p)); if (id) return firstOf(id); } return null; };
      const refOwnerOf = n => { for (let p = n.parent; p && !ts.isSourceFile(p); p = p.parent) { const id = declId.get(K(r, p)); if (id && !symAt.get(id).member) return firstOf(id); } return topId.get(K(r, topOf(n))) || r; };
      const ctx = { sf, file: r, from: refOwnerOf, site: n => site(sf, n) };
      // calls not followed are counted in the code the map shows, not in tests
      const tally = k => { if (!files[r].test) CALLS[k]++; };
      // the name a callee starts from (a in a.b.c(), f in f()(…)), and whether it comes from outside the code: a
      // global of the language or the browser, or an import from a package (`react`, `zod`)
      const rootName = e => { e = unwrap(e); while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e) || ts.isNewExpression(e)) e = unwrap(e.expression); return ts.isIdentifier(e) ? e : null; };
      const fromOutside = id => {
        if (!id) return false;
        let sym = null; try { sym = checker.getSymbolAtLocation(id); } catch {}
        const d0 = sym && (sym.declarations || [])[0]; if (!d0) return GLOBALS.has(id.text);
        let p = d0; while (p && !ts.isImportDeclaration(p) && !ts.isSourceFile(p)) p = p.parent;
        return !!(p && ts.isImportDeclaration(p) && ts.isStringLiteral(p.moduleSpecifier) && !/^[./]/.test(p.moduleSpecifier.text));
      };
      // a call of declaration d, written at `at`; through an instance (`b.run()`, `this.run()`) a class method may be
      // dispatched to another: an override in the repo, a class whose base the scan cannot follow, or an abstract one's
      const call = (node, at, d, viaInstance) => {
        if (!files[rel(d.getSourceFile().fileName)]) return;   // a library's code: not part of the map
        if (ts.isMethodSignature(d) || ts.isPropertySignature(d) || ts.isCallSignatureDeclaration(d)) { tally('interface'); return; }   // through an interface: any implementation
        const to = declId.get(KN(d)); if (!to) { tally('local'); return; }   // a local function, a parameter, a destructured name
        const loose = viaInstance && d.parent && ts.isClassLike(d.parent) && (overridden.has(to) || abstract.has(to) || open.has(symAt.get(to).name));
        // the site is the name called, which a chained call (`a\n  .b\n  .c()`) has on a line of its own
        addRel(ownerOf(node) || r, firstOf(to), 'call', sf, at, loose ? 'inferred' : 'exact');
      };
      const viaInstance = e => { e = unwrap(e); if (e.kind === ts.SyntaxKind.SuperKeyword) return false; const d = ts.isIdentifier(e) && resolve(e); return !(d && ts.isClassLike(d)); };   // Class.staticMethod() names its class
      const onCall = node => {
        // super(…) runs the constructor of the class this one extends
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) {
          let c = node.parent; while (c && !ts.isClassLike(c)) c = c.parent;
          const b = c && baseIn(checker, c); if (b) call(node, node.expression, b, false); else if (b === undefined) tally('dynamic');
          return;
        }
        const c = calleeOf(node); if (!c) return;
        // api["send"](): a literal key names the member; a computed key cannot be followed
        if (ts.isElementAccessExpression(c)) {
          const a = c.argumentExpression;
          if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) { const d = resolve(a); if (d) call(node, a, d, viaInstance(c.expression)); else if (!fromOutside(rootName(c.expression))) tally('member'); } else tally('dynamic');
          return;
        }
        // (factory())(), (a || b)(): a value computed at run time; (function () {})(): a function of no name
        const nameNode = ts.isIdentifier(c) ? c : ts.isPropertyAccessExpression(c) ? c.name : null; if (!nameNode) { if (isFn(c)) tally('local'); else if (!ts.isDecorator(node)) tally('dynamic'); return; }
        if (c === nameNode && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^[a-z]|-/.test(c.text)) return;   // <div>: an HTML element
        const d = resolve(nameNode);
        // fn.call(…) and fn.apply(…) run fn; fn.bind(…) only makes a new function
        if ((!d || !files[rel(d.getSourceFile().fileName)]) && ts.isPropertyAccessExpression(c) && /^(call|apply)$/.test(nameNode.text) && ts.isCallExpression(node)) {
          const inner = unwrap(c.expression), nn = ts.isIdentifier(inner) ? inner : ts.isPropertyAccessExpression(inner) ? inner.name : null, d2 = nn && resolve(nn);
          if (d2 && files[rel(d2.getSourceFile().fileName)]) { call(node, nn, d2, ts.isPropertyAccessExpression(inner) && viaInstance(inner.expression)); return; }
        }
        // a name nothing in the code declares, or a method of a value whose type the scan does not know (`any`, a
        // parameter of a library's type it cannot read); globals and packages' names are outside the map, not gaps
        if (!d) { if (!fromOutside(ts.isIdentifier(c) ? c : rootName(c.expression)) && (ts.isIdentifier(c) || !BUILTIN_METHODS.has(nameNode.text))) tally(ts.isIdentifier(c) ? 'unknown' : 'member'); return; }
        call(node, nameNode, d, ts.isPropertyAccessExpression(c) && viaInstance(c.expression));
      };
      const visit = node => {
        if (ts.isIdentifier(node) && node.parent && !(ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent) || ts.isNamespaceImport(node.parent) || isRequireBinding(node))) {
          const tt = inType(node);
          if (tt !== null && !(node.parent.name === node && (ts.isFunctionDeclaration(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isClassDeclaration(node.parent) || ts.isPropertyAccessExpression(node.parent) && node.parent.expression !== node))) {
            const d = resolve(node);
            if (d) {
              const dr = rel(d.getSourceFile().fileName), to = dr !== r && files[dr] && !dr.startsWith('..') ? targetOf(d) : null;
              if (to) addRel(ctx.from(node), to, tt ? 'type' : 'ref', sf, node, 'exact');
            }
          }
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node) || ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) || ts.isDecorator(node)) onCall(node);
        for (const h of hooks) h.onNode(ts, node, ctx);
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }

  // compare: the top-level declarations of one version of a file, for diffs
  const roots = D.roots.map(r => r.path);
  const owns = p => COVERS.includes(path.extname(p).toLowerCase()) && !/\.d\.[cm]?ts$/.test(p) && codeRoots.includes(rootOf(roots, p));
  const ranges = (p, text) => {
    const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true, scriptKind(p)), o = [], DECLARED = declaredNames(sf);
    const own = e => ts.isIdentifier(e) && DECLARED.has(e.text);   // exports.alias = x names x, declared on its own lines
    const L = n => sf.getLineAndCharacterOfPosition(n).line + 1;
    for (const s of sf.statements) {
      const a = L(s.getStart(sf)), b = L(s.getEnd()), cj = cjsAssign(s);
      if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && (s.name || ts.isFunctionDeclaration(s))) o.push([s.name ? s.name.text : 'default', a, b]);
      else if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) { if (ts.isIdentifier(d.name)) o.push([d.name.text, L(d.getStart(sf)), L(d.getEnd())]); }
      else if (ts.isExportAssignment(s)) o.push([ts.isIdentifier(s.expression) ? s.expression.text : 'default', a, b]);
      else if (cj && cjsTarget(cj.left) && !own(cj.right)) o.push([cjsTarget(cj.left), a, b]);
      else if (cj && cjsTarget(cj.left)) { /* exports.alias = x */ }
      else if (cj && cjsTarget(cj.left) === '' && ts.isObjectLiteralExpression(cj.right)) { for (const pr of cj.right.properties) if ((ts.isPropertyAssignment(pr) && !ts.isIdentifier(pr.initializer) || ts.isMethodDeclaration(pr)) && pr.name && (ts.isIdentifier(pr.name) || ts.isStringLiteral(pr.name))) o.push([pr.name.text, L(pr.getStart(sf)), L(pr.getEnd())]); }
      else if (cj && cjsTarget(cj.left) === '' && !ts.isIdentifier(cj.right)) o.push([(cj.right.name && cj.right.name.text) || 'default', a, b]);
    }
    // [name, first line, last line, id, the id without its path (to match a renamed file's declarations)]
    const ids = idMaker(p);
    return o.map(([n, a, b]) => { const id = ids.id(part(n)); return [n, a, b, id, id.slice(p.length)]; });
  };
  const ms = Date.now() - t0;
  const info = () => ({ name: NAME, version: ts.version, files: Object.keys(files).length, facts: symbols.length + REL.size, ms, covers: COVERS });
  // relations in the order the files and their nodes were read: fixed for one commit, and the order consumers break ties in
  const relations = [...REL.values()];
  return { name: NAME, files, symbols, relations, owns, ranges, info, unresolved: () => ({ 'call-local': CALLS.local, 'call-unknown': CALLS.unknown, 'call-member': CALLS.member, 'call-dynamic': CALLS.dynamic, 'call-interface': CALLS.interface }) };
}

module.exports = { tscAdapter, COVERS };
