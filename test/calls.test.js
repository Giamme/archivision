'use strict';
// `call` relations from the TypeScript adapter: every call between symbols, at every site, same-file ones too,
// scored against the hand-labelled fixture (test/fixtures/labelled, "// CALL from -> to" comments), and the cases a
// review found, one by one.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { scanRepo, validateScan } = require('../lib');
const { facts } = require('../lib/repo/facts');
const { parse, tokenAt, isCallee } = require('./support/callsite');

const LABELLED = path.join(__dirname, 'fixtures', 'labelled');
// a repo whose files are the given ones
function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-calls-')), root = path.join(dir, 'r');
  for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); }
  return { root, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
// one fact per call site: caller id, line, column, callee id and how sure (a multiset: a site found twice and one
// missed do not cancel, nor do two sites on one line found at one column)
const sitesOf = S => S.relations.filter(r => r.rel === 'call').flatMap(r => r.sites.map(([l, c]) => `${r.from} @${l}:${c} -> ${r.to} ${r.status}`)).sort();

// labels: `// CALL from -> to@column [status]`, several separated by commas; the status is exact unless it says
test('calls: the labelled TypeScript fixture, every labelled call site found once and nothing else', () => {
  const src = path.join(LABELLED, 'ts'), files = {};
  for (const f of fs.readdirSync(src)) files[`src/ts/${f}`] = fs.readFileSync(path.join(src, f), 'utf8');
  const r = repoWith(files);
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    const want = [];
    for (const [p, t] of Object.entries(files)) t.split('\n').forEach((l, i) => {
      const m = l.match(/CALL\s+(\S+)\s+->\s+(.+)$/); if (!m) return;
      for (const t of m[2].split(',').map(x => x.trim())) { const [, to, col, st] = t.match(/^(\S+)@(\d+)(?:\s+(\w+))?$/); want.push(`src/${m[1]} @${i + 1}:${col} -> src/${to} ${st || 'exact'}`); }
    });
    assert.equal(want.length, 14, 'labels read');
    assert.deepEqual(sitesOf(S), want.sort());
    assert.ok(S.relations.filter(x => x.rel === 'call').every(x => x.n === x.sites.length));
  } finally { r.cleanup(); }
});

test('calls: JSX elements, new, members of objects, overrides, super and local functions', () => {
  const r = repoWith({
    'src/ui.tsx': "export function Card() { return <div>card</div>; }\nexport function Page() {\n  return <section><Card /><Card /></section>;\n}\n",
    'src/shapes.ts': [
      'export class Base {', '  run() { return 1; }', '  go() { return this.run(); }', '}',
      'export class Child extends Base {', '  run() { return super.run() + 1; }', '}',
      'export const api = {', '  orders: {', '    send(id: string) { return id; },', '  },', '};',
      'export function useAll() {', '  const b = new Base();', '  function local() { return 2; }', '  return b.go() + local() + api.orders.send("x").length;', '}', ''].join('\n'),
  });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    const rel = (from, to) => S.relations.find(x => x.rel === 'call' && x.from === from && x.to === to);
    const card = rel('src/ui.tsx#Page', 'src/ui.tsx#Card');
    assert.ok(card, sitesOf(S).join('\n'));
    assert.deepEqual(card.sites, [[3, 20], [3, 28]], 'two JSX elements, two sites (at the name), same file');
    assert.ok(rel('src/shapes.ts#useAll', 'src/shapes.ts#Base'), 'new Base()');
    assert.ok(rel('src/shapes.ts#useAll', 'src/shapes.ts#api.orders.send'), 'a method of a nested object');
    assert.equal(rel('src/shapes.ts#Base.go', 'src/shapes.ts#Base.run').status, 'inferred', 'Child overrides run: this.run() may run it');
    assert.equal(rel('src/shapes.ts#Child.run', 'src/shapes.ts#Base.run').status, 'exact', 'super.run() names its target');
    assert.equal(rel('src/shapes.ts#useAll', 'src/shapes.ts#Base.go').status, 'exact', 'nothing overrides go');
    assert.ok(!S.relations.some(x => x.rel === 'call' && /local/.test(x.to)), 'a local function is not a symbol');
    assert.ok(S.unresolved.tsc['call-local'] >= 1, JSON.stringify(S.unresolved));
  } finally { r.cleanup(); }
});

test('calls: the cases the review found', () => {
  const r = repoWith({
    'src/dispatch.ts': [
      'export class Base { run() { return 1; } }',
      'const Alias = Base;',
      'export class Child extends Alias { run() { return 2; } }',
      'declare function mixin<T>(b: T): T;',
      'export class Mixed extends mixin(Object) { go() { return 3; } }',
      'export class Plain { go() { return 4; } }',
      'export abstract class A { abstract act(): number; twice() { return this.act() * 2; } }',
      'export function target() { return 1; }',
      'export function fn(n: number) { return n; }',
      ''].join('\n'),
    'src/cases.ts': [
      "import type { Base as BaseT, Plain } from './dispatch';",
      "import { target, fn } from './dispatch';",
      "import * as ns from './ns';",
      "import def, { named as renamed } from './ns';",
      'export function viaType(b: BaseT, p: Plain) { return b.run() + p.go(); }',
      'const a = {}; const b = { run() { return 1; } };',
      'export function useB() { return b.run(); }',
      'export function f1() { class C { run() { return 1; } } return new C().run(); }',
      'export function f2() { class C { run() { return 2; } } return new C().run(); }',
      'export const x = target(), y = 1;',
      'const key = "send" as string;',
      'export const api = { send() { return 1; } };',
      'export function keys() { return api["send"]() + (api as any)[key](); }',
      'export function indirect() { return fn.call(null, 1) + fn.apply(null, [2]) + fn.bind(null)(3); }',
      'export function optional(g?: typeof fn) { return target?.() ?? 0; }',
      'export function id<T>(v: T) { return v; }',
      'export function generic() { return id<number>(1); }',
      'export function imports() { return ns.helper() + def() + renamed(); }',
      'export function withDefault(n = target()) { return n; }',
      'export function callback() { return [1].map(fn); }',
      ''].join('\n'),
    'src/ns.ts': 'export function helper() { return 1; }\nexport function named() { return 2; }\nexport default function main() { return 3; }\n',
    'src/klass.ts': [
      "import { Base, target } from './dispatch';",
      'function dec(t: any) { return t; }',
      'export class K extends Base {',
      '  v = target();',
      '  static { target(); }',
      '  constructor() { super(); }',
      '  get total() { return target(); }',
      '  @dec method() { return 1; }',
      '}',
      'export function make() { return new K(); }',
      ''].join('\n'),
  });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    const calls = S.relations.filter(x => x.rel === 'call');
    const rel = (from, to) => calls.find(x => x.from === from && x.to === to);
    const has = (from, to, why) => assert.ok(rel(from, to), `${why}: ${from} -> ${to}\n${sitesOf(S).join('\n')}`);
    // a type-only import does not hide a call through a value typed by it
    has('src/cases.ts#viaType', 'src/dispatch.ts#Base.run', 'a call through a value of an imported type');
    const X = facts(S), e = X.edges.find(x => x.f === 'src/cases.ts' && x.fs === 'viaType' && x.ts === 'Base');
    assert.ok(e && e.call > 0 && !e.type, `the edge to Base is a call edge: ${JSON.stringify(e)}`);
    // the owner of a member comes from the declaration, not from line numbers
    assert.ok(X.sameFile.some(x => x.fs === 'useB' && x.ts === 'b'), JSON.stringify(X.sameFile.filter(x => x.fs === 'useB')));
    assert.ok(!X.sameFile.some(x => x.fs === 'useB' && x.ts === 'a'));
    // two classes of one name in two functions stay two
    has('src/cases.ts#f1', 'src/cases.ts#f1.C.run', 'the class inside f1');
    has('src/cases.ts#f2', 'src/cases.ts#f2.C.run', 'the class inside f2');
    // dispatch: an override through an alias, a mixin, an abstract method
    assert.equal(rel('src/cases.ts#viaType', 'src/dispatch.ts#Base.run').status, 'inferred', 'Child (extends an alias of Base) overrides run');
    assert.equal(rel('src/cases.ts#viaType', 'src/dispatch.ts#Plain.go').status, 'inferred', 'a mixin class has a go of its own');
    assert.equal(rel('src/dispatch.ts#A.twice', 'src/dispatch.ts#A.act').status, 'inferred', 'an abstract method');
    // references and calls of one declaration come from the same declarator
    has('src/cases.ts#x', 'src/dispatch.ts#target', 'export const x = target(), y = 1');
    assert.ok(!S.relations.some(x => x.from === 'src/cases.ts#y'), 'y references nothing');
    // keys, call/apply, bind, optional and generic calls, imports of every kind
    has('src/cases.ts#keys', 'src/cases.ts#api.send', 'api["send"]()');
    assert.ok(S.unresolved.tsc['call-dynamic'] >= 1, 'a computed key is counted');
    const ind = rel('src/cases.ts#indirect', 'src/dispatch.ts#fn');
    assert.equal(ind && ind.n, 2, 'fn.call and fn.apply run fn; fn.bind does not');
    has('src/cases.ts#optional', 'src/dispatch.ts#target', 'target?.()');
    has('src/cases.ts#generic', 'src/cases.ts#id', 'id<number>(1)');
    for (const t of ['helper', 'named', 'main']) has('src/cases.ts#imports', `src/ns.ts#${t}`, 'namespace, default and renamed imports');
    has('src/cases.ts#withDefault', 'src/dispatch.ts#target', 'a default parameter value');
    assert.ok(!rel('src/cases.ts#callback', 'src/dispatch.ts#fn'), 'passing fn on is not calling it');
    // class bodies: field initializers, static blocks, super(), getters, decorators, new
    assert.equal(rel('src/klass.ts#K', 'src/dispatch.ts#target').n, 2, 'a field initializer and a static block');
    has('src/klass.ts#K.constructor', 'src/dispatch.ts#Base', 'super() runs the base constructor');
    has('src/klass.ts#K.total', 'src/dispatch.ts#target', 'a getter');
    has('src/klass.ts#K', 'src/klass.ts#dec', 'a decorator');
    has('src/klass.ts#make', 'src/klass.ts#K', 'new K()');
  } finally { r.cleanup(); }
});

test('calls: the page checks a call-site link with the compiler', () => {
  const src = [
    'import Other from "./x";',
    '// f()',
    'function f() { return 1; }',
    'const v = <f>value;',
    'f?.();',
    'f',
    '  ();',
    'f<() => void>();',
    'Other();',
    'api["send"]();',
    'class B extends A { constructor() { super(); } }',
    'fn.call(null);',
    ''].join('\n');
  const sf = parse('a.ts', src), at = (l, c) => { const t = tokenAt(sf, l, c); return t && isCallee(t); };
  assert.equal(at(2, 4), null, 'a comment holds no token');
  assert.equal(at(3, 10), false, 'a declaration is not a call');
  assert.equal(at(4, 12), false, 'a type assertion is not a call');
  assert.equal(at(5, 1), true, 'f?.()');
  assert.equal(at(6, 1), true, 'f on its own line, called on the next');
  assert.equal(at(8, 1), true, 'f<() => void>()');
  assert.equal(at(9, 1), true, 'a default import under its own name');
  assert.equal(at(10, 5), true, 'a literal key');
  assert.equal(at(11, 37), true, 'super()');
  assert.equal(at(12, 1), true, 'fn.call');
});
