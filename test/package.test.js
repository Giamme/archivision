'use strict';
// The npm package: what `npm pack` puts in it is what runs (bin, lib, the Python reader, the page assets, the shop
// example) and the papers that go with it, nothing else: no tests, fixtures or anything outside that list.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const npm = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' });
const skip = npm.status !== 0 && `npm pack failed: ${(npm.stderr || '').split('\n')[0]}`;
const packed = skip ? [] : JSON.parse(npm.stdout)[0].files;
const paths = new Set(packed.map(f => f.path));

test('package: only the runtime and its papers go to npm', { skip }, () => {
  const allowed = /^(bin\/[^/]+\.js|lib\/.+\.js|python\/scan\.py|assets\/(figure\.js|shell-3d\.html|ISO-GLOW-LICENSE)|examples\/shop\/[^/]+|package\.json|README\.md|LICENSE|NOTICE|CHANGELOG\.md)$/;
  assert.deepEqual([...paths].filter(p => !allowed.test(p)), []);
  for (const p of ['bin/archivision.js', 'lib/index.js', 'python/scan.py', 'assets/figure.js', 'assets/shell-3d.html', 'assets/ISO-GLOW-LICENSE', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md'])
    assert.ok(paths.has(p), `${p} is in the package`);
  // the command is executable as installed
  assert.ok(packed.find(f => f.path === 'bin/archivision.js').mode & 0o111, 'bin/archivision.js is executable');
});

test('package: every file the code loads is in it', { skip }, () => {
  const missing = [];
  for (const f of [...paths].filter(p => p.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');   // not in comments
    // local requires, and the files read next to the code (the Python reader, the page assets, the licences)
    for (const [, r] of src.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
      const base = path.relative(ROOT, path.resolve(ROOT, path.dirname(f), r));
      if (![base, `${base}.js`, `${base}/index.js`].some(x => paths.has(x))) missing.push(`${f} → ${r}`);
    }
  }
  assert.deepEqual(missing, []);
  const read = ['lib/page.js', 'lib/repo/scan/python.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  for (const [name, file] of [['figure.js', 'assets/figure.js'], ['shell-3d.html', 'assets/shell-3d.html'], ['ISO-GLOW-LICENSE', 'assets/ISO-GLOW-LICENSE'], ["'LICENSE'", 'LICENSE'], ['scan.py', 'python/scan.py']]) {
    assert.ok(read.includes(name), `the code reads ${name}`);
    assert.ok(paths.has(file), `${file} is in the package`);
  }
});

test('package: published as archivision, MIT, with both commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'archivision');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.private, undefined);
  assert.deepEqual(Object.keys(pkg.bin).sort(), ['archivision', 'birdview']);
  assert.ok(Object.keys(pkg.dependencies).every(d => d === 'typescript'), 'typescript is the only runtime dependency');
});
