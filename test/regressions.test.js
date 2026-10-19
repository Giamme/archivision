'use strict';
// Cases the review of 0c found, each a small change to a fixture.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { scanRepo, autoMap, buildRepo, validateScan } = require('../lib');
const { makeRepo } = require('./support/fixture-repo');

const write = (root, files) => { for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); } };

test('symbols named like object properties (toString, constructor) keep their own ids', () => {
  const r = makeRepo('mini-shop');
  try {
    write(r.root, {
      'src/lib/proto.ts': "export function toString() { return 'x'; }\nexport const constructor = () => 1;\nexport function hasOwnProperty() { return true; }\n",
      'src/lib/use-proto.ts': "import { toString, constructor, hasOwnProperty } from './proto';\nexport function useProto() { return toString() + constructor() + String(hasOwnProperty()); }\n",
    });
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    for (const n of ['toString', 'constructor', 'hasOwnProperty']) assert.ok(S.relations.some(x => x.from === 'src/lib/use-proto.ts#useProto' && x.to === `src/lib/proto.ts#${n}`), n);
    const B = buildRepo(autoMap(S), S);
    assert.ok(B.ATLAS.modules.length > 0);
  } finally { r.cleanup(); }
});

test('helpers in the app folder group with their route even when they hold no route file', () => {
  const r = makeRepo('mini-shop');
  try {
    write(r.root, Object.fromEntries(['a', 'b', 'c', 'd'].map((x, i, all) => [`src/app/reports/_lib/${x}.ts`, `${i ? `import { ${all[i - 1]}Report } from './${all[i - 1]}';\n` : ''}export function ${x}Report() { return ${i ? `${all[i - 1]}Report() + ` : ''}1; }\n`])));
    const S = scanRepo(r.root, {}), map = autoMap(S);
    const owner = map.modules.find(m => m.parts.some(p => (p.globs || []).some(g => g.startsWith('src/app/reports'))));
    assert.ok(owner, map.modules.map(m => m.name).join(', '));
    assert.equal(owner.name, 'Reports');
  } finally { r.cleanup(); }
});

test('a browser spec that a unit test also reaches keeps both its visits and the files it reaches', () => {
  const r = makeRepo('mini-shop');
  try {
    write(r.root, {
      'e2e/check.spec.ts': "import { createOrder } from '../src/lib/orders';\nexport const used = createOrder;\nexport async function visit(page: any) { await page.goto('/orders'); }\n",
      'tests/check.test.ts': "import { used } from '../e2e/check.spec';\nexport const again = used;\n",
    });
    const S = scanRepo(r.root, {});
    const t = S.tests['e2e/check.spec.ts'];
    assert.ok(t && t.visits.some(v => v.route === '/orders'), JSON.stringify(t));
    assert.ok(t.imports.some(i => i.file === 'src/lib/orders.ts'), JSON.stringify(t));
  } finally { r.cleanup(); }
});

test('a walkthrough step on a method nested in an object, or on a local function, keeps its link', () => {
  const r = makeRepo('mini-shop');
  try {
    write(r.root, { 'src/lib/api.ts': "export const api = {\n  orders: {\n    send(id: string) {\n      return id;\n    },\n  },\n};\nexport function outer() {\n  function inner() {\n    return 2;\n  }\n  return inner();\n}\n" });
    const S = scanRepo(r.root, {}), map = autoMap(S);
    const m = map.modules.find(x => x.parts.some(p => (p.globs || []).some(g => 'src/lib/api.ts'.startsWith(g.replace('/**', '')) || g === 'src/lib/api.ts'))) || map.modules[0];
    const part = m.parts[0].id;
    map.journeys = [{ name: 'nested', group: 'test', steps: [
      { module: m.id, part, symbol: 'api.orders.send', file: 'src/lib/api.ts', note: 'nested member' },
      { module: m.id, part, symbol: 'inner', file: 'src/lib/api.ts', note: 'local function' }] }];
    const B = buildRepo(map, S), j = B.ATLAS.journeys[0];
    assert.ok(j, B.warnings.join('\n'));
    assert.deepEqual(j.code.map(c => c && [c.l, c.e]), [[3, 5], [9, 9]]);
    assert.equal(j.status, 'unresolved', 'no reference joins the two steps');
  } finally { r.cleanup(); }
});

test('overloaded route handlers and server actions are one entry each', () => {
  const r = makeRepo('mini-shop');
  try {
    write(r.root, {
      'src/app/api/report/route.ts': "export function GET(): Response;\nexport function GET(req?: Request): Response { return new Response(String(req)); }\n",
      'src/app/actions/report.ts': "'use server';\nexport async function makeReport(a: string): Promise<string>;\nexport async function makeReport(a: number): Promise<string>;\nexport async function makeReport(a: any) { return String(a); }\n",
    });
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    assert.equal(S.entries.filter(e => e.kind === 'route' && e.evidence.file === 'src/app/api/report/route.ts').length, 1);
    assert.equal(S.entries.filter(e => e.kind === 'action' && e.evidence.file === 'src/app/actions/report.ts').length, 1);
    assert.ok(S.symbols.some(s => s.id === 'src/app/actions/report.ts#makeReport#3'), 'the third declaration gets #3');
  } finally { r.cleanup(); }
});

test('a qualified member is found only under its owner, class-field objects included', () => {
  const r = makeRepo('mini-shop');
  try {
    write(r.root, { 'src/lib/owners.ts': "export class A {\n  send() { return 1; }\n  handlers = {\n    save() { return 2; },\n  };\n}\n" });
    const S = scanRepo(r.root, {}), { member } = require('../lib/repo/facts').facts(S);
    assert.equal(member('src/lib/owners.ts', 'A.send').line, 2);
    assert.equal(member('src/lib/owners.ts', 'Missing.send'), null);
    assert.equal(member('src/lib/owners.ts', 'A.handlers.save').line, 4);
    assert.equal(member('src/lib/owners.ts', 'save').line, 4);
  } finally { r.cleanup(); }
});

test('an unresolved reference stays unresolved on its cable; two models of one name in two packages stay two', () => {
  const r = makeRepo('mini-shop');
  try {
    const S = scanRepo(r.root, {}), map = autoMap(S);
    const U = JSON.parse(JSON.stringify(S)); for (const x of U.relations) x.status = 'unresolved';
    const B = buildRepo(map, U);
    assert.ok(B.ATLAS.modules.flatMap(m => m.links || []).every(l => l.status === 'unresolved'));
    const T = JSON.parse(JSON.stringify(S)), [id, res] = Object.entries(T.resources).find(([, x]) => x.name === 'Order');
    T.resources[id.replace(/:[^:]*:Order$/, ':other-pkg:Order')] = { ...res, pkg: 'other-pkg', line: 99, end: 100 };
    const { models } = require('../lib/repo/facts').facts(T);
    assert.equal(Object.keys(models).length, Object.keys(T.resources).length);
    assert.deepEqual(Object.keys(models).filter(k => k.startsWith('Order ·')).sort(), ['Order · other-pkg', 'Order · prisma']);
  } finally { r.cleanup(); }
});

test('a unit test file is credited to the runner it imports', () => {
  const r = makeRepo('mini-shop');
  try {
    write(r.root, { 'tests/a.test.ts': "import { describe } from 'vitest';\nimport { createOrder } from '../src/lib/orders';\ndescribe('x', () => createOrder);\n" });
    const S = scanRepo(r.root, {});
    assert.equal(S.tests['tests/a.test.ts'].runner, 'vitest');
    assert.equal(S.tests['tests/a.test.ts'].runnerProv, 'its imports');
  } finally { r.cleanup(); }
});

test('a page title with quotes, a newline, </script> or U+2028 stays a string in the page script', () => {
  const { renderPage } = require('../lib');
  const vm = require('vm');
  for (const title of ["it's \\ a\nb", 'Shop </script><script>alert(1)</script>', 'a\u2028b\u2029c', '$& $1 $` x']) {
    const html = renderPage({ ATLAS: {}, SCENE: {} }, title);
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(!scripts.some(s => /alert\(1\)/.test(s) && !/FIGS3D\.push/.test(s)), 'no script of its own');
    const mod = scripts.find(s => s.includes("FIGS3D.push({ id: 'az'"));
    assert.ok(mod, `the figure module is still one script for ${JSON.stringify(title)}`);
    const line = mod.slice(mod.indexOf("FIGS3D.push({ id: 'az'")).split('\n')[0];
    const m = line.match(/name: ("(?:[^"\\]|\\.)*"), mod:/);
    assert.ok(m, line.slice(0, 200));
    assert.equal(vm.runInNewContext(m[1]), title);
  }
});
