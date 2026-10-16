'use strict';
// Go symbols from ripwire's language server (`ripwire --lsp`, textDocument/documentSymbol), when the user has the
// binary. archivision never downloads or bundles it: it is found through --ripwire,
// ARCHIVISION_RIPWIRE or the PATH, never inside the scanned repo; only versions on the allow-list run, and the binary's
// sha256 goes into the scan's provenance. One session answers every file: the requests are written up front and the
// answers read back in order. Both runs (--version, then --lsp) start in a private folder that is their working
// directory, HOME and TMPDIR, deleted afterwards, with a minimal environment, a time limit (then SIGKILL) and caps on
// what they are given and what is read back. ripwire's symbols for Go are checked against archivision's own reading of
// the text (go.js): a symbol both agree on (name, line, kind) is kept, with the text's span; what one of them alone
// lists is counted. Methods come without their receiver: the declaration names it, and they attach to a type of the
// same package. Edges: none (no SCIP index, no --edges=ripwire yet), and the page says so.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { rootOf } = require('../roots');
const { goDecls, goPackage, goRanges } = require('./go');
const NAME = 'ripwire-lsp';
const ALLOW = new Set(['0.6.7']);
const isGo = p => /\.go$/.test(p);
const TEST = /_test\.go$/;
// LSP symbol kinds archivision keeps, by what a map calls them
const KIND = { 12: 'function', 6: 'method', 23: 'class', 11: 'interface', 5: 'class', 10: 'enum', 14: 'const', 13: 'var', 26: 'type' };

// the binary: --ripwire, ARCHIVISION_RIPWIRE (or BIRDVIEW_RIPWIRE, the old name), else `ripwire` on the PATH; never one inside the repo or on a relative path
function findRipwire(ROOT, given) {
  // the repo by its real path too (/var/… is /private/var/… on macOS): a ripwire inside it is never run; the binary is
  // returned by its real path, the one that was checked
  const real = p => { try { return fs.realpathSync(p); } catch { return null; } };
  const roots = [...new Set([path.resolve(ROOT), real(ROOT)].filter(Boolean))];
  const inside = p => roots.some(r => p === r || p.startsWith(r + path.sep));
  const ok = p => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };
  const pick = p => { const a = real(p); return a && !inside(path.resolve(p)) && !inside(a) && ok(a) ? a : null; };
  for (const p of [given, process.env.ARCHIVISION_RIPWIRE, process.env.BIRDVIEW_RIPWIRE].filter(Boolean)) { const a = pick(path.resolve(p)); if (a) return a; }
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!path.isAbsolute(d) || inside(d) || inside(real(d) || d)) continue;
    const a = pick(path.join(d, 'ripwire')); if (a) return a;
  }
  return null;
}

// LSP messages, framed
const frame = m => { const s = JSON.stringify(m); return `Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`; };
function unframe(buf, most = Infinity, biggest = Infinity) {
  const out = []; let i = 0;
  while (i < buf.length && out.length < most) {
    const h = buf.indexOf('\r\n\r\n', i); if (h < 0) break;
    const m = /Content-Length: (\d+)/i.exec(buf.subarray(i, h).toString()); if (!m) break;
    const len = +m[1]; if (h + 4 + len > buf.length) break;
    // a message over the size a file's symbols take is not decoded: its file is counted as not read
    if (len <= biggest) try { out.push(JSON.parse(buf.subarray(h + 4, h + 4 + len).toString())); } catch {}
    i = h + 4 + len;
  }
  return out;
}

function ripwireAdapter(ROOT, D, opts = {}) {
  const t0 = Date.now(), rel = D.rel;
  const all = [...new Set([...D.src, ...D.tests].map(rel).filter(isGo))].sort();
  const files = {}, symbols = [], counts = {}, add = (k, n = 1) => { if (n) counts[k] = (counts[k] || 0) + n; };
  const types = [], pkgOf = new Map();            // the types methods may attach to; each file's package
  let version = '', sha = '', note = null;
  if (!all.length) return done();
  const bin = opts.ripwire === null ? null : findRipwire(ROOT, opts.ripwire);
  if (!bin) { counts['no-ripwire'] = all.length; note = 'ripwire not found'; return done(); }
  // the files it is asked about: regular files of a source file's size, within a budget for them all
  const texts = new Map(); let total = 0;
  for (const f of all) {
    let st; try { st = fs.statSync(path.join(ROOT, f)); } catch { add('unreadable'); continue; }
    if (!st.isFile()) { add('unreadable'); continue; }
    if (st.size > MAX_FILE) { add('too-large'); continue; }
    if (total + st.size > MAX_TOTAL) { add('over-budget'); continue; }
    try { texts.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8')); total += st.size; } catch { add('unreadable'); }
  }
  const asked = [...texts.keys()];
  if (!asked.length) return done();
  // both runs from a private folder (its working directory, HOME and TMPDIR), removed afterwards. If archivision is
  // killed meanwhile, ripwire dies on its next write (its output pipe is gone) and the folder stays: the next run
  // removes the ones archivision marked as its own whose process has ended, nothing else
  sweep();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-ripwire-'));
  fs.writeFileSync(path.join(tmp, MARK), JSON.stringify({ by: 'archivision', pid: process.pid }));
  const env = { PATH: '/usr/bin:/bin', TMPDIR: tmp, HOME: tmp, LANG: 'en_US.UTF-8' };
  let run;
  try {
    const v = spawnSync(bin, ['--version'], { cwd: tmp, encoding: 'utf8', timeout: 10e3, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, env, windowsHide: true });
    version = !v.error && v.status === 0 ? ((v.stdout || '').match(/^ripwire\s+(\d+\.\d+\.\d+)(?:\s|$)/m) || [])[1] || '' : '';
    if (!ALLOW.has(version)) {
      counts['ripwire-version'] = asked.length;
      note = v.error || v.status !== 0 ? `ripwire --version failed (${v.error ? v.error.code || v.error.message : `exit ${v.status}`})` : `ripwire ${version || '(unknown version)'} is not on the allow-list (${[...ALLOW].join(', ')})`;
      version = '';
      return done();
    }
    sha = crypto.createHash('sha256').update(fs.readFileSync(bin)).digest('hex');
    // one session: initialize, a documentSymbol per file, shutdown
    let id = 0; const want = new Map();
    let input = frame({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { processId: null, rootUri: pathToFileURL(ROOT).href, capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } } } });
    input += frame({ jsonrpc: '2.0', method: 'initialized', params: {} });
    for (const f of asked) { want.set(++id, f); input += frame({ jsonrpc: '2.0', id, method: 'textDocument/documentSymbol', params: { textDocument: { uri: pathToFileURL(path.join(ROOT, f)).href } } }); }
    input += frame({ jsonrpc: '2.0', id: ++id, method: 'shutdown', params: null }) + frame({ jsonrpc: '2.0', method: 'exit', params: null });
    run = spawnSync(bin, ['--lsp', '--no-cache'], { cwd: tmp, input, env, timeout: opts.timeout || 300e3, killSignal: 'SIGKILL', maxBuffer: MAX_OUT, windowsHide: true });
    if (run.error || run.status !== 0) { counts['ripwire-failed'] = asked.length; note = `ripwire failed: ${run.error ? run.error.code || run.error.message : `exit ${run.status}`}`; version = ''; return done(); }
    const answers = new Map(unframe(run.stdout, 4 * want.size + 64, MAX_MSG).filter(m => m && m.id != null).map(m => [m.id, m]));
    for (const [rid, f] of want) {
      try { readFile(f, texts.get(f), answers.get(rid)); } catch { add('ripwire-error'); delete files[f]; for (let k = symbols.length - 1; k >= 0; k--) if (symbols[k].file === f) symbols.splice(k, 1); }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  if (!Object.keys(files).length) { version = ''; note = 'ripwire answered no file'; }   // no symbols to claim
  attach();
  for (const s of symbols) delete s.status;
  return done();

  // one file's symbols: ripwire's, each kept where the text has the same declaration (name at the same line, the same
  // kind); spans are the text's; an interface's methods are checked one by one too
  function readFile(f, text, a) {
    if (!a || a.error || !Array.isArray(a.result)) { add('ripwire-error'); return; }
    // every symbol of the answer, at any depth, until the cap
    let many = 0;
    for (const stack = [...a.result]; stack.length && many <= MAX_SYMS;) { const x = stack.pop(); many++; if (x && Array.isArray(x.children)) stack.push(...x.children.slice(0, MAX_SYMS)); }
    if (many > MAX_SYMS) { add('ripwire-too-many'); return; }
    const roleTest = r => { const role = D.roleOf(r); return role === 'test' || role === 'e2e' || TEST.test(r); };
    files[f] = { lang: 'go', lines: text.split('\n').length, test: roleTest(f), pkg: D.pkgOf(f), flags: { server: false, client: false, middleware: false }, prov: NAME };
    pkgOf.set(f, goPackage(text));
    const mine = goDecls(text), L = text.split('\n'), byKey = new Map(mine.map(d => [`${d.name}@${d.nameLine}`, d]));
    const ids = new Map(), idOf = q => { const k = (ids.get(q) || 0) + 1; ids.set(q, k); return `${f}#${q}${k > 1 ? `#${k}` : ''}`; };
    // ripwire's symbols at their name's line (selectionRange); a `type (…)` group comes as one symbol named after a
    // type of it with the others nested: each type in it is a declaration; the file scope (kind 2) is none
    const flat = [];
    for (const s of a.result) {
      if (!shaped(s)) { add('ripwire-malformed'); continue; }
      if (s.kind === 2) continue;
      flat.push([s, false]);
      if (s.kind !== 11) for (const c of s.children || []) if (shaped(c) && KIND[c.kind]) flat.push([c, true]);
    }
    const tops = [], seen = new Set();
    for (const [s, nested] of flat) {
      const line = (s.selectionRange || s.range).start.line + 1, d = byKey.get(`${s.name}@${line}`);
      if (!KIND[s.kind] || !d || seen.has(d)) { if (!nested) add('ripwire-only'); continue; }
      if (!agrees(d, s.kind)) { add('kind-disagrees'); continue; }
      seen.add(d);
      tops.push({ s, d });
    }
    // what only the text has: grouped constants and variables (ripwire lists none), else declarations it missed
    for (const d of mine) if (!seen.has(d)) add(d.inGroup && (d.kind === 'const' || d.kind === 'var') ? 'text-only' : 'text-missing');
    const isMain = goPackage(text) === 'main';
    for (const { s, d } of tops) if (d.kind !== 'method') {
      // exported: a capital first letter; and a program's func main, what it runs
      const kind = d.kind === 'type' ? (d.tkind === 'interface' ? 'interface' : 'class') : d.kind, sid = idOf(d.name);
      const exported = /^\p{Lu}/u.test(d.name) || (isMain && kind === 'function' && d.name === 'main');
      if ((kind === 'class' || kind === 'interface') && pkgOf.get(f)) types.push({ key: `${path.posix.dirname(f)}|${pkgOf.get(f)}|${d.name}`, id: sid, file: f });
      symbols.push({ id: sid, file: f, name: d.name, qname: d.name, kind, line: d.line, end: d.end, exported, sig: sigOf(L[d.line - 1]), doc: docOf(L, d.line), member: false, parent: null, prov: NAME, status: 'exact' });
      // an interface's methods: ripwire's children where the text lists the same method at the same line
      if (kind === 'interface') {
        const theirs = new Map((d.methods || []).map(m => [`${m.name}@${m.line}`, m])), got = new Set();
        for (const c of s.children || []) {
          if (!shaped(c)) { add('ripwire-malformed'); continue; }
          const cl = (c.selectionRange || c.range).start.line + 1, m = theirs.get(`${c.name}@${cl}`);
          if (!m || got.has(m) || (c.kind !== 6 && c.kind !== 12)) { add('ripwire-only'); continue; }
          got.add(m);
          symbols.push({ id: idOf(`${d.name}.${m.name}`), file: f, name: m.name, qname: `${d.name}.${m.name}`, kind: 'method', line: m.line, end: m.line, exported: /^\p{Lu}/u.test(m.name), sig: '', doc: docOf(L, m.line), member: true, parent: sid, prov: NAME, status: 'exact' });
        }
        add('text-missing', (d.methods || []).filter(m => !got.has(m)).length);
      }
    }
    for (const { d } of tops) if (d.kind === 'method') {
      symbols.push({ id: idOf(`${d.recv}.${d.name}`), file: f, name: d.name, qname: `${d.recv}.${d.name}`, kind: 'method', line: d.line, end: d.end, exported: /^\p{Lu}/u.test(d.name),
        sig: sigOf(L[d.line - 1]), doc: docOf(L, d.line), member: true, parent: null, recv: `${path.posix.dirname(f)}|${pkgOf.get(f)}|${d.recv}`, prov: NAME, status: 'exact' });
    }
  }

  // a method attaches to its receiver's type: in the same folder and the same package (a _test package is another);
  // two such types (files for different builds), or a file whose package clause is not read, leave it on its own,
  // counted
  function attach() {
    const by = new Map(); for (const t of types) { if (!by.has(t.key)) by.set(t.key, []); by.get(t.key).push(t); }
    for (const s of symbols) if (s.recv) {
      const ts = /\|null\|/.test(s.recv) ? [] : by.get(s.recv) || [], own = ts.filter(t => t.file === s.file), pick = own.length === 1 ? own : ts;
      if (pick.length === 1) s.parent = pick[0].id;
      else { if (pick.length > 1 || /\|null\|/.test(s.recv)) add('method-type-ambiguous'); s.member = false; }
      delete s.recv;
    }
  }

  function done() {
    const ms = Date.now() - t0, roots = D.roots.map(r => r.path), codeRoots = D.roots.filter(r => r.role === 'code').map(r => r.path);
    return {
      name: NAME, files, symbols, relations: [], note,
      unresolved: () => counts,
      info: () => ({ name: NAME, version: version || 'none', files: Object.keys(files).length, facts: symbols.length, ms, covers: ['.go'], ...(sha ? { sha256: sha } : {}) }),
      owns: p => isGo(p) && codeRoots.includes(rootOf(roots, p)),
      ranges: goRanges,
    };
  }
}
// limits: a file, the files together, ripwire's answer, the symbols of one file
const MAX_FILE = 2 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024, MAX_OUT = 256 * 1024 * 1024, MAX_MSG = 32 * 1024 * 1024, MAX_SYMS = 50000;
// the file that marks a temporary folder as one archivision made, with the process that made it (birdview, its old
// name, marked its own as .birdview-ripwire, and those are swept too)
const MARK = '.archivision-ripwire';
// an LSP DocumentSymbol as the protocol shapes it
const pos = p => p && Number.isInteger(p.line) && p.line >= 0 && Number.isInteger(p.character);
const span = r => r && pos(r.start) && pos(r.end) && r.end.line >= r.start.line;
const shaped = s => s && typeof s.name === 'string' && Number.isInteger(s.kind) && span(s.range) && (s.selectionRange === undefined || span(s.selectionRange)) && (s.children === undefined || Array.isArray(s.children));
// the LSP kinds each declaration the text reads may come as (ripwire gives a constant as a Variable: which one it is
// comes from the text)
const agrees = (d, k) => d.kind === 'function' ? k === 12 : d.kind === 'method' ? k === 6 : d.kind === 'const' || d.kind === 'var' ? k === 13 || k === 14
  : d.tkind === 'interface' ? k === 11 : d.tkind === 'struct' ? k === 23 || k === 5 : [5, 10, 23, 26].includes(k);
// temporary folders of runs killed before they could remove theirs: only ones archivision marked (a regular file it
// wrote, this user's), whose process has ended
function sweep() {
  let names = [];
  try { names = fs.readdirSync(os.tmpdir()).filter(n => /^(archivision|birdview)-ripwire-/.test(n)); } catch { return; }
  const uid = process.getuid ? process.getuid() : null;
  for (const n of names) {
    try {
      const by = n.slice(0, n.indexOf('-')), p = path.join(os.tmpdir(), n), st = fs.lstatSync(p), mk = path.join(p, `.${by}-ripwire`), ms = fs.lstatSync(mk);
      if (!st.isDirectory() || !ms.isFile() || ms.size > 256 || (uid !== null && (st.uid !== uid || ms.uid !== uid))) continue;
      const m = JSON.parse(fs.readFileSync(mk, 'utf8'));
      if (!m || m.by !== by || !Number.isInteger(m.pid) || m.pid === process.pid || alive(m.pid)) continue;
      fs.rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// a declaration's first line as its signature, without the body; the comment lines just above as its doc
const sigOf = l => (/^func\b/.test(l || '') ? l.replace(/\s*\{.*$/, '').replace(/^func\s+(\([^)]*\)\s*)?[A-Za-z_]\w*/, '').trim().slice(0, 160) : '');
function docOf(L, line) {
  const out = []; for (let i = line - 2; i >= 0 && /^\s*\/\//.test(L[i]); i--) out.unshift(L[i].replace(/^\s*\/\/\s?/, ''));
  return out.join(' ').slice(0, 300);
}

module.exports = { ripwireAdapter, findRipwire, ALLOW };
