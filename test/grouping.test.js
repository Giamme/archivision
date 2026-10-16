'use strict';
// Phase 2: grouping without routes. A package with no app routes gets blocks from its folders (3 files or more), a
// block of more than 40 files splits by its sub-folders, and walkthroughs start from any kind of entry point.
// Expected membership is listed file by file.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { scanRepo, autoMap, buildRepo } = require('../lib');
const { makeRepo } = require('./support/fixture-repo');

function repoWith(name, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-group-')), root = path.join(dir, name);
  for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); }
  return { root, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
// block name -> its files, from the build (what the page shows)
function blocks(root) {
  const S = scanRepo(root, {}), map = autoMap(S), B = buildRepo(map, S);
  const out = {}; for (const m of B.ATLAS.modules) if (m.id !== 'dock') out[m.name] = m.parts.flatMap(p => p.code.files.map(f => f[0])).sort();
  return { out, map, B, S };
}
const fn = (name, body = 'return 1;') => `export function ${name}() { ${body} }\n`;

test('a library: one block per folder, a big folder split by its sub-folders', () => {
  const files = { 'package.json': '{ "name": "toolkit" }', 'src/index.ts': "export * from './core/run';\n" };
  for (const f of ['run', 'plan', 'step']) files[`src/core/${f}.ts`] = fn(f);
  for (const f of ['http', 'fs']) files[`src/adapters/${f}.ts`] = fn(`${f}Adapter`);   // two files: too few for a block
  // 45 components: three sub-folders of 12, 12 and 6, and 15 at the top of the folder
  const comp = [];
  for (const [sub, n] of [['forms', 12], ['charts', 12], ['layout', 6], ['', 15]]) for (let i = 0; i < n; i++) { const p = `src/components/${sub ? sub + '/' : ''}${sub || 'misc'}${i}.ts`; files[p] = fn(`${sub || 'misc'}${i}`); comp.push(p); }
  const r = repoWith('toolkit', files);
  try {
    const { out, map } = blocks(r.root);
    const list = (dir, n, name) => Array.from({ length: n }, (_, i) => `src/components/${dir ? dir + '/' : ''}${name}${i}.ts`);
    assert.deepEqual(out, {
      Toolkit: ['src/adapters/fs.ts', 'src/adapters/http.ts', 'src/index.ts'],
      Core: ['src/core/plan.ts', 'src/core/run.ts', 'src/core/step.ts'],
      Components: list('', 15, 'misc').sort(),
      Forms: list('forms', 12, 'forms').sort(),
      Charts: list('charts', 12, 'charts').sort(),
      Layout: list('layout', 6, 'layout').sort(),
    });
    assert.deepEqual(map.layers.map(l => l.name), ['Package toolkit']);
  } finally { r.cleanup(); }
});

test('an API-only service with no routes the scan knows: blocks from its folders', () => {
  const files = {
    'package.json': '{ "name": "orders-api", "dependencies": { "express": "4.0.0" } }',
    'src/index.ts': "import { start } from './server';\nstart();\n",
    'src/server.ts': "import { orderRoutes } from './routes/orders';\nexport function start() { return orderRoutes(); }\n",
    'src/config.ts': 'export const PORT = 3000;\n',
  };
  for (const f of ['orders', 'users', 'health']) files[`src/routes/${f}.ts`] = fn(`${f}Routes`);
  for (const f of ['orders', 'users', 'billing']) files[`src/services/${f}.ts`] = fn(`${f}Service`);
  for (const f of ['order', 'user', 'invoice']) files[`src/models/${f}.ts`] = `export interface ${f[0].toUpperCase() + f.slice(1)} { id: string }\n`;
  const r = repoWith('orders-api', files);
  try {
    const { out } = blocks(r.root);
    assert.deepEqual(out, {
      'Orders api': ['src/config.ts', 'src/index.ts', 'src/server.ts'],
      Routes: ['src/routes/health.ts', 'src/routes/orders.ts', 'src/routes/users.ts'],
      Services: ['src/services/billing.ts', 'src/services/orders.ts', 'src/services/users.ts'],
      Models: ['src/models/invoice.ts', 'src/models/order.ts', 'src/models/user.ts'],
    });
  } finally { r.cleanup(); }
});

test('a monorepo: the app by its routes, each other package by its folders', () => {
  const r = makeRepo('mono');
  try {
    const { out, map } = blocks(r.root);
    assert.deepEqual(out, {
      Core: ['packages/core/src/db.ts', 'packages/core/src/index.ts', 'packages/core/src/money.ts', 'packages/core/src/orders.ts'],
      Legacy: ['packages/legacy/index.js', 'packages/legacy/lib/util.js'],
      Ui: ['packages/ui/src/Button.tsx', 'packages/ui/src/Price.tsx', 'packages/ui/src/index.ts'],
      'Shared core': ['apps/web/src/app/.well-known/health/route.ts', 'apps/web/src/app/api/orders/route.ts', 'apps/web/src/app/page.tsx', 'apps/web/src/lib/load.ts'],
    });
    assert.deepEqual(map.layers.map(l => l.name), ['Package @mono/core', 'Package @mono/legacy', 'Package @mono/ui', 'Shared code (@mono/web)']);
  } finally { r.cleanup(); }
});

test('walkthroughs start from any entry point: a server action when there are few pages', () => {
  const r = repoWith('actions-only', {
    'package.json': '{ "name": "actions-only" }',
    'prisma/schema.prisma': 'model Note {\n  id   String @id\n  body String\n}\n',
    'src/lib/db.ts': 'export const prisma: any = {};\n',
    'src/lib/notes.ts': "import { prisma } from './db';\nexport async function saveNote(body: string) {\n  return prisma.note.create({ data: { body } });\n}\n",
    'src/app/actions/notes.ts': "'use server';\nimport { saveNote } from '@/lib/notes';\nexport async function createNote(body: string) {\n  return saveNote(body);\n}\n",
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }',
  });
  try {
    const { map } = blocks(r.root);
    assert.equal(map.journeys.length, 1, JSON.stringify(map.journeys));
    const j = map.journeys[0];
    assert.deepEqual(j.steps.map(s => s.symbol), ['createNote', 'saveNote']);
    assert.match(j.caption, /from the server action createNote to the code that writes Note/);
  } finally { r.cleanup(); }
});
