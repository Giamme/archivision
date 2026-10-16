'use strict';
// birdview was archivision's first name. What people kept from it goes on working: the command, the ripwire variable,
// a map saved next to an old page with its edits by hand, and models written as <name>.birdview.arch.json.
// Every page also carries the licences of the code it is made of.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { makeRepo } = require('./support/fixture-repo');
const { findRipwire } = require('../lib/repo/scan/ripwire');

const ROOT = path.join(__dirname, '..'), BIN = path.join(ROOT, 'bin', 'archivision.js');
const run = (cwd, ...a) => spawnSync(process.execPath, [BIN, ...a], { cwd, encoding: 'utf8' });

test('rename: both commands run the same file', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'archivision');
  assert.deepEqual(pkg.bin, { archivision: 'bin/archivision.js', birdview: 'bin/archivision.js' });
  assert.match(run(ROOT).stdout, /^archivision: [^]*birdview, the old name, runs the same commands/);
});

test('rename: a model saved as x.birdview.arch.json renders to x.archivision.html, not x.birdview.archivision.html', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-rename-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'examples', 'shop', 'shop.arch.json'), path.join(dir, 'shop.birdview.arch.json'));
    const r = run(dir, 'render', 'shop.birdview.arch.json');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['shop.archivision.html', 'shop.birdview.arch.json']);
    assert.match(fs.readFileSync(path.join(dir, 'shop.archivision.html'), 'utf8'), /<title>Corner Shop · archivision<\/title>/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rename: a map saved next to an old page carries over with its edits, once', () => {
  const r = makeRepo('mini-shop'), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-rename-'));
  try {
    // a first run writes the map; the person renames a block in it by hand, as under the old name
    assert.equal(run(cwd, 'repo', r.root).status, 0);
    const fresh = path.join(cwd, 'mini-shop.archivision.map.json'), old = path.join(cwd, 'mini-shop.birdview.map.json');
    const map = JSON.parse(fs.readFileSync(fresh, 'utf8'));
    map.modules[0].name = 'Renamed by hand';
    fs.writeFileSync(old, JSON.stringify(map, null, 2) + '\n'); fs.rmSync(fresh); fs.rmSync(path.join(cwd, 'mini-shop.archivision.html'));
    const a = run(cwd, 'repo', r.root);
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /carried over mini-shop\.birdview\.map\.json → mini-shop\.archivision\.map\.json/);
    assert.match(a.stdout, /2 group {3}using mini-shop\.archivision\.map\.json/);
    assert.equal(JSON.parse(fs.readFileSync(fresh, 'utf8')).modules[0].name, 'Renamed by hand');
    assert.match(fs.readFileSync(path.join(cwd, 'mini-shop.archivision.html'), 'utf8'), /Renamed by hand/);
    // the next run reads the new one and leaves the old file alone
    const b = run(cwd, 'repo', r.root);
    assert.doesNotMatch(b.stdout, /carried over/);
    assert.ok(fs.existsSync(old));
    // --remap still starts over from the code
    const c = run(cwd, 'repo', r.root, '--remap');
    assert.doesNotMatch(c.stdout, /carried over/);
    assert.notEqual(JSON.parse(fs.readFileSync(fresh, 'utf8')).modules[0].name, 'Renamed by hand');
  } finally { r.cleanup(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('rename: ripwire named by BIRDVIEW_RIPWIRE, the old variable, is still found; ARCHIVISION_RIPWIRE comes first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-rename-')), repo = path.join(dir, 'repo');
  const keep = { a: process.env.ARCHIVISION_RIPWIRE, b: process.env.BIRDVIEW_RIPWIRE, path: process.env.PATH };
  try {
    fs.mkdirSync(repo);
    const fake = n => { const p = path.join(dir, n); fs.writeFileSync(p, '#!/bin/sh\nexit 0\n'); fs.chmodSync(p, 0o755); return fs.realpathSync(p); };
    const oldBin = fake('old-ripwire'), newBin = fake('new-ripwire');
    process.env.PATH = '/nowhere';
    delete process.env.ARCHIVISION_RIPWIRE; process.env.BIRDVIEW_RIPWIRE = oldBin;
    assert.equal(findRipwire(repo), oldBin);
    process.env.ARCHIVISION_RIPWIRE = newBin;
    assert.equal(findRipwire(repo), newBin);
  } finally {
    for (const [k, v] of [['ARCHIVISION_RIPWIRE', keep.a], ['BIRDVIEW_RIPWIRE', keep.b], ['PATH', keep.path]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('licences: every page carries archivision\'s and iso-glow\'s, in a comment in its head', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-rename-'));
  try {
    const out = path.join(dir, 'shop.html');
    assert.equal(run(dir, 'render', path.join(ROOT, 'examples', 'shop', 'shop.arch.json'), '--out', out).status, 0);
    const html = fs.readFileSync(out, 'utf8'), head = html.slice(0, html.indexOf('</head>'));
    const note = head.slice(head.indexOf('<!--'), head.indexOf('-->'));
    for (const f of [path.join(ROOT, 'LICENSE'), path.join(ROOT, 'assets', 'ISO-GLOW-LICENSE')])
      assert.ok(note.includes(fs.readFileSync(f, 'utf8').trim()), `${path.basename(f)} is in the page`);
    assert.match(note, /Copyright \(c\) 2026 Giamme/);
    assert.match(note, /Copyright \(c\) 2026 April Zhu/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
