'use strict';
// Python through the standard library's ast (python/scan.py). The file contents are read here and sent on stdin;
// Python runs as `python3 -I -S -B` from a folder outside the repo, in a minimal environment, with time, output and
// memory limits, so it never imports or runs the scanned code and never opens a file of the repo. What it reads:
// symbols (functions, classes, methods, nested functions as members, module constants), calls and references with
// how sure each one is, the files each file imports, data access (boto3 DynamoDB, S3 and SQS; DB-API cursors with the
// tables their SQL names; SQLAlchemy and Django models), and handlers by convention. No python3: the Python files are
// counted as not read, and the map goes on.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { rootOf } = require('../roots');
const NAME = 'ast';
const SCAN = path.join(__dirname, '..', '..', '..', 'python', 'scan.py');
const isPy = p => /\.py$/.test(p);
const TEST = /(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$|(^|\/)tests?\//;
// how boto3, DB-API, SQLAlchemy and Django facts are labelled
const PROV = d => d.via || (d.store === 'sql' ? 'dbapi' : d.store === 'django' ? 'django' : 'boto3');

// python3 on the PATH, never one inside the scanned repo (by its real location, so a symlink outside that points in
// does not count) or on a relative PATH entry; the real path found is the one that runs
function findPython(ROOT) {
  let R; try { R = fs.realpathSync(ROOT); } catch { R = ROOT; }
  const inside = p => p === R || p.startsWith(R + path.sep) || p === ROOT || p.startsWith(ROOT + path.sep);
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!path.isAbsolute(d) || inside(d)) continue;
    try { const p = fs.realpathSync(path.join(d, 'python3')); fs.accessSync(p, fs.constants.X_OK); if (!inside(p) && fs.statSync(p).isFile()) return p; } catch {}
  }
  return null;
}
// what one scan sends to Python: no file over 2 MiB, at most 256 MiB in all (the rest is counted, not read)
const MAX_FILE = 2 * 1024 * 1024, MAX_ALL = 256 * 1024 * 1024;

function pythonAdapter(ROOT, D, opts = {}) {
  const t0 = Date.now(), rel = D.rel;
  const all = [...new Set([...D.src, ...D.tests].map(rel).filter(isPy))].sort();
  const files = {}, symbols = [], relations = [], resources = {}, data = [], tests = {}, conventional = [], rebound = {};
  const counts = {};
  let version = '', note = null, dataDone = null, out = null;
  const isTest = r => { const role = D.roleOf(r); return role === 'test' || role === 'e2e' || TEST.test(r); };
  if (!all.length) return done();
  const py = opts.python === undefined ? findPython(ROOT) : opts.python;
  if (!py) { note = 'python3 not found'; counts['no-python'] = all.length; return done(); }
  const src = {}; let total = 0;
  for (const r of all) {
    try {
      const st = fs.statSync(path.join(ROOT, r));
      if (!st.isFile()) { counts.unreadable = (counts.unreadable || 0) + 1; continue; }
      if (st.size > MAX_FILE) { counts['too-large'] = (counts['too-large'] || 0) + 1; continue; }
      if (total + st.size > MAX_ALL) { counts['over-budget'] = (counts['over-budget'] || 0) + 1; continue; }
      total += st.size; src[r] = fs.readFileSync(path.join(ROOT, r), 'utf8');
    } catch { counts.unreadable = (counts.unreadable || 0) + 1; }
  }
  const req = JSON.stringify({ files: src, tests: all.filter(isTest), deploy: D.pyDeploy || [], pkgdirs: D.pyPkgdirs || [] });
  const run = spawnSync(py, ['-I', '-S', '-B', SCAN, '--memory-mb=2048'], { input: req, encoding: 'utf8', cwd: os.tmpdir(), env: { PATH: `${path.dirname(py)}:/usr/bin:/bin`, LANG: 'en_US.UTF-8' },
    timeout: 300e3, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (run.error || run.status !== 0) {
    // scan.py says so when this python3 is older than the 3.10 it needs. It exits before it reads stdin, so the
    // request (bigger than the pipe, or written after the exit) may meet a closed pipe: EPIPE is that same answer
    const last = (run.stderr || '').trim().split('\n').pop();
    const old = (!run.error || run.error.code === 'EPIPE') && run.status === 2 && /needs Python 3\.10 or later/.test(last);
    note = `python3 failed: ${old ? last : run.error ? run.error.code || run.error.message : last}`; counts[old ? 'python-too-old' : 'python-failed'] = all.length; return done();
  }
  try { out = JSON.parse(run.stdout); } catch { note = 'python3 answered no JSON'; counts['python-failed'] = all.length; return done(); }
  version = out.python;

  for (const [r, f] of Object.entries(out.files)) {
    files[r] = { lang: 'py', lines: f.lines, test: isTest(r), pkg: D.pkgOf(r), flags: { server: false, client: false, middleware: false }, prov: NAME,
      ...(f.error ? { error: `${f.error.message}${f.error.line ? ` (line ${f.error.line})` : ''}, Python ${version}` } : {}) };
    if (f.error) counts['parse-error'] = (counts['parse-error'] || 0) + 1;
  }
  for (const s of out.symbols) symbols.push({ ...s, prov: NAME });
  for (const r of out.relations) relations.push({ ...r, prov: NAME });
  Object.assign(counts, out.unresolved);
  for (const [f, ns] of Object.entries(out.rebound || {})) if (files[f]) rebound[f] = ns;

  // tests: the repo files each test file imports; the runner it imports, else none claimed
  for (const r of all) {
    if (!files[r] || !files[r].test) continue;
    const t = src[r] || '', runner = /^\s*(import|from)\s+pytest\b/m.test(t) ? 'pytest' : /^\s*(import|from)\s+unittest\b/m.test(t) ? 'unittest' : 'unknown';
    tests[r] = { runner, runnerProv: runner === 'unknown' ? 'its name' : 'its imports', imports: (out.imports[r] || []).filter(([f]) => files[f]).map(([file, line, status]) => ({ file, line, status, prov: NAME })), visits: [] };
  }

  const pkgOf = file => files[file] ? files[file].pkg : D.pkgOf(file);
  const idOf = (store, file, name) => `${store}:${pkgOf(file) || '.'}:${name}`;
  for (const x of out.resources) {
    const id = idOf(x.store, x.file, x.name);
    resources[id] = { store: x.store, kind: 'table', name: x.name, pkg: pkgOf(x.file), file: x.file, line: x.line, end: x.end, fields: x.fields, rel: [], prov: x.via || (x.store === 'sql' ? 'sqlalchemy' : 'django'), status: 'exact' };
  }
  for (const e of out.entries) if (e.kind === 'lambda') conventional.push(e);
  return done();

  // data, once the deployed functions are known: a literal name is a resource; a name from an environment variable
  // is one too, named by the value the deployments running that code give it (each function's own value over its
  // provider's) when they all give the same literal, with the manifest line as evidence; else by the variable
  // ($NAME), and counted when they disagree. The deployments running the code are those whose handler reaches it by
  // calls (module-level code: those reaching its file); when none does, every function of the nearest manifest
  // holding the file. Any other name is unknown, and its use unresolved
  function dataWith(deploys = []) {
    const callees = new Map(); for (const r of relations) if (r.rel === 'call') { if (!callees.has(r.from)) callees.set(r.from, []); callees.get(r.from).push(r.to); }
    const reach = new Map(), reachOf = h => { if (reach.has(h)) return reach.get(h); const seen = new Set([h]), stack = [h]; while (stack.length) for (const t of callees.get(stack.pop()) || []) if (!seen.has(t)) { seen.add(t); stack.push(t); } reach.set(h, seen); return seen; };
    const reaches = (dep, from) => (from.includes('#') ? reachOf(dep.handler).has(from) : [...reachOf(dep.handler)].some(x => x.startsWith(from + '#')));
    const literal = v => (v && v.value && !/\$\{/.test(v.value) ? v.value : null);
    const nearest = file => {
      const ms = (D.manifests || []).filter(m => (m.kind === 'serverless' || m.kind === 'sam') && (m.dir === '.' || file.startsWith(m.dir + '/'))).sort((a, b) => b.dir.length - a.dir.length);
      const m = ms[0]; if (!m) return [];
      return m.data.functions.map(f => { const env = {}; for (const [k, v] of Object.entries(m.kind === 'sam' ? f.environment : { ...m.data.environment, ...f.environment })) env[k] = { ...v, file: v.file || m.file }; return env; });
    };
    const envValue = (d, file) => {
      const by = deploys.filter(dep => reaches(dep, d.from)).map(dep => dep.env), envs = by.length ? by : nearest(file);
      // one setting they all agree on (literal or not) is the evidence; a literal one names the resource
      const vals = envs.map(e => e[d.name[1]]), raw = new Set(vals.map(v => (v && v.value) || null));
      if (vals.length && raw.size === 1 && vals[0] && vals[0].value) return { ...vals[0], value: literal(vals[0]) };
      if ([...raw].some(Boolean)) counts['data-env-varies'] = (counts['data-env-varies'] || 0) + 1;
      return null;
    };
    const DATA = new Map();
    for (const d of out.data) {
      const file = d.from.split('#')[0];
      let res = null;
      if (d.name[0] === 'literal') {
        res = idOf(d.store, file, d.name[1]);
        // evidence: the line that names it (a SQL table in its query, a bucket's string, maybe in another module)
        const [ef, el] = d.name[2] ? [d.name[2], d.store === 'sql' ? d.at : d.name[3]] : [file, d.at || d.site[0]];
        if (!resources[res]) resources[res] = { store: d.store, kind: d.kind, name: d.name[1], pkg: pkgOf(file), file: ef, line: el, end: el, fields: 0, rel: [], prov: PROV(d), status: 'inferred' };
      } else if (d.name[0] === 'env') {
        const env = envValue(d, file), lit = env ? env.value : null;
        res = idOf(d.store, file, lit || `$${d.name[1]}`);
        if (!resources[res]) resources[res] = { store: d.store, kind: d.kind, name: lit || `$${d.name[1]}`, pkg: pkgOf(file), file: env ? env.file : d.name[2] || file, line: env ? env.line : d.name[3] || d.site[0], end: env ? env.line : d.name[3] || d.site[0], fields: 0, rel: [], prov: PROV(d), status: 'inferred' };
      }
      const k = `${d.from}|${res}`, e = DATA.get(k);
      if (e) { e.n++; e.sites.push(d.site); if (d.op === 'write') e.w = true; else e.r = true; }
      else DATA.set(k, { from: d.from, resource: res, sites: [d.site], n: 1, r: d.op !== 'write', w: d.op === 'write', status: res ? 'inferred' : 'unresolved', prov: PROV(d) });
    }
    for (const { r, w, ...d } of DATA.values()) data.push({ ...d, op: r && w ? 'rw' : w ? 'write' : 'read' });
    return data;
  }

  function done() {
    const ms = Date.now() - t0;
    const roots = D.roots.map(r => r.path), codeRoots = D.roots.filter(r => r.role === 'code').map(r => r.path);
    return {
      name: NAME, files, symbols, relations, resources, data: deploys => (dataDone = dataDone || (out ? dataWith(deploys) : data)), tests, conventional, rebound, note,
      unresolved: () => counts,
      info: () => ({ name: NAME, version: version || 'none', files: Object.keys(files).length, facts: symbols.length + relations.length, ms, covers: ['.py'] }),
      owns: p => isPy(p) && codeRoots.includes(rootOf(roots, p)),
      ranges: pyRanges,
    };
  }
}

// the top-level declarations of one version of a Python file, for diffs, read without Python: functions and classes
// (from their first decorator), and the first assignment of each module constant, at module level or inside module-level
// if/try/with/for blocks; ids are numbered as python/scan.py numbers them
function pyRanges(p, text) {
  const L = text.split('\n'), decls = [], stack = [], consts = new Set();
  let str = null, depth = 0, deco = null, last = 0;
  for (let i = 0; i < L.length; i++) {
    const s = L[i], cont = str !== null || depth > 0;
    // strings, brackets and comments on this line
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (str) { if (c === '\\') { j++; continue; } if (s.startsWith(str, j)) { j += str.length - 1; str = null; } continue; }
      if (c === '#') break;
      if (c === '"' || c === "'") { const t = s.startsWith(c.repeat(3), j) ? c.repeat(3) : c; str = t; j += t.length - 1; continue; }
      if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    }
    if (str && str.length === 1) str = null;          // a one-quote string never runs past its line
    const t = s.trim();
    if (cont || !t || t.startsWith('#')) { if (cont && t) last = i + 1; continue; }   // a continuation line ends what it continues
    const ind = s.length - s.trimStart().length;
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    const inDef = stack.some(x => x.def);
    // a declaration ends at the last line before the next statement at its indentation or less
    for (const d of decls) if (!d.closed && ind <= d.ind) { d.end = Math.max(d.line, last); d.closed = true; }
    if (t.startsWith('@')) { if (deco === null) deco = i + 1; last = i + 1; continue; }
    const m = t.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)/);
    if (m) {
      if (!inDef) decls.push({ name: m[1] || m[2], line: deco || i + 1, ind });
      stack.push({ ind, def: true }); deco = null; last = i + 1; continue;
    }
    deco = null;
    if (/^(if|elif|else|try|except|finally|with|for|while|match|case|async\s+(with|for))\b.*:\s*(#.*)?$/.test(t)) stack.push({ ind, def: false });
    else if (!inDef) { const a = t.match(/^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/); if (a && a[1] !== '__all__' && !consts.has(a[1])) { consts.add(a[1]); decls.push({ name: a[1], line: i + 1, ind, one: true }); } }
    last = i + 1;
  }
  for (const d of decls) if (!d.closed) d.end = Math.max(d.line, last);
  const count = new Map();
  return decls.map(d => { const k = (count.get(d.name) || 0) + 1; count.set(d.name, k); const id = `${p}#${d.name}${k > 1 ? `#${k}` : ''}`; return [d.name, d.line, d.end, id, id.slice(p.length)]; });
}

module.exports = { pythonAdapter, pyRanges, findPython };
