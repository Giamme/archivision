'use strict';
// Phase 1: code roots. Workspace packages each give a root (their src/, or their folder without one), with their
// own tsconfig; a repo with no src/ and no packages is one root; --src overrides; dot-folders are skipped except a
// Next.js .well-known route; whatever is not read is counted, inside the roots and outside them.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { scanRepo, autoMap, buildRepo, validateScan } = require('../lib');
const { makeRepo } = require('./support/fixture-repo');

const write = (root, files) => { for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); } };
const codeIn = (S, root) => Object.keys(S.files).filter(f => f.startsWith(root + '/') && !S.files[f].test).sort();

test('a workspace repo: one root per package, each package its own district', () => {
  const r = makeRepo('mono');
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    assert.deepEqual(S.roots.map(x => [x.path, x.role, x.pkg]), [
      ['apps/web/src', 'code', '@mono/web'], ['packages/core/src', 'code', '@mono/core'], ['packages/legacy', 'code', '@mono/legacy'], ['packages/ui/src', 'code', '@mono/ui'],
      ['apps/web/e2e', 'e2e', '@mono/web'], ['packages/core/tests', 'test', '@mono/core']]);
    // the files of each package are its source files, and nothing from outside it
    assert.deepEqual(codeIn(S, 'packages/core/src'), ['packages/core/src/db.ts', 'packages/core/src/index.ts', 'packages/core/src/money.ts', 'packages/core/src/orders.ts']);
    assert.deepEqual(codeIn(S, 'packages/legacy'), ['packages/legacy/index.js', 'packages/legacy/lib/util.js'], 'no dist/, no tool config');
    assert.ok(S.files['apps/web/src/app/.well-known/health/route.ts'].entry, 'a .well-known route is a route');
    assert.ok(!Object.keys(S.files).some(f => f.startsWith('.storybook/')), 'other dot-folders are skipped');
    for (const f of Object.keys(S.files)) assert.ok(S.files[f].pkg, `${f} has a package`);
    // calls across packages, through each package's own tsconfig paths and an index re-export
    const call = (a, b) => S.relations.find(x => x.rel === 'call' && x.from === a && x.to === b);
    assert.equal(call('apps/web/src/app/api/orders/route.ts#GET', 'packages/core/src/orders.ts#listOrders').status, 'exact');
    assert.ok(call('packages/ui/src/Price.tsx#Price', 'packages/core/src/money.ts#total'));
    assert.ok(call('packages/legacy/index.js#title', 'packages/legacy/lib/util.js#slug'), 'CommonJS in a package with no tsconfig');
    // a package's Prisma schema
    assert.deepEqual(Object.keys(S.resources), ['prisma:@mono/core:Order']);
    assert.ok(S.data.some(d => d.from === 'packages/core/src/orders.ts#placeOrder' && d.resource === 'prisma:@mono/core:Order'));
    // what is left out is counted
    assert.equal(S.skipped.reasons['build output or assets'], 1);
    assert.equal(S.skipped.reasons['tool configuration'], 1);
    assert.equal(S.skipped.outside.byExt['.py'], 1);
    assert.equal(S.skipped.outside.from, 'git ls-files');
    // districts: a package without app routes is one of its own, and holds only its files
    const M = autoMap(S), B = buildRepo(M, S);
    for (const [pkg, root] of [['@mono/core', 'packages/core/src'], ['@mono/ui', 'packages/ui/src'], ['@mono/legacy', 'packages/legacy']]) {
      const layer = M.layers.find(l => l.name === `Package ${pkg}`); assert.ok(layer, M.layers.map(l => l.name).join(', '));
      const files = B.ATLAS.modules.filter(m => m.layer === layer.id).flatMap(m => m.parts.flatMap(p => p.code.files.map(f => f[0]))).sort();
      assert.deepEqual(files, codeIn(S, root), pkg);
    }
    assert.ok(B.ATLAS.coverage.lines.some(l => /outside the roots 13 files/.test(l)), B.ATLAS.coverage.lines.join('\n'));
  } finally { r.cleanup(); }
});

test('--src picks the roots; a repo with no src/ and no packages is one root', () => {
  const r = makeRepo('mono');
  try {
    const S = scanRepo(r.root, { src: ['packages/core/src', 'packages/ui/src'] });
    assert.deepEqual(S.roots.filter(x => x.role === 'code').map(x => [x.path, x.found]), [['packages/core/src', '--src'], ['packages/ui/src', '--src']]);
    assert.ok(!Object.keys(S.files).some(f => f.startsWith('apps/')), 'the web app is not read');
    assert.throws(() => scanRepo(r.root, { src: ['../elsewhere'] }), /not a folder inside/);
  } finally { r.cleanup(); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-nosrc-')), root = path.join(dir, 'app-only');
  try {
    write(root, {
      'package.json': '{ "name": "app-only" }', 'jsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }',
      'app/page.jsx': "import { Card } from '@/components/Card';\nexport default function Home() { return <Card />; }\n",
      'components/Card.jsx': 'export function Card() { return <div>card</div>; }\n',
      'next.config.mjs': 'export default {};\n', 'public/sw.js': 'self.addEventListener("fetch", () => {});\n',
    });
    const S = scanRepo(root, {});
    assert.deepEqual(S.roots.map(x => x.path), ['.']);
    assert.deepEqual(Object.keys(S.files).sort(), ['app/page.jsx', 'components/Card.jsx']);
    assert.equal(S.files['app/page.jsx'].entry.route, '/');
    assert.ok(S.relations.some(x => x.rel === 'call' && x.from === 'app/page.jsx#Home' && x.to === 'components/Card.jsx#Card'));
    assert.equal(S.skipped.outside.from, 'the folder');
    const B = buildRepo(autoMap(S), S);
    assert.ok(B.ATLAS.modules.length > 0);
    assert.ok(B.ATLAS.coverage.lines[0].includes('the whole repo'), B.ATLAS.coverage.lines[0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
