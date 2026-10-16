'use strict';
// More ways a scanned repo could make archivision run or read something it should not:
// a submodule with its own diff tool, a partial clone that would fetch, and symlinks that leave the repo.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { execFileSync, spawnSync } = require('child_process');
const { scanRepo } = require('../lib');
const { makeRepo } = require('./support/fixture-repo');

const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
const archivision = (root, dir, ...extra) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'archivision.js'), 'repo', root, '--out', path.join(dir, 'out', 'page.html'), ...extra], { encoding: 'utf8', env: ENV });
// every file under a folder with its content hash
const tree = d => { const o = {}; const w = x => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) w(p); else o[path.relative(d, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } }; w(d); return o; };

test('a submodule\'s own diff tool never runs, whatever diff.submodule says', () => {
  const r = makeRepo('mini-shop'), marks = path.join(r.dir, 'marks'), sub = path.join(r.dir, 'lib-repo');
  fs.mkdirSync(marks);
  try {
    fs.mkdirSync(sub); git(sub, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(sub, 'x.txt'), 'one\n'); git(sub, 'add', '-A'); git(sub, 'commit', '-qm', 'one');
    git(r.root, '-c', 'protocol.file.allow=always', 'submodule', '-q', 'add', sub, 'vendor/lib'); git(r.root, 'commit', '-qm', 'submodule');
    fs.writeFileSync(path.join(sub, 'x.txt'), 'two\n'); git(sub, 'commit', '-qam', 'two');
    git(path.join(r.root, 'vendor/lib'), '-c', 'protocol.file.allow=always', 'pull', '-q', 'origin', 'main'); git(r.root, 'commit', '-qam', 'bump');
    git(r.root, 'config', 'diff.submodule', 'diff');
    git(path.join(r.root, 'vendor/lib'), 'config', 'diff.external', `sh -c 'touch ${marks}/external'`);
    git(path.join(r.root, 'vendor/lib'), 'config', 'core.fsmonitor', `sh -c 'touch ${marks}/fsmonitor'`);
    const run = archivision(r.root, r.dir, '--bases', 'dev');
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(fs.readdirSync(marks), []);
    // plain git, asked for the same diff, does run them
    spawnSync('git', ['-C', r.root, 'diff', 'dev', 'HEAD'], { env: ENV });
    spawnSync('git', ['-C', r.root, 'status'], { env: ENV });
    assert.ok(fs.readdirSync(marks).length > 0, 'the fixture is not hostile');
  } finally { r.cleanup(); }
});

test('a partial clone fetches nothing: missing objects stay missing', () => {
  const r = makeRepo('next-full'), clone = path.join(r.dir, 'clone');
  try {
    git(r.root, 'config', 'uploadpack.allowFilter', 'true'); git(r.root, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    execFileSync('git', ['clone', '-q', '--filter=blob:none', `file://${r.root}`, clone], { env: ENV, stdio: 'ignore' });
    const missing = git(clone, 'rev-list', '--objects', '--missing=print', '--all').split('\n').filter(l => l.startsWith('?'));
    assert.ok(missing.length > 0, 'the clone has missing blobs to tempt a lazy fetch');
    const before = tree(path.join(clone, '.git', 'objects'));
    const S = scanRepo(clone, { bases: 'origin/dev', since: 100000 });
    assert.ok(S.compare.length > 0, 'branches were still compared');
    assert.deepEqual(tree(path.join(clone, '.git', 'objects')), before, 'archivision fetched objects into the clone');
    // plain git would have fetched them
    execFileSync('git', ['-C', clone, 'cat-file', '-p', missing[0].slice(1)], { env: ENV, stdio: 'ignore' });
    assert.notDeepEqual(tree(path.join(clone, '.git', 'objects')), before, 'the fixture is not a working partial clone');
  } finally { r.cleanup(); }
});

test('symlinks that leave the repo are not followed, as a file or as the whole src folder', () => {
  const r = makeRepo('mini-shop'), outside = path.join(r.dir, 'outside');
  try {
    fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.ts'), 'export function secretOutside() { return 42; }\n');
    fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(r.root, 'src/lib/leak.ts'));
    fs.writeFileSync(path.join(r.root, 'src/lib/uses-leak.ts'), "import { secretOutside } from './leak';\nexport const leaked = () => secretOutside();\n");
    const S = scanRepo(r.root, {});
    assert.ok(!S.files['src/lib/leak.ts'], 'the symlinked file was read');
    assert.ok(!Object.keys(S.files).some(f => f.startsWith('..')), 'a file outside the repo was read');
    assert.ok(!S.symbols.some(s => s.name === 'secretOutside'));
    assert.equal(S.skipped.reasons['symlink leaving the repo'], 1);
    // the whole code root as a symlink out of the repo
    const r2 = path.join(r.dir, 'linked'); fs.mkdirSync(r2); fs.symlinkSync(path.join(r.root, 'src'), path.join(r2, 'src'));
    assert.throws(() => scanRepo(r2, {}), /no code archivision reads/);
  } finally { r.cleanup(); }
});
