'use strict';
// Finds the packages and code roots of a repo and their files, and counts what it leaves out and why.
// Roots, most specific first: --src when given; else each workspace package (package.json `workspaces`,
// pnpm-workspace.yaml, else apps/* and packages/*) gives its src/ or, without one, its own folder; the repo gives
// src/, or, with no src/ and no packages, the whole repo. tests/, test/ and e2e/ next to a package are test roots.
// A file belongs to the most specific root that holds it. A folder holding a package.json with a name is a package;
// one without a name (`{"type": "commonjs"}`) only sets how its files load. Deployment manifests (serverless.yml,
// SAM templates, Dockerfiles that run a Python handler) found outside every code root make their folder a code root
// and a package of its own (named after the service), with the test folders next to it.
const fs = require('fs'), path = require('path');
const { rootOf, join, under } = require('../roots');
const M = require('./manifests');

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, PY = /\.py$/, GO = /\.go$/;
const DECL = /\.d\.[cm]?ts$/;
// build output and assets next to a package's code: never read when a whole package folder is a root
const OUTPUT = new Set(['dist', 'build', 'out', 'coverage', 'public', 'static', 'storybook-static', 'vendor', 'tmp']);
const TESTS = [['tests', 'test'], ['test', 'test'], ['__tests__', 'test'], ['browser-tests', 'test'], ['e2e', 'e2e']];
const MIN = /\.min\.[cm]?js$/;
// whether a file is one archivision reads
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readable = name => (CODE.test(name) || PY.test(name) || GO.test(name)) && !DECL.test(name) && !MIN.test(name);
// the languages read before Go: a src/ holding only Go never becomes the root of a repo with code in them
const readableOld = name => (CODE.test(name) || PY.test(name)) && !DECL.test(name) && !MIN.test(name);
// a root that is a package's src/ (or the repo's) reads every folder in it; a whole package folder leaves out its
// build output and its tool configs
const isSrc = r => r === 'src' || r.endsWith('/src');

function discover(ROOT, opts = {}) {
  const rel = f => path.relative(ROOT, f).split(path.sep).join('/') || '.';
  const abs = r => (r === '.' ? ROOT : path.join(ROOT, r));
  const realRoot = fs.realpathSync(ROOT);
  const skipped = { byExt: {}, byRoot: {}, reasons: {} };
  // folders left out inside the roots, with why: the files in them are counted from the inventory (scan/index.js)
  const leftOut = [];
  const skip = (root, reason, file, dir) => {
    skipped.reasons[reason] = (skipped.reasons[reason] || 0) + 1;
    skipped.byRoot[root] = (skipped.byRoot[root] || 0) + 1;
    if (file) { const ext = path.extname(file).toLowerCase() || '(none)'; skipped.byExt[ext] = (skipped.byExt[ext] || 0) + 1; }
    if (dir) leftOut.push([dir, reason]);
  };
  // whether a path's real location is inside the repo (a symlink may lead out of it); cached, the compiler asks often
  const seen = new Map();
  const inside = p => { if (seen.has(p)) return seen.get(p); let ok; try { const r = fs.realpathSync(p); ok = r === realRoot || r.startsWith(realRoot + path.sep); } catch { ok = true; } seen.set(p, ok); return ok; };
  const isDir = p => { try { return fs.statSync(p).isDirectory() && inside(p); } catch { return false; } };
  const readJson = p => { try { return inside(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } };
  // sorted, so the order of files (and of everything read from them) does not depend on the file system
  const entries = d => { try { return fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); } catch { return []; } };

  /* ---------- packages ---------- */
  const pj = readJson(path.join(ROOT, 'package.json'));
  const globs = [];
  if (pj && Array.isArray(pj.workspaces)) globs.push(...pj.workspaces);
  else if (pj && pj.workspaces && Array.isArray(pj.workspaces.packages)) globs.push(...pj.workspaces.packages);
  try {   // pnpm-workspace.yaml: the `packages:` list, read as plain lines
    const y = path.join(ROOT, 'pnpm-workspace.yaml');
    if (fs.existsSync(y) && inside(y)) { let on = false; for (const l of fs.readFileSync(y, 'utf8').split('\n')) { if (/^packages\s*:/.test(l)) { on = true; continue; } if (on && /^\S/.test(l)) on = false; const m = on && l.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/); if (m) globs.push(m[1]); } }
  } catch {}
  const clean = g => g.replace(/^\.\//, '').replace(/\/+$/, '');
  const globRe = g => new RegExp('^' + clean(g).split('/').map(s => s === '**' ? '(?:.+)' : s.replace(/[.+^$()|[\]\\{}]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('/') + '$');
  const use = globs.length ? globs : ['apps/*', 'packages/*'];
  const posG = use.filter(g => !g.startsWith('!')), negG = use.filter(g => g.startsWith('!')).map(g => g.slice(1));
  const hasPj = d => { const f = path.join(abs(d), 'package.json'); return fs.existsSync(f) && inside(f); };
  // folders under the repo that hold a package.json, not in node_modules, dot-folders or build output: as deep as the
  // workspace patterns reach (a literal path is checked directly; `**` reaches 8 levels), and at least 4 deep
  const pkgDirs = new Set(posG.filter(g => !/[*?[{]/.test(g) && clean(g) && hasPj(clean(g))).map(clean));
  const reach = Math.max(4, ...posG.filter(g => /[*?[{]/.test(g)).map(g => (g.includes('**') ? 8 : clean(g).split('/').length)));
  (function walkPkgs(d, depth) {
    for (const e of entries(d)) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.') || OUTPUT.has(e.name)) continue;
      const p = path.join(d, e.name); if (!inside(p)) continue;
      if (hasPj(rel(p))) pkgDirs.add(rel(p));
      if (depth < reach) walkPkgs(p, depth + 1);
    }
  })(ROOT, 1);
  const pos = posG.map(globRe), neg = negG.map(globRe);
  const nameOf = d => { const j = readJson(path.join(abs(d), 'package.json')); return j && typeof j.name === 'string' && j.name ? j.name : null; };
  const packages = [...pkgDirs].sort().filter(d => pos.some(r => r.test(d)) && !neg.some(r => r.test(d))).map(dir => ({ dir, name: nameOf(dir) || dir, found: globs.length ? 'workspaces' : 'apps/*, packages/*' }));
  // the package of a folder: a workspace package, or any folder whose package.json has a name
  const PKG = new Map([['.', (pj && pj.name) || null], ...[...pkgDirs].sort().filter(d => nameOf(d)).map(d => [d, nameOf(d)]), ...packages.map(p => [p.dir, p.name])]);
  // the package a path is in: the nearest folder above it with a package.json
  const pkgOf = r => { let d = r; while (true) { d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '.'; if (PKG.has(d)) return PKG.get(d); if (d === '.') return null; } };

  /* ---------- deployment manifests and Python package files ---------- */
  // found anywhere in the repo (not in node_modules, dot-folders or build output), read as text, never run
  const manifests = [];
  // a file a serverless.yml includes (${file(./functions.yml)}): relative to its folder, inside the repo by its real
  // path, a regular file of at most 1 MiB; else why not
  const includeFrom = dir => p => {
    if (path.isAbsolute(p) || /^~/.test(p)) return { why: 'an included file outside the repo' };
    const a = path.resolve(abs(dir), p);
    if (rel(a).startsWith('..')) return { why: 'an included file outside the repo' };
    let st; try { st = fs.statSync(a); } catch { return { why: 'an included file not found' }; }
    if (!st.isFile()) return { why: 'an included file that is not a regular file' };
    let real; try { real = fs.realpathSync(a); } catch { return { why: 'an included file not found' }; }
    if (!(real === realRoot || real.startsWith(realRoot + path.sep))) return { why: 'an included file outside the repo' };
    if (st.size > 1024 * 1024) return { why: 'an included file over 1 MiB' };
    try { return { text: fs.readFileSync(a, 'utf8'), file: rel(a) }; } catch { return { why: 'an included file that could not be read' }; }
  };
  (function walkManifests(d, depth) {
    for (const e of entries(d)) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 8 && e.name !== 'node_modules' && !e.name.startsWith('.') && !OUTPUT.has(e.name) && inside(p)) walkManifests(p, depth + 1); continue; }
      const r = rel(p), kind = M.kindOf(r); if (!kind || !e.isFile() || !inside(p)) continue;
      let text = ''; try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      const dir = r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '.';
      let data = null;
      try { data = kind === 'serverless' ? M.readServerless(text, includeFrom(dir)) : kind === 'sam' ? M.readSam(text) : kind === 'docker' ? M.readDockerfile(text) : { text }; }
      catch { data = kind === 'serverless' || kind === 'sam' ? { service: null, runtime: null, environment: {}, functions: [], problems: [{ line: 0, why: 'a manifest that could not be read' }] } : null; }
      if (data) manifests.push({ file: r, dir, kind, data });
    }
  })(ROOT, 1);
  const hasPy = d => { const stack = [abs(d)]; while (stack.length) { const x = stack.pop(); for (const e of entries(x)) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = path.join(x, e.name); if (e.isDirectory()) { if (inside(p)) stack.push(p); } else if (PY.test(e.name)) return true; } } return false; };
  // folders a deployment runs Python from: a serverless service or SAM template holding Python, a Docker build
  // context whose CMD names a module next to it; and the package folders a pyproject.toml, setup.cfg or setup.py names
  const pyDeploy = [], pyPkgdirs = [];
  for (const m of manifests) {
    if ((m.kind === 'serverless' || m.kind === 'sam') && hasPy(m.dir)) pyDeploy.push(m.dir);
    else if (m.kind === 'docker' && m.data.handler && fs.existsSync(path.join(abs(m.dir), m.data.handler.value.replace(/\.[^.]+$/, '').replace(/\./g, '/') + '.py'))) pyDeploy.push(m.dir);
    else if (m.kind === 'python') {
      // a src layout: `where = ["src"]` (pyproject), `package_dir = {"": "src"}` (setup.py), `package_dir =\n  =src` (setup.cfg)
      const t = m.data.text, src = /\bwhere\s*=\s*\[?\s*["']src["']/.test(t) || /package[-_]dir\s*=[^\n]*["']src["']/.test(t) || /package_dir\s*=\s*\n\s*=\s*src\b/.test(t);
      pyPkgdirs.push(src && isDir(abs(join(m.dir, 'src'))) ? join(m.dir, 'src') : m.dir);
    }
  }
  const serviceOf = d => { const m = manifests.find(x => x.dir === d && (x.kind === 'serverless' || x.kind === 'sam') && x.data.service); return m ? m.data.service : d === '.' ? null : d.split('/').pop(); };

  /* ---------- roots ---------- */
  const roots = [];
  const addRoot = (p, role, found) => { if (!roots.some(r => r.path === p)) roots.push({ path: p, role, pkg: p === '.' ? PKG.get('.') : PKG.has(p) ? PKG.get(p) : pkgOf(p), found }); };
  // whether a folder holds a file the walk below would read, by the same rules (a src/ of only images or minified
  // scripts has none, and the package folder is the root instead)
  const hasCode = (r, can = readable) => { const top = abs(r), stack = [top]; while (stack.length) { const x = stack.pop(); for (const e of entries(x)) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = path.join(x, e.name), atTop = x === top && !isSrc(r);
    if (e.isDirectory()) { if (inside(p) && !(atTop && OUTPUT.has(e.name))) stack.push(p); } else if (can(e.name) && !(atTop && /\.config\.[cm]?[jt]s$/.test(e.name))) return true; } } return false; };
  if (opts.src && opts.src.length) {
    for (const s of opts.src) {
      const a = path.resolve(ROOT, s), r = rel(a);
      if (r.startsWith('..') || !isDir(a)) throw new Error(`--src ${s}: not a folder inside ${ROOT}`);
      addRoot(r, 'code', '--src');
    }
  } else {
    const can = hasCode('.', readableOld) ? readableOld : readable;
    for (const p of packages) addRoot(isDir(abs(`${p.dir}/src`)) && hasCode(`${p.dir}/src`, can) ? `${p.dir}/src` : p.dir, 'code', 'auto');
    if (isDir(abs('src')) && hasCode('src', can)) addRoot('src', 'code', 'auto');
    else if (!packages.length) addRoot('.', 'code', 'auto');
  }
  // a deployment folder outside every code root is one, and a package of its own (named after its service)
  const byManifest = [];
  if (!(opts.src && opts.src.length)) for (const d of [...new Set(pyDeploy)].sort()) {
    if (rootOf(roots.filter(r => r.role === 'code').map(r => r.path), d === '.' ? 'x' : `${d}/x`) !== null) continue;
    if (!PKG.has(d)) PKG.set(d, serviceOf(d));
    addRoot(d, 'code', 'manifest'); byManifest.push(d);
  }
  // test folders: next to the repo and each package, and inside and next to each deployment folder (service/tests for service/lambda)
  const up = d => (d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '.'), near = new Set([...byManifest, ...byManifest.map(up)].filter(d => d !== '.'));
  for (const base of ['.', ...packages.map(p => p.dir), ...near]) for (const [d, role] of TESTS) { const p = join(base, d); if (isDir(abs(p)) && !roots.some(r => r.path === p)) addRoot(p, role, near.has(base) ? 'manifest' : 'auto'); }
  // a root whose real location leaves the repo is not read
  for (const r of roots.slice()) if (!inside(abs(r.path))) { skip(r.path, 'symlink leaving the repo'); roots.splice(roots.indexOf(r), 1); }
  const ROOTS = roots.map(r => r.path);
  const roleOf = p => { const r = rootOf(ROOTS, p); return r === null ? null : roots.find(x => x.path === r).role; };
  // Next.js: a code root uses it when a package.json at or above it depends on next, a next.config sits there, or its
  // app/ folder has the root layout every App Router app has; only then is app/ an app folder and middleware.ts one
  const nextAt = d => { const j = readJson(path.join(abs(d), 'package.json')), deps = j ? { ...j.dependencies, ...j.devDependencies, ...j.peerDependencies } : {};
    return !!deps.next || ['js', 'mjs', 'cjs', 'ts', 'mts'].some(e => fs.existsSync(path.join(abs(d), `next.config.${e}`))); };
  const ups = p => { const o = [p]; while (p !== '.') { p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.'; o.push(p); } return o; };
  const layout = a => ['tsx', 'jsx', 'ts', 'js'].some(e => fs.existsSync(path.join(abs(a), `layout.${e}`)));
  const nextRoots = roots.filter(r => r.role === 'code' && (ups(r.path).some(nextAt) || layout(join(r.path, 'app')))).map(r => r.path);
  const appDirs = nextRoots.map(r => join(r, 'app')).filter(a => isDir(abs(a)));
  const inApp = p => appDirs.some(a => under(a, p));

  /* ---------- files ---------- */
  // every folder is read once, by its real path: folders first, then the ones a symlink leads to (one that leads to a
  // folder already read, or above itself, adds nothing; the loop a/x -> .. ends there)
  const walked = new Set(), later = [];
  const realOf = p => { try { return fs.realpathSync(p); } catch { return null; } };
  const walk = (root, d, out, link = false) => {
    const real = realOf(d);
    if (!real || walked.has(real)) { if (link) skip(root.path, 'a folder already read, through a symlink', null, rel(d)); return out; }
    walked.add(real);
    for (const e of entries(d)) {
      const p = path.join(d, e.name), r = rel(p);
      if (e.name === 'node_modules') { skip(root.path, 'node_modules', null, r); continue; }
      if (e.name.startsWith('.') && !(e.name === '.well-known' && e.isDirectory() && inApp(r))) { if (e.isDirectory()) skip(root.path, 'dot-folder', null, r); else skip(root.path, 'dot-file', e.name); continue; }
      if (e.isSymbolicLink() && !inside(p)) { skip(root.path, 'symlink leaving the repo'); continue; }
      const dir = e.isDirectory() || (e.isSymbolicLink() && isDir(p));
      if (dir) {
        if (ROOTS.includes(r)) continue;                                    // another root: it reads its own files
        if (path.dirname(p) === abs(root.path) && !isSrc(root.path) && OUTPUT.has(e.name)) { skip(root.path, 'build output or assets', null, r); continue; }
        if (e.isSymbolicLink()) later.push([root, p, out]); else walk(root, p, out);
      } else if (path.dirname(p) === abs(root.path) && !isSrc(root.path) && /\.config\.[cm]?[jt]s$/.test(e.name)) skip(root.path, 'tool configuration', e.name);
      else if (readable(e.name) && !isFile(p)) skip(root.path, 'not a regular file', e.name);   // a FIFO or a device would block the read
      else if (readable(e.name)) out.push(p);
      else skip(root.path, DECL.test(e.name) ? 'type declarations (.d.ts)' : MIN.test(e.name) ? 'minified' : 'not a language archivision reads yet', e.name);
    }
    return out;
  };
  const files = {};
  for (const r of roots) files[r.path] = walk(r, abs(r.path), []);
  while (later.length) { const [root, p, out] = later.shift(); walk(root, p, out, true); }
  const by = role => roots.filter(r => r.role === role).flatMap(r => files[r.path]);
  const SRC = by('code');
  if (!SRC.length) throw new Error(`no code archivision reads (.ts, .tsx, .js, .jsx, .mjs, .cjs, .py, .go) under ${roots.filter(r => r.role === 'code').map(r => r.path).join(', ') || 'any code root'} in ${ROOT}`);

  // the tsconfig.json (or jsconfig.json) nearest above a file, inside the repo
  const CFG = new Map();
  const configOf = f => {
    let d = path.dirname(f); const chain = [];
    while (true) {
      if (CFG.has(d)) { const c = CFG.get(d); for (const x of chain) CFG.set(x, c); return c; }
      chain.push(d);
      const hit = ['tsconfig.json', 'jsconfig.json'].map(n => path.join(d, n)).find(x => fs.existsSync(x) && inside(x));
      if (hit || d === ROOT || !d.startsWith(ROOT)) { const c = hit || null; for (const x of chain) CFG.set(x, c); return c; }
      d = path.dirname(d);
    }
  };
  return { roots, packages, src: SRC, tests: by('test'), e2e: by('e2e'), pkg: PKG.get('.'), pkgOf, roleOf, configOf, appDirs, nextRoots, skipped, leftOut, rel, inside, readJson,
    manifests, pyDeploy: [...new Set(pyDeploy)], pyPkgdirs: [...new Set(pyPkgdirs)] };
}

module.exports = { discover, CODE, PY };
