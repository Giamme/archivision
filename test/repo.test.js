'use strict';
// Repo mode end to end on a small Next.js + Prisma fixture, made into a throwaway git repo with three branches.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const { scanRepo, autoMap, buildRepo, writePage } = require('../lib');

const FIX = path.join(__dirname, 'fixtures', 'mini-shop');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-repo-'));
const ROOT = path.join(tmp, 'mini-shop');
const git = (...a) => execFileSync('git', ['-C', ROOT, '-c', 'user.name=archivision test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
fs.cpSync(FIX, ROOT, { recursive: true });
git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'shop');
git('branch', 'dev'); git('checkout', '-q', '-b', 'feature/discounts', 'dev');
fs.appendFileSync(path.join(ROOT, 'src/lib/orders.ts'), '\nexport function discount(total: number, code: string) {\n  return code === "TEN" ? total * 0.9 : total;\n}\n');
fs.writeFileSync(path.join(ROOT, 'src/lib/orders.ts'), fs.readFileSync(path.join(ROOT, 'src/lib/orders.ts'), 'utf8').replace('return prisma.order.create', 'const order = prisma.order.create; return order'));
git('commit', '-q', '-am', 'discounts');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let S, map, B;
test('scan reads symbols, calls, Prisma, tests and branch changes', () => {
  S = scanRepo(ROOT, { bases: 'dev,main', since: 3650 });
  assert.equal(S.version, 2);
  const sym = id => S.symbols.find(s => s.id === id);
  assert.ok(sym('src/lib/orders.ts#createOrder'));
  assert.equal(sym('src/app/orders/page.tsx#OrdersPage').kind, 'page');
  assert.equal(sym('src/app/actions/orders.ts#submitOrder').kind, 'action');
  assert.ok(S.entries.some(e => e.kind === 'action' && e.handler === 'src/app/actions/orders.ts#submitOrder'), 'the server action is an entry point');
  assert.ok(S.data.some(x => x.resource === 'prisma:.:Order' && x.op !== 'read'), 'a write to Order');
  assert.deepEqual(Object.values(S.resources).map(r => r.name).sort(), ['Order', 'OrderLine', 'Product']);
  assert.ok(S.tests['e2e/orders.spec.ts'].visits.some(v => v.route === '/orders'));
  assert.ok(S.relations.every(r => r.status === 'exact' && r.prov === 'tsc'));
  const c = S.compare.find(x => x.base.endsWith('dev') && x.head === 'feature/discounts');
  assert.ok(c, `dev..feature/discounts compared (have ${S.compare.map(x => `${x.base}..${x.head}`).join(', ')})`);
  assert.deepEqual(c.files.map(f => f[0]), ['src/lib/orders.ts']);
  assert.deepEqual(c.syms['src/lib/orders.ts'].sort(), ['createOrder', 'discount']);
  assert.deepEqual(c.changed.map(x => `${x.at} ${x.id}`).sort(), ['head src/lib/orders.ts#createOrder', 'head src/lib/orders.ts#discount']);
});

test('automap groups every file without AI, with a walkthrough down to the database', () => {
  map = autoMap(S);
  assert.equal(map.generator, 'automap');
  assert.ok(map.modules.length >= 2);
  assert.ok(map.dbGroups.length >= 1);
  const j = map.journeys.find(x => x.steps.some(s => s.symbol === 'submitOrder'));
  assert.ok(j, `a walkthrough through submitOrder (have ${map.journeys.map(x => x.name).join('; ')})`);
  assert.equal(j.steps[j.steps.length - 1].symbol, 'createOrder');
});

test('build places every file, checks anchors and lights the changed block', () => {
  B = buildRepo(map, S);
  assert.equal(B.ATLAS.mode, 'repo');
  assert.match(B.summary[1], /unplaced 0/);
  assert.deepEqual(B.warnings, []);
  assert.ok(B.SCENE.rail && B.SCENE.ports.length >= 1, 'a database rail');
  const fileCount = B.ATLAS.modules.filter(m => m.id !== 'dock').reduce((a, m) => a + m.parts.reduce((b, p) => b + p.code.files.length, 0), 0);
  assert.equal(fileCount, B.ATLAS.totals.files);
  const c = B.ATLAS.cmp.list.find(x => x.head === 'feature/discounts');
  assert.ok(c.mods.length >= 1 && c.nsym === 2);
  // every anchor points at a real line
  for (const m of B.ATLAS.modules) for (const p of m.parts) for (const k of p.children || []) {
    const n = fs.readFileSync(path.join(ROOT, k.code.p), 'utf8').split('\n').length;
    assert.ok(k.code.l >= 1 && k.code.e <= n, `${k.code.p}:${k.code.l}-${k.code.e}`);
  }
  for (const j of B.ATLAS.journeys) assert.ok(j.steps.some(s => /^P\d+$/.test(s)), `walkthrough «${j.name}» reaches a rail port`);
});

test('the page opens offline and every link and control works', () => {
  const out = path.join(tmp, 'mini-shop.archivision.html');
  writePage(B, 'mini-shop · archivision', out);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), out], { encoding: 'utf8', timeout: 180e3 });
  assert.equal(r.status, 0, r.stdout.slice(-2500) + r.stderr.slice(-1000));
  assert.match(r.stdout, /mode repo/);
  assert.match(r.stdout, /FAIL none/);
});

test('a folder that is not a git repo still maps, with no comparisons', () => {
  const plain = path.join(tmp, 'plain');
  fs.cpSync(FIX, plain, { recursive: true });
  const S2 = scanRepo(plain, {});
  assert.deepEqual(S2.compare, []);
  const B2 = buildRepo(autoMap(S2), S2);
  assert.equal(B2.ATLAS.cmp.list.length, 0);
});

test('a repo without Prisma has no rail', () => {
  const np = path.join(tmp, 'no-prisma');
  fs.cpSync(FIX, np, { recursive: true });
  fs.rmSync(path.join(np, 'prisma'), { recursive: true });
  const S3 = scanRepo(np, {});
  const B3 = buildRepo(autoMap(S3), S3);
  assert.equal(B3.SCENE.rail, null);
  assert.equal(B3.ATLAS.rail, null);
  assert.ok(!B3.ATLAS.modules.some(m => m.id === 'dock'));
  const out = path.join(tmp, 'no-prisma.html');
  writePage(B3, 'no-prisma · archivision', out);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), out], { encoding: 'utf8', timeout: 180e3 });
  assert.equal(r.status, 0, r.stdout.slice(-2500) + r.stderr.slice(-1000));
  assert.match(r.stdout, /rail no/);
});

test('a reference that is not exact is marked on its cable and its walkthrough, and the page still checks', () => {
  const S4 = JSON.parse(JSON.stringify(S));
  for (const r of S4.relations) r.status = 'inferred';
  const B4 = buildRepo(map, S4);
  assert.ok(B4.ATLAS.flows.filter(f => f.to !== 'dock').every(f => f.status === 'inferred'));
  assert.ok(B4.ATLAS.modules.some(m => (m.links || []).some(l => l.status === 'inferred')) || B4.ATLAS.modules.every(m => !(m.links || []).length));
  assert.ok(B4.ATLAS.journeys.some(j => j.status === 'inferred'), 'a walkthrough over inferred references says so');
  assert.ok(B.ATLAS.journeys.every(j => j.status === 'exact'));
  const out = path.join(tmp, 'inferred.html');
  writePage(B4, 'inferred · archivision', out);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), out], { encoding: 'utf8', timeout: 180e3 });
  assert.equal(r.status, 0, r.stdout.slice(-2500) + r.stderr.slice(-1000));
  const [, drawn, dashed] = r.stdout.match(/cables drawn (\d+) · dashed (\d+)/).map(Number);
  assert.ok(drawn > 0 && dashed === drawn, `every cable over inferred references is dashed: ${drawn} drawn, ${dashed} dashed`);
});
