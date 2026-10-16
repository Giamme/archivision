'use strict';
// Reads a repo through adapters and returns the scan contract, version 2 (lib/scan-schema.js): code roots,
// files, symbols, relations between them, entry points, data resources and their uses, tests, and what changed
// between branches, each fact with the adapter that found it and how sure it is. Read-only on the repo.
const fs = require('fs'), path = require('path');
const { rootOf, under } = require('../roots');
const { discover } = require('./discover');
const { tscAdapter } = require('./tsc');
const { nextAdapter } = require('./next');
const { prismaAdapter } = require('./prisma');
const { pythonAdapter } = require('./python');
const { lambdaEntries } = require('./lambda');
const { ripwireAdapter } = require('./ripwire');
const { playwrightAdapter } = require('./playwright');
const { gitSection } = require('./compare');
const { makeGit } = require('./git');

/**
 * @param {string} ROOT  the repo folder
 * @param {{bases?: string, since?: number|string, max?: number|string, compare?: string, src?: string|string[], python?: string|null, ripwire?: string|null}} ARGS
 */
function scanRepo(ROOT, ARGS = {}) {
  const t0 = Date.now();
  const D = discover(ROOT, { src: ARGS.src ? [].concat(ARGS.src).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean) : null });
  const next = nextAdapter(D.appDirs, D.nextRoots);
  const prisma = prismaAdapter(ROOT, D);
  const tsc = tscAdapter(ROOT, D, next, [prisma]);
  const py = pythonAdapter(ROOT, D, { python: ARGS.python });
  // Go: symbols from ripwire's language server, when the user has it (--ripwire, ARCHIVISION_RIPWIRE, the PATH)
  const go = ripwireAdapter(ROOT, D, { ripwire: ARGS.ripwire });
  const hasGo = [...D.src, ...D.tests].some(f => /\.go$/.test(f));
  const pw = playwrightAdapter(D.e2e, D.rel);
  const tN = Date.now(), entries = next.entries(tsc.files, tsc.symbols), nextMs = Date.now() - tN;
  // every language's files and symbols; then the lambdas the manifests name, on any of them
  const files = { ...tsc.files, ...py.files, ...go.files }, symbols = [...tsc.symbols, ...py.symbols, ...go.symbols];
  const tL = Date.now(), lam = lambdaEntries(D.manifests, files, symbols, py.conventional, py.rebound), lamMs = Date.now() - tL;
  entries.push(...lam.entries);
  // a handler is a symbol of kind `handler`, and its file an entry point (unless it is a Next.js route already)
  const symById = new Map(symbols.map(s => [s.id, s]));
  for (const [id, h] of lam.handlers) { const s = symById.get(id); if (!s) continue; if (!s.member) s.kind = 'handler'; if (!files[s.file].entry) files[s.file].entry = { kind: 'lambda', variant: h.variant, route: h.route }; }
  // Python's data uses, named by the environment of the deployments that run them
  const pyData = py.data(lam.deploys);

  // unit tests: the files each test file reaches, from the references the compiler resolved
  const runner = unitRunner(ROOT, D.readJson);
  const symFile = new Map(symbols.map(s => [s.id, s.file]));
  const tests = {};
  for (const [f, F] of Object.entries(tsc.files)) if (F.test) { const own = runnerOf(path.join(ROOT, f)); tests[f] = { runner: own || runner.name, runnerProv: own ? 'its imports' : runner.prov, imports: [], visits: [] }; }
  for (const r of tsc.relations) {
    if (r.rel === 'call') continue;   // the files a test reaches are the ones it imports from (references), as before
    const f = symFile.get(r.from) || r.from, T = tests[f]; if (!T) continue;
    const to = symFile.get(r.to); if (!T.imports.some(x => x.file === to)) T.imports.push({ file: to, line: r.sites[0][0], status: r.status, prov: r.prov });
  }
  // a browser spec the compiler also read keeps the files it reaches, and gains its visits; Python tests as read
  for (const [f, t] of Object.entries(pw.tests)) tests[f] = tests[f] ? { ...t, imports: tests[f].imports } : t;
  Object.assign(tests, py.tests);

  let G = null, git = null;
  try { git = makeGit(ROOT); G = gitSection(git, ARGS, [tsc, py, prisma, go]); } catch { G = null; }   // not a git repo: a map without comparisons
  // the inventory: the tracked files (git ls-files), or, in a folder that is no git repo, every file in it but .git
  // and node_modules, read in name order; a folder that cannot be read is counted, and the walk goes on
  let all = null, from = 'git ls-files', unreadable = 0;
  if (G) try { all = git('ls-files', '-z').split('\0').filter(Boolean); } catch { all = null; }
  if (!all) {
    from = 'the folder'; all = [];
    const walk = d => { let es; try { es = fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); } catch { unreadable++; return; }
      for (const e of es) { if (e.name === 'node_modules' || e.name === '.git') continue; const p = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) walk(p); else if (e.isFile()) all.push(p); } };
    walk('');
  }
  // files outside every root (by extension and top folder), and files in the folders left out inside the roots
  // (build output, dot-folders, node_modules: by extension and reason)
  const allRoots = D.roots.map(r => r.path), outside = { files: 0, byExt: {}, byDir: {}, from, ...(unreadable ? { unreadable } : {}) };
  const folders = { files: 0, byExt: {}, byReason: {} };
  const extOf = p => (p.match(/(\.[^./]+)$/) || [, '(none)'])[1].toLowerCase();
  for (const p of all.sort()) {
    if (rootOf(allRoots, p) !== null) {
      const lo = D.leftOut.find(([d]) => under(d, p)); if (!lo) continue;
      folders.files++; folders.byExt[extOf(p)] = (folders.byExt[extOf(p)] || 0) + 1; folders.byReason[lo[1]] = (folders.byReason[lo[1]] || 0) + 1;
      continue;
    }
    outside.files++;
    const ext = extOf(p), dir = p.includes('/') ? p.slice(0, p.indexOf('/')) : '(repo root)';
    outside.byExt[ext] = (outside.byExt[ext] || 0) + 1; outside.byDir[dir] = (outside.byDir[dir] || 0) + 1;
  }
  D.skipped.outside = outside; D.skipped.folders = folders;
  const out = {
    version: 2,
    repo: { name: path.basename(ROOT), root: ROOT, remote: G ? G.remote : '', sha: G ? G.sha : '', branch: G ? G.branch : '', pushed: G ? G.pushed : false, dirty: G ? G.dirty : 0, scanned: new Date().toISOString() },
    refs: G ? { bases: G.BASES.map(r => r.name), heads: G.HEADS.map(r => ({ name: r.name, label: r.label, t: r.t, current: !!r.current })), all: G.REFS.map(r => r.name) } : { bases: [], heads: [], all: [] },
    roots: D.roots,
    files, symbols, relations: [...tsc.relations, ...py.relations, ...go.relations], entries,
    resources: { ...prisma.resources, ...py.resources }, data: [...prisma.data(), ...pyData],
    tests, compare: G ? G.COMPARE : [],
    skipped: D.skipped,
    unresolved: { [tsc.name]: tsc.unresolved(), [prisma.name]: prisma.unresolved(), [py.name]: py.unresolved(), lambda: lam.why, ...(Object.keys(lam.manifest).length ? { 'lambda-manifest': lam.manifest } : {}), ...(hasGo ? { [go.name]: go.unresolved() } : {}) },
    adapters: [tsc.info(), { name: next.name, version: next.version, files: Object.values(tsc.files).filter(f => f.entry && f.entry.variant === next.name).length, facts: entries.filter(e => e.variant === next.name).length, ms: nextMs }, prisma.info(), pw.info(),
      py.info(), ...(hasGo ? [go.info()] : []), { name: 'lambda', version: '1', files: D.manifests.filter(m => m.kind !== 'python').length, facts: lam.entries.length, ms: lamMs },
      ...(runner.name !== 'unknown' ? [{ name: runner.name, version: runner.version || '', files: Object.values(tests).filter(t => t.runner === runner.name).length, facts: 0, ms: 0 }] : [])],
  };
  const nf = Object.keys(out.files).length, ns = out.symbols.filter(s => !s.member).length;
  out.summary = `${nf} files · ${ns} symbols · ${countRefEdges(out.relations)} calls · ${out.data.length} data calls · ${Object.keys(out.resources).length} data resources${byStore(out.resources)} · ${out.compare.length} branch comparisons${G ? '' : ' (not a git repo)'} · ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  return out;
}

// resources per store, for the summary: « (prisma 12, s3 1)»
const byStore = R => { const n = {}; for (const r of Object.values(R)) n[r.store] = (n[r.store] || 0) + 1; const t = Object.entries(n).map(([k, v]) => `${k} ${v}`).join(', '); return t ? ` (${t})` : ''; };
// the pairs that have at least one reference outside a type position (the "calls" of the summary, as before)
const countRefEdges = rels => new Set(rels.filter(r => r.rel === 'ref').map(r => `${r.from}|${r.to}`)).size;

// the runner a test file imports from, if it says (test files are ones discovery read, inside the repo)
function runnerOf(file) {
  let t = ''; try { t = fs.readFileSync(file, 'utf8'); } catch {}
  return /from\s+['"]vitest['"]/.test(t) ? 'vitest' : /from\s+['"]@jest\/globals['"]/.test(t) ? 'jest' : /from\s+['"]mocha['"]/.test(t) ? 'mocha' : null;
}

// which unit test runner the package declares; package.json is read only when it is inside the repo
function unitRunner(ROOT, readJson) {
  const pkg = readJson(path.join(ROOT, 'package.json')) || {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of ['vitest', 'jest', 'mocha']) if (deps[name]) return { name, version: deps[name], prov: 'package.json' };
  return { name: 'unknown', prov: 'no runner in package.json' };
}

module.exports = { scanRepo };
