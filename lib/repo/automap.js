// Groups a repo into areas, blocks, parts and zones from the code alone, with no language model:
// routes give the blocks, file names and imports attach the rest, Prisma calls give each table an owner,
// and walkthroughs follow real calls from a page down to the database. The result is the map file the
// build reads, so people can rename and regroup by hand and keep their edits.
'use strict';
const fs = require('fs'), path = require('path');
const { facts } = require('./facts');
const ROOTS_ = require('./roots');

/** @param {object} S the result of scanRepo */
function autoMap(S) {
  const X = facts(S), ROOT = X.root, FI = X.files;
  const FILES = X.srcFiles;
  // paths inside their code root: today's rules were written for src/, and read the same in any root
  const depth = p => { const r = X.rootOf(p); return r === null ? 0 : ROOTS_.depthOf(r); };
  const inRoot = X.inRoot;
  const ROOTS = X.codeRoots.map(r => (r === '.' ? 'the repo' : r)).join(', ');
  const shortDir = d => { const r = X.codeRoots.filter(r => r !== '.' && d.startsWith(r + '/')).sort((a, b) => b.length - a.length)[0]; return r ? d.slice(r.length + 1) : d; };   // src/lib -> lib, src stays src
  // a repo of several packages: a package with no app routes is a district of its own, and its files stay in it.
  // A package is known by its package.json name, '.' when the repo has none; its display name is the repo's then
  const PKG = p => FI[p].pkg || '.', MULTI = new Set(FILES.map(PKG)).size > 1;
  const pkgShort = n => String(n).replace(/^@[^/]+\//, '');
  const TXT = {}; const text = p => TXT[p] ?? (TXT[p] = (() => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } })());
  // dictionaries keyed by names from the code have no inherited keys: a word or a symbol may be `constructor`
  const dict = () => Object.create(null);
  const by = (a, f) => a.reduce((o, x) => ((o[f(x)] = o[f(x)] || []).push(x), o), dict());
  const uniq = a => [...new Set(a)];
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
  const nOf = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const list = (a, n) => a.length <= n ? a.join(', ') : `${a.slice(0, n).join(', ')} +${a.length - n}`;
  const NAMES = Object.values(FI).flatMap(f => f.syms.map(s => s.name)).filter(n => !/^[A-Z0-9_]+$/.test(n)).concat(Object.keys(X.models)).join(' ');   // SCREAMING_CASE constants say nothing about how a word is written
  const CASE = dict();
  const upper = w => { const k = w.toLowerCase(); if (k in CASE) return CASE[k]; if (/\d/.test(w) && w.length <= 5) return (CASE[k] = true); if (w.length > 5) return (CASE[k] = false);
    const U = w.toUpperCase(), C = U[0] + k.slice(1), cnt = re => (NAMES.match(re) || []).length;
    return (CASE[k] = cnt(new RegExp(`${U}(?![a-z])`, 'g')) > Math.max(1, cnt(new RegExp(`${C}(?![a-z])`, 'g')))); };
  const human = k => k.split(/[-_/]+/).filter(Boolean).map((w, i) => upper(w) ? w.toUpperCase() : i ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const stem = t => { t = t.toLowerCase(); if (t.length > 4 && /ies$/.test(t)) t = t.slice(0, -3) + 'y'; if (t.length > 4 && /s$/.test(t)) t = t.slice(0, -1); if (t.length > 4 && /[aeio]$/.test(t)) t = t.slice(0, -1); return t; };

  /* ---------- the import graph, file to file ---------- */
  // the import graph: references the code names (a call through an object it never names is no import)
  const val = X.edges.filter(e => !e.type && e.ref && FI[e.f] && !FI[e.f].test);
  const callsOnly = X.edges.filter(e => !e.ref && FI[e.f] && !FI[e.f].test);
  const NB = {}; const addW = (a, b, w) => { if (a === b) return; (NB[a] = NB[a] || {})[b] = (NB[a][b] || 0) + w; };
  for (const e of val) { if (!FILES.includes(e.f) || !FILES.includes(e.t)) continue; const w = Math.min(e.n, 3); addW(e.f, e.t, w); addW(e.t, e.f, w); }
  const PRF = new Set(X.dataUses.map(x => x.f));

  /* ---------- 1. features from the routes in the app folder (src/app) ---------- */
  const isDyn = s => /^\[.*\]$/.test(s);
  const APPS = [...new Set(Object.values(FI).map(f => f.appDir).filter(Boolean))];
  const appOf = p => APPS.find(a => p.startsWith(a + '/')) || null;
  const segsOf = p => p.slice(appOf(p).length + 1).split('/').slice(0, -1).filter(s => !/^\(.*\)$/.test(s) && !s.startsWith('@') && !s.startsWith('_'));
  const routeInfo = p => {
    const segs = segsOf(p), api = segs[0] === 'api', rest = api ? segs.slice(1) : segs;
    const area = api ? 'api' : isDyn(rest[0] || '') ? rest[0] : null;
    return { api, area, st: rest.filter(s => !isDyn(s)) };
  };
  const APP = FILES.filter(p => appOf(p));
  // packages with no app routes (pages, layouts, route handlers in an app folder): in a repo of several, each is a
  // district of its own; a repo with no routes at all is one such package; either way its blocks come from its
  // folders (below), not from features. Routes, not an app/ folder, decide: a library may have an app/ folder of
  // helpers, and a Lambda handler is no route of an app
  const LIBPKG = new Set(FILES.map(PKG).filter(k => !FILES.some(p => PKG(p) === k && FI[p].rkind && FI[p].appDir)));
  const pkgName = k => (k === '.' ? S.repo.name : k);
  const ownPkg = p => LIBPKG.has(PKG(p));   // a file of a package that is a district of its own
  const GENERIC = new Set('src lib app actions action service services utils util index types type helpers helper client server api hooks hook use components component ui page pages route routes shared common core data config constants context contexts providers provider store model models schema schemas new get set create update delete list manager handler handlers tsx ts the and for with from to of'.split(' '));
  const tokens = p => p.replace(/\.([cm]?[jt]sx?|py)$/, '').split('/').slice(depth(p) + 1).flatMap(s => s.split(/[-_.]|(?<=[a-z])(?=[A-Z])/)).map(t => t.toLowerCase()).filter(t => t.length >= 2 && !GENERIC.has(t));
  // a feature that grows big and has sub-routes splits into them; the attachment then runs again with the new keys
  const SPLIT = new Set();
  const appKey = p => { const r = routeInfo(p); if (!r.st.length) return r.api ? 'api' : 'home'; let k = r.st[0], i = 1; while (SPLIT.has(k) && r.st[i]) k += '/' + r.st[i++]; return k; };
  let FEAT = {};
  function attach() {
    FEAT = {}; for (const p of APP) FEAT[p] = appKey(p); for (const p of FILES) if (ownPkg(p)) FEAT[p] = `pkg:${PKG(p)}`;
    const keyStem = dict();
    for (const k of uniq(Object.values(FEAT)).filter(k => !k.startsWith('pkg:'))) { const last = k.split('/').pop(); for (const x of [stem(last), ...last.split('-').filter(w => w.length > 3).map(stem)]) if (!(x in keyStem) || k.split('/').length > keyStem[x].split('/').length) keyStem[x] = k; }
    const cands = p => { const t = tokens(p), o = []; for (let i = 0; i < t.length; i++) for (const x of [i + 1 < t.length ? stem(`${t[i]}-${t[i + 1]}`) : null, stem(t[i])]) if (x && keyStem[x] && !o.includes(keyStem[x])) o.push(keyStem[x]); return o; };
    const score = p => { const o = dict(); for (const [q, w] of Object.entries(NB[p] || {})) if (FEAT[q] && !FEAT[q].startsWith('pkg:')) o[FEAT[q]] = (o[FEAT[q]] || 0) + w; return o; };
    for (let round = 0; round < 8; round++) {
      let changed = 0;
      for (const p of FILES) {
        if (appOf(p) || ownPkg(p)) continue;
        const c = cands(p), sc = score(p), tot = Object.values(sc).reduce((a, b) => a + b, 0);
        let pick = null;
        if (c.length) pick = c.slice().sort((a, b) => (sc[b] || 0) - (sc[a] || 0) || b.split('/').length - a.split('/').length)[0];
        else if (tot) { const [f, w] = Object.entries(sc).sort((a, b) => b[1] - a[1])[0]; if (w >= 2 && w / tot >= .5) pick = f; }
        if (pick && FEAT[p] !== pick) { FEAT[p] = pick; changed++; }
      }
      if (!changed) break;
    }
    for (const p of FILES) if (!FEAT[p]) FEAT[p] = 'shared';
  }
  for (let pass = 0; pass < 4; pass++) {
    attach();
    const sz = by(FILES, p => FEAT[p]);
    const big = Object.keys(sz).filter(k => k !== 'shared' && !k.startsWith('pkg:') && !k.includes('/') && sz[k].length > 60 && !SPLIT.has(k)).filter(k => {
      const d = k.split('/').length, kids = by(APP.filter(p => FEAT[p] === k), p => routeInfo(p).st[d] || '');
      return Object.entries(kids).filter(([c, x]) => c && x.length >= 2).length >= 2; });
    if (!big.length) break;
    big.forEach(k => SPLIT.add(k));
  }
  const FAREA = dict();
  for (const p of APP) { const r = routeInfo(p), k = FEAT[p]; if (!k || k === 'shared') continue; const area = r.api ? 'api' : [r.area, k.includes('/') ? k.split('/')[0] : null].filter(Boolean).join('/') || 'top'; const v = (FAREA[k] = FAREA[k] || dict()); v[area] = (v[area] || 0) + 1; }

  /* ---------- 3. small features join their strongest neighbour; at most 22 ---------- */
  const sizeOf = () => by(FILES, p => FEAT[p]);
  const link = k => { const o = dict(); for (const p of FILES.filter(p => FEAT[p] === k)) for (const [q, w] of Object.entries(NB[p] || {})) if (FEAT[q] !== k && FEAT[q] !== 'shared' && !FEAT[q].startsWith('pkg:')) o[FEAT[q]] = (o[FEAT[q]] || 0) + w; return Object.entries(o).sort((a, b) => b[1] - a[1])[0]; };
  for (let guard = 0; guard < 200; guard++) {
    const sz = sizeOf(), ks = Object.keys(sz).filter(k => k !== 'shared' && !k.startsWith('pkg:')).sort((a, b) => sz[a].length - sz[b].length);
    const k = ks.find(k => sz[k].length < 4) || (ks.length > 22 ? ks[0] : null); if (!k) break;
    const par = k.includes('/') ? k.split('/')[0] : null, sib = par && ks.filter(x => x !== k && x.startsWith(par + '/')).sort((a, b) => sz[b].length - sz[a].length)[0];
    const to = link(k), dest = par && sz[par] ? par : to && (!par || to[0].startsWith(par + '/') || to[0] === par) ? to[0] : sib || (to ? to[0] : 'shared');
    for (const p of sz[k]) FEAT[p] = dest;
    if (FAREA[k] && !FAREA[dest]) FAREA[dest] = FAREA[k];
  }
  /* ---------- grouping without routes: a package's folders ---------- */
  // in a package with no app routes, each folder in its root with 3 files or more is a block; files at the root and
  // in smaller folders stay in the package's own block; a block of more than 40 files splits by its sub-folders when
  // at least two of them hold 4 files or more; at most 16 folder blocks per package, the smallest merging back.
  // A folder block's key holds the folder's path in the repo, so two roots' utils/ stay two blocks
  for (const k of LIBPKG) {
    const base = `pkg:${k}`, mine = FILES.filter(p => FEAT[p] === base);
    const folderOf = (p, n) => { const s = inRoot(p).split('/'); return s.length > n ? ROOTS_.join(X.rootOf(p), s.slice(0, n).join('/')) : null; };
    const place = (list, n, key) => {
      const g = by(list.filter(p => folderOf(p, n)), p => folderOf(p, n));
      for (const [d, fs_] of Object.entries(g)) {
        if (fs_.length < (n === 1 ? 3 : 4)) continue;
        const kk = `${base}:${d}`; for (const p of fs_) FEAT[p] = kk;
        const subs = Object.values(by(fs_.filter(p => folderOf(p, n + 1)), p => folderOf(p, n + 1))).filter(x => x.length >= 4);
        if (fs_.length > 40 && subs.length >= 2 && n < 3) place(fs_, n + 1, kk);
      }
    };
    place(mine, 1, base);
    const blocksOf = () => Object.entries(by(mine, p => FEAT[p])).filter(([kk]) => kk !== base).sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1));
    for (let bs = blocksOf(); bs.length > 16; bs = blocksOf()) for (const p of bs[0][1]) FEAT[p] = base;
  }
  // shared code: big folders become blocks of their own
  { const sh = FILES.filter(p => FEAT[p] === 'shared'), g = by(sh, p => { const d = depth(p), n = p.split('/').length; return p.split('/').slice(d, n > d + 2 ? d + 2 : d + 1).join('/'); });
    Object.entries(g).filter(([, fs_]) => fs_.length >= 12).sort((a, b) => b[1].length - a[1].length).slice(0, 4).forEach(([k, fs_]) => { for (const p of fs_) FEAT[p] = `shared:${k}`; }); }

  /* ---------- 4. parts by what the files are, zones in the order things happen ---------- */
  // Python imports of model SDKs and of clients for other services
  const PYMODEL = /^\s*(?:import|from)\s+(openai|anthropic|google\.generativeai|google\.genai|langchain\w*|vertexai)\b/m;
  const PYEXT = /^\s*(?:import|from)\s+(requests|httpx|aiohttp|urllib3|urllib\.request|smtplib|stripe|boto3|botocore)\b/m;
  const kindOf = p => {
    const F = FI[p], t = text(p);
    if (F.rkind === 'route') return 'endpoint';
    if (F.rkind === 'lambda') return 'handler';
    if (F.server || F.middleware) return 'gate';
    if (F.rkind) return 'page';
    if (F.client || /\.(tsx|jsx)$/.test(p) || F.syms.some(s => s.kind === 'component') || /^(components|hooks|contexts|providers)\//.test(inRoot(p))) return 'ui';
    if (/from ['"](openai|@anthropic-ai\/sdk|ai|@ai-sdk\/[^'"]+|@google\/generative-ai)['"]/.test(t) || PYMODEL.test(t)) return 'model';
    if (PRF.has(p)) return 'store';
    if (/\bfetch\(|from ['"](axios|nodemailer|@aws-sdk\/[^'"]+|stripe|resend|undici|got|ky)['"]/.test(t) || PYEXT.test(t)) return 'external';
    if (/^(config|constants)\//.test(inRoot(p)) || F.syms.every(s => ['const', 'type', 'enum'].includes(s.kind))) return 'config';
    return 'process';
  };
  const PK = {
    page: ['Pages', 'ui', 'Screens'], ui: ['Components', 'ui', 'Screens'], gate: ['Server actions', 'gate', 'Entry points'], endpoint: ['API routes', 'endpoint', 'Entry points'], handler: ['Handlers', 'endpoint', 'Entry points'],
    process: ['Logic', 'process', 'Logic'], config: ['Config', 'config', 'Logic'], store: ['Data access', 'store', 'Data'], external: ['Outside calls', 'external', 'Outside services'], model: ['AI calls', 'model', 'Outside services'],
  };
  const ZORDER = ['Screens', 'Entry points', 'Logic', 'Data', 'Outside services'];
  const ZTIP = { Screens: 'Pages and components the user sees.', 'Entry points': 'Server actions and API routes: where requests come in.', Logic: 'Functions that decide and compute.', Data: 'Code that reads and writes the database.', 'Outside services': 'Calls to other services and models.' };
  // Lambda handlers come in with events too; stores that are not all databases are data stores
  if (FILES.some(p => FI[p].rkind === 'lambda')) ZTIP['Entry points'] = 'Server actions, API routes and Lambda handlers: where requests and events come in.';
  if (!X.storeWords.db) ZTIP.Data = 'Code that reads and writes the data stores.';
  const dirOf = p => p.split('/').slice(0, -1).join('/');
  const common = ps => { if (!ps.length) return ''; let c = dirOf(ps[0]).split('/'); for (const p of ps) { const d = dirOf(p).split('/'); let i = 0; while (i < c.length && c[i] === d[i]) i++; c = c.slice(0, i); } return c.join('/'); };
  // glob list that reproduces exactly this set of files: whole folders where they belong only here, single files otherwise
  function globs(ps) {
    const mine = new Set(ps), out = [], done = new Set();
    const dirs = uniq(ps.flatMap(p => { const d = p.split('/'), o = []; for (let i = depth(p) + 1; i < d.length; i++) o.push(d.slice(0, i).join('/')); return o; })).sort((a, b) => a.split('/').length - b.split('/').length);
    for (const d of dirs) {
      if ([...done].some(x => d.startsWith(x + '/'))) continue;
      const all = FILES.filter(f => f.startsWith(d + '/'));
      if (all.length >= 2 && all.every(f => mine.has(f))) { out.push(d + '/**'); done.add(d); }
    }
    for (const p of ps) if (![...done].some(d => p.startsWith(d + '/'))) out.push(p);
    return out;
  }
  // a Lambda handler by the name its deployment gives it, else by its own name
  const LNAME = dict(); for (const e of X.entries) if (e.kind === 'lambda' && e.name && !LNAME[`${e.file}#${e.sym}`]) LNAME[`${e.file}#${e.sym}`] = e.name;
  const symsOf = (ps, kinds) => ps.flatMap(p => FI[p].syms.filter(s => kinds.includes(s.kind) && (s.exported || ['page', 'handler', 'lambda'].includes(s.kind))).map(s => s.kind === 'page' ? (FI[p].route || '/') : s.kind === 'handler' ? `${s.name} ${FI[p].route}` : s.kind === 'lambda' ? LNAME[`${p}#${s.name}`] || s.name : s.name));
  const dbOf = ps => { const c = X.dataUses.filter(x => ps.includes(x.f)); return { w: uniq(c.filter(x => x.w).map(x => x.m)), r: uniq(c.filter(x => x.r && !x.w).map(x => x.m)) }; };

  const FK = by(FILES, p => FEAT[p]);
  const blocks = [];
  for (const [key, ps] of Object.entries(FK)) {
    const groups = by(ps, kindOf), parts = [];
    for (const [k, fs_] of Object.entries(groups)) {
      const [nm, kind, zone] = PK[k];
      // a big group splits by the folder that tells its files apart
      const base = common(fs_), sub = by(fs_, p => { const r = dirOf(p).slice(base.length).split('/').filter(x => x && !/^\(.*\)$/.test(x) && !isDyn(x) && !GENERIC.has(x) && !x.startsWith('@')); return r[0] || ''; });
      const subs = Object.entries(sub).sort((a, b) => b[1].length - a[1].length);
      if (fs_.length > 16 && subs.length > 1) {
        const top = subs.filter(([s, x]) => s && x.length >= 4).slice(0, 3), rest = subs.filter(x => !top.includes(x)).flatMap(x => x[1]);
        for (const [s, x] of top) parts.push({ nm: `${nm} · ${human(s.replace(/^\[|\]$/g, ''))}`, kind, zone, files: x, k });
        if (rest.length) parts.push({ nm: top.length ? `${nm} · other` : nm, kind, zone, files: rest, k });
      } else parts.push({ nm, kind, zone, files: fs_, k });
    }
    // at most 9 parts: the smallest ones in the same zone merge
    while (parts.length > 9) {
      parts.sort((a, b) => a.files.length - b.files.length);
      const a = parts[0], b = parts.slice(1).find(x => x.zone === a.zone) || parts[1];
      b.files.push(...a.files); if (b.zone !== a.zone || b.kind !== a.kind) b.nm = b.zone === a.zone ? b.zone : `${b.nm} and more`; parts.splice(0, 1);
    }
    const ids = new Set();
    const P = parts.sort((a, b) => ZORDER.indexOf(a.zone) - ZORDER.indexOf(b.zone) || b.files.length - a.files.length).map(x => {
      let id = slug(x.nm); while (ids.has(id)) id += '-2'; ids.add(id);
      const d = dbOf(x.files), cd = common(x.files);
      const sy = x.k === 'page' ? symsOf(x.files, ['page']) : x.k === 'endpoint' ? symsOf(x.files, ['handler']) : x.k === 'handler' ? symsOf(x.files, ['lambda']) : x.k === 'gate' ? symsOf(x.files, ['action']) : symsOf(x.files, ['function', 'class', 'component', 'hook']);
      const tip = [sy.length ? `${x.k === 'page' ? 'Pages' : x.k === 'endpoint' ? 'Handles' : x.k === 'handler' ? 'Handlers' : x.k === 'gate' ? 'Actions' : 'Exports'}: ${list(sy, 4)}.` : '', d.w.length ? `Writes ${list(d.w, 4)}.` : '', d.r.length ? `Reads ${list(d.r, 4)}.` : ''].filter(Boolean).join(' ');
      return { id, name: x.nm, kind: x.kind, what: `${x.files.length} file${x.files.length === 1 ? '' : 's'}${cd ? ` in ${shortDir(cd)}` : ''}`, tip: tip || `${x.files.length} files.`, globs: globs(x.files), zone: x.zone, files: x.files };
    });
    blocks.push({ key, files: ps, parts: P });
  }

  /* ---------- 5. names, areas and words, all from facts ---------- */
  const areaOf = key => { if (key.startsWith('pkg:')) { const i = key.indexOf(':', 4); return i > 0 ? key.slice(0, i) : key; } if (key.startsWith('shared')) return 'shared'; const v = FAREA[key]; if (!v) return 'shared'; return Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]; };
  const blockOfFile = {}; for (const b of blocks) for (const p of b.files) blockOfFile[p] = b;
  // a folder block's folder (its path in the repo), and a package district's package
  const folderOfKey = k => (k.startsWith('pkg:') && k.indexOf(':', 4) > 0 ? k.slice(k.indexOf(':', 4) + 1) : k.startsWith('shared:') ? k.slice(7) : null);
  const pkgOfArea = a => (a.startsWith('pkg:') ? a.slice(4) : null);
  const ids = new Set();
  for (const b of blocks) {
    const k = b.key, folder = k.startsWith('pkg:') ? folderOfKey(k) : null;
    const last = k.startsWith('shared:') ? k.slice(7).split('/').pop() : folder ? folder.split('/').pop() : k.startsWith('pkg:') ? pkgShort(pkgName(k.slice(4))) : k.split('/').pop();
    // ids read like the key, with a folder block's folder inside its root and the repo's own package by the repo's
    // name, and are unique: two keys can slug alike (foo-bar/ and foo_bar/, two roots' utils/), and the second one
    // gets -2, then -3
    const idKey = k.startsWith('pkg:') ? `pkg:${pkgName(k.slice(4).split(':')[0])}${folder ? `:${inRoot(folder)}` : ''}` : k.replace(/^shared:/, 'shared-');
    const id0 = slug(idKey); let id = id0, n = 1; while (ids.has(id)) id = `${id0}-${++n}`; ids.add(id);
    b.id = id; b.area = areaOf(k);
    b.name = k === 'shared' ? 'Shared core' : k === 'home' ? 'Home' : human(last);
    const routes = uniq(b.files.filter(p => FI[p].rkind === 'page').map(p => FI[p].route)).sort();
    const pre = routes.length ? routes.reduce((a, r) => { let i = 0; const x = a.split('/'), y = r.split('/'); while (i < x.length && x[i] === y[i]) i++; return x.slice(0, i).join('/'); }) : '';
    const d = dbOf(b.files), cnt = k2 => b.files.filter(p => kindOf(p) === k2).length;
    const callers = dict(); for (const e of val) { const a = blockOfFile[e.f], t = blockOfFile[e.t]; if (a && t && a !== b && t === b) callers[a.key] = (callers[a.key] || 0) + 1; }
    const topC = Object.entries(callers).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([kk]) => blocks.find(x => x.key === kk));
    b.role = [nOf(routes.length, 'page'), nOf(cnt('gate'), 'server-action file'), nOf(cnt('endpoint'), 'API route'), nOf(cnt('handler'), 'handler file')].filter(s => !s.startsWith('0 ')).join(' · ') || (folder ? `${b.files.length} files in ${shortDir(common(b.files)) || folder}` : k.startsWith('pkg:') ? `package ${pkgName(k.slice(4))} · ${b.files.length} files` : `${b.files.length} files of shared code`);
    b.tip = [routes.length ? `Pages under ${pre || '/'}${routes.length > 1 ? '' : ''} (${routes.length}).` : `Code in ${shortDir(common(b.files)) || ROOTS}.`,
      d.w.length ? `Writes ${list(d.w, 3)}.` : d.r.length ? `Reads ${list(d.r, 3)}.` : '',
      topC.length ? `Used most by ${topC.map(x => x.name || human(x.key)).join(', ')}.` : ''].filter(Boolean).join(' ');
  }
  // names must not repeat. Blocks of one name are told apart by what differs between them, in this order: their area
  // (a package's short name, «shared», the pages they serve), their parent folder, their package's full name, then
  // the folders above; a level where they all agree is skipped, and a level splits them into smaller groups that the
  // next levels tell apart. A block says the last qualifier that set it apart (none when it had none), and a name
  // that still repeats gets a number
  const quals = b => { const f = folderOfKey(b.key), segs = f ? f.split('/').slice(0, -1) : [], pk = pkgOfArea(b.area), up = i => (segs.length > i ? segs.slice(segs.length - 1 - i).join('/') : '');
    return [b.area === 'shared' ? 'shared' : pk !== null ? pkgShort(pkgName(pk)) : b.area.replace(/^\[|\]$/g, ''), up(0), pk !== null ? pkgName(pk) : '', ...segs.slice(1).map((_, i) => up(i + 1))]; };
  const tell = (bs, level, last) => {
    const Q = bs.map(quals);
    if (bs.length === 1 || level >= Math.max(...Q.map(q => q.length))) { if (last) for (const b of bs) b.name = `${b.name} (${last})`; return; }
    const parts = by(bs, b => quals(b)[level] || '');
    if (Object.keys(parts).length === 1) return tell(bs, level + 1, last);
    for (const [k, g] of Object.entries(parts)) tell(g, level + 1, k || last);
  };
  for (const bs of Object.values(by(blocks, b => b.name))) if (bs.length > 1) tell(bs, 0, '');
  for (const bs of Object.values(by(blocks, b => b.name))) bs.slice(1).forEach((b, i) => { b.name = `${b.name} ${i + 2}`; });
  // in a repo of several packages, the app's shared code says whose it is
  const appPkgs = uniq(APP.map(PKG)), sharedOf = MULTI && appPkgs.length === 1 ? ` (${appPkgs[0]})` : '';
  const AREA_NAME = a => a.startsWith('pkg:') ? `Package ${pkgName(a.slice(4))}` : a === 'shared' ? `Shared code${sharedOf}` : a === 'api' ? 'API only' : a === 'top' ? 'Top-level pages' : `Pages under /${a}`;
  const isPkg = a => a.startsWith('pkg:');
  const areas = uniq(blocks.map(b => b.area)).sort((a, b) => (a === 'shared') - (b === 'shared') || (a === 'api') - (b === 'api') || isPkg(a) - isPkg(b) || blocks.filter(x => x.area === b).length - blocks.filter(x => x.area === a).length);
  // where a package's code is: its code roots
  const pkgDir = a => { const rs = X.coverage.roots.filter(x => x.role === 'code' && (x.pkg || '.') === a.slice(4)).map(x => (x.path === '.' ? 'the repo' : x.path)); return rs.length ? rs.join(', ') : a.slice(4); };
  const AREA_ID = dict(); for (const a of areas) { const id0 = slug(`area-${isPkg(a) ? `pkg-${pkgName(a.slice(4))}` : a}`); let id = id0, n = 1; while (Object.values(AREA_ID).includes(id)) id = `${id0}-${++n}`; AREA_ID[a] = id; }
  const layers = areas.map(a => ({ id: AREA_ID[a], name: AREA_NAME(a), blurb: `${blocks.filter(b => b.area === a).length} blocks`, tip: isPkg(a) ? `The code of the package ${pkgName(a.slice(4))}, in ${pkgDir(a)}.` : a === 'shared' ? 'Code that no single feature owns: UI kit, utilities, auth and clients used across the app.' : a === 'api' ? 'Features that only have API routes.' : `Features whose pages live under ${a === 'top' ? '/' : '/' + a}.` }));

  /* ---------- 6. tables: each model belongs to the block that writes it most ---------- */
  // what the groups hold: tables (Prisma models too), else the stores' word for them (buckets, queues, resources)
  const TW = X.stores.every(s => s === 'prisma') ? 'tables' : X.storeWords.what, TW1 = TW.replace(/s$/, ''), MW = X.storeWords.what[0].toUpperCase() + X.storeWords.what.slice(1);
  const MODELS = Object.keys(X.models), REL = dict();
  for (const m of MODELS) REL[m] = X.models[m].rel;
  const own = dict();
  for (const x of X.dataUses) { const b = blockOfFile[x.f]; if (!b) continue; const o = (own[x.m] = own[x.m] || dict()); o[b.id] = (o[b.id] || 0) + (x.w ? 2 : 0) + (x.r ? 1 : 0); }
  const OWN = dict(); for (const m of MODELS) if (own[m]) OWN[m] = Object.entries(own[m]).sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < 4; i++) for (const m of MODELS) if (!OWN[m]) { const v = by(REL[m].filter(r => OWN[r]), r => OWN[r]), best = Object.entries(v).sort((a, b) => b[1].length - a[1].length)[0]; if (best) OWN[m] = best[0]; }
  let G = Object.entries(by(MODELS, m => OWN[m] || 'unused')).map(([o, ms]) => ({ o, ms }));
  while (G.length > 16) { G.sort((a, b) => a.ms.length - b.ms.length); const a = G.shift(); let t = G.find(g => g.o === 'other'); if (!t) { t = { o: 'other', ms: [] }; G.push(t); } t.ms.push(...a.ms); }
  const dbGroups = G.sort((a, b) => b.ms.length - a.ms.length).map(g => { const b = blocks.find(x => x.id === g.o);
    return { id: slug(g.o), name: b ? b.name : g.o === 'unused' ? `Not used in ${ROOTS}` : `Other ${TW}`, tip: b ? `${TW[0].toUpperCase() + TW.slice(1)} written or read mostly by «${b.name}».` : g.o === 'unused' ? `${MW} no code in ${ROOTS} reads or writes.` : `Smaller groups of ${TW}, merged.`, models: g.ms }; });

  /* ---------- 7. walkthroughs: from a page (or an API route), follow real calls down to the database ---------- */
  const SYM = {}; for (const p of FILES) for (const s of FI[p].syms) SYM[`${p}#${s.name}`] = { p, s };
  // exact references only, and exact calls between the top-level symbols of one file
  const OUT = by([...val, ...callsOnly, ...X.sameFile.filter(e => FILES.includes(e.f))].filter(e => e.fs && e.status === 'exact' && SYM[`${e.t}#${e.ts}`]), e => `${e.f}#${e.fs}`);
  const DB = by(X.dataUses.filter(x => x.fs), x => `${x.f}#${x.fs}`);
  const PRI = { action: 6, handler: 5, lambda: 5, function: 3, class: 3, hook: 2, component: 1 };
  const memo = new Map();
  function best(k, depth, seen) {
    if (DB[k]) return { path: [k], sc: DB[k].some(x => x.w) ? 4 : 2 };
    if (!depth) return null;
    const mk = k + '|' + depth; if (memo.has(mk)) return memo.get(mk);
    let top = null;
    const VERB = n => /^(create|submit|save|send|start|upload|connect|update|add|generate|run|import|verify|confirm|complete|approve|request|register|handle)/i.test(n) ? 2 : /^(delete|remove|reset|clear)/i.test(n) ? -3 : 0;
    const nx = uniq((OUT[k] || []).map(e => `${e.t}#${e.ts}`)).filter(n => !seen.has(n) && PRI[SYM[n].s.kind]).sort((a, b) => PRI[SYM[b].s.kind] + VERB(SYM[b].s.name) - PRI[SYM[a].s.kind] - VERB(SYM[a].s.name)).slice(0, 8);
    for (const n of nx) { seen.add(n); const r = best(n, depth - 1, seen); seen.delete(n); if (r && (!top || r.sc + 1 > top.sc)) top = { path: [k, ...r.path], sc: r.sc + 1 + (blockOfFile[SYM[k].p] !== blockOfFile[SYM[n].p] ? 1.5 : 0) }; }
    memo.set(mk, top); return top;
  }
  const partOf = p => { const b = blockOfFile[p]; return b && b.parts.find(x => x.files.includes(p)); };
  // how one step reaches the next: it calls it (renders a component), or only uses it (passes it on, reads a value)
  const hop = (a, b) => { const e = (OUT[a] || []).find(x => `${x.t}#${x.ts}` === b); return !e || !e.call ? 'uses' : SYM[b].s.kind === 'component' ? 'renders' : 'calls'; };
  const KL = { page: 'The page', component: 'Component', hook: 'Hook', action: 'Server action', handler: 'API route', lambda: 'Lambda handler', function: 'Function', class: 'Class' };
  const tours = [];
  // walkthroughs start from entry points: pages when a repo has at least three, else every kind (route handlers,
  // server actions, middleware, and lambdas, jobs, commands and events where an adapter finds them)
  // (layouts are no entry a walkthrough starts from); by kind, then in file order, then in source order
  const ENTRY = ['page', 'route', 'action', 'middleware', 'lambda', 'job', 'cli', 'event'], FIX = new Map(FILES.map((p, i) => [p, i]));
  const lineOf = e => SYM[`${e.file}#${e.sym}`].s.line;
  const seen = new Set(), entrySeeds = X.entries.filter(e => ENTRY.includes(e.kind) && FILES.includes(e.file) && SYM[`${e.file}#${e.sym}`])
    .sort((a, b) => ENTRY.indexOf(a.kind) - ENTRY.indexOf(b.kind) || FIX.get(a.file) - FIX.get(b.file) || lineOf(a) - lineOf(b))
    .filter(e => { const k = `${e.file}#${e.sym}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const pageSeeds = entrySeeds.filter(e => e.kind === 'page');
  const ENTRY_WORD = { page: 'the page', route: 'the API route', action: 'the server action', middleware: 'the middleware', lambda: 'the Lambda function', job: 'the job', cli: 'the command', event: 'the event handler' };
  // a Lambda function, job or event by the name its deployment gives it, else by its handler and file
  const label = e => e.kind === 'page' ? e.route : e.kind === 'route' ? `${e.method} ${e.route}` : e.kind === 'middleware' ? `middleware ${e.sym}` : e.name || (e.kind === 'lambda' ? `${e.sym} (${e.file.split('/').pop()})` : e.sym);
  for (const e of pageSeeds.length >= 3 ? pageSeeds : entrySeeds) {
    const p = e.file, s = SYM[`${p}#${e.sym}`].s;
    const r = best(`${p}#${s.name}`, 6, new Set([`${p}#${s.name}`])); if (!r || r.path.length < (s.kind === 'page' ? 3 : 2)) continue;
    const kinds = r.path.map(k => SYM[k].s.kind), endName = SYM[r.path[r.path.length - 1]].s.name;
    const sc = r.sc + (kinds.some(k => k === 'action' || k === 'handler' || k === 'lambda') ? 2 : 0) + (/^(create|submit|save|send|start|upload|connect|update|add|generate|run|import|verify|confirm|complete|approve|request|register)/i.test(endName) ? 2 : 0) - (/^(delete|remove|reset|clear)/i.test(endName) || kinds.some((k, i) => i && /^(delete|remove)/i.test(SYM[r.path[i]].s.name)) ? 6 : /^(get|list|load|fetch|read|find)/i.test(endName) ? 1 : 0);
    tours.push({ r, sc, route: label(e), page: e.kind === 'page', api: e.kind === 'route', word: ENTRY_WORD[e.kind] || 'the entry point', b: blockOfFile[p] });
  }
  const journeys = [], usedB = new Set();
  const usedM = new Set();
  for (const t of tours.sort((a, b) => b.sc - a.sc || b.r.path.length - a.r.path.length)) {
    const endM = uniq((DB[t.r.path[t.r.path.length - 1]] || []).map(x => x.m)).join();
    if (usedB.has(t.b.id) || usedM.has(endM) || journeys.length >= 6) continue; usedB.add(t.b.id); usedM.add(endM);
    const ks = t.r.path, lastDb = DB[ks[ks.length - 1]] || [], w = uniq(lastDb.filter(x => x.w).map(x => x.m)), rd = uniq(lastDb.filter(x => !x.w).map(x => x.m));
    const allCalls = ks.slice(1).every((k, i) => hop(ks[i], k) !== 'uses');
    journeys.push({ name: `${t.route} → ${(w[0] || rd[0] || SYM[ks[ks.length - 1]].s.name)}`, group: t.b.name, caption: `Follows the ${allCalls ? 'calls' : 'calls and references'} from ${t.word} ${t.route} to the code that ${w.length ? `writes ${list(w, 3)}` : `reads ${list(rd, 3)}`}.`,
      steps: ks.map((k, i) => { const { p, s } = SYM[k], b = blockOfFile[p], pt = partOf(p), nx = ks[i + 1] && SYM[ks[i + 1]], v = nx ? hop(k, ks[i + 1]) : '';
        const note = i === 0 && t.page ? `The page ${FI[p].route} renders${nx ? (v === 'renders' ? ` ${nx.s.name}` : ` and ${v} ${nx.s.name}`) : ''}.` : i === 0 && !DB[k] && t.api ? `The API route ${t.route} receives the request${nx ? ` and ${v} ${nx.s.name}` : ''}.` : `${KL[s.kind] || 'Function'} ${s.name}${nx ? ` ${v} ${nx.s.name}` : ''}${DB[k] ? `${nx ? ', and' : ''} ${w.length && i === ks.length - 1 ? `writes ${list(w, 3)}` : `reads ${list(uniq(DB[k].map(x => x.m)), 3)}`}` : ''}.`;
        return { module: b.id, part: pt ? pt.id : null, symbol: s.name, file: p, note }; }) });
  }

  /* ---------- write the map ---------- */
  const map = {
    generator: 'automap', generated: new Date().toISOString(), commit: S.repo.sha,
    intro: `${S.repo.name}: ${FILES.length} files grouped by their routes, names and imports, with no AI. Open a block to see its parts in the order requests flow, then a part to reach its functions and files.`,
    layers,
    modules: areas.flatMap(a => blocks.filter(b => b.area === a).sort((x, y) => y.files.length - x.files.length)).map(b => ({
      id: b.id, layer: AREA_ID[b.area], name: b.name, short: b.name.length <= 14 ? b.name : b.name.split(' ')[0].slice(0, 14), role: b.role, tip: b.tip,
      zones: ZORDER.map(z => ({ name: z, tip: ZTIP[z], parts: b.parts.filter(p => p.zone === z).map(p => p.id) })).filter(z => z.parts.length),
      parts: b.parts.map(({ files, zone, ...p }) => p) })),
    dbGroups, journeys,
  };
  map.summary = `${map.modules.length} blocks in ${layers.length} areas · ${map.modules.reduce((a, m) => a + m.parts.length, 0)} parts · ${dbGroups.length} ${TW1} groups · ${journeys.length} walkthroughs`;
  return map;
}

module.exports = { autoMap };
