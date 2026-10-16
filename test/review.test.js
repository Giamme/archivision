'use strict';
// The cases the reviews of phases 1 and 2 found, one test each, asserting what the scan finds and what the map and the page show.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { scanRepo, autoMap, buildRepo, validateScan } = require('../lib');
const { parse, tokenAt, makeResolver } = require('./support/callsite');

const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...a], { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root, files) => { for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); } };
// a repo of these files in a fresh folder (a git repo with one commit when `commit`)
function repoWith(name, files, { commit = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-review-')), root = path.join(dir, name);
  fs.mkdirSync(root); write(root, files);
  if (commit) { git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'one'); }
  return { root, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const fn = n => `export function ${n}() { return 1; }\n`;
const many = (dir, n, stem = 'f') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${dir}/${stem}${i}.ts`, fn(`${stem}${i}`)]));
// block name -> its files, from the build (what the page shows)
function blocks(S) {
  const map = autoMap(S), B = buildRepo(map, S), out = {};
  for (const m of B.ATLAS.modules) if (m.id !== 'dock') out[m.name] = m.parts.flatMap(p => p.code.files.map(f => f[0])).sort();
  return { out, map, B };
}

/* ---------- phase 1 ---------- */

test('review 1.1: package.json and a Prisma schema folder that are symlinks out of the repo are not read', () => {
  const r = repoWith('app', { 'src/a.ts': fn('a') });
  try {
    const away = path.join(r.dir, 'away'); write(away, { 'package.json': '{ "name": "away", "devDependencies": { "vitest": "1.0.0" } }', 'schema/x.prisma': 'model Secret {\n  id String @id\n}\n' });
    fs.symlinkSync(path.join(away, 'package.json'), path.join(r.root, 'package.json'));
    fs.mkdirSync(path.join(r.root, 'prisma')); fs.symlinkSync(path.join(away, 'schema'), path.join(r.root, 'prisma', 'schema'));
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    assert.deepEqual(Object.keys(S.resources), [], 'no model from outside');
    assert.ok(!S.adapters.some(a => a.name === 'vitest'), 'no runner from outside');
    assert.equal(S.roots[0].pkg, null);
  } finally { r.cleanup(); }
});

test('review 1.2: a CommonJS export names its binding wherever it is declared, in the scan and in a diff', () => {
  const r = repoWith('cjs', { 'src/a.js': 'exports.x = x;\nfunction x() { return 1; }\nfunction y() { return 2; }\nexports.alias = y;\n', 'src/b.js': "const { x, alias } = require('./a');\nfunction use() { return x() + alias(); }\nmodule.exports = { use };\n" }, { commit: true });
  try {
    git(r.root, 'checkout', '-qb', 'dev'); git(r.root, 'checkout', '-qb', 'feature');
    fs.writeFileSync(path.join(r.root, 'src/a.js'), 'exports.x = x;\nfunction x() { return 1; }\nfunction y() { return 3; }\nexports.alias = y;\n'); git(r.root, 'commit', '-qam', 'y');
    const S = scanRepo(r.root, { bases: 'dev', since: 100000 });
    assert.deepEqual(validateScan(S), []);
    assert.deepEqual(S.symbols.filter(s => s.file === 'src/a.js').map(s => [s.id, s.exported]), [['src/a.js#x', true], ['src/a.js#y', true]]);
    const call = to => S.relations.find(x => x.rel === 'call' && x.from === 'src/b.js#use' && x.to === to);
    assert.ok(call('src/a.js#x') && call('src/a.js#y'), JSON.stringify(S.relations));
    const c = S.compare.find(x => x.base === 'dev' && x.head === 'feature');
    assert.deepEqual(c.syms, { 'src/a.js': ['y'] }, 'the diff names y, the declaration, not alias');
    assert.deepEqual(c.changed, [{ id: 'src/a.js#y', at: 'head' }]);
  } finally { r.cleanup(); }
});

test('review 1.3: two packages\' schemas changed in one comparison: both models, each with its package', () => {
  const schema = 'model User {\n  id String @id\n}\n';
  const r = repoWith('two', {
    'package.json': '{ "name": "two", "workspaces": ["packages/*"] }',
    'packages/a/package.json': '{ "name": "@t/a" }', 'packages/a/prisma/schema.prisma': schema, 'packages/a/src/users.ts': 'declare const prisma: any;\nexport function list() { return prisma.user.findMany(); }\n',
    'packages/b/package.json': '{ "name": "@t/b" }', 'packages/b/prisma/schema.prisma': schema, 'packages/b/src/users.ts': 'declare const prisma: any;\nexport function make() { return prisma.user.create({}); }\n',
  }, { commit: true });
  try {
    git(r.root, 'checkout', '-qb', 'dev'); git(r.root, 'checkout', '-qb', 'feature');
    for (const p of ['packages/a', 'packages/b']) fs.writeFileSync(path.join(r.root, p, 'prisma/schema.prisma'), 'model User {\n  id   String @id\n  name String\n}\n');
    git(r.root, 'commit', '-qam', 'names');
    const S = scanRepo(r.root, { bases: 'dev', since: 100000 });
    const c = S.compare.find(x => x.base === 'dev' && x.head === 'feature');
    assert.deepEqual(c.models.sort(), ['prisma:@t/a:User', 'prisma:@t/b:User']);
    const { B } = blocks(S), cm = B.ATLAS.cmp.list.find(x => x.head === 'feature');
    assert.deepEqual(cm.models.sort(), ['User · @t/a', 'User · @t/b']);
    assert.equal(cm.db.length, B.ATLAS.groups.filter(g => g.models.length).length, 'every group with a changed model is lit');
  } finally { r.cleanup(); }
});

test('review 1.4: a package.json with no name (only a module format) makes no package', () => {
  const r = repoWith('one', { 'package.json': '{ "name": "one" }', 'src/a.ts': fn('a'), 'src/legacy/package.json': '{ "type": "commonjs" }', 'src/legacy/old.js': 'exports.old = function old() { return 1; };\n' });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(Object.values(S.files).map(f => f.pkg), ['one', 'one']);
    assert.deepEqual(autoMap(S).layers.map(l => l.name), ['Package one']);
  } finally { r.cleanup(); }
});

test('review 1.5: a src/ with nothing archivision reads does not hide the code next to it', () => {
  const r = repoWith('assets', {
    'package.json': '{ "name": "assets", "workspaces": ["packages/*"] }',
    'packages/w/package.json': '{ "name": "w" }', 'packages/w/index.js': 'exports.w = function w() { return 1; };\n', 'packages/w/src/widget.min.js': 'var a=1;\n',
  });
  const r2 = repoWith('logo', { 'src/logo.png': 'png', 'main.ts': fn('main') });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(S.roots.filter(x => x.role === 'code').map(x => x.path), ['packages/w']);
    assert.ok(S.files['packages/w/index.js']);
    const S2 = scanRepo(r2.root, {});
    assert.deepEqual(S2.roots.map(x => x.path), ['.']);
    assert.deepEqual(Object.keys(S2.files), ['main.ts']);
  } finally { r.cleanup(); r2.cleanup(); }
});

test('review 1.6: an app/ folder is Next.js only with evidence (a next dependency, a next.config, a root layout)', () => {
  const r = repoWith('plainapp', { 'package.json': '{ "name": "plainapp" }', 'src/app/helpers.ts': fn('help'), 'src/app/page.js': 'export default function Page() { return 1; }\n', 'src/middleware.ts': fn('middleware') });
  const r2 = repoWith('withnext', { 'package.json': '{ "name": "withnext", "dependencies": { "next": "15.0.0" } }', 'src/app/page.tsx': 'export default function Page() { return null; }\n' });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(S.entries, []);
    assert.ok(Object.values(S.files).every(f => !f.appDir && !f.flags.middleware));
    const S2 = scanRepo(r2.root, {});
    assert.deepEqual(S2.entries.map(e => [e.kind, e.route]), [['page', '/']]);
  } finally { r.cleanup(); r2.cleanup(); }
});

test('review 1.7: a workspace given as a literal deep path is found', () => {
  const r = repoWith('deep', { 'package.json': '{ "name": "deep", "workspaces": ["tools/build/internal/packages/compiler"] }', 'tools/build/internal/packages/compiler/package.json': '{ "name": "compiler" }', 'tools/build/internal/packages/compiler/src/c.ts': fn('compile') });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(S.roots.map(x => [x.path, x.pkg]), [['tools/build/internal/packages/compiler/src', 'compiler']]);
  } finally { r.cleanup(); }
});

test('review 1.8: coverage counts what the map places, what it reads besides (also listed outside the roots), and the files in left-out folders', () => {
  const r = repoWith('cov', { 'src/main.ts': "import { help } from '../tools/helper';\nexport function main() { return help(); }\n", 'tools/helper.ts': fn('help') }, { commit: true });
  const r2 = repoWith('pkgcov', { 'package.json': '{ "name": "pkgcov", "workspaces": ["packages/*"] }', 'packages/p/package.json': '{ "name": "p" }', 'packages/p/index.ts': fn('p'), 'packages/p/dist/a.py': 'x = 1\n', 'packages/p/dist/b.js': 'var b;\n' }, { commit: true });
  try {
    const S = scanRepo(r.root, {}), B = buildRepo(autoMap(S), S), C = B.ATLAS.coverage;
    assert.deepEqual([C.mapped, C.read, C.besides], [1, { ts: 1 }, { ts: 1 }]);
    assert.match(C.lines.join('\n'), /mapped 1 files \(1 ts\)[^\n]*\nread besides 1 files outside the roots/);
    // the imported file is read (its symbols and calls) but placed nowhere, and the inventory of files outside the
    // roots still lists it: that line counts every file outside them, read or not
    assert.ok(S.files['tools/helper.ts'] && S.symbols.some(s => s.file === 'tools/helper.ts' && s.name === 'help'));
    assert.ok(B.ATLAS.modules.every(m => m.parts.every(p => !p.code || p.code.files.every(f => f[0] !== 'tools/helper.ts'))));
    assert.deepEqual([S.skipped.outside.files, S.skipped.outside.byDir], [1, { tools: 1 }]);
    assert.match(C.lines.join('\n'), /\noutside the roots 1 files \(1 \.ts; in 1 tools\)/);
    const S2 = scanRepo(r2.root, {});
    assert.deepEqual(S2.skipped.folders, { files: 2, byExt: { '.js': 1, '.py': 1 }, byReason: { 'build output or assets': 2 } });
    assert.match(buildRepo(autoMap(S2), S2).ATLAS.coverage.lines.join('\n'), /in folders left out of the roots 2 files/);
  } finally { r.cleanup(); r2.cleanup(); }
});

test('review 1.9: calls and database calls the scan cannot follow are counted and said', () => {
  const r = repoWith('loose', {
    'prisma/schema.prisma': 'model Order {\n  id String @id\n}\n',
    'src/a.ts': [
      'declare const prisma: any; declare const obj: any;',
      "import { z } from 'zod';",
      'function factory() { return () => 1; }',
      'export function run() { return (factory())() + obj.run() + nowhere() + z.string() + JSON.stringify(1).length + String(1); }',
      'export function db() { return prisma.missing.findMany(); }', ''].join('\n'),
  });
  try {
    const S = scanRepo(r.root, {});
    const u = S.unresolved;
    // obj.run() and prisma.missing.findMany() are on values of type any; a package's z.string(), JSON and String are not counted
    assert.deepEqual([u.tsc['call-dynamic'], u.tsc['call-member'], u.tsc['call-unknown']], [1, 2, 1]);
    assert.equal(u.prisma['data-unknown-model'], 1);
    const lines = buildRepo(autoMap(S), S).ATLAS.coverage.lines.join('\n');
    assert.match(lines, /of values computed at run time/); assert.match(lines, /to names nothing in the code declares/); assert.match(lines, /on values whose type the scan does not know/); assert.match(lines, /1 on models no schema has/);
  } finally { r.cleanup(); }
});

test('review 1.10: a call-site link is checked against what the name resolves to', () => {
  const r = repoWith('sites', {
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }',
    'src/other.ts': 'export default function main() { return 1; }\nexport function named() { return 2; }\n',
    'src/index.ts': "export { named as renamed } from './other';\nexport * from './more';\n",
    'src/more.ts': 'export class Base { run() { return 1; } }\n',
    'src/cjs.js': 'function go() { return 1; }\nmodule.exports = go;\n',
    'src/use.ts': [
      "import Other from './other';",
      "import { renamed, Base } from '@/index';",
      "import * as ns from './other';",
      "const go = require('./cjs');",
      'export class K extends Base { constructor() { super(); } }',
      'export function use(local: () => number) { return Other() + renamed() + ns.named() + go() + local() + new K().run(); }', ''].join('\n'),
  });
  try {
    const R = makeResolver(r.root), text = fs.readFileSync(path.join(r.root, 'src/use.ts'), 'utf8'), sf = parse('src/use.ts', text);
    // what the call at the first `word` on a line invokes (`off` characters into it)
    const at = (word, line, off = 0) => { const L = text.split('\n')[line - 1], t = tokenAt(sf, line, L.indexOf(word) + 1 + off); assert.ok(t, `no name at ${word}`); return R.resolveCall('src/use.ts', t); };
    assert.deepEqual(at('Other()', 6), { file: 'src/other.ts', name: 'main' }, 'a default import under its own name');
    assert.deepEqual(at('renamed()', 6), { file: 'src/other.ts', name: 'named' }, 'through a path alias and a renaming re-export');
    assert.deepEqual(at('.named()', 6, 1), { file: 'src/other.ts', name: 'named' }, 'a namespace import');
    assert.deepEqual(at('go()', 6), { file: 'src/cjs.js', name: 'go' }, 'require of a CommonJS module.exports');
    assert.deepEqual(at('local()', 6), { local: true }, 'a parameter');
    assert.deepEqual(at('super', 5), { file: 'src/more.ts', name: 'Base' }, 'super() through export *');
    assert.equal(at('run()', 6).member, 'run');
  } finally { r.cleanup(); }
});

test('review 1.12: an inventory without git reads dot-folders, sorts, and counts a folder it cannot read', { skip: process.getuid && process.getuid() === 0 && 'root reads every folder' }, () => {
  const r = repoWith('nogit', { 'src/a.ts': fn('a'), '.storybook/config.py': 'x = 1\n', 'docs/locked/x.md': '# x\n', 'docs/open.md': '# o\n' });
  const locked = path.join(r.root, 'docs/locked');
  try {
    fs.chmodSync(locked, 0o000);
    const S = scanRepo(r.root, {});
    assert.equal(S.skipped.outside.from, 'the folder');
    assert.deepEqual(S.skipped.outside.byExt, { '.md': 1, '.py': 1 });
    assert.equal(S.skipped.outside.unreadable, 1);
    assert.match(buildRepo(autoMap(S), S).ATLAS.coverage.lines.join('\n'), /folders that could not be read 1/);
  } finally { fs.chmodSync(locked, 0o755); r.cleanup(); }
});

/* ---------- phase 2 ---------- */

test('review 2.1: two folders whose names slug alike are two blocks with two ids', () => {
  const r = repoWith('toolkit', { 'package.json': '{ "name": "toolkit" }', ...many('src/foo-bar', 3, 'a'), ...many('src/foo_bar', 3, 'b') });
  try {
    const S = scanRepo(r.root, {}), { out, map } = blocks(S);
    assert.deepEqual(out, { 'Foo bar': ['src/foo-bar/a0.ts', 'src/foo-bar/a1.ts', 'src/foo-bar/a2.ts'], 'Foo bar 2': ['src/foo_bar/b0.ts', 'src/foo_bar/b1.ts', 'src/foo_bar/b2.ts'] }, 'nothing tells them apart but a number');
    assert.equal(new Set(map.modules.map(m => m.id)).size, map.modules.length);
  } finally { r.cleanup(); }
});

test('review 2.2: blocks keep their root and package: two roots\' utils/, a repo named like one of its packages', () => {
  const r = repoWith('split', { ...many('client/utils', 3, 'c'), ...many('server/utils', 3, 's') });
  const r2 = repoWith('toolkit', { 'hello.ts': fn('hello'), 'packages/toolkit/package.json': '{ "name": "toolkit" }', ...many('packages/toolkit/src', 2, 't') });
  try {
    const S = scanRepo(r.root, { src: 'client,server' }), { out } = blocks(S);
    assert.deepEqual(out, { 'Utils (client)': ['client/utils/c0.ts', 'client/utils/c1.ts', 'client/utils/c2.ts'], 'Utils (server)': ['server/utils/s0.ts', 'server/utils/s1.ts', 'server/utils/s2.ts'] });
    const S2 = scanRepo(r2.root, {});
    assert.deepEqual(S2.roots.filter(x => x.role === 'code').map(x => [x.path, x.pkg]), [['packages/toolkit/src', 'toolkit']], 'apps/*, packages/*: no root for the repo');
  } finally { r.cleanup(); r2.cleanup(); }
});

test('review 2.3: helpers in an app/ folder of a library are grouped by their folders, not as app routes', () => {
  const r = repoWith('lib', { 'package.json': '{ "name": "lib" }', ...many('src/app/services', 3, 's'), ...many('src/app/models', 3, 'm') });
  try {
    const { out, map } = blocks(scanRepo(r.root, {}));
    assert.deepEqual(Object.keys(out), ['App']);
    assert.equal(out.App.length, 6);
    assert.deepEqual(map.layers.map(l => l.name), ['Package lib']);
  } finally { r.cleanup(); }
});

test('review 2.4: walkthroughs start from entries in file order, and never from a layout', () => {
  const route = m => `import { save } from '@/lib/save';\nexport async function ${m}() {\n  return save();\n}\n`;
  const r = repoWith('routes', {
    'package.json': '{ "name": "routes", "dependencies": { "next": "15.0.0" } }',
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }',
    'prisma/schema.prisma': 'model Note {\n  id String @id\n}\n',
    'src/lib/db.ts': 'export const prisma: any = {};\n',
    'src/lib/save.ts': "import { prisma } from './db';\nexport function save() { return prisma.note.create({}); }\n",
    'src/app/layout.tsx': "import { save } from '@/lib/save';\nexport default function Layout() { save(); return null; }\n",
    'src/app/api/a/route.ts': route('POST'),
    'src/app/api/z/route.ts': route('GET'),
  });
  try {
    const { map } = blocks(scanRepo(r.root, {}));
    assert.ok(map.journeys.length >= 1, JSON.stringify(map));
    assert.match(map.journeys[0].caption, /from the API route POST \/api\/a /);
    assert.ok(!map.journeys.some(j => /Layout/.test(j.caption + j.name)), 'a layout starts no walkthrough');
  } finally { r.cleanup(); }
});

test('review 2.5: repeated block names are told apart by package, then by parent folder', () => {
  const r = repoWith('names', {
    'package.json': '{ "name": "names", "workspaces": ["packages/*"] }',
    'packages/a/package.json': '{ "name": "@a/core" }', ...many('packages/a/src/types', 3, 'a'),
    'packages/b/package.json': '{ "name": "@b/core" }', ...many('packages/b/src/types', 3, 'b'),
    'packages/t/package.json': '{ "name": "toolkit" }', ...many('packages/t/src/types', 3, 't'),
  });
  try {
    const names = Object.keys(blocks(scanRepo(r.root, {})).out).sort();
    assert.deepEqual(names, ['Types (@a/core)', 'Types (@b/core)', 'Types (toolkit)'], 'the short names agree for two: their full names tell them apart');
  } finally { r.cleanup(); }
});

test('review 2.6: a repo with no package.json names its district after the repo and says where its code is', () => {
  const r = repoWith('toolkit', { 'hello.ts': fn('hello') });
  try {
    const map = autoMap(scanRepo(r.root, {}));
    assert.deepEqual(map.layers.map(l => [l.name, l.tip]), [['Package toolkit', 'The code of the package toolkit, in the repo.']]);
  } finally { r.cleanup(); }
});

test('review 2: split and cap boundaries, in any order the files were written', () => {
  // 40 files in a folder stay one block; 41 split by sub-folders of 4 or more, a sub-folder of 3 stays with its parent
  const at40 = { ...many('src/big/a', 18, 'a'), ...many('src/big/b', 18, 'b'), ...many('src/big', 4, 'r') };
  const at41 = { ...many('src/big/a', 18, 'a'), ...many('src/big/b', 18, 'b'), ...many('src/big/c', 3, 'c'), ...many('src/big', 2, 'r') };
  // three levels: a 41-file folder whose biggest sub-folder holds 41 files again
  const deep = { ...many('src/top/one/p', 20, 'p'), ...many('src/top/one/q', 21, 'q'), ...many('src/top/two', 4, 't') };
  // 17 folders of 3 files: the smallest (by name, at equal size) merges back into the package's own block
  const cap = {}; for (let i = 0; i < 17; i++) Object.assign(cap, many(`src/d${String(i).padStart(2, '0')}`, 3, `d${i}x`));
  const run = files => { const keys = Object.keys(files).sort(() => Math.random() - 0.5), shuffled = Object.fromEntries(keys.map(k => [k, files[k]]));
    const r = repoWith('lib', { 'package.json': '{ "name": "lib" }', ...shuffled }); try { return blocks(scanRepo(r.root, {})).out; } finally { r.cleanup(); } };
  assert.deepEqual(Object.keys(run(at40)), ['Big']);
  const o41 = run(at41);
  assert.deepEqual(Object.keys(o41).sort(), ['A', 'B', 'Big']);
  assert.equal(o41.Big.length, 5, 'the root files and the 3-file sub-folder stay in the parent block');
  assert.deepEqual(Object.keys(run(deep)).sort(), ['P', 'Q', 'Two'], 'top/ splits into one/ and two/, and one/ again into p/ and q/');
  const oc = run(cap), capNames = Object.keys(oc);
  assert.equal(capNames.length, 17, capNames.join(', '));
  assert.equal(oc.Lib.length, 3, 'one folder merged back');
  assert.ok(oc.Lib.every(f => f.startsWith('src/d00/')), oc.Lib.join(', '));
});

test('review 2: walkthroughs start from pages with three pages or more, from every entry with two', () => {
  const page = (d, w) => [`src/app/${d}/page.tsx`, `import { submit } from '@/lib/flow';\nexport default function Page() { ${w ? 'submit();' : ''} return null; }\n`];
  const base = {
    'package.json': '{ "name": "pages", "dependencies": { "next": "15.0.0" } }',
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }',
    'prisma/schema.prisma': 'model Note {\n  id String @id\n}\n',
    'src/lib/db.ts': 'export const prisma: any = {};\n',
    'src/lib/save.ts': "import { prisma } from './db';\nexport function save() { return prisma.note.create({}); }\n",
    'src/lib/flow.ts': "import { save } from './save';\nexport function submit() { return save(); }\n",
    'src/app/api/notes/route.ts': "import { save } from '@/lib/save';\nexport async function POST() { return save(); }\n",
  };
  const two = repoWith('two', { ...base, ...Object.fromEntries([page('a', false), page('b', false)]) });
  const three = repoWith('three', { ...base, ...Object.fromEntries([page('a', false), page('b', false), page('c', true)]) });
  try {
    const j2 = blocks(scanRepo(two.root, {})).map.journeys, j3 = blocks(scanRepo(three.root, {})).map.journeys;
    assert.ok(j2.some(j => /from the API route POST \/api\/notes/.test(j.caption)), JSON.stringify(j2.map(j => j.caption)));
    assert.ok(j3.length && j3.every(j => /from the page \//.test(j.caption)), JSON.stringify(j3.map(j => j.caption)));
  } finally { two.cleanup(); three.cleanup(); }
});
