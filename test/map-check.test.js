'use strict';
// `archivision repo --check` is for CI: it checks the saved map against the code, writes nothing, and fails when a
// source file is placed by no rule of the map or the map names code that is gone. Files the nearest folder places
// still pass (the conservative default).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const { makeRepo } = require('./support/fixture-repo');

const BIN = path.join(__dirname, '..', 'bin', 'archivision.js');
const run = (r, args, env = {}) => spawnSync(process.execPath, [BIN, 'repo', r.root, '--out', path.join(r.dir, 'out', 'p.html'), '--bases', 'dev', '--no-update-check', ...args],
  { encoding: 'utf8', cwd: r.root, env: { ...process.env, GITHUB_ACTIONS: '', ...env } });
const commit = (r, msg) => { const g = (...a) => execFileSync('git', ['-C', r.root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]); g('add', '-A'); g('commit', '-qm', msg); };

// a fixture repo with its map saved, as a team would have it committed
function mapped() {
  const r = makeRepo('plain-js');
  const first = run(r, []);
  assert.equal(first.status, 0, first.stderr);
  fs.rmSync(path.join(r.dir, 'out', 'p.html'));
  return r;
}

test('--check passes on a map that fits the code, and writes nothing', () => {
  const r = mapped();
  try {
    fs.writeFileSync(path.join(r.root, 'src/lib/slug.js'), 'exports.slug = s => s.toLowerCase();\n');   // placed by its folder
    commit(r, 'slug');
    const mapBefore = fs.readFileSync(path.join(r.dir, 'out', 'p.map.json'), 'utf8');
    const c = run(r, ['--check']);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.ok(!fs.existsSync(path.join(r.dir, 'out', 'p.html')), '--check wrote the page');
    assert.equal(fs.readFileSync(path.join(r.dir, 'out', 'p.map.json'), 'utf8'), mapBefore, '--check changed the map');
  } finally { r.cleanup(); }
});

test('--check fails on a source file no rule of the map places, with an annotation under GitHub Actions', () => {
  const r = mapped();
  try {
    fs.mkdirSync(path.join(r.root, 'src/jobs'));
    fs.writeFileSync(path.join(r.root, 'src/jobs/cleanup.js'), 'exports.cleanup = () => 0;\n');
    commit(r, 'jobs');
    const c = run(r, ['--check'], { GITHUB_ACTIONS: 'true' });
    assert.equal(c.status, 1, c.stdout + c.stderr);
    assert.match(c.stdout, /^ {12}src\/jobs\/cleanup\.js$/m);
    assert.match(c.stdout, /^::error file=src\/jobs\/cleanup\.js::/m);
  } finally { r.cleanup(); }
});

test('--check fails when the map names code that is gone', () => {
  const r = mapped();
  try {
    fs.rmSync(path.join(r.root, 'src/lib/tags.mjs'));
    commit(r, 'drop tags');
    const c = run(r, ['--check']);
    assert.equal(c.status, 1, c.stdout + c.stderr);
    assert.match(c.stdout, /glob matches nothing: shared\/data-access src\/lib\/tags\.mjs/);
  } finally { r.cleanup(); }
});

test('--check with no saved map is a usage error, not a pass', () => {
  const r = makeRepo('plain-js');
  try {
    const c = run(r, ['--check']);
    assert.equal(c.status, 2, c.stdout + c.stderr);
    assert.match(c.stderr, /no saved map to check/);
    assert.ok(!fs.existsSync(path.join(r.dir, 'out', 'p.map.json')), '--check wrote a map');
  } finally { r.cleanup(); }
});
