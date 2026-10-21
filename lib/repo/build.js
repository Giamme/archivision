'use strict';
// Joins a grouping (the map: blocks, parts, globs, words, written by automap, by hand or by an LLM) with the parser's
// facts (scan: files, symbols, references, Prisma calls, tests, branch changes) into the page data,
// and checks every code anchor before it ships.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { plate, cells, orderLayers } = require('../layout');
const { facts } = require('./facts');
// why Go files were not read, as the page and the error say it
const GO_NOT = [['no-ripwire', 'ripwire was not found: give it with --ripwire or ARCHIVISION_RIPWIRE'], ['ripwire-version', 'ripwire is not at an allowed version'], ['ripwire-failed', 'ripwire failed'], ['ripwire-error', 'ripwire could not read them'], ['ripwire-too-many', 'too many symbols in ripwire\'s answer'], ['unreadable', 'they could not be read'], ['too-large', 'over 2 MiB'], ['over-budget', 'over the 256 MiB the Go files may take together']];

function buildRepo(plan, S) {
  const X = facts(S), FI = X.files;
  // a warning about the map naming what the code no longer has is also «stale», which `archivision repo --check` fails on
  const WARN = [], STALE = [], warn = (s, stale) => { WARN.push(s); if (stale) STALE.push(s); };
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
  const uniq = a => [...new Set(a)];
  // dictionaries keyed by names from the code have no inherited keys: a symbol may be called `toString`
  const dict = () => Object.create(null);
  const by = (a, f) => a.reduce((o, x) => ((o[f(x)] = o[f(x)] || []).push(x), o), dict());
  
  /* ---------- globs ---------- */
  const reEsc = s => s.replace(/[.+^$()|[\]\\]/g, '\\$&');
  function globRe(g) {
    let re = '', i = 0;
    while (i < g.length) {
      const c = g[i];
      if (c === '*' && g[i + 1] === '*') { i += 2; if (g[i] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; continue; }
      if (c === '*') { re += '[^/]*'; i++; continue; }
      if (c === '?') { re += '[^/]'; i++; continue; }
      if (c === '{') { const j = g.indexOf('}', i); re += '(?:' + g.slice(i + 1, j).split(',').map(x => reEsc(x).replace(/\\\*|\*/g, '[^/]*')).join('|') + ')'; i = j + 1; continue; }
      re += reEsc(c); i++;
    }
    return new RegExp('^' + re + '$');
  }
  const SRCFILES = X.srcFiles;
  const FP = {};                 // file -> part key
  const PARTS = {};              // part key -> { m, p, files: [] }
  const MODS = plan.modules.filter(m => m.id !== 'unsorted' || m.parts.length);
  for (const m of MODS) for (const p of m.parts) PARTS[`${m.id}/${p.id}`] = { m, p, files: [], globHits: {} };
  const matchers = [];
  for (const m of MODS) for (const p of m.parts) for (const g of p.globs || []) {
    const plain = !/[*?{]/.test(g) && !/\.\w+$/.test(g);
    matchers.push({ key: `${m.id}/${p.id}`, g, re: globRe(plain ? g.replace(/\/$/, '') + '/**' : g) });
  }
  for (const f of SRCFILES) {
    const hit = matchers.find(x => x.re.test(f));
    if (hit) { FP[f] = hit.key; PARTS[hit.key].globHits[hit.g] = (PARTS[hit.key].globHits[hit.g] || 0) + 1; }
  }
  for (const x of matchers) if (!PARTS[x.key].globHits[x.g] && !Object.keys(FI).some(f => x.re.test(f))) warn(`glob matches nothing: ${x.key} ${x.g}`, true);
  // files no glob claimed: the part that owns most files in the nearest folder takes them
  const unplaced = SRCFILES.filter(f => !FP[f]);
  for (const f of unplaced) {
    let dir = f.split('/').slice(0, -1);
    while (dir.length >= 2) {
      const pre = dir.join('/') + '/', own = by(SRCFILES.filter(x => FP[x] && x.startsWith(pre)), x => FP[x]);
      const best = Object.entries(own).sort((a, b) => b[1].length - a[1].length)[0];
      if (best) { FP[f] = best[0]; break; }
      dir.pop();
    }
  }
  const stillOut = SRCFILES.filter(f => !FP[f]);
  for (const f of SRCFILES) if (FP[f]) PARTS[FP[f]].files.push(f);
  for (const k in PARTS) if (!PARTS[k].files.length) warn(`part has no files: ${k}`, true);
  
  /* ---------- symbols, references, data ---------- */
  const symOf = (p, name) => X.syms(p).find(s => s.name === name) || null;
  const MP = f => FP[f] ? FP[f].split('/')[0] : null;
  const val = X.edges.filter(e => !e.type && FI[e.f] && !FI[e.f].test);
  const inn = by(val, e => `${e.t}#${e.ts}`), outE = by(val, e => `${e.f}#${e.fs}`);
  // calls between the top-level symbols of one file: they never cross a part, but a piece shows them
  const sf = X.sameFile.filter(e => FI[e.f] && !FI[e.f].test), sfIn = by(sf, e => `${e.t}#${e.ts}`), sfOut = by(sf, e => `${e.f}#${e.fs}`);
  const outAll = k => [...(outE[k] || []), ...(sfOut[k] || [])];
  // where a link to an edge points: the first call when it calls (with its column), else the first reference; and
  // what to look for there
  const siteOf = e => e.call ? [e.callLine, 'call', e.callee, e.callCol] : [e.line, 'ref', e.ts, null];
  // «calls a, b» for edges that call, «uses X» for ones that only use a value (a constant, a function passed on)
  const verbs = (es, k) => {
    const names = l => Object.entries(by(l, e => e.ts)).sort((x, y) => y[1].length - x[1].length).map(x => x[0]);
    const all = names(es), called = new Set(names(es.filter(e => e.call))), head = all.slice(0, k);
    const c = head.filter(x => called.has(x)), u = head.filter(x => !called.has(x));
    return [c.length ? `calls ${c.join(', ')}` : '', u.length ? `uses ${u.join(', ')}` : ''].filter(Boolean).join(' · ') + (all.length > k ? ` +${all.length - k}` : '');
  };
  const prismaBy = by(X.dataUses, x => `${x.f}#${x.fs}`);
  // a data use of a store other than Prisma carries its store and the resource's own name, for its link
  const resOf = x => (x.store !== 'prisma' ? [x.store, X.models[x.m].name] : []);
  // a cable or a set of sites is exact only when every fact under it is
  // a file a hand-written map names is read only when it really is inside the repo
  const insideRepo = p => { try { const root = fs.realpathSync(S.repo.root), r = fs.realpathSync(path.resolve(S.repo.root, String(p))); return r.startsWith(root + path.sep); } catch { return false; } };
  const statusOf = es => (['unresolved', 'ambiguous', 'inferred'].find(s => es.some(e => e.status === s)) || 'exact');
  const rw = list => { const r = list.some(x => x.r), w = list.some(x => x.w); return r && w ? 'rw' : w ? 'w' : 'r'; };
  const lines = f => FI[f].lines;
  const routeRe = r => new RegExp('^' + r.split('/').map(s => /^\[\[?\.\.\./.test(s) ? '.*' : /^\[.*\]$/.test(s) ? '[^/]+' : reEsc(s)).join('/') + '/?$');
  
  /* ---------- DB groups (the rail and its ports) ---------- */
  const allModels = Object.keys(X.models), seenM = new Set();
  const groups = (plan.dbGroups || []).map((g, i) => ({ n: i + 1, id: g.id || slug(g.name), name: g.name, tip: g.tip,
    models: (g.models || []).filter(m => { if (!X.models[m]) { warn(`unknown model in ${g.id}: ${m}`, true); return false; } if (seenM.has(m)) { warn(`model twice: ${m}`); return false; } seenM.add(m); return true; }) }));
  const miss = allModels.filter(m => !seenM.has(m));
  if (miss.length) { warn(`models in no group, added to «Other»: ${miss.join(', ')}`); groups.push({ n: groups.length + 1, id: 'other', name: 'Other', tip: 'Models not placed in a group.', models: miss }); }
  const GM = dict(); for (const g of groups) for (const m of g.models) GM[m] = g;
  for (const g of groups) {
    const calls = X.dataUses.filter(x => GM[x.m] === g && FP[x.f]);
    g.users = Object.entries(by(calls, x => MP(x.f))).map(([m, l]) => [m, l.length, rw(l)]).sort((a, b) => b[1] - a[1]);
    g.modelsInfo = g.models.map(m => [m, X.models[m].line, X.models[m].end, X.models[m].fields, X.models[m].file, ...(X.models[m].store !== 'prisma' ? [X.models[m].store, X.models[m].name] : [])]);
  }
  
  /* ---------- parts, pieces and the cables inside each block ---------- */
  const PIECE_OF = {};            // file#sym -> piece node id
  // a cable's site: [file, line, from symbol, to symbol, to file, its first and last line, status, provenance, call|ref, the name called there, its column]
  const cableSite = e => { const t = symOf(e.t, e.ts) || {}, [l, k, nm, col] = siteOf(e); return [e.f, l, e.fs, e.ts, e.t, t.line || 0, t.end || 0, e.status, e.prov, k, nm, col]; };
  const modules = [];
  for (const m of MODS) {
    const zones = (m.zones || []).map(z => ({ ...z, parts: (z.parts || []).filter(id => m.parts.some(p => p.id === id)) })).filter(z => z.parts.length);
    const inZone = new Set(zones.flatMap(z => z.parts)), loose = m.parts.filter(p => !inZone.has(p.id)).map(p => p.id);
    if (loose.length) { warn(`parts outside any zone in ${m.id}: ${loose.join(', ')}`); zones.push({ name: 'Other', tip: 'Parts not placed in a zone.', parts: loose }); }
    const parts = m.parts.filter(p => PARTS[`${m.id}/${p.id}`].files.length).map(p => {
      const key = `${m.id}/${p.id}`, P = PARTS[key], files = P.files;
      const cand = [];
      for (const f of files) for (const s of X.syms(f)) {
        const KP = X.lang(f).score;
        if (s.kind === 'type' || !(s.exported || ['page', 'layout', 'handler', 'lambda'].includes(s.kind))) continue;
        const callers = [...(inn[`${f}#${s.name}`] || []), ...(sfIn[`${f}#${s.name}`] || [])], fan = uniq(callers.filter(e => FP[e.f] !== key).map(e => e.f)).length;
        if (s.kind === 'const' && fan < 2) continue;
        const db = prismaBy[`${f}#${s.name}`] || [];
        cand.push({ f, s, callers, fan, db, score: KP[s.kind] + 1.6 * Math.log2(1 + fan) + (db.length ? .8 : 0) });
      }
      cand.sort((a, b) => b.score - a.score || a.f.localeCompare(b.f) || a.s.line - b.s.line);
      const pick = cand.slice(0, 8), used = new Set();
      const children = pick.map(({ f, s, callers, db }) => {
        const F = FI[f], { kind: KIND3, label: KL } = X.lang(f);
        // a Lambda handler by the name its deployment gives it (its own name says what it is)
        const dep = s.kind === 'lambda' ? (X.entries.find(e => e.kind === 'lambda' && e.file === f && e.sym === s.name && e.name) || {}).name : null;
        let name = s.kind === 'page' ? (F.route || '/') : s.kind === 'layout' ? `layout ${F.route || '/'}` : s.kind === 'handler' ? `${s.name} ${F.route}` : dep || s.name;
        if (name === 'default') name = f.split('/').pop().replace(/\.[cm]?[jt]sx?$/, '');
        let id = slug(name); while (used.has(id)) id += '-2'; used.add(id);
        const nid = `${key}/${id}`; PIECE_OF[`${f}#${s.name}`] = nid;
        const outs = outAll(`${f}#${s.name}`), calls = outs.filter(e => e.call), uses = outs.filter(e => !e.call);
        const toSym = e => { const t = symOf(e.t, e.ts) || {}; return [e.ts, e.t, t.line || 1, e.status, e.prov, t.end || 0]; };
        return { id, name, tag: name, kind: KIND3[s.kind] || 'process', sk: s.kind,
          what: `${KL[s.kind]}${dep && dep !== s.name ? ` ${s.name}` : ''} · ${f.split('/').pop()}:${s.line}`,
          tip: s.doc || (s.sig ? `${s.name === name ? name : s.name}${s.sig}` : `${KL[s.kind]} in ${f}`),
          code: { p: f, l: s.line, e: s.end, sym: s.name, sig: s.sig, doc: s.doc,
            callers: callers.slice().sort((a, b) => b.n - a.n).slice(0, 8).map(e => { const [l, k, nm, col] = siteOf(e); return [e.f, l, e.fs, e.status, e.prov, k, nm, col]; }), nCallers: callers.length,
            calls: calls.slice().sort((a, b) => b.n - a.n).slice(0, 8).map(toSym), nCalls: calls.length,
            uses: uses.slice().sort((a, b) => b.n - a.n).slice(0, 8).map(toSym), nUses: uses.length,
            db: Object.entries(by(db, x => x.m)).map(([mm, l]) => [mm, rw(l), l[0].line, ...resOf(l[0])]) } };
      });
      // calls between the pieces of this part
      const plinks = [];
      for (const c of pick) for (const e of outAll(`${c.f}#${c.s.name}`)) {
        const a = PIECE_OF[`${c.f}#${c.s.name}`], b = PIECE_OF[`${e.t}#${e.ts}`];
        if (b && b !== a && b.startsWith(key + '/')) plinks.push({ from: a.split('/').pop(), to: b.split('/').pop(), label: `${e.call ? 'calls' : 'uses'} ${e.ts}`, status: e.status });
      }
      // tests: unit test files that import this part, browser specs that visit its pages
      const vt = uniq(X.testImports.filter(x => FP[x.t] === key).map(x => x.f)).sort();
      const routes = uniq(files.filter(f => FI[f].rkind === 'page').map(f => FI[f].route)).map(routeRe);
      const pw = Object.entries(X.visits).filter(([, us]) => us.some(u => routes.some(r => r.test(u)))).map(([f]) => f).sort();
      const dbc = files.flatMap(f => X.dataUses.filter(x => x.f === f));
      const counts = by(files.flatMap(f => X.syms(f).filter(s => s.exported || ['page', 'layout', 'handler', 'lambda'].includes(s.kind))), s => s.kind);
      return { id: p.id, name: p.name, tag: p.name, kind: p.kind, what: p.what, tip: p.tip, children, links: plinks,
        code: { files: files.map(f => [f, lines(f)]), nLines: files.reduce((a, f) => a + lines(f), 0),
          counts: Object.fromEntries(['page', 'action', 'handler', 'lambda', 'component', 'hook', 'function'].filter(k => k !== 'lambda' || counts[k]).map(k => [k, (counts[k] || []).length])),
          vitest: vt, e2e: pw, db: Object.entries(by(dbc, x => x.m)).map(([mm, l]) => [mm, rw(l), GM[mm] ? GM[mm].n : 0]).sort((a, b) => a[0].localeCompare(b[0])) } };
    });
    // cables between parts of this block
    const pl = dict();
    for (const e of val) {
      const a = FP[e.f], b = FP[e.t]; if (!a || !b || a === b || a.split('/')[0] !== m.id || b.split('/')[0] !== m.id) continue;
      const k = `${a}|${b}`; (pl[k] = pl[k] || []).push(e);
    }
    const links = Object.entries(pl).map(([k, es]) => { const [a, b] = k.split('|');
      return { from: a.split('/')[1], to: b.split('/')[1], n: es.length, label: verbs(es, 2), status: statusOf(es),
        sites: es.slice().sort((x, y) => y.n - x.n).slice(0, 8).map(cableSite) }; })
      .sort((x, y) => y.n - x.n).slice(0, 12).filter(l => parts.some(p => p.id === l.from) && parts.some(p => p.id === l.to));
    const nFiles = parts.reduce((a, p) => a + p.code.files.length, 0), nLines = parts.reduce((a, p) => a + p.code.nLines, 0);
    const mod = { id: m.id, layer: m.layer, name: m.name, short: m.short || m.name, role: m.role, tip: m.tip,
      count: `${nFiles} files · ${nLines.toLocaleString('en-US')} lines`, disp: `${nFiles} files · ${parts.length} parts`, zones: zones.map(z => ({ name: z.name, tip: z.tip, parts: z.parts.filter(id => parts.some(p => p.id === id)) })).filter(z => z.parts.length),
      parts, links };
    if (!parts.length) { warn(`block has no files: ${m.id}`, true); continue; }
    cells(mod); modules.push(mod);
  }
  
  /* ---------- connections between blocks ---------- */
  // a site of a cable: where, from which symbol, to which symbol and its span, how sure, and what the link checks for
  const fl = dict();
  for (const e of val) { const a = MP(e.f), b = MP(e.t); if (!a || !b || a === b) continue; (fl[`${a}|${b}`] = fl[`${a}|${b}`] || []).push(e); }
  let flows = Object.entries(fl).map(([k, es]) => {
    const [a, b] = k.split('|'), syms = Object.entries(by(es, e => e.ts)).sort((x, y) => y[1].length - x[1].length).map(x => x[0]);
    const kc = by(es, e => (symOf(e.t, e.ts) || {}).kind || 'x'), top = Object.entries(kc).sort((x, y) => y[1].length - x[1].length)[0][0];
    const verb = !es.some(e => e.call) ? 'uses' : kc.action && kc.action.length * 3 >= es.length ? 'calls actions' : kc.handler ? 'calls API' : top === 'component' ? 'renders' : 'uses';
    return { from: a, to: b, n: es.length, kind: verb, label: `${syms.slice(0, 3).join(', ')}${syms.length > 3 ? ` +${syms.length - 3}` : ''}`, status: statusOf(es),
      sites: es.slice().sort((x, y) => y.n - x.n).slice(0, 10).map(cableSite) };
  });
  const keepF = new Set();
  for (const m of modules) flows.filter(f => f.from === m.id).sort((a, b) => b.n - a.n).slice(0, 5).forEach(f => keepF.add(f));
  flows = flows.filter(f => keepF.has(f) || f.n >= 8).sort((a, b) => b.n - a.n);
  for (const m of modules) for (const g of groups) { const u = g.users.find(x => x[0] === m.id); if (u)
    flows.push({ from: m.id, to: 'dock', ports: [g.n], n: u[1], kind: u[2] === 'rw' ? 'reads, writes' : u[2] === 'w' ? 'writes' : 'reads', label: `${g.name}: ${uniq(X.dataUses.filter(x => GM[x.m] === g && MP(x.f) === m.id).map(x => x.m)).slice(0, 4).join(', ')}` }); }
  
  /* ---------- journeys: code walkthroughs, every step checked against the parse ---------- */
  const journeys = (plan.journeys || []).map(j => {
    const steps = [], notes = [], code = []; let unfound = 0;
    for (const s of j.steps || []) {
      const m = modules.find(x => x.id === s.module); if (!m) { warn(`journey «${j.name}»: unknown module ${s.module}`, true); continue; }
      let part = m.parts.find(p => p.id === s.part); if (!part) warn(`journey «${j.name}»: unknown part ${s.module}/${s.part}`, true);
      let f = s.file, sym = symOf(f, s.symbol);
      if (!sym && part) for (const ff of part.code.files.map(x => x[0])) { sym = symOf(ff, s.symbol); if (sym) { f = ff; break; } }
      if (!sym) { const all = Object.keys(FI).filter(ff => symOf(ff, s.symbol)); if (all.length === 1) { f = all[0]; sym = symOf(f, s.symbol); } }
      if (!sym && s.file) {   // a method of a class or a member of an object, as the scan read it
        const mm = X.member(s.file, s.symbol);
        if (mm) { f = s.file; sym = { name: s.symbol, line: mm.line, end: mm.end, member: true }; }
      }
      if (!sym && s.file && insideRepo(s.file) && fs.existsSync(path.join(S.repo.root, s.file))) {   // anything else named so in the file (a local function): its first line
        const L = fs.readFileSync(path.join(S.repo.root, s.file), 'utf8').split('\n'), re = new RegExp(`(^|[\\s.])(async\\s+)?${String(s.symbol).replace(/[^\w$]/g, '')}\\s*(\\(|:|=|<)`);
        const i = L.findIndex(l => re.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/\bawait\b|\breturn\b/.test(l));
        if (i >= 0) { f = s.file; sym = { name: s.symbol, line: i + 1, end: i + 1, member: true }; }
      }
      if (!sym) warn(`journey «${j.name}»: symbol not found ${s.symbol} in ${s.file}`, true);
      if (!sym && s.symbol) unfound++;
      if (sym && FP[f] && (!part || FP[f] !== `${m.id}/${part.id}`)) { const k = FP[f]; if (k.split('/')[0] === m.id) part = m.parts.find(p => p.id === k.split('/')[1]) || part; }
      steps.push(m.id); notes.push(s.note || '');
      code.push(sym ? { p: f, l: sym.line, e: sym.end, sym: sym.name, sel: part ? `${m.id}/${part.id}` : null, pc: PIECE_OF[`${f}#${sym.name}`] || null } : (part ? { sel: `${m.id}/${part.id}` } : null));
      // a step that writes or reads the database lights the rail port it goes through
      const db = sym && !sym.member ? prismaBy[`${f}#${sym.name}`] || [] : [];
      if (db.length) {
        const g = Object.entries(by(db, x => GM[x.m] ? GM[x.m].n : 0)).sort((a, b) => b[1].length - a[1].length)[0];
        if (g && +g[0]) { const l = g[1], w = l.filter(x => x.w).map(x => x.m), r = l.filter(x => x.r && !x.w).map(x => x.m);
          steps.push('P' + g[0]); notes.push(`${w.length ? `writes ${uniq(w).join(', ')}` : ''}${w.length && r.length ? ' · ' : ''}${r.length ? `reads ${uniq(r).join(', ')}` : ''}`);
          code.push({ p: f, l: l[0].line, sym: sym.name, db: true, m: l[0].m, ...(l[0].store !== 'prisma' ? { st: l[0].store, res: X.models[l[0].m].name } : {}) }); }
      }
    }
    // a walkthrough is as sure as the references between its consecutive steps
    const hops = code.filter(c => c && c.sym && !c.db), es = []; let missing = 0;
    for (let i = 1; i < hops.length; i++) { const h = outAll(`${hops[i - 1].p}#${hops[i - 1].sym}`).filter(e => e.t === hops[i].p && e.ts === hops[i].sym); if (h.length) es.push(...h); else missing++; }
    return { name: j.name, group: j.group, caption: j.caption, steps, notes, code, status: missing || unfound ? 'unresolved' : es.length ? statusOf(es) : 'exact' };
  }).filter(j => j.steps.length > 1);
  
  /* ---------- branch comparisons: what changed, which blocks and functions, who calls the changed code ---------- */
  const PATHS = [], PIX = {}; const pix = p => PIX[p] ?? (PIX[p] = PATHS.push(p) - 1);
  const partFor = p => FP[p] || (X.covers(p) ? (matchers.find(x => x.re.test(p)) || {}).key || null : null);
  const CMP = (S.compare || []).map(c => {
    const chSyms = Object.entries(c.syms).flatMap(([p, ns]) => ns.map(n => `${p}#${n}`)), byMod = dict(), cm = c.models.map(X.modelName);
    for (const [p] of c.files) { const k = partFor(p); if (!k) continue; const [m, pt] = k.split('/'); const o = (byMod[m] = byMod[m] || { n: 0, parts: new Set() }); o.n++; o.parts.add(pt); }
    const blast = dict();
    for (const k of chSyms) for (const e of (inn[k] || []).filter(e => e.status === 'exact')) { const a = MP(e.f), b = MP(k.split('#')[0]); if (a && b && a !== b) { const o = (blast[b] = blast[b] || dict()); o[a] = (o[a] || 0) + 1; } }
    return { base: c.base, head: c.head, bl: c.baseLabel, hl: c.headLabel, bs: c.baseSha, hs: c.headSha, ahead: c.ahead, behind: c.behind, t: c.t,
      f: c.files.map(([p, st]) => [pix(p), st]), s: Object.fromEntries(Object.entries(c.syms).map(([p, ns]) => [pix(p), ns])), nsym: chSyms.length,
      src: c.files.filter(([p]) => partFor(p)).length, mods: Object.entries(byMod).map(([m, o]) => [m, o.n, [...o.parts]]),
      blast: Object.fromEntries(Object.entries(blast).map(([b, o]) => [b, Object.entries(o).sort((x, y) => y[1] - x[1])])),
      other: c.files.filter(([p]) => !partFor(p)).map(([p, st]) => [pix(p), st]),
      db: groups.filter(g => g.models.some(m => cm.includes(m))).map(g => g.n), models: cm, ...(c.incomplete ? { inc: c.incomplete } : {}) };
  });
  const curRef = ((S.refs && S.refs.heads) || []).find(h => h.current);
  let cmpDef = CMP.findIndex(c => curRef && c.head === curRef.name && c.base === S.refs.bases[0]); if (cmpDef < 0) cmpDef = 0;
  const cmp = { paths: PATHS, hash: PATHS.map(p => crypto.createHash('sha256').update(p).digest('hex')), list: CMP, def: cmpDef,
    bases: (S.refs && S.refs.bases) || [], heads: ((S.refs && S.refs.heads) || []).map(h => [h.name, h.label, h.t, h.current ? 1 : 0]) };

  /* ---------- the plate: districts per area, the database rail in the middle (none without Prisma) ---------- */
  if (!modules.length) {
    const un = (X.coverage.unresolved || {}).ast || {}, notRead = (un['no-python'] || 0) + (un['python-too-old'] || 0) + (un['python-failed'] || 0);
    const gun = (X.coverage.unresolved || {})['ripwire-lsp'] || {}, goWhy = GO_NOT.filter(([k]) => gun[k]), goNot = goWhy.reduce((n, [k]) => n + gun[k], 0);
    if (goNot && !notRead && !SRCFILES.length) throw new Error(`nothing to map: the ${goNot} Go files could not be read (${goWhy.map(([k, w]) => w).join('; ')})`);
    throw new Error(notRead && !SRCFILES.length ? `nothing to map: the ${notRead} Python files could not be read (${un['no-python'] ? 'python3 was not found on the PATH' : un['python-too-old'] ? 'python3 is older than 3.10' : 'python3 failed'})` : 'the map places no files: check its globs against the scan');
  }
  const P = plate({ modules, layers: plan.layers, groups: groups.map(g => ({ n: g.n, name: g.name, users: g.users })) });
  const { px: PX, py: PY, place, districts, rail, ports } = P;
  // the rail names the data stores the scan found and where they are declared: a schema file, or the files and
  // manifests that name a bucket, a table or a queue; a rail of stores that are not all databases is «Data»
  const SW = X.storeWords, stLabel = SW.label, stWhat = X.stores.length ? SW.what : 'models', DBW = SW.db ? 'Database' : 'Data';
  const sfs = uniq(allModels.map(m => X.models[m].file)), schemas = X.stores.every(s => s === 'prisma') ? sfs.join(', ') : `${sfs.slice(0, 3).join(', ')}${sfs.length > 3 ? ` +${sfs.length - 3} files` : ''}`;
  // «1 groups»: kept for Prisma, as pages have always said it; other stores count in the singular too
  const nW = n => (n === 1 && X.stores.length && !X.stores.every(s => s === 'prisma') ? SW.one : stWhat), nG = n => (n === 1 && nW(1) !== stWhat ? 'group' : 'groups');
  const RAILTXT = `${DBW.toUpperCase()} · ${groups.length} ${nG(groups.length).toUpperCase()} · ${allModels.length} ${nW(allModels.length).toUpperCase()}`;

  /* ---------- the page data ---------- */
  const dockLayer = rail ? { id: 'dock', name: DBW, blurb: `${allModels.length} ${stLabel} ${nW(allModels.length)} in ${groups.length} ${nG(groups.length)}.`, tip: `${schemas}: ${allModels.length} ${nW(allModels.length)}. Each port on the rail is a group of ${X.stores.every(s => s === 'prisma') ? 'tables' : stWhat}; cables show which blocks read or write them.` } : null;
  const lyr = orderLayers(plan.layers, districts, rail, dockLayer);
  const dock = rail ? { id: 'dock', layer: 'dock', name: `${DBW} (${stLabel})`, short: DBW, role: `${schemas} · ${allModels.length} ${nW(allModels.length)} in ${groups.length} ${nG(groups.length)}`, count: `${groups.length} ${nG(groups.length)} · ${allModels.length} ${nW(allModels.length)}`,
    tip: dockLayer.tip, parts: groups.map(g => ({ id: g.id, name: g.name, what: `${g.models.length} ${nW(g.models.length)} · ${g.models.slice(0, 5).join(', ')}${g.models.length > 5 ? '…' : ''}`, ports: [g.n] })) } : null;
  const ATLAS = { mode: 'repo', intro: plan.intro, generator: plan.generator || 'hand or AI', repo: S.repo, layers: lyr, modules: dock ? [...modules, dock] : modules, flows, journeys, groups, cmp,
    rail: dock ? { tip: dockLayer.tip, label: DBW.toLowerCase() } : null, ports: Object.fromEntries(groups.map(g => [g.n, { name: g.name, tip: g.tip }])),
    roots: X.codeRoots, testRoots: X.testRoots, runner: X.runner, runners: X.runners, store: { label: stLabel || 'Prisma', what: stWhat, one: X.stores.length ? SW.one : 'model', of: Object.fromEntries(X.stores.map(s => [s, X.store[s] ? `${X.store[s].label} ${X.store[s].one}` : s])) }, coverage: coverageOf(X, SRCFILES, unplaced.length - stillOut.length, stillOut),
    totals: { files: SRCFILES.length, lines: SRCFILES.reduce((a, f) => a + lines(f), 0), symbols: Object.values(FI).reduce((a, f) => a + f.syms.length, 0), models: allModels.length, edges: val.length } };
  const demo = modules.slice().sort((a, b) => b.parts.filter(p => p.children.length).length - a.parts.filter(p => p.children.length).length || b.parts.length - a.parts.length)[0];
  const firstJ = journeys[0] && journeys[0].steps.find(x => !/^P\d+$/.test(x));
  const SCENE = { px: PX, py: PY, place, districts, rail, ports, railTxt: rail ? RAILTXT : '', portmap: {}, front: '__none__', demoOpen: firstJ || demo.id, labels: {} };

  const np = modules.reduce((a, m) => a + m.parts.length, 0), nc = modules.reduce((a, m) => a + m.parts.reduce((b, p) => b + p.children.length, 0), 0);
  const CV = ATLAS.coverage;
  const cd = CMP[cmpDef];
  const summary = [
    `blocks ${modules.length} · parts ${np} · pieces ${nc} · flows ${flows.length} · walkthroughs ${journeys.length} · table groups ${groups.length} · plate ${PX}×${PY} · rows ${P.rows}`,
    `files placed by glob ${SRCFILES.length - unplaced.length}/${SRCFILES.length} · by folder ${unplaced.length - stillOut.length} · unplaced ${stillOut.length}${stillOut.length ? ': ' + stillOut.slice(0, 8).join(', ') : ''}`,
    `comparisons ${CMP.length} · default ${cd ? `${cd.bl}..${cd.hl}: ${cd.f.length} files, ${cd.src} in src, ${cd.mods.length} blocks, ${cd.nsym} symbols` : 'none'}`,
    `coverage  ${CV.lines.join(' · ')}`,
  ];
  // what --check fails on: source files no rule of the map places, and map entries that name code that is gone
  return { ATLAS, SCENE, summary, warnings: WARN, check: { unplaced: stillOut, stale: STALE } };
}

// what the page says it covers and leaves out, in a few lines a person reads
function coverageOf(X, SRC, byFolder, unplaced) {
  const C = X.coverage, sk = C.skipped, out = sk.outside || { files: 0, byExt: {}, byDir: {} }, fo = sk.folders || { files: 0, byExt: {}, byReason: {} };
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
  const fmt = l => l.map(([k, v]) => `${v} ${k}`).join(', ');
  const roots = C.roots.filter(r => r.role === 'code').map(r => r.path === '.' ? 'the whole repo' : r.path);
  const inRoots = Object.values(sk.byExt).reduce((a, b) => a + b, 0);
  const un = C.unresolved || {}, calls = un.tsc || {}, data = un.prisma || {}, py = un.ast || {}, lam = un.lambda || {}, lamM = un['lambda-manifest'] || {}, gu = un['ripwire-lsp'];
  const besides = Object.values(C.besides || {}).reduce((a, b) => a + b, 0);
  const said = (o, words) => words.filter(([k]) => o[k]).map(([k, w]) => `${o[k]} ${w}`).join(', ');
  const callsTxt = said(calls, [['call-local', 'into local functions'], ['call-interface', 'through interfaces'], ['call-dynamic', 'of values computed at run time'], ['call-unknown', 'to names nothing in the code declares'], ['call-member', 'on values whose type the scan does not know']]);
  const dataTxt = said(data, [['data', 'on unknown receivers'], ['data-ambiguous', 'on a model of several packages'], ['data-unknown-model', 'on models no schema has']]);
  // Python: files not read, calls and data not followed; Lambda handlers a manifest names that the map cannot find
  const pyRead = said(py, [['no-python', 'not read (no python3 on this machine)'], ['python-too-old', 'not read (python3 is older than 3.10)'], ['python-failed', 'not read (python3 failed)'], ['parse-error', 'that do not parse'], ['unreadable', 'that could not be read']]);
  const pyCalls = said(py, [['call-local', 'into local functions'], ['call-ambiguous', 'that may reach several methods (drawn to each)'], ['call-dynamic', 'of values computed at run time'], ['call-unknown', 'to names nothing in the code declares'], ['call-member', 'on values whose type the scan does not know']]);
  const pyMore = said(py, [['import-unresolved', 'imports not found in the repo'], ['syspath-not-static', 'sys.path changes the scan cannot read']]);
  const pyData = said(py, [['data-unknown-name', 'on names computed at run time'], ['data-env-varies', 'on environment variables the deployments running them set differently'], ['data-untraced', 'on clients the scan cannot trace to boto3']]);
  const pyLimits = said(py, [['call-abstract', 'calls to abstract methods and protocols, not drawn to their implementations']]);
  const byCount = o => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${v} ${k}`).join(', ');
  const lamTxt = byCount(lam), lamMTxt = byCount(lamM);
  // Go: what ripwire gave (symbols, no calls), or why the files were not read
  const rw = (C.adapters || []).find(a => a[0] === 'ripwire-lsp');
  const goNot = gu && said(gu, GO_NOT.map(([k, w]) => [k, `not read (${w})`]));
  // what ripwire gave, only when it ran and answered; where it and archivision's reading of the text differ, each counted
  const goTxt = gu && rw && rw[1] !== 'none' ? [`Go: symbols from ripwire ${rw[1]}, no calls between them`, ...[['text-only', 'grouped constants and variables ripwire does not list (counted, not drawn)'], ['text-missing', "declarations ripwire did not list, left out"], ['ripwire-only', 'symbols only ripwire listed, left out'], ['kind-disagrees', 'symbols ripwire and the text give different kinds, left out'], ['ripwire-malformed', 'malformed symbols from ripwire'], ['method-type-ambiguous', 'methods whose type is declared more than once in their package (builds), shown on their own']].filter(([k]) => gu[k]).map(([k, w]) => `${gu[k]} ${w}`)].join('; ') : '';
  const lines = [
    `mapped ${SRC.length} files (${fmt(top(C.read, 6)) || 'none'}) from ${roots.join(', ')}`,
    besides ? `read besides ${besides} files outside the roots that the code imports (${fmt(top(C.besides, 4))}), not placed` : '',
    inRoots ? `skipped in the roots ${inRoots} (${fmt(top(sk.byExt, 5))})` : '',
    fo.files ? `in folders left out of the roots ${fo.files} files (${fmt(top(fo.byReason, 4))}; ${fmt(top(fo.byExt, 4))})` : '',
    out.files ? `outside the roots ${out.files} files (${fmt(top(out.byExt, 5))}; in ${fmt(top(out.byDir, 4))})` : '',
    out.unreadable ? `folders that could not be read ${out.unreadable}: what they hold is not counted` : '',
    unplaced.length ? `placed by no rule ${unplaced.length}` : '',
    callsTxt ? `calls not followed: ${callsTxt}` : '',
    dataTxt ? `database calls not matched: ${dataTxt}` : '',
    pyRead ? `Python files: ${pyRead}` : '',
    pyCalls ? `Python calls not followed: ${pyCalls}` : '',
    pyMore ? `Python: ${pyMore}` : '',
    pyData ? `Python data calls not matched: ${pyData}` : '',
    pyLimits ? `Python: ${pyLimits}; a class's subclasses outside the repo are not seen` : '',
    lamTxt ? `Lambda handlers not found: ${lamTxt}` : '',
    lamMTxt ? `Lambda manifests, parts not read (the functions there may be missing): ${lamMTxt}` : '',
    goNot ? `Go files: ${goNot}` : '',
    goTxt,
  ].filter(Boolean);
  return { lines, mapped: SRC.length, read: C.read, besides: C.besides || {}, roots: C.roots, skipped: { inRoots, byExt: sk.byExt, reasons: sk.reasons, folders: fo }, outside: out, unresolved: un, unplaced: unplaced.length };
}

module.exports = { buildRepo };
