// Offline check of a archivision page, with no browser: real three.js and the page's own module run in jsdom,
// with WebGL and the 2D canvas stubbed. It clicks every block and every part with an inside at its projected
// screen position, checks every code link against the files on disk (repo pages), plays the branch view and
// every comparison (repo pages), every walkthrough, the rail, the theme and the Iso view, and reports problems.
//   node test/check-page.mjs page.html        (env: W, H window size · SAMPLE n parts per block · DEMO=1 the tour)
// Exits 1 when anything fails.
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const THREE_DIR = path.resolve(path.dirname(require.resolve('three')), '..');
const W0 = +(process.env.W || 1440), H0 = +(process.env.H || 900);
const PAGE = process.argv[2] || process.env.PAGE;
if (!PAGE) { console.error('usage: node test/check-page.mjs page.html'); process.exit(2); }
const html = fs.readFileSync(PAGE, 'utf8');
let code = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
const errors = [], vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdom: ' + String(e && (e.message || e)).slice(0, 200)));
const dom = new JSDOM(body, { url: 'http://localhost/' + (process.env.Q ?? '?still'), virtualConsole: vc });
const win = dom.window, doc = win.document;
Object.defineProperty(win, 'innerWidth', { value: W0, writable: true, configurable: true });
Object.defineProperty(win, 'innerHeight', { value: H0, writable: true, configurable: true });
win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
win.HTMLElement.prototype.scrollIntoView = function () {};
win.HTMLCanvasElement.prototype.setPointerCapture = function () {};
win.HTMLCanvasElement.prototype.releasePointerCapture = function () {};
const DRAWN = [];
win.HTMLCanvasElement.prototype.getContext = function () {
  if (this.__ctx) return this.__ctx;
  const t = { canvas: this, font: '10px mono', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic', letterSpacing: '0px', globalAlpha: 1, LOG: [] };
  const px = () => parseFloat((t.font.match(/([\d.]+)px/) || [0, 10])[1]);
  return (this.__ctx = new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'measureText') return s => ({ width: String(s).length * px() * .6 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
      if (k === 'clearRect') return () => { o.LOG = []; };
      if (k === 'fillText') return (s, x, y, mw) => { const w = String(s).length * px() * .6; o.LOG.push({ s, x, y, mw, w, px: px() }); };
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  }));
};
let CLOCK = 1000; const RAFQ = [];
const G = globalThis;
for (const k of ['document', 'navigator', 'location', 'localStorage', 'matchMedia', 'HTMLElement', 'HTMLCanvasElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle'])
  Object.defineProperty(G, k, { value: k === 'document' ? doc : win[k], configurable: true, writable: true });
G.window = win; G.self = win; G.parent = win;
Object.defineProperty(G, 'innerWidth', { get: () => win.innerWidth, configurable: true });
Object.defineProperty(G, 'innerHeight', { get: () => win.innerHeight, configurable: true });
G.devicePixelRatio = 2;
G.Path2D = function () { return new Proxy({}, { get: () => () => {} }); };
G.Image = win.Image;
G.addEventListener = win.addEventListener.bind(win); G.removeEventListener = win.removeEventListener.bind(win);
G.requestAnimationFrame = cb => { RAFQ.push(cb); return RAFQ.length; };
Object.defineProperty(G, 'performance', { value: { now: () => CLOCK, mark() {}, measure() {} }, configurable: true });
class FakeRenderer {
  constructor() { this.domElement = doc.createElement('canvas'); this._pr = 1; this._w = W0; this._h = H0; this.info = { render: {} }; this.capabilities = {}; }
  setPixelRatio(r) { this._pr = r; } getPixelRatio() { return this._pr; }
  setSize(w, h) { this._w = w; this._h = h; } getSize(v) { return v.set(this._w, this._h); }
  getDrawingBufferSize(v) { return v.set(this._w * this._pr, this._h * this._pr); }
  render() {} setRenderTarget() {} getRenderTarget() { return null; } clear() {} setClearColor() {} getClearColor(c) { return c; } getClearAlpha() { return 1; } compile() {}
}
class FakeComposer { constructor() { this.passes = []; } addPass(p) { if (p.scene) this.rp = p; } setSize() {} render() { this.rp.scene.updateMatrixWorld(); this.rp.camera.updateMatrixWorld(); this.rp.scene.traverseVisible(o => { if (o.isMesh && o.onBeforeRender) o.onBeforeRender(); if (o.isMesh && o.material && o.material.map && o.material.map.needsUpdate === undefined) {} }); } }
G.__FakeRenderer = FakeRenderer; G.__FakeComposer = FakeComposer;
const T3 = pathToFileURL(path.join(THREE_DIR, 'build/three.module.js')).href, ADD = pathToFileURL(path.join(THREE_DIR, 'examples/jsm/')).href;
code = code.replace(/from 'three';/g, `from '${T3}';`).replace(/from 'three\/addons\/([^']+)'/g, (_, p) => `from '${ADD}${p}'`)
  .replace('new THREE.WebGLRenderer({ antialias: true })', 'new __FakeRenderer()').replace('new EffectComposer(', 'new __FakeComposer(');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-check-')), MJS = path.join(TMP, 'page.mjs');
fs.writeFileSync(MJS, code);
process.on('uncaughtException', e => { errors.push('uncaught: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); });
const t0 = Date.now();
try { await import(pathToFileURL(MJS).href); }
catch (e) { console.log('IMPORT FAILED', e.stack); process.exit(1); }
finally { fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(`page loaded in ${Date.now() - t0} ms`);

const frames = (n, dt = 16.7) => { for (let i = 0; i < n; i++) { CLOCK += dt; const q = RAFQ.splice(0); for (const cb of q) { try { cb(CLOCK); } catch (e) { errors.push('frame: ' + e.stack.split('\n').slice(0, 3).join(' | ')); } } } };
frames(4);
const A = win.__az3; if (!A) { console.log('no debug hook', errors); process.exit(1); }
const ARCH = !A.AZ.repo;
console.log(`mode ${ARCH ? 'architecture' : 'repo'} · ${Object.values(A.NODE).filter(n => n.level === 1).length} blocks · rail ${A.SCENE.rail ? 'yes' : 'no'}`);
const THREE = await import(T3);
const fail = [], warn = [], out = [];
const cv = doc.querySelector('canvas');
const proj = (x, y, z) => { const v = A.W(x, y, z).project(A.cam()); return [(v.x + 1) / 2 * W0, (1 - v.y) / 2 * H0, v.z]; };
const fire = (el, type, x, y, extra = {}) => el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...extra }));
const clickAt = (x, y) => { fire(cv, 'pointerdown', x, y); fire(cv, 'pointerup', x, y); };
const key = k => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
const read = () => doc.getElementById('read').textContent;
const visible = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
// CSS px of one em of the print on a plane, measured along its text line
function fontPx(t) {
  if (!t.fonts.length || !visible(t.mesh)) return null;
  const o = t.mesh.localToWorld(new THREE.Vector3(0, 0, 0)), e = t.mesh.localToWorld(new THREE.Vector3(A.TS, 0, 0));
  const a = o.clone().project(A.cam()), b = e.clone().project(A.cam());
  const k = Math.hypot((b.x - a.x) / 2 * W0, (b.y - a.y) / 2 * H0);
  return Math.min(...t.fonts) * k;
}
const minPx = pred => { const v = A.TXT.filter(pred).map(fontPx).filter(x => x != null); return v.length ? Math.min(...v) : null; };
const overflow = pred => A.TXT.filter(pred).flatMap(t => t.x.LOG.filter(l => l.mw && l.w > l.mw * 1.02).map(l => `${l.s} (${(l.w / l.mw).toFixed(2)}×)`));
// on screen, inside the free part of the window?
function framing(box) {
  const pts = []; for (const X of [box[0], box[3]]) for (const Y of [box[1], box[4]]) for (const Z of [box[2], box[5]]) pts.push(proj(X, Y, Z));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), F = A.FREE;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), fill: (Math.max(...xs) - Math.min(...xs)) / F.w, inside: Math.min(...xs) >= F.px - 2 && Math.max(...xs) <= W0 + 2 && Math.min(...ys) >= F.top - 2 && Math.max(...ys) <= H0 - F.bot + 2 };
}
// every link is checked by what it claims to point at: a link with no kind, or a kind this
// checker does not know, fails, so nothing escapes the check silently
const LINES = {}, LINKS = { n: 0, bad: [], kinds: {} };
const ROOT = A.AZ.repo ? A.AZ.repo.root : null;
if (ROOT) { A.PREF.open = 'vscode'; A.PREF.root = ROOT; }          // check against the files on disk, not GitHub
// a file the page names is read only inside the repo (by its real path: a symlink, or a page that says ../.., leads
// nowhere else), when it is a regular file of a size a source file has
const REAL = ROOT ? (() => { try { return fs.realpathSync(ROOT); } catch { return null; } })() : null;
const within = f => { try { const r = fs.realpathSync(f), st = fs.statSync(r); return !!REAL && (r === REAL || r.startsWith(REAL + path.sep)) && st.isFile() && st.size <= 8 * 1024 * 1024; } catch { return false; } };
const fileLines = f => f in LINES ? LINES[f] : (LINES[f] = within(f) ? fs.readFileSync(f, 'utf8').split('\n') : null);
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = n => new RegExp(`(^|[^\\w$])${reEsc(n)}([^\\w$]|$)`);
const isTestPath = p => /(^|\/)(__tests__|tests?|e2e)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/.test(p);
// Python call sites and data uses are checked together at the end, by test/support/pycall.py (its own reading of the
// AST, not the scan's)
const PYQ = new Map();
function checkPyCalls() {
  if (!PYQ.size) return;
  const Q = [...PYQ.values()], { spawnSync } = require('child_process');
  const r = spawnSync('python3', ['-I', '-B', path.join(path.dirname(new URL(import.meta.url).pathname), 'support', 'pycall.py')], { input: JSON.stringify({ root: ROOT, checks: Q.map(q => q.c) }), encoding: 'utf8', cwd: os.tmpdir(), maxBuffer: 64 * 1024 * 1024, timeout: 300e3, killSignal: 'SIGKILL' });
  if (r.status !== 0) { LINKS.bad.push(`python call sites: the checker failed: ${r.error && r.error.code === 'ETIMEDOUT' ? 'it ran over 5 minutes' : (r.stderr || r.error || r.signal || '').toString().trim().split('\n').pop()}`); return; }
  for (const q of Q) { const kd = q.c.kind === 'data' ? 'data-op:py' : 'call-site:py'; LINKS.kinds[kd] = (LINKS.kinds[kd] || 0) + 1; }
  JSON.parse(r.stdout).forEach((why, i) => { if (why) LINKS.bad.push(`${Q[i].where}: ${Q[i].c.kind === 'data' ? `data-op ${Q[i].c.file}:${Q[i].c.line} «${Q[i].c.raw}»` : `call-site ${Q[i].c.file}:${Q[i].c.line} «${Q[i].c.name}»`}: ${why}`); });
  PYQ.clear();
}
// boto3, DB-API, SQLAlchemy and Django operations per store, as a data use's line must show one
const DATA_OP = {
  s3: /\.(get_object|put_object|delete_objects?|copy_object|head_object|list_objects(_v2)?|upload_file(obj)?|download_file(obj)?|get_object_tagging|put_object_tagging|select_object_content)\s*\(/,
  dynamodb: /\.(get_item|put_item|update_item|delete_item|query|scan|batch_get_item|batch_write_item|batch_writer|transact_write_items)\s*\(/,
  sqs: /\.(send_messages?|send_message_batch|receive_messages?|delete_message(_batch)?|change_message_visibility)\s*\(/,
  sql: /\.(execute|executemany|query)\s*\(/,
  django: /\.objects\.\w+\s*\(|\.objects\b/,
};
// the names a symbol can be referenced by in one file: its own, `x as y` aliases anywhere in the mapped code
// (imports and barrel re-exports), and a default import's local name
let ALIAS = null;
function aliasesIn(file, name) {
  if (!ALIAS) {
    ALIAS = new Map();
    const files = new Set(A.AZ.modules.flatMap(m => m.parts.flatMap(p => (p.code && p.code.files || []).map(f => f[0]))));
    for (const f of files) for (const m of (fileLines(path.join(ROOT, f)) || []).join('\n').matchAll(/\b([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g)) {
      if (!ALIAS.has(m[1])) ALIAS.set(m[1], new Set()); ALIAS.get(m[1]).add(m[2]);
    }
  }
  const out = new Set([name, ...(ALIAS.get(name) || [])]);
  if (name === 'default') for (const m of (fileLines(path.join(ROOT, file)) || []).join('\n').matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|\s+from)/g)) out.add(m[1]);
  return out;
}
const sha256 = x => crypto.createHash('sha256').update(x).digest('hex');
// call sites are read with the compiler (test/support/callsite.js)
const { ts, parse, tokenAt, isCallee, makeResolver } = require('./support/callsite.js');
const RESOLVE = ROOT ? makeResolver(ROOT) : null;
// a member named `name` declared in some code: a method, an accessor, a property or an object key
const memberDecl = name => new RegExp(`(^|[\\s{,;(])(?:(?:static|async|get|set|public|private|protected|readonly|override|abstract|declare)\\s+)*\\*?\\s*#?(?:${reEsc(name)}|['"]${reEsc(name)}['"])\\s*(?:<[^>]*>)?\\s*[?!]?\\s*[(:=]`, 'm');
const AST = {};
const astOf = f => f in AST ? AST[f] : (AST[f] = (() => { const L = fileLines(path.join(ROOT, f)); return L ? parse(f, L.join('\n')) : null; })());
function checkLink(a, where) {
  const d = a.dataset, kind = d.kind, p = d.path, l = +d.line || 0, e = +d.end || 0, name = d.name;
  LINKS.n++; LINKS.kinds[kind || 'none'] = (LINKS.kinds[kind || 'none'] || 0) + 1;
  const bad = msg => LINKS.bad.push(`${where}: ${kind || 'no kind'} ${p || ''}${l ? ':' + l : ''}${name ? ` «${name}»` : ''}: ${msg}`);
  if (kind === 'diff') {
    const c = A.cmp(), row = c && c.f.find(([i]) => A.CM.paths[i] === p);
    if (!row) return bad('not in the comparison on show');
    if (row[1] !== d.status) return bad(`status ${d.status}, the comparison says ${row[1]}`);
    if (!a.getAttribute('href').endsWith(`#diff-${sha256(p)}`)) return bad('anchor is not sha256(path)');
    return;                                            // a deleted (D) file needs no file on disk
  }
  if (kind === 'compare') return A.CM.list.some(c => c.bl === d.base && c.hl === d.head) ? undefined : bad(`pair ${d.base}…${d.head} not in the build`);
  if (!ROOT) return bad('a code link on a page with no repo');
  if (!p) return bad('no path');
  const h = a.getAttribute('href'), m = h.match(/^(?:vscode|cursor):\/\/file(.+?)(?::(\d+))?$/);
  if (!m) return bad(`unexpected href ${h}`);
  if (decodeURI(m[1]) !== `${ROOT}/${p}`) return bad(`href points at ${decodeURI(m[1])}`);
  if (+(m[2] || 0) !== l) return bad(`href line ${m[2]}`);
  const L = fileLines(path.join(ROOT, p)); if (!L) return bad('missing file');
  if (l > L.length || e > L.length) return bad(`beyond the file's ${L.length} lines`);
  const at = i => L[i - 1] || '';
  switch (kind) {
    case 'file': return;
    case 'test': return isTestPath(p) ? undefined : bad('not a test file');
    case 'symbol': {
      if (!l || !name) return bad('no line or name');
      const hi = Math.min(Math.max(e, l), l + 20);
      for (let i = l; i <= hi; i++) if (name === 'default' ? /export\s+default/.test(at(i)) : word(name).test(at(i))) return;
      return bad(`not declared in lines ${l}–${hi}`);
    }
    case 'ref-site': {
      if (!l || !name) return bad('no line or name');
      const names = aliasesIn(p, name);
      if ([...names].some(n => word(n).test(at(l)))) return;
      // a reference to a member (a property, a method, an enum value) points at the symbol that declares it:
      // then an identifier on the line must be declared inside the target's own span
      const tm = (d.target || '').match(/^(.*):(\d+)-(\d+)$/);
      if (tm) {
        const T = fileLines(path.join(ROOT, tm[1])) || [], span = T.slice(+tm[2] - 1, +tm[3]).join('\n');
        const ids = (at(l).match(/[A-Za-z_$][\w$]*/g) || []).filter(x => x.length > 2);
        if (ids.some(x => new RegExp(`(^|[^\\w$])${reEsc(x)}\\s*[?!]?\\s*[:(=;,]`, 'm').test(span))) { LINKS.kinds['ref-site:member'] = (LINKS.kinds['ref-site:member'] || 0) + 1; return; }
      }
      return bad(`none of ${[...names].join('/')} on the line, nor a member of the target: ${at(l).trim().slice(0, 90)}`);
    }
    case 'call-site': {
      if (/\.py$/.test(p)) {
        if (!l || !name || !+d.col) return bad('no line, name or column');
        const tm = (d.target || '').match(/^(.*):(\d+)-(\d+)$/); if (!tm) return bad('no target');
        const c = { file: p, line: l, col: +d.col, name, target: [tm[1], +tm[2], +tm[3]], status: d.st || null }, k = JSON.stringify(c);
        if (!PYQ.has(k)) PYQ.set(k, { c, where });
        return;
      }
      // the name at line:col is what a call, `new`, a JSX element, a tagged template or a decorator invokes (read with
      // the compiler's parser, so comments, declarations and type assertions do not pass), and it names the target:
      // followed through local bindings, imports, require(), re-exports and CommonJS exports to the declaration in
      // the target's file, or, for a method of a value, to a member of that name declared in the target's lines
      if (!l || !name) return bad('no line or name');
      const col = +d.col || 0; if (!col) return bad('no column');
      const tm = (d.target || '').match(/^(.*):(\d+)-(\d+)$/); if (!tm) return bad('no target');
      const [, tp, tl, te] = tm;
      const sf = astOf(p); if (!sf) return bad('cannot parse the file');
      const t = tokenAt(sf, l, col); if (!t) return bad(`no name at column ${col}: ${at(l).trim().slice(0, 90)}`);
      if (!isCallee(t)) return bad(`${t.getText(sf)} at column ${col} is not called there: ${at(l).trim().slice(0, 90)}`);
      const spelled = t.kind === ts.SyntaxKind.SuperKeyword ? 'super' : t.text, R = RESOLVE.resolveCall(p, t);
      if (!R) return bad(`what ${spelled} calls cannot be told from the code: ${at(l).trim().slice(0, 90)}`);
      if (R.local) return bad(`${spelled} is bound inside the function there, not the target ${name}`);
      const span = () => (fileLines(path.join(ROOT, tp)) || []).slice(+tl - 1, +te).join('\n');
      if (R.member !== undefined) {
        if (R.member !== name) return bad(`${R.member} is called there, not ${name}`);
        // a method of a name the file binds: that name's declaration is the target, or a class that extends another
        if (R.owner && R.owner.file !== tp) { const o = astOf(R.owner.file), c = o && o.statements.find(s => ts.isClassDeclaration(s) && s.name && s.name.text === R.owner.name);
          if (!(c && (c.heritageClauses || []).length)) return bad(`${spelled} is a member of ${R.owner.name} in ${R.owner.file}, not of the target in ${tp}`); }
        return memberDecl(name).test(span()) ? undefined : bad(`no member ${name} declared in ${tp}:${tl}-${te}`);
      }
      if (R.file !== tp) return bad(`${spelled} names ${R.name} in ${R.file}, not the target in ${tp}`);
      if (R.name !== name) return bad(`${spelled} names ${R.name}, not ${name}`);
      return name === 'default' || word(name).test(span()) ? undefined : bad(`${name} is not declared in ${tp}:${tl}-${te}`);
    }
    case 'data-use': {
      if (!l || !name) return bad('no line or model');
      const dl = name[0].toLowerCase() + name.slice(1);
      return new RegExp(`\\.${reEsc(dl)}\\b`).test(at(l)) ? undefined : bad(`no .${dl} on the line: ${at(l).trim().slice(0, 90)}`);
    }
    case 'data-op': {
      // a store other than Prisma: the line runs an operation of that store, and the file names the resource: its
      // name, or ($NAME) the environment variable that holds it, or the variable a manifest beside it sets to it
      if (!l || !name) return bad('no line or resource');
      const re = DATA_OP[d.store]; if (!re) return bad(`unknown store ${d.store}`);
      if (!re.test(at(l))) return bad(`no ${d.store} operation on the line: ${at(l).trim().slice(0, 90)}`);
      // the resource is what the operation is given (its bucket, table, queue or SQL argument, or the object it is
      // called on), followed through assignments before the call, constants, imports and os.environ: checked by
      // test/support/pycall.py on Python's own AST; a variable a manifest beside the code sets to it counts as it
      const raw = d.res || name, envs = new Set();
      if (/\.py$/.test(p)) for (let dir = path.dirname(p); ; dir = path.dirname(dir)) {
        for (const mf of ['serverless.yml', 'serverless.yaml', 'template.yaml', 'template.yml']) for (const ml of fileLines(path.join(ROOT, dir, mf)) || []) {
          const km = ml.match(/^\s*([A-Za-z_][\w]*)\s*:\s*['"]?([^'"#\s]+)/); if (km && km[2] === raw) envs.add(km[1]);
        }
        if (dir === '.' || dir === '/' || !dir) break;
      }
      if (!/\.py$/.test(p)) return bad(`a data use outside Python: ${p}`);
      const c = { kind: 'data', file: p, line: l, store: d.store, raw, envs: [...envs].sort() }, k = JSON.stringify(c);
      if (!PYQ.has(k)) PYQ.set(k, { c, where });
      return;
    }
    case 'resource': {
      // a bucket, a table or a queue named at the line (a string, a class, a manifest's variable); $NAME by its variable
      if (!l || !name) return bad('no line or resource');
      const raw = (d.res || name).replace(/^\$/, ''), span = L.slice(l - 1, Math.max(e, l)).join('\n');
      return span.includes(raw) ? undefined : bad(`${raw} is not named in lines ${l}–${Math.max(e, l)}`);
    }
    case 'model':
      if (!new RegExp(`^\\s*model\\s+${reEsc(name || '')}\\s*\\{`).test(at(l))) return bad(`line ${l} does not open model ${name}`);
      return e && !/^\s*\}/.test(at(e)) ? bad(`line ${e} does not close it`) : undefined;
    default: return bad('unknown kind');
  }
}
// a check that throws is a bad link, never a run that stops
function checkLinks(where) {
  for (const a of A.ins.querySelectorAll('a.src')) try { checkLink(a, where); } catch (e) { LINKS.bad.push(`${where}: ${a.dataset.kind || 'no kind'} ${a.dataset.path || ''}:${a.dataset.line || ''}: the check broke: ${String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')}`); }
}
const pinsShown = () => [...doc.querySelectorAll('.az-pin')].filter(p => !p.classList.contains('off')).length;

if (process.env.DEMO) {
  const snap = () => { const c = A.cam(); return `t=${((CLOCK - 1000) / 1000).toFixed(1)}s path ${JSON.stringify(A.st.path)} sel ${A.st.sel || '-'} tip ${A.tip() ? A.tip().id : '-'} cam ${c.position.toArray().map(v => v.toFixed(1)).join(',')} «${read()}»`; };
  for (let i = 0; i < 12; i++) { frames(60); console.log(snap()); }
  const f = framing(A.boxFor(A.st.path[A.st.path.length - 1])); console.log('framing of the open part', JSON.stringify(f));
  console.log('ERRORS', errors.length ? errors : 'none'); process.exit(errors.length ? 1 : 0);
}
frames(30);
out.push(`overview: pins ${doc.querySelectorAll('.az-pin').length} (${pinsShown()} shown) · readout «${read()}» · block names ≥ ${minPx(t => t.node && t.node.level === 1)?.toFixed(1)} px · districts ≥ ${minPx(t => !t.node && t.face === 'top' && t.fonts[0] > 15)?.toFixed(1)} px`);
const f0 = framing(A.BOX0); out.push(`overview framing: fill ${(f0.fill * 100).toFixed(0)}% of free width · inside ${f0.inside} · x ${f0.x0.toFixed(0)}–${f0.x1.toFixed(0)} y ${f0.y0.toFixed(0)}–${f0.y1.toFixed(0)}`);
if (!f0.inside) fail.push('overview does not fit the free part of the window');
// hover a block: links show
const B0 = Object.values(A.NODE).find(n => n.level === 1 && n.id !== 'dock');
{ const n = B0, [x, y] = proj(n.x + n.w / 2, n.y + n.d / 2, n.h); fire(cv, 'pointermove', x, y); frames(2); out.push(`hover ${n.id}: «${read()}» · faint arcs ${A.flowsG.children.length}`); if (A.st.hover !== n.id) fail.push('hovering the first block does not register'); fire(cv, 'pointerleave', 0, 0); frames(2); }
// tooltip on a block pin
{ const pin = doc.querySelector(`.az-pin[data-tip="${B0.id}"]`); fire(pin, 'pointerover', 0, 0); frames(3); const tp = A.tipEl(); out.push(`${B0.id} tip: ${tp.hidden ? 'HIDDEN' : tp.querySelector('.title').textContent} · fold ${tp.classList.contains('fold')}`); if (tp.hidden) fail.push('block tooltip did not open'); fire(pin, 'pointerout', 0, 0); frames(15); if (!A.tipEl().hidden) fail.push('tooltip did not close'); }

const rows = [], T0 = Date.now();
const blocks = Object.values(A.NODE).filter(n => n.level === 1 && n.id !== 'dock');
for (const n of blocks) {
  const v = A.VIS[n.id], [x, y] = proj(n.x + n.w / 2, n.y + n.d * .62, n.h * v.cover.scale.y);
  const tb = Date.now(); clickAt(x, y); const tBuild = Date.now() - tb; frames(110);
  if (A.st.path[0] !== n.id) { fail.push(`${n.id}: clicking its roof did not open it (path ${JSON.stringify(A.st.path)})`); continue; }
  checkLinks(n.id);
  const fr = framing(A.boxFor(n.id));
  const kidsShown = n.kids.filter(k => visible(A.VIS[k.id].root) && A.VIS[k.id].q > .99).length;
  const l2 = minPx(t => t.node && t.node.parent === n && t.face === 'top'), l2f = minPx(t => t.node && t.node.parent === n && t.face === 'front');
  const zl = minPx(t => t.node && t.node.kind === 'zone' && t.node.parent === n);
  const ov = overflow(t => t.node && t.node.parent === n);
  let line = `${n.id.padEnd(14)} parts ${kidsShown}/${n.kids.length} · links ${A.VIS[n.id].IM.links.length} · zones ${n.zones.length} · pins ${pinsShown()} · roof ≥ ${l2?.toFixed(1)}px front ≥ ${l2f?.toFixed(1)}px${zl ? ` zone ≥ ${zl.toFixed(1)}px` : ''} · fill ${(fr.fill * 100).toFixed(0)}%${fr.inside ? '' : ' OUTSIDE'} · built ${tBuild} ms`;
  if (kidsShown !== n.kids.length) fail.push(`${n.id}: ${kidsShown} of ${n.kids.length} parts up`);
  if (!fr.inside) fail.push(`${n.id}: open block not inside the free view`);
  if (l2 != null && l2 < 9.5) warn.push(`${n.id}: smallest part label ${l2.toFixed(1)} px`);
  if (ov.length) warn.push(`${n.id}: squeezed text ${ov.slice(0, 3).join(', ')}`);
  // hover a part: it becomes the selection, its cables light and carry pulses
  const k1 = n.kids.find(k => n.links.some(l => l.a === k || l.b === k)) || n.kids[0];
  { const [hx, hy] = proj(k1.x + k1.w / 2, k1.y + k1.d / 2, k1.h); fire(cv, 'pointermove', hx, hy); frames(30); const hot = A.VIS[n.id].IM.links.filter(L => L.hot > .5).length;
    line += ` · hover → ${A.st.sel === k1.id ? 'selected' : 'NOT selected (' + A.st.sel + ')'}${n.links.length ? `, ${hot} cables lit` : ''}`; if (A.st.sel !== k1.id) fail.push(`${n.id}: hovering ${k1.tag} did not select it`); }
  // tooltip of a part pin
  { const pin = doc.querySelector(`.az-pin[data-tip="${CSS_esc(k1.id)}"]`); if (!pin) fail.push(`${n.id}: no pin for ${k1.tag}`); else { fire(pin, 'click', 0, 0); frames(3); if (A.tipEl().hidden) fail.push(`${n.id}: part tooltip did not open`); fire(pin, 'click', 0, 0); frames(2); } }
  // one level deeper, on every part that has an inside
  const deep = [];
  for (const k of n.kids.filter(k => k.kids.length).slice(0, +(process.env.SAMPLE || 0) || Infinity)) {
    const kv = A.VIS[k.id], [kx, ky] = proj(k.x + k.w / 2, k.y + k.d * .55, k.h);
    clickAt(kx, ky); frames(90);
    if (A.st.path[1] !== k.id) { fail.push(`${k.id}: clicking it did not open it (path ${JSON.stringify(A.st.path)})`); key('Escape'); frames(60); continue; }
    checkLinks(k.id); for (const c of k.kids) { A.select(c.id); checkLinks(c.id); if (!ARCH && !A.ins.querySelector('#az-code a.src')) fail.push(`${c.id}: no code link for the symbol`); }
    const fr3 = framing(A.boxFor(k.id)), up = k.kids.filter(c => A.VIS[c.id] && visible(A.VIS[c.id].root) && A.VIS[c.id].q > .99).length;
    const l3 = minPx(t => t.node && t.node.parent === k && t.face === 'top');
    if (up !== k.kids.length) fail.push(`${k.id}: ${up} of ${k.kids.length} pieces up`);
    if (!fr3.inside) fail.push(`${k.id}: open part not inside the free view`);
    if (l3 != null && l3 < 9.5) warn.push(`${k.id}: smallest piece label ${l3.toFixed(1)} px`);
    const ov3 = overflow(t => t.node && t.node.parent === k); if (ov3.length) warn.push(`${k.id}: squeezed ${ov3.slice(0, 2).join(', ')}`);
    deep.push(`${k.tag.slice(0, 16)} ${up}/${l3 ? l3.toFixed(0) : '-'}px/${(fr3.fill * 100).toFixed(0)}%`);
    key('Escape'); frames(70);
    if (A.st.path.length !== 1) fail.push(`${k.id}: escape did not go back one level`);
  }
  if (deep.length) line += `\n${' '.repeat(16)}deeper: ${deep.join(' · ')}`;
  rows.push(line); process.stderr.write(`${n.id} ${((Date.now() - T0) / 1000).toFixed(0)}s\n`);
  key('Escape'); frames(70);
  if (A.st.path.length) fail.push(`${n.id}: escape did not close it`);
}
function CSS_esc(s) { return s.replace(/["\\]/g, '\\$&'); }
out.push(rows.join('\n'));
checkPyCalls();
out.push(`code links checked: ${LINKS.n} (${Object.keys(LINES).length} files) · bad ${LINKS.bad.length} · by kind ${JSON.stringify(LINKS.kinds)}`); if (LINKS.bad.length) fail.push(...LINKS.bad.slice(0, 6));
if (ARCH && LINKS.n) fail.push(`architecture page shows ${LINKS.n} code links`);
// the branch view (repo pages); in an architecture b does nothing
if (ARCH) { key('b'); frames(10); out.push(`b in an architecture: branch ${A.st.branch}`); if (A.st.branch) fail.push('b turned on a branch view in an architecture page'); }
else if (!A.CM.list.length) out.push('branch view: no comparisons in this build');
else { key('b'); frames(60); const lit = Object.values(A.VIS).filter(v => v.n.level === 1 && v.hot > .9).length, dim = Object.values(A.VIS).filter(v => v.n.level === 1 && v.hot > .3 && v.hot < .6).length;
  out.push(`branch view: «${read()}» · ${lit} blocks lit · ${dim} callers half-lit · ${A.flowsG.children.length} dashed arcs · ports lit ${Object.values(A.PORTV).filter(p => p.hot > .5).length}`);
  if (lit !== A.cmp().mods.length) fail.push(`branch view lights ${lit} blocks, expected ${A.cmp().mods.length}`);
  const bm = A.cmp().mods[0];
  checkLinks('branch view');
  if (bm) { A.open(bm[0]); frames(110); for (const pid of bm[2].slice(0, 3)) { A.select(`${bm[0]}/${pid}`); frames(3); checkLinks(`branch ${bm[0]}/${pid}`); } const n = A.NODE[bm[0]], hot = n.kids.filter(k => A.VIS[k.id].hot > .5).length; checkLinks('branch ' + n.id);
    out.push(`  open ${n.id}: ${hot} parts lit (expected ${bm[2].length}) · diff links ${A.ins.querySelectorAll('a.diff').length}`); if (hot < bm[2].length) fail.push(`branch: ${n.id} lights ${hot} of ${bm[2].length} changed parts`);
    key('Escape'); frames(70); }
  // every comparison through the two selects: the lit blocks follow
  const CL = A.CM.list, res = [];
  for (const c of CL) {
    const bs = A.ins.querySelector('select[data-cmp="base"]'), hs = A.ins.querySelector('select[data-cmp="head"]');
    if (!bs || !hs) { fail.push('branch selects missing'); break; }
    bs.value = c.base; hs.value = c.head; hs.dispatchEvent(new win.Event('change', { bubbles: true })); frames(50);
    const lit2 = Object.values(A.VIS).filter(v => v.n.level === 1 && v.hot > .9).length, want = c.mods.filter(m => A.NODE[m[0]]).length;
    res.push(`${c.hl.slice(0, 14)}←${c.bl.replace('origin/', '')}:${c.f.length}f/${lit2}b`); if (lit2 !== want) fail.push(`compare ${c.bl}..${c.hl}: ${lit2} blocks lit, expected ${want}`);
    if (A.cmp() !== c) fail.push(`compare ${c.bl}..${c.hl}: picker did not switch`);
  }
  out.push(`  all ${CL.length} comparisons via the selects: ${res.join(' ')}`);
  { const sw = CL.find(c => A.CM.bases.includes(c.head)); if (sw) { A.pickCmp(sw.base, sw.head); frames(10); A.ins.querySelector('[data-act="swap"]').click(); frames(10); out.push(`  swap ${sw.bl}..${sw.hl} → ${A.cmp().bl}..${A.cmp().hl}`); if (A.cmp().base !== sw.head) fail.push('swap did not swap'); } }
  A.pickCmp(A.CM.bases[0], A.CM.bases[0]); frames(20); out.push(`  same branch twice: «${A.ins.querySelector('h2').textContent}» · lit ${Object.values(A.VIS).filter(v => v.n.level === 1 && v.hot > .9).length}`);
  A.pickCmp(A.CM.bases[0], 'no-such-branch'); frames(5); out.push(`  missing pair: «${A.ins.querySelector('h2').textContent}» · ${A.ins.querySelector('pre') ? A.ins.querySelector('pre').textContent : '-'}`);
  { const d = A.CM.list[A.CM.def]; A.pickCmp(d.base, d.head); frames(30); }
  key('b'); frames(30); out.push(`  after b: «${read()}» · arcs ${A.flowsG.children.length}`); }
// a walkthrough step row opens its block at the right part
{ const j = A.AZ.journeys.findIndex(j => j.code.some(c => c && c.sel)); if (j >= 0) { A.playJourney(j); frames(20); const i = A.AZ.journeys[j].code.findIndex(c => c && c.sel), rowEl = A.ins.querySelectorAll('.row[data-m]')[i];
  const srcs = A.ins.querySelectorAll('.step-src a.src').length; rowEl.click(); frames(120); const want = A.AZ.journeys[j].code[i];
  out.push(`walkthrough ${j + 1} step ${i + 1}: path ${JSON.stringify(A.st.path)} sel ${A.st.sel} · step links ${srcs}`); if (A.st.sel !== (want.pc || want.sel) && A.st.path[A.st.path.length - 1] !== want.sel) fail.push(`walkthrough step opened ${A.st.sel}, expected ${want.pc || want.sel}`); checkLinks('walkthrough');
  key('Escape'); key('Escape'); frames(80); } }
out.push(`code links after all: ${LINKS.n} · bad ${LINKS.bad.length} · by kind ${JSON.stringify(LINKS.kinds)}`);
{ const px = A.TXT.reduce((t, x) => t + x.c.width * x.c.height, 0), big = A.TXT.slice().sort((a, b) => b.c.width * b.c.height - a.c.width * a.c.height).slice(0, 4).map(t => `${t.c.width}×${t.c.height}${t.node ? ' ' + (t.node.tag || t.node.name) : ''}`);
  const lv = [1, 2, 3].map(l => A.TXT.filter(t => t.node && t.node.level === l).reduce((a, t) => a + t.c.width * t.c.height, 0) / 1e6);
  out.push(`after closing: path ${JSON.stringify(A.st.path)} · pins ${pinsShown()} · canvases ${A.TXT.length} · ${(px / 1e6).toFixed(1)} Mpx (L1 ${lv[0].toFixed(1)}, L2 ${lv[1].toFixed(1)}, L3 ${lv[2].toFixed(1)}) · biggest ${big.join(', ')}`); }
// the rail
if (A.SCENE.rail && A.SCENE.ports.length) { const P1 = A.SCENE.ports[0], [x, y] = proj(P1.x, A.SCENE.rail.y + 22, 11); clickAt(x, y); frames(80); out.push(`port 1 click: path ${JSON.stringify(A.st.path)} · «${read()}» · pins ${pinsShown()}`); if (A.st.path[0] !== 'dock') fail.push('clicking port 1 did not open the dock'); checkLinks('dock');
  for (let i = 0; i < Math.min(40, A.AZ.groups.length); i++) { key('ArrowDown'); frames(3); checkLinks('dock ↓'); } out.push(`  ↓ «${read()}»`); key('Escape'); frames(60); }
// keys: → enter, i
{ key('ArrowRight'); frames(3); key('Enter'); frames(100); key('i'); frames(5); out.push(`keys: «${read()}» · tip ${A.tipEl().hidden ? 'none' : A.tipEl().querySelector('.title').textContent}`); key('Escape'); key('Escape'); frames(80); }
// every journey to its end
if (!A.AZ.journeys.length) out.push('no walkthroughs');
const jr = [];
for (let k = 0; k < A.AZ.journeys.length; k++) {
  A.playJourney(k); const J0 = A.st.jour, N = A.AZ.journeys[k].steps.length; let g = 0;
  while (A.st.jour === J0 && J0.i < N - 1 && g++ < 400) frames(10);
  jr.push(`${k + 1}:${J0.i + 1}/${N}`); if (J0.i !== N - 1) fail.push(`journey ${k + 1} stopped at step ${J0.i + 1} of ${N}`);
  frames(30);
}
out.push(`journeys: ${jr.join(' ')} · «${read()}»`);
key('Escape'); frames(20);
// the controls sheet: "?" opens it with every key, the bar's buttons and the gestures; esc and "?" close it
{
  const sheet = doc.getElementById('az-keys'), btn = doc.getElementById('az-keys-b');
  if (!sheet || !btn) fail.push('controls sheet: no #az-keys or no ? button');
  else {
    const path0 = JSON.stringify(A.st.path);
    key('?'); frames(2);
    if (sheet.hidden) fail.push('controls sheet: "?" did not open it');
    const keys = [...sheet.querySelectorAll('dt')].map(d => d.textContent.replace(/\s+/g, ' ').trim());
    const want = ['esc', '← →', '↑ ↓', 'enter', 'i', 't', '?', ...(A.AZ.journeys.length ? ['space'] : []), ...(ARCH ? [] : ['b']), 'click', 'drag', 'scroll'];
    for (const k of want) if (!keys.includes(k)) fail.push(`controls sheet: no row for «${k}» (rows: ${keys.join(' | ')})`);
    const bar = [...doc.querySelectorAll('#ctl-az button kbd')].map(k => k.textContent.trim()).filter(k => k && k !== '▶');
    for (const k of bar) if (!keys.includes(k)) fail.push(`controls sheet: the bar's key «${k}» is not listed`);
    if (btn.getAttribute('aria-expanded') !== 'true') fail.push('controls sheet: the ? button does not say it is expanded');
    key('Escape'); frames(2);
    if (!sheet.hidden) fail.push('controls sheet: esc did not close it');
    if (JSON.stringify(A.st.path) !== path0) fail.push('controls sheet: the esc that closed it also went back');
    btn.click(); frames(1); if (sheet.hidden) fail.push('controls sheet: the ? button did not open it');
    key('?'); frames(1); if (!sheet.hidden) fail.push('controls sheet: "?" did not close it');
    out.push(`controls sheet: ${keys.length} rows`);
  }
}
// theme, accent, iso view
doc.getElementById('theme').click(); frames(4); out.push(`theme → ${doc.documentElement.dataset.theme}`); doc.getElementById('theme').click(); frames(4);
[...doc.querySelectorAll('#swatches button')][1].click(); frames(2);
{ const iso = [...doc.querySelectorAll('#ctl-az button')].find(b => b.textContent.startsWith('Iso')); iso.click(); frames(60); out.push(`iso view: ortho ${A.cam().isOrthographicCamera}`);
  const n = A.NODE[A.SCENE.demoOpen], [x, y] = proj(n.x + n.w / 2, n.y + n.d * .6, n.h); clickAt(x, y); frames(110); const fr = framing(A.boxFor(n.id));
  out.push(`  open ${n.id} in iso: path ${JSON.stringify(A.st.path)} · fill ${(fr.fill * 100).toFixed(0)}% inside ${fr.inside} · roof ≥ ${minPx(t => t.node && t.node.parent === n && t.face === 'top')?.toFixed(1)}px`);
  if (!fr.inside) fail.push(`${n.id} not inside the view in Iso mode`);
  key('Escape'); frames(60); iso.click(); frames(60); }
checkPyCalls();
out.push(`all links: ${LINKS.n} · bad ${LINKS.bad.length} · by kind ${JSON.stringify(LINKS.kinds)}`);
{ const cables = Object.values(A.VIS).flatMap(v => (v.IM ? v.IM.links : [])); out.push(`cables drawn ${cables.length} · dashed ${cables.filter(c => c.mat.dashed || c.mat.isLineDashedMaterial).length}`); }
checkPyCalls();
for (const b of LINKS.bad.slice(0, 12)) if (!fail.includes(b)) fail.push(b);
console.log(out.join('\n'));
console.log('\nERRORS', errors.length ? errors.slice(0, 12) : 'none');
console.log('FAIL', fail.length ? fail : 'none');
console.log('WARN', warn.length ? warn : 'none');
process.exit(fail.length || errors.length ? 1 : 0);
