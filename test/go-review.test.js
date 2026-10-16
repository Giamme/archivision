'use strict';
// The cases the review of phase 5 (Go through ripwire's language server) found, one test each. A fake ripwire (a
// shell script outside the repo, at the allowed version) answers with canned LSP messages, so the adapter's checks
// are tested on answers the real one would not give: malformed symbols, wrong kinds and spans, failures.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { scanRepo, autoMap, buildRepo } = require('../lib');
const { goDecls, goPackage } = require('../lib/repo/scan/go');

const frame = m => { const s = JSON.stringify(m); return `Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`; };
const sym = (name, kind, from, to, sel = from, children) => ({ name, kind, range: { start: { line: from - 1, character: 0 }, end: { line: to - 1, character: 1 } }, selectionRange: { start: { line: sel - 1, character: 0 }, end: { line: sel - 1, character: 1 } }, ...(children ? { children } : {}) });
// a repo with these files, and a fake ripwire that answers documentSymbol with `answers` (by file, in sorted order)
function setup(files, answers = {}, { vexit = 0, lexit = 0, version = 'ripwire 0.6.7 (fake)' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-goreview-')), root = path.join(dir, 'repo'), bin = path.join(dir, 'bin');
  for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); }
  fs.mkdirSync(bin);
  const goFiles = Object.keys(files).filter(f => f.endsWith('.go') && Buffer.byteLength(files[f]) <= 2 * 1024 * 1024).sort();
  let resp = frame({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } });
  goFiles.forEach((f, i) => { resp += frame(answers[f] === 'error' ? { jsonrpc: '2.0', id: i + 2, error: { code: -1, message: 'x' } } : { jsonrpc: '2.0', id: i + 2, result: answers[f] || [] }); });
  resp += frame({ jsonrpc: '2.0', id: goFiles.length + 2, result: null });
  fs.writeFileSync(path.join(dir, 'resp'), resp);
  const mark = path.join(dir, 'mark');
  fs.writeFileSync(path.join(bin, 'ripwire'), `#!/bin/sh\nif [ "$1" = "--version" ]; then pwd > "${mark}.vcwd"; echo "${version}"; exit ${vexit}; fi\npwd > "${mark}.cwd"; echo "$HOME" > "${mark}.home"\ncat > /dev/null\ncat "${path.join(dir, 'resp')}"\nexit ${lexit}\n`);
  fs.chmodSync(path.join(bin, 'ripwire'), 0o755);
  return { root, bin: path.join(bin, 'ripwire'), mark, read: k => fs.readFileSync(`${mark}.${k}`, 'utf8').trim(), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const shown = S => S.symbols.filter(s => s.file.endsWith('.go')).map(s => `${s.id} ${s.kind} ${s.line}-${s.end}${s.parent ? ` < ${s.parent}` : ''}`).sort();

test('review5 1: both runs start in a private folder (cwd, HOME), removed afterwards', () => {
  const r = setup({ 'a.go': 'package p\n\nfunc F() {}\n' }, { 'a.go': [sym('F', 12, 3, 3)] });
  try {
    scanRepo(r.root, { ripwire: r.bin });
    const plain = p => p.replace(/^\/private(?=\/(var|tmp)\/)/, ''), cwd = plain(r.read('cwd'));   // macOS: /var is /private/var
    assert.match(path.basename(cwd), /^archivision-ripwire-/);
    assert.equal(plain(r.read('vcwd')), cwd, 'the version check runs there too');
    assert.equal(plain(r.read('home')), cwd, 'HOME is that folder');
    assert.ok(!fs.existsSync(cwd), 'and it is gone');
  } finally { r.cleanup(); }
});

test('review5 2 and 9: a version check that fails, or a run that fails, reads nothing and claims no symbols', () => {
  for (const [opts, why, err] of [[{ vexit: 1 }, 'ripwire-version', /ripwire is not at an allowed version/], [{ lexit: 3 }, 'ripwire-failed', /ripwire failed/]]) {
    const r = setup({ 'a.go': 'package p\n\nfunc F() {}\n' }, { 'a.go': [sym('F', 12, 3, 3)] }, opts);
    try {
      const S = scanRepo(r.root, { ripwire: r.bin });
      assert.deepEqual(S.unresolved['ripwire-lsp'], { [why]: 1 });
      assert.equal(S.symbols.length, 0);
      assert.equal(S.adapters.find(a => a.name === 'ripwire-lsp').version, 'none');
      assert.throws(() => buildRepo(autoMap(S), S), err);
    } finally { r.cleanup(); }
  }
});

test('review5 3, 6 and 8: spans are the text\'s, kinds must agree, an interface keeps only the methods the text has, malformed answers are counted', () => {
  const go = 'package p\n\nfunc F() {}\n\ntype S struct{}\n\ntype I interface {\n\tM()\n\tN()\n}\n\nvar X = 1\n';
  const r = setup({ 'a.go': go }, { 'a.go': [
    sym('F', 12, 3, 999),                                              // a span far past the function
    sym('S', 11, 5, 5),                                                // a struct said to be an interface
    sym('I', 11, 7, 10, 7, [sym('M', 6, 8, 8), sym('Ghost', 6, 99, 99)]),   // a method the text does not have; N missing
    sym('X', 13, 12, 12),
    { name: 'broken', kind: 12 },                                      // no range
  ] });
  try {
    const S = scanRepo(r.root, { ripwire: r.bin });
    assert.deepEqual(shown(S), ['a.go#F function 3-3', 'a.go#I interface 7-10', 'a.go#I.M method 8-8 < a.go#I', 'a.go#X var 12-12']);
    assert.deepEqual(S.unresolved['ripwire-lsp'], { 'ripwire-malformed': 1, 'kind-disagrees': 1, 'ripwire-only': 1, 'text-missing': 2 }, 'S, and the method N, are what ripwire did not give right');
    const B = buildRepo(autoMap(S), S);
    assert.ok(B.ATLAS.coverage.lines.some(l => /^Go: symbols from ripwire 0\.6\.7, no calls between them; 2 declarations ripwire did not list, left out; 1 symbols only ripwire listed, left out; 1 symbols ripwire and the text give different kinds, left out; 1 malformed symbols from ripwire$/.test(l)), B.ATLAS.coverage.lines.join('\n'));
  } finally { r.cleanup(); }
});

test('review5 4: a method attaches to the type of its own package, never to a _test package\'s of the same name', () => {
  const r = setup({ 'a.go': 'package p\n\nfunc (t T) M() {}\n', 'b.go': 'package p\n\ntype T struct{}\n', 'z_test.go': 'package p_test\n\ntype T struct{}\n' },
    { 'a.go': [sym('M', 6, 3, 3)], 'b.go': [sym('T', 23, 3, 3)], 'z_test.go': [sym('T', 23, 3, 3)] });
  try {
    const S = scanRepo(r.root, { ripwire: r.bin });
    assert.equal(S.symbols.find(s => s.name === 'M').parent, 'b.go#T');
  } finally { r.cleanup(); }
});

test('review5 5: Go files under src/ do not narrow a repo whose TypeScript or Python is elsewhere', () => {
  const r = setup({ 'app.ts': 'export const a = 1;\n', 'main.py': 'def f():\n    return 1\n', 'src/helper.go': 'package src\n\nfunc H() {}\n' }, { 'src/helper.go': [sym('H', 12, 3, 3)] });
  try {
    const S = scanRepo(r.root, { ripwire: r.bin });
    assert.deepEqual(S.roots.filter(x => x.role === 'code').map(x => x.path), ['.']);
    assert.deepEqual(Object.keys(S.files).sort(), ['app.ts', 'main.py', 'src/helper.go']);
  } finally { r.cleanup(); }
});

test('review5 7: the text reader follows multi-line receivers, commented groups, Unicode names, statements over lines and interfaces', () => {
  const at = t => goDecls(t).map(d => `${d.kind} ${d.recv ? `${d.recv}.` : ''}${d.name} ${d.line}-${d.end} @${d.nameLine}${d.tkind ? ` ${d.tkind}` : ''}${d.methods && d.methods.length ? ` [${d.methods.map(m => m.name).join(',')}]` : ''}`);
  assert.deepEqual(at('package p\n\nfunc (\n\ts *Store,\n) Put(x int) {\n}\n'), ['method Store.Put 3-6 @5']);
  assert.deepEqual(at('package p\n\ntype ( /* kinds */\n\tA int\n\tB struct{}\n)\n'), ['type A 4-4 @4 other', 'type B 5-5 @5 struct']);
  assert.deepEqual(at('package p\n\nfunc Écrire() {}\n\nfunc Café() {}\n'), ['function Écrire 3-3 @3', 'function Café 5-5 @5']);
  assert.deepEqual(at('package p\n\nvar X =\n\tf(\n\t)\n\nvar Y = 1\n'), ['var X 3-5 @3', 'var Y 7-7 @7']);
  assert.deepEqual(at('package p\n\ntype I interface {\n\tM()\n\tio.Reader\n\tN(x int) error\n}\n'), ['type I 3-7 @3 interface [M,N]']);
  assert.equal(goPackage('// c\n/* x\n y */\npackage foo_test\n'), 'foo_test');
});

test('review5 10 and 11: a file over 2 MiB is counted, not sent; an answer ripwire could not give says why nothing maps', () => {
  const big = 'package p\n\n' + '// ' + 'x'.repeat(3 * 1024 * 1024) + '\n';
  const r = setup({ 'big.go': big, 'a.go': 'package p\n\nfunc F() {}\n' }, { 'a.go': 'error' });
  try {
    const S = scanRepo(r.root, { ripwire: r.bin });
    assert.deepEqual(S.unresolved['ripwire-lsp'], { 'too-large': 1, 'ripwire-error': 1 });
    assert.throws(() => buildRepo(autoMap(S), S), /nothing to map: the 2 Go files could not be read \(ripwire could not read them; over 2 MiB\)/);
  } finally { r.cleanup(); }
});

/* ---------- the second review ---------- */

test('review6 A: the sweep removes only folders archivision (or birdview, its old name) marked whose process has ended', () => {
  const r = setup({ 'a.go': 'package p\n\nfunc F() {}\n' }, { 'a.go': [sym('F', 12, 3, 3)] });
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-go-sweep-')), TMP = process.env.TMPDIR;
  try {
    const dead = require('child_process').spawnSync('/usr/bin/true').pid;
    const mk = (n, mark, file = '.archivision-ripwire') => { fs.mkdirSync(path.join(own, n)); if (mark) fs.writeFileSync(path.join(own, n, file), JSON.stringify(mark)); };
    mk('archivision-ripwire-unrelated-backup', null);                     // not archivision's: kept
    mk('archivision-ripwire-dead', { by: 'archivision', pid: dead });     // archivision's, its process gone: removed
    mk('archivision-ripwire-alive', { by: 'archivision', pid: 1 });       // archivision's mark, a process still there: kept
    mk('archivision-ripwire-other', { by: 'someone', pid: dead });        // another mark: kept
    mk('birdview-ripwire-dead', { by: 'birdview', pid: dead }, '.birdview-ripwire');     // the old name's, its process gone: removed
    mk('birdview-ripwire-mixed', { by: 'archivision', pid: dead }, '.birdview-ripwire'); // a mark that does not match its folder: kept
    mk('birdview-ripwire-unmarked', null);                                // the old name, no mark: kept
    process.env.TMPDIR = own;
    try { scanRepo(r.root, { ripwire: r.bin }); } finally { if (TMP === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = TMP; }
    assert.deepEqual(fs.readdirSync(own).sort(), ['archivision-ripwire-alive', 'archivision-ripwire-other', 'archivision-ripwire-unrelated-backup', 'birdview-ripwire-mixed', 'birdview-ripwire-unmarked']);
  } finally { r.cleanup(); fs.rmSync(own, { recursive: true, force: true }); }
});

test('review6 B and C: comments never make a receiver, a method name or a package', () => {
  const recv = 'package p\n\nfunc (\n/* explanation\nWrong) Ghost\n*/\nr *Real,\n) M() {}\n';
  assert.deepEqual(goDecls(recv).map(d => `${d.recv}.${d.name} @${d.nameLine}`), ['Real.M @8']);
  assert.equal(goPackage('// /* comment\npackage p_test\n'), 'p_test');
  // a canned Ghost on the comment's line is no method; M on its own line is Real's
  const r = setup({ 'a.go': recv, 'b.go': 'package p\n\ntype Real struct{}\n', 'z_test.go': '// /* comment\npackage p_test\n\ntype Real struct{}\n' },
    { 'a.go': [sym('Ghost', 6, 3, 8, 5), sym('M', 6, 3, 8, 8)], 'b.go': [sym('Real', 23, 3, 3)], 'z_test.go': [sym('Real', 23, 4, 4)] });
  try {
    const S = scanRepo(r.root, { ripwire: r.bin });
    assert.deepEqual(S.symbols.filter(s => s.kind === 'method').map(s => `${s.qname} < ${s.parent}`), ['Real.M < b.go#Real']);
    assert.equal(S.unresolved['ripwire-lsp']['ripwire-only'], 1);
  } finally { r.cleanup(); }
});

test('review6 6: an interface on one line keeps its methods, and one ripwire leaves out is counted', () => {
  assert.deepEqual(goDecls('package p\n\ntype I interface { M(); N(x int) error }\n')[0].methods.map(m => m.name), ['M', 'N']);
  const r = setup({ 'a.go': 'package p\n\ntype I interface { M() }\n' }, { 'a.go': [sym('I', 11, 3, 3)] });
  try {
    const S = scanRepo(r.root, { ripwire: r.bin });
    assert.deepEqual(S.unresolved['ripwire-lsp'], { 'text-missing': 1 });
  } finally { r.cleanup(); }
});

test('review6 9 and 11: answers that are all errors claim no symbols; a nested answer over the cap is refused', () => {
  const r = setup({ 'a.go': 'package p\n\nfunc F() {}\n' }, { 'a.go': 'error' });
  try {
    const S = scanRepo(r.root, { ripwire: r.bin });
    assert.equal(S.adapters.find(a => a.name === 'ripwire-lsp').version, 'none');
  } finally { r.cleanup(); }
  const kids = Array.from({ length: 50001 }, (_, k) => sym(`M${k}`, 6, 4, 4));
  const r2 = setup({ 'a.go': 'package p\n\ntype I interface {\n\tM0()\n}\n' }, { 'a.go': [sym('I', 11, 3, 5, 3, kids)] });
  try {
    const S = scanRepo(r2.root, { ripwire: r2.bin });
    assert.deepEqual(S.unresolved['ripwire-lsp'], { 'ripwire-too-many': 1 });
  } finally { r2.cleanup(); }
});

test('review7: semicolons of a type inside an interface method are not the interface\'s; a cap counts symbols at any depth', () => {
  assert.deepEqual(goDecls('package p\n\ntype I interface { M(x interface { A(); Ghost() }); N() }\n')[0].methods.map(m => m.name), ['M', 'N']);
  let deep = Array.from({ length: 50001 }, (_, k) => sym(`M${k}`, 6, 4, 4));
  for (let k = 0; k < 5; k++) deep = [sym(`W${k}`, 2, 3, 5, 3, deep)];
  const r = setup({ 'a.go': 'package p\n\ntype I interface {\n\tM0()\n}\n' }, { 'a.go': deep });
  try {
    const S = scanRepo(r.root, { ripwire: r.bin });
    assert.deepEqual(S.unresolved['ripwire-lsp'], { 'ripwire-too-many': 1 });
  } finally { r.cleanup(); }
});
