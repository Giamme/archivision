'use strict';
const ROOTS = require('./roots');
// The facts automap and build work from, read from the scan contract (version 2). This is the only place that
// knows the contract's shape; the consumers see files, symbols, references, data uses, resources and tests.

// what a map shows per kind of symbol, one table per language
const LANG = {
  ts: {
    score: { page: 6, handler: 6, action: 5, layout: 3, component: 2, hook: 2, function: 2, class: 2, const: .5, enum: 0 },
    kind: { page: 'ui', layout: 'ui', component: 'ui', hook: 'ui', handler: 'endpoint', action: 'gate', function: 'process', class: 'process', const: 'config', enum: 'config' },
    label: { page: 'page', layout: 'layout', component: 'component', hook: 'hook', handler: 'API route', action: 'server action', function: 'function', class: 'class', const: 'constant', enum: 'enum' },
  },
};
// a Lambda handler reads the same in every language
Object.assign(LANG.ts.score, { lambda: 6 }); Object.assign(LANG.ts.kind, { lambda: 'endpoint' }); Object.assign(LANG.ts.label, { lambda: 'Lambda handler' });
LANG.py = {
  score: { lambda: 6, function: 2, class: 2, const: .5 },
  kind: { lambda: 'endpoint', function: 'process', class: 'process', const: 'config' },
  label: { lambda: 'Lambda handler', function: 'function', class: 'class', const: 'constant' },
};
// Go: ripwire's symbols, a type being a class (a struct, a named type) or an interface
LANG.go = {
  score: { function: 2, class: 2, interface: 1, const: .5, var: .5 },
  kind: { function: 'process', class: 'process', interface: 'process', const: 'config', var: 'config' },
  label: { function: 'function', class: 'type', interface: 'interface', const: 'constant', var: 'variable' },
};
// JavaScript reads the same: the compiler gives it the same kinds of symbols
for (const l of ['tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) LANG[l] = LANG.ts;
// each data store: its name, what its resources are called (one and many), and whether it is a database
const STORE = {
  prisma: { label: 'Prisma', what: 'models', one: 'model', db: true, schema: 'prisma/schema.prisma' },
  dynamodb: { label: 'DynamoDB', what: 'tables', one: 'table', db: true },
  sql: { label: 'SQL', what: 'tables', one: 'table', db: true },
  django: { label: 'Django', what: 'models', one: 'model', db: true },
  s3: { label: 'S3', what: 'buckets', one: 'bucket', db: false },
  sqs: { label: 'SQS', what: 'queues', one: 'queue', db: false },
};
const RUNNER = { vitest: 'Vitest', jest: 'Jest', mocha: 'Mocha', pytest: 'pytest', unittest: 'unittest', unknown: 'unit test', playwright: 'Playwright' };

function facts(S) {
  if (S.version !== 2) throw new Error(`this archivision reads scan version 2, not ${S.version}`);
  const by = (a, f) => a.reduce((o, x) => ((o[f(x)] = o[f(x)] || []).push(x), o), Object.create(null));   // no inherited keys: a symbol may be called toString
  const codeRoots = S.roots.filter(r => r.role === 'code').map(r => r.path), allRoots = S.roots.map(r => r.path);
  // the code root a file is in: the most specific root holding it, when that root holds code (not tests)
  const rootOf = p => { const r = ROOTS.rootOf(allRoots, p); return r !== null && codeRoots.includes(r) ? r : null; };
  // a handler in a Lambda handler's file (not a Next.js route) is a Lambda handler
  const SYMS = S.symbols.map(s => (s.kind === 'handler' && S.files[s.file] && S.files[s.file].entry && S.files[s.file].entry.kind === 'lambda' ? { ...s, kind: 'lambda' } : s));
  const SYM = new Map(SYMS.map(s => [s.id, s]));

  // per file: what it is and its top-level symbols, in source order
  const top = by(SYMS.filter(s => !s.member), s => s.file), members = by(SYMS.filter(s => s.member), s => s.file);
  const FILES = {};
  for (const [p, f] of Object.entries(S.files)) {
    FILES[p] = { lang: f.lang, lines: f.lines, test: f.test, server: f.flags.server, client: f.flags.client, middleware: f.flags.middleware,
      route: f.entry ? f.entry.route : null, rkind: f.entry ? f.entry.kind : null, appDir: f.appDir || null,
      root: rootOf(p), pkg: f.pkg, syms: top[p] || [], members: members[p] || [] };
  }
  // the code a map places: files in a code root, in a language it shows, not tests
  const srcFiles = Object.keys(FILES).filter(p => FILES[p].root && LANG[FILES[p].lang] && !FILES[p].test).sort();
  // files a code adapter reads, for branch changes: by the extensions the adapters say they cover
  const EXT = new Set(S.adapters.flatMap(a => a.covers || []));
  const covers = p => !!rootOf(p) && EXT.has((p.match(/\.[^./]+$/) || [''])[0]);

  // references between top-level symbols: a reference and a type reference of one pair are one edge, as the
  // map has always counted them; `type` means every reference is in a type position
  const end = x => (SYM.has(x) ? [SYM.get(x).file, SYM.get(x).name] : [x, null]);
  const RANK = { exact: 0, inferred: 1, ambiguous: 2, unresolved: 3 }, worst = (a, b) => (b && RANK[b] > RANK[a] ? b : a);
  const pairs = new Map();
  for (const r of S.relations) {
    if (r.rel !== 'ref' && r.rel !== 'type') continue;
    const k = `${r.from}|${r.to}`, e = pairs.get(k) || { from: r.from, to: r.to, n: 0, status: 'exact', prov: r.prov };
    e.n += r.n; e[r.rel] = r; e.status = worst(e.status, r.status); pairs.set(k, e);
  }
  // calls, lifted to the top-level symbol each side is in (a method to its class or object, a method of a class
  // inside a function to that function), same-file ones too; a call to the symbol it is in is left out
  const lift = id => { let s = SYM.get(id), guard = 0; while (s && s.member && guard++ < 50) { if (!s.parent) return s.file; s = SYM.get(s.parent); } return s ? s.id : id; };
  const cp = new Map();
  for (const r of S.relations) {
    if (r.rel !== 'call') continue;
    const a = lift(r.from), b = lift(r.to); if (a === b) continue;
    const k = `${a}|${b}`, e = cp.get(k) || { from: a, to: b, n: 0, sites: [], status: 'exact', prov: r.prov };
    e.n += r.n; e.status = worst(e.status, r.status); for (const [l, c] of r.sites) e.sites.push([l, c, SYM.get(r.to).name, r.status]); cp.set(k, e);
  }
  for (const e of cp.values()) e.sites.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const fileOf = x => (SYM.has(x) ? SYM.get(x).file : x);
  // an edge per pair of top-level symbols in two files that reference or call each other; `call` counts the calls
  // among its references, at `callLine`/`callCol`, of `callee` (a method's own name when the call is to a method);
  // `ref` says whether the caller names the symbol as a value (an import), which grouping by imports reads; `type`
  // means it is named only in types and never called
  const edge = (from, to, n, line, type, status, prov, c, ref) => { const [f, fs] = end(from), [t, ts] = end(to);
    return { f, fs, t, ts, n, line, type: type && !c, ref, status: worst(status, c && c.status), prov, call: c ? c.n : 0, callLine: c ? c.sites[0][0] : null, callCol: c ? c.sites[0][1] : null, callee: c ? c.sites[0][2] : null }; };
  // a type-only reference whose symbol is still called (through a value typed by it) is a call edge
  const edges = [...pairs.values()].map(e => edge(e.from, e.to, e.n, (e.ref || e.type).sites[0][0], !e.ref, e.status, e.prov, cp.get(`${e.from}|${e.to}`), !!e.ref));
  // a call through an object the caller never names (`getStore().save()`) is an edge of its own
  for (const c of cp.values()) if (!pairs.has(`${c.from}|${c.to}`) && fileOf(c.from) !== fileOf(c.to)) edges.push(edge(c.from, c.to, c.n, c.sites[0][0], false, c.status, c.prov, c, false));
  // calls inside one file, between its top-level symbols
  const sameFile = [...cp.values()].filter(c => fileOf(c.from) === fileOf(c.to)).map(c => edge(c.from, c.to, c.n, c.sites[0][0], false, c.status, c.prov, c, false));

  // data resources and the uses of each
  // a resource is shown by its name; when two have that name, with what tells them apart (the store, the package, or
  // both). The label is the map's key for it, so two resources never share one (the id decides the rest)
  // (labels are built from names the scanned code chose, so: Maps, and a label another resource's name or label
  // already holds is never reused, whatever order they come in)
  const RES = S.resources, models = Object.create(null), byName = new Map();
  for (const [id, r] of Object.entries(RES)) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(id); }
  const want = new Map();
  for (const [name, ids] of byName) for (const id of ids.sort()) {
    const r = RES[id], same = ids.map(i => RES[i]), stores = new Set(same.map(x => x.store)).size > 1, pkgs = new Set(same.map(x => x.pkg || '.')).size > 1;
    const l = ids.length === 1 ? name : [name, stores && (STORE[r.store] || { label: r.store }).label, pkgs && (r.pkg || (stores ? 'root' : r.store))].filter(Boolean).join(' · ');
    want.set(id, l === name && ids.length > 1 ? `${name} · ${id}` : l);
  }
  // a label two resources want goes to neither: both take their ids; one that is still taken gets a number
  const count = new Map();
  for (const l of want.values()) count.set(l, (count.get(l) || 0) + 1);
  const LABEL = new Map(), taken = new Set();
  for (const id of [...want.keys()].sort()) {
    const r = RES[id];
    let l = count.get(want.get(id)) > 1 ? `${r.name} · ${id}` : want.get(id);
    for (let n = 2; taken.has(l); n++) l = `${r.name} · ${id} (${n})`;
    taken.add(l); LABEL.set(id, l);
  }
  const shown = id => LABEL.get(id);
  for (const [id, r] of Object.entries(RES)) models[shown(id)] = { line: r.line, end: r.end, fields: r.fields, file: r.file, store: r.store, kind: r.kind, name: r.name, rel: r.rel.map(shown) };
  const dataUses = S.data.filter(x => x.resource && RES[x.resource]).map(x => { const [f, fs] = end(x.from); return { f, fs, m: shown(x.resource), line: x.sites[0][0], n: x.n, r: x.op !== 'write', w: x.op !== 'read', store: RES[x.resource].store, status: x.status }; });
  const stores = [...new Set(Object.values(RES).map(r => r.store))];
  // the stores together: their names, and the word for what they hold when they agree on it, else «resources»
  const ST = stores.map(s => STORE[s] || { label: s, what: 'resources', one: 'resource', db: false });
  const what = [...new Set(ST.map(s => s.what))], storeWords = { label: ST.map(s => s.label).join(', '), what: what.length === 1 ? what[0] : 'resources', one: what.length === 1 ? ST[0].one : 'resource', db: ST.every(s => s.db) };
  // a resource id (store:package:name) as the map shows it; one the scan no longer has (deleted at the head) by its name
  const modelName = id => (RES[id] ? shown(id) : String(id).split(':').slice(2).join(':'));

  // tests: unit test files with the files they reach, browser specs with the routes they visit
  const testImports = Object.entries(S.tests).flatMap(([f, t]) => t.imports.map(i => ({ f, t: i.file })));
  const visits = Object.fromEntries(Object.entries(S.tests).filter(([, t]) => t.visits.length).map(([f, t]) => [f, t.visits.map(v => v.route)]));
  const unitRunner = (Object.values(S.tests).find(t => t.runner !== 'playwright') || {}).runner || (S.adapters.find(a => RUNNER[a.name] && a.name !== 'playwright') || {}).name || 'unknown';
  const runners = Object.fromEntries(Object.entries(S.tests).map(([f, t]) => [f, RUNNER[t.runner] || t.runner]));

  // what the map covers and what it leaves out: the files it maps per language, the files read only because the code
  // imports them (outside every root), files skipped (in a root: by reason and extension; in folders left out inside
  // a root; outside every root: by extension and folder), and facts an adapter could not resolve
  const byLang = {}; for (const p of srcFiles) byLang[FILES[p].lang] = (byLang[FILES[p].lang] || 0) + 1;
  const besides = {}, mapped = new Set(srcFiles); for (const p of Object.keys(FILES)) if (!FILES[p].test && !FILES[p].root && !mapped.has(p)) besides[FILES[p].lang] = (besides[FILES[p].lang] || 0) + 1;
  const coverage = { read: byLang, besides, mapped: srcFiles.length, skipped: S.skipped, unresolved: S.unresolved, adapters: (S.adapters || []).map(a => [a.name, a.version]), roots: S.roots.map(r => ({ path: r.path, role: r.role, pkg: r.pkg, found: r.found })) };
  // entry points with the top-level symbol that handles each: pages, route handlers, actions, middleware, and later
  // lambdas, jobs, commands and events
  const entries = (S.entries || []).filter(e => e.handler && SYM.has(e.handler) && !SYM.get(e.handler).member).map(e => ({ kind: e.kind, file: SYM.get(e.handler).file, sym: SYM.get(e.handler).name, route: e.route, method: e.method, status: e.status, trigger: e.trigger || null, name: e.name || null }));
  // packages: the code roots' packages, in root order
  const packages = [...new Set(S.roots.filter(r => r.role === 'code').map(r => r.pkg || '.'))];
  return {
    root: S.repo.root, codeRoots, coverage, packages, inRoot: p => { const r = rootOf(p); return r === null ? p : ROOTS.inRoot(r, p); }, testRoots: S.roots.filter(r => r.role !== 'code').map(r => r.path), rootOf, srcFiles, covers, files: FILES, file: p => FILES[p],
    syms: p => (FILES[p] ? FILES[p].syms : []),
    // a member by its qualified name (Owner.name), else the one qualified name that ends with it, else by name
    member: (p, q) => { const ms = FILES[p] ? FILES[p].members : [], d = String(q).replace(/^\.+/, ''); return ms.find(s => s.qname === d) || ms.find(s => s.qname.endsWith('.' + d)) || (d.includes('.') ? null : ms.find(s => s.name === d)) || null; },
    edges, sameFile, entries, dataUses, models, modelName, stores, store: STORE, storeWords, testImports, visits,
    runner: { unit: RUNNER[unitRunner] || unitRunner, e2e: RUNNER.playwright }, runners,
    lang: p => LANG[(FILES[p] || {}).lang] || LANG.ts,
  };
}

module.exports = { facts, LANG, STORE, RUNNER };
