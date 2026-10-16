'use strict';
// Go (phase 5, the pilot of an outside language server): ripwire's symbols, checked against archivision's own reading of
// the text (lib/repo/scan/go.js); without ripwire the Go files are counted, not read; ripwire is found outside the
// repo only, runs only at an allowed version, and writes nothing.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const { scanRepo, autoMap, buildRepo, validateScan, writePage } = require('../lib');
const { goDecls, goRanges } = require('../lib/repo/scan/go');
const { findRipwire, ALLOW } = require('../lib/repo/scan/ripwire');

const FIX = path.join(__dirname, 'fixtures', 'go-svc');
// the binary, found as a scan finds it (ARCHIVISION_RIPWIRE, else ripwire on the PATH; never in the repo); without it,
// or at a version a scan does not run (it would read no Go), those tests skip. They expect ripwire 0.6.7.
const RW = findRipwire(FIX);
// its version, asked as a scan asks it: from a private folder (working directory and HOME), removed afterwards
const versionOf = bin => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-go-version-'));
  try {
    const v = spawnSync(bin, ['--version'], { cwd: tmp, encoding: 'utf8', timeout: 10e3, killSignal: 'SIGKILL', env: { PATH: '/usr/bin:/bin', TMPDIR: tmp, HOME: tmp } });
    return ((v.stdout || '').match(/^ripwire\s+(\d+\.\d+\.\d+)(?:\s|$)/m) || [])[1] || '';
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
};
const RWV = RW ? versionOf(RW) : '';
const skip = !RW ? 'no ripwire binary (put ripwire 0.6.7 on the PATH or set ARCHIVISION_RIPWIRE)'
  : !ALLOW.has(RWV) ? `${RW} is ripwire ${RWV || '(unknown version)'}, not ${[...ALLOW].join(' or ')} (put that on the PATH or set ARCHIVISION_RIPWIRE)` : false;
function copy(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-go-')), root = path.join(dir, 'gosvc');
  fs.cpSync(FIX, root, { recursive: true });
  for (const [p, t] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); }
  return { root, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
// every file under a folder with its hash, to tell that nothing was written
const tree = d => { const out = {}; const walk = x => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else out[path.relative(d, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } }; walk(d); return out; };

test('go: declarations read from the text, with strings, comments, groups and generic receivers followed', () => {
  const store = fs.readFileSync(path.join(FIX, 'internal/store/store.go'), 'utf8'), methods = fs.readFileSync(path.join(FIX, 'internal/store/methods.go'), 'utf8');
  assert.deepEqual(goDecls(store).map(d => `${d.kind} ${d.name} ${d.line}-${d.end}`), [
    'type Order 6-9', 'type ID 13-13', 'type Page 15-18', 'const MaxPage 22-22', 'const minPage 23-23', 'const A 24-24', 'const B 24-24',
    'var mu 28-28', 'var Default 30-30', 'const banner 33-35', 'type Store 38-40', 'function New 43-45']);
  assert.deepEqual(goDecls(methods).map(d => `${d.recv}.${d.name} ${d.line}-${d.end}`), ['Store.Put 6-10', 'Store.Get 13-16', 'Page.Len 18-18']);
  const main = fs.readFileSync(path.join(FIX, 'cmd/server/main.go'), 'utf8');
  assert.deepEqual(goRanges('cmd/server/main.go', main).map(r => r[3]), ['cmd/server/main.go#main', 'cmd/server/main.go#init', 'cmd/server/main.go#init#2']);
});

test('go: ripwire\'s symbols, where the text agrees, with methods on their types across the files of a package', { skip }, () => {
  const r = copy();
  try {
    const S = scanRepo(r.root, { ripwire: RW });
    assert.deepEqual(validateScan(S), []);
    const go = S.symbols.filter(s => s.file.endsWith('.go')).map(s => `${s.id} ${s.kind} ${s.line}-${s.end}${s.parent ? ` < ${s.parent.split('#')[1]}` : ''}`).sort();
    assert.deepEqual(go, [
      'cmd/server/main.go#init function 20-22', 'cmd/server/main.go#init#2 function 24-26', 'cmd/server/main.go#main function 12-18',
      'internal/api/api.go#Handler class 17-17', 'internal/api/api.go#Handler.Orders method 23-31 < Handler', 'internal/api/api.go#NewHandler function 20-20',
      'internal/api/api.go#Saver interface 11-14', 'internal/api/api.go#Saver.Get method 13-13 < Saver', 'internal/api/api.go#Saver.Put method 12-12 < Saver',
      'internal/api/api_test.go#TestNewHandler function 5-9',
      'internal/store/methods.go#Page.Len method 18-18 < Page', 'internal/store/methods.go#Store.Get method 13-16 < Store', 'internal/store/methods.go#Store.Put method 6-10 < Store',
      'internal/store/store.go#ID class 13-13', 'internal/store/store.go#New function 43-45', 'internal/store/store.go#Order class 6-9', 'internal/store/store.go#Page class 15-18',
      'internal/store/store.go#Store class 38-40', 'internal/store/store.go#banner const 33-35']);
    assert.ok(S.files['internal/api/api_test.go'].test && !S.files['internal/api/api.go'].test);
    // grouped constants and variables ripwire does not list: counted, not shown
    assert.deepEqual(S.unresolved['ripwire-lsp'], { 'text-only': 6 });
    const info = S.adapters.find(a => a.name === 'ripwire-lsp');
    assert.equal(info.version, '0.6.7');
    assert.equal(info.sha256, crypto.createHash('sha256').update(fs.readFileSync(RW)).digest('hex'));
    // no calls: ripwire gives none, and the scan invents none
    assert.equal(S.relations.filter(x => x.from.endsWith('.go') || x.from.includes('.go#')).length, 0);
  } finally { r.cleanup(); }
});

test('go: ripwire writes nothing in the repo, runs from a private temporary folder, and leaves none', { skip }, () => {
  // a temporary folder of its own (os.tmpdir() reads TMPDIR), so other tests running at the same time do not show
  const r = copy(), own = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-go-tmp-')), TMP = process.env.TMPDIR;
  try {
    const before = tree(r.root);
    process.env.TMPDIR = own;
    try { scanRepo(r.root, { ripwire: RW }); } finally { if (TMP === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = TMP; }
    assert.deepEqual(tree(r.root), before);
    assert.deepEqual(fs.readdirSync(own), []);
  } finally { r.cleanup(); fs.rmSync(own, { recursive: true, force: true }); }
});

test('go: a ripwire inside the repo is never found, and one at a version not allowed is never run', () => {
  const marker = path.join(os.tmpdir(), `archivision-go-ran-${process.pid}`);
  const fake = v => `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ripwire ${v}"; exit 0; fi\ntouch "${marker}"\nexit 0\n`;
  const r = copy({ 'bin/ripwire': fake('0.6.7') }), out = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-go-bin-')), PATH = process.env.PATH, ENV = process.env.ARCHIVISION_RIPWIRE, OLD = process.env.BIRDVIEW_RIPWIRE;
  try {
    fs.chmodSync(path.join(r.root, 'bin/ripwire'), 0o755);
    // on the PATH, through a symlink outside, or named by the variable: inside the repo, so never
    fs.symlinkSync(path.join(r.root, 'bin/ripwire'), path.join(out, 'ripwire'));
    process.env.PATH = `${path.join(r.root, 'bin')}${path.delimiter}${out}${path.delimiter}/usr/bin${path.delimiter}/bin`;
    process.env.ARCHIVISION_RIPWIRE = path.join(r.root, 'bin/ripwire'); delete process.env.BIRDVIEW_RIPWIRE;
    assert.equal(findRipwire(r.root), null);
    const S = scanRepo(r.root, {});
    assert.deepEqual(S.unresolved['ripwire-lsp'], { 'no-ripwire': 5 });
    // outside the repo but at another version: asked its version, never run
    fs.rmSync(path.join(out, 'ripwire')); fs.writeFileSync(path.join(out, 'ripwire'), fake('9.9.9')); fs.chmodSync(path.join(out, 'ripwire'), 0o755);
    const S2 = scanRepo(r.root, { ripwire: path.join(out, 'ripwire') });
    assert.deepEqual(S2.unresolved['ripwire-lsp'], { 'ripwire-version': 5 });
    assert.ok(!fs.existsSync(marker), 'the fake was never run with --lsp');
  } finally {
    process.env.PATH = PATH; if (ENV === undefined) delete process.env.ARCHIVISION_RIPWIRE; else process.env.ARCHIVISION_RIPWIRE = ENV;
    if (OLD !== undefined) process.env.BIRDVIEW_RIPWIRE = OLD;
    fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(marker, { force: true }); r.cleanup();
  }
});

test('go: without ripwire a Go repo has nothing to map, and says why', () => {
  const r = copy();
  try {
    const S = scanRepo(r.root, { ripwire: null });
    assert.equal(Object.keys(S.files).filter(f => f.endsWith('.go')).length, 0);
    assert.deepEqual(S.unresolved['ripwire-lsp'], { 'no-ripwire': 5 });
    assert.throws(() => buildRepo(autoMap(S), S), /nothing to map: the 5 Go files could not be read \(ripwire was not found/);
  } finally { r.cleanup(); }
});

test('go: the map and its page, with Go symbols, a coverage line, and every link checked', { skip }, () => {
  const r = copy();
  try {
    const S = scanRepo(r.root, { ripwire: RW }), B = buildRepo(autoMap(S), S), A = B.ATLAS;
    const names = A.modules.filter(m => m.id !== 'dock').flatMap(m => m.parts.flatMap(p => p.children.map(c => c.name)));
    for (const n of ['main', 'NewHandler', 'Handler', 'Store', 'New']) assert.ok(names.includes(n), `${n} in ${names.join(', ')}`);
    assert.ok(A.coverage.lines.some(l => /^Go: symbols from ripwire 0\.6\.7, no calls between them; 6 grouped constants and variables ripwire does not list \(counted, not drawn\)$/.test(l)), A.coverage.lines.join('\n'));
    const page = path.join(r.dir, 'go.html'); writePage(B, 'go', page);
    const c = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), page], { encoding: 'utf8', timeout: 180e3 });
    assert.equal(c.status, 0, c.stdout.slice(-3000) + c.stderr.slice(-800));
    assert.match(c.stdout, /all links: \d+ · bad 0 · by kind .*"symbol":\d+/);
  } finally { r.cleanup(); }
});
