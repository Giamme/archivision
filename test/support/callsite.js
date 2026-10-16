'use strict';
// Checks a call-site link: the token at a line and column, whether a call invokes it there (a call, `new`, a JSX
// element, a tagged template, a decorator, fn.call/apply), and what it invokes. That last part is read from the
// syntax of the files and the compiler's module resolution only, never from its type checker, so it checks the
// scan rather than repeating it: a name is followed through local bindings, imports, require(), re-exports and
// CommonJS exports to the declaration it names. Used by check-page.mjs.
const fs = require('fs'), path = require('path');
const ts = require('typescript');

const scriptKind = f => /\.tsx$/.test(f) ? ts.ScriptKind.TSX : /\.jsx$/.test(f) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(f) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
// the name, string key or `super` that starts at a line and column (both from 1)
function tokenAt(sf, line, col) {
  let pos; try { pos = sf.getPositionOfLineAndCharacter(line - 1, col - 1); } catch { return null; }
  let hit = null;
  const v = n => { if (hit) return; if (n.getStart(sf) === pos && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || n.kind === ts.SyntaxKind.SuperKeyword)) { hit = n; return; } if (n.pos <= pos && pos < n.end) ts.forEachChild(n, v); };
  v(sf); return hit;
}
const WRAP = n => n && (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n)));
const unwrap = e => { while (WRAP(e)) e = e.expression; return e; };
function isCallee(t) {
  if (t.kind === ts.SyntaxKind.SuperKeyword) return ts.isCallExpression(t.parent) && t.parent.expression === t;
  let n = t;
  if (ts.isStringLiteral(t) || ts.isNoSubstitutionTemplateLiteral(t)) { if (!(ts.isElementAccessExpression(t.parent) && t.parent.argumentExpression === t)) return false; n = t.parent; }
  else if (t.parent && ts.isPropertyAccessExpression(t.parent) && t.parent.name === t) n = t.parent;
  const callee = x => { while (WRAP(x.parent)) x = x.parent; const p = x.parent; if (!p) return false;
    return ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === x) || (ts.isTaggedTemplateExpression(p) && p.tag === x) || ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) && p.tagName === x) || (ts.isDecorator(p) && p.expression === x); };
  if (callee(n)) return true;
  const p = n.parent;   // fn.call(…), fn.apply(…)
  return !!(p && ts.isPropertyAccessExpression(p) && p.expression === n && /^(call|apply)$/.test(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p);
}

const has = (n, k) => !!(ts.canHaveModifiers(n) && (ts.getModifiers(n) || []).some(m => m.kind === k));
const requireOf = e => { e = e && unwrap(e); return e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'require' && e.arguments[0] && ts.isStringLiteral(e.arguments[0]) ? e.arguments[0].text : null; };
// CommonJS: `exports.x =`, `module.exports.x =` name x; `module.exports =` names the module itself ('')
const cjs = s => {
  if (!ts.isExpressionStatement(s) || !ts.isBinaryExpression(s.expression) || s.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  const l = s.expression.left, r = s.expression.right; if (!ts.isPropertyAccessExpression(l)) return null;
  const e = l.expression;
  if (ts.isIdentifier(e) && e.text === 'module' && l.name.text === 'exports') return { name: '', right: r };
  if (ts.isIdentifier(e) && e.text === 'exports') return { name: l.name.text, right: r };
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'module' && e.name.text === 'exports') return { name: l.name.text, right: r };
  return null;
};

// what calls in a repo invoke: { file, name } a declaration, { member, owner } a method of a value (owner: the
// declaration the value is, when the receiver is a name the file binds), { local: true } a binding inside a function
function makeResolver(ROOT) {
  const REAL = fs.realpathSync(ROOT), SF = new Map(), CFG = new Map();
  const read = f => { if (SF.has(f)) return SF.get(f); let sf = null; try { sf = parse(f, fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch {} SF.set(f, sf); return sf; };
  const configFor = f => { let d = path.dirname(path.join(ROOT, f)); for (;;) { for (const n of ['tsconfig.json', 'jsconfig.json']) { const c = path.join(d, n); if (fs.existsSync(c)) return c; } if (d === ROOT || !d.startsWith(ROOT)) return null; d = path.dirname(d); } };
  const optionsFor = f => { const c = configFor(f); if (CFG.has(c)) return CFG.get(c); let o = { allowJs: true };
    if (c) try { const p = ts.getParsedCommandLineOfConfigFile(c, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} }); if (p) o = { ...p.options, allowJs: true }; } catch {}
    CFG.set(c, o); return o; };
  // the repo file a module specifier names, from a file; null for a library's or a declaration file
  const moduleOf = (from, spec) => {
    const r = ts.resolveModuleName(spec, path.join(ROOT, from), optionsFor(from), ts.sys).resolvedModule; if (!r) return null;
    let f = r.resolvedFileName; try { f = fs.realpathSync(f); } catch {}
    const rel = path.relative(REAL, f).split(path.sep).join('/');
    return rel.startsWith('..') || rel.includes('node_modules') || /\.d\.[cm]?ts$/.test(rel) ? null : rel;
  };
  // what a top-level name of a file is bound to: one of its own declarations, or an import
  const bindingOf = (f, name) => {
    const sf = read(f); if (!sf) return null;
    for (const s of sf.statements) {
      if (ts.isImportDeclaration(s) && s.importClause && ts.isStringLiteral(s.moduleSpecifier)) {
        const m = s.moduleSpecifier.text, c = s.importClause, nb = c.namedBindings;
        if (c.name && c.name.text === name) return { import: m, name: 'default' };
        if (nb && ts.isNamespaceImport(nb) && nb.name.text === name) return { import: m, ns: true };
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (el.name.text === name) return { import: m, name: (el.propertyName || el.name).text };
      }
      if (ts.isImportEqualsDeclaration(s) && s.name.text === name && ts.isExternalModuleReference(s.moduleReference) && ts.isStringLiteral(s.moduleReference.expression)) return { import: s.moduleReference.expression.text, ns: true };
      if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name && s.name.text === name) return { file: f, name };
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
        const req = requireOf(d.initializer);
        if (ts.isIdentifier(d.name) && d.name.text === name) return req ? { import: req, ns: true } : { file: f, name };
        if (ts.isObjectBindingPattern(d.name)) for (const el of d.name.elements) if (ts.isIdentifier(el.name) && el.name.text === name) return req ? { import: req, name: (el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName : el.name).text } : { local: true };
      }
    }
    return null;
  };
  // a top-level name of a file, followed through imports to its declaration ({ file, ns } for a whole module)
  const declOf = (f, name, depth = 0) => {
    if (depth > 12) return null;
    const b = bindingOf(f, name); if (!b || b.file || b.local) return b;
    const t = moduleOf(f, b.import); if (!t) return null;
    return b.ns ? { file: t, ns: true } : exportOf(t, b.name, depth + 1);
  };
  // the declaration a file exports under a name: its own, a re-export (`export { x } from`, `export *`), or CommonJS
  const exportOf = (f, name, depth = 0) => {
    const sf = read(f); if (!sf || depth > 12) return null;
    const stars = [];
    for (const s of sf.statements) {
      const own = (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && has(s, ts.SyntaxKind.ExportKeyword);
      if (name === 'default') {
        if (own && has(s, ts.SyntaxKind.DefaultKeyword)) return { file: f, name: s.name ? s.name.text : 'default' };
        if (ts.isExportAssignment(s) && !s.isExportEquals) return ts.isIdentifier(s.expression) ? declOf(f, s.expression.text, depth + 1) : { file: f, name: 'default' };
      } else {
        if ((own || ((ts.isEnumDeclaration(s)) && has(s, ts.SyntaxKind.ExportKeyword))) && !has(s, ts.SyntaxKind.DefaultKeyword) && s.name && s.name.text === name) return { file: f, name };
        if (ts.isVariableStatement(s) && has(s, ts.SyntaxKind.ExportKeyword)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return { file: f, name };
      }
      if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) for (const el of s.exportClause.elements) if (el.name.text === name) {
        const local = (el.propertyName || el.name).text;
        if (s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) { const t = moduleOf(f, s.moduleSpecifier.text); return t ? exportOf(t, local, depth + 1) : null; }
        return declOf(f, local, depth + 1);
      }
      if (ts.isExportDeclaration(s) && !s.exportClause && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) stars.push(s.moduleSpecifier.text);
      // CommonJS: exports.x = …, module.exports = x, module.exports = { x, y: z }
      const c = cjs(s); if (!c) continue;
      const r = unwrap(c.right);
      const named = (n, e) => (e && ts.isIdentifier(e) && bindingOf(f, e.text) ? declOf(f, e.text, depth + 1) : { file: f, name: n });
      if (c.name && c.name === name) return named(name, r);
      if (!c.name && name === 'default') return ts.isIdentifier(r) ? declOf(f, r.text, depth + 1) : { file: f, name: (r.name && r.name.text) || 'default' };
      if (!c.name && ts.isObjectLiteralExpression(r)) for (const pr of r.properties) {
        if (ts.isShorthandPropertyAssignment(pr) && pr.name.text === name) return declOf(f, name, depth + 1);
        if ((ts.isPropertyAssignment(pr) || ts.isMethodDeclaration(pr)) && pr.name && (ts.isIdentifier(pr.name) || ts.isStringLiteral(pr.name)) && pr.name.text === name) return ts.isPropertyAssignment(pr) ? named(name, unwrap(pr.initializer)) : { file: f, name };
      }
    }
    for (const m of stars) { const t = moduleOf(f, m), r = t && exportOf(t, name, depth + 1); if (r) return r; }
    return null;
  };
  // whether a name is bound inside a function around a node (a parameter, a local variable, function or class)
  const localBinding = (at, name) => {
    const binds = d => d && ((ts.isIdentifier(d) && d.text === name) || ((ts.isObjectBindingPattern(d) || ts.isArrayBindingPattern(d)) && d.elements.some(e => !ts.isOmittedExpression(e) && binds(e.name))));
    const declares = st => (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name && st.name.text === name || ts.isVariableStatement(st) && st.declarationList.declarations.some(d => binds(d.name));
    for (let p = at.parent; p && !ts.isSourceFile(p); p = p.parent) {
      if (ts.isFunctionLike(p) && (p.parameters || []).some(x => binds(x.name))) return true;
      if ((ts.isFunctionExpression(p) || ts.isClassExpression(p)) && p.name && p.name.text === name) return true;
      if (ts.isBlock(p) && !ts.isSourceFile(p.parent) && p.statements.some(declares)) return true;
      if ((ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isForStatement(p)) && p.initializer && ts.isVariableDeclarationList(p.initializer) && p.initializer.declarations.some(d => binds(d.name))) return true;
      if (ts.isCatchClause(p) && p.variableDeclaration && binds(p.variableDeclaration.name)) return true;
    }
    return false;
  };
  // a name used at a node of a file
  const nameAt = (f, at, name) => (localBinding(at, name) ? { local: true } : declOf(f, name));
  // what the call at a token invokes
  function resolveCall(f, t) {
    if (t.kind === ts.SyntaxKind.SuperKeyword) {
      let c = t.parent; while (c && !ts.isClassLike(c)) c = c.parent;
      const h = c && (c.heritageClauses || []).find(x => x.token === ts.SyntaxKind.ExtendsKeyword), e = h && unwrap(h.types[0].expression);
      return e && ts.isIdentifier(e) ? nameAt(f, c, e.text) : null;
    }
    const p = t.parent, recv = p && ts.isPropertyAccessExpression(p) && p.name === t ? p.expression : p && ts.isElementAccessExpression(p) && p.argumentExpression === t ? p.expression : null;
    if (recv) {
      const r = unwrap(recv), o = ts.isIdentifier(r) ? nameAt(f, r, r.text) : null;
      if (o && o.ns) return exportOf(o.file, t.text);                      // ns.helper(): a module's export
      return { member: t.text, owner: o && o.file && !o.ns ? o : null };
    }
    const d = nameAt(f, t, t.text);
    return d && d.ns ? exportOf(d.file, 'default') : d;                  // const run = require('./run'); run()
  }
  return { resolveCall, exportOf, declOf, moduleOf };
}

module.exports = { ts, parse, tokenAt, isCallee, makeResolver };
