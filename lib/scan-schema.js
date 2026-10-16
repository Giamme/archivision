'use strict';
// The scan contract, version 2: what `scanRepo` returns and every consumer reads (through lib/repo/facts.js).
// Every fact carries the adapter that found it (`prov`) and how sure it is (`status`). Paths are relative to the
// repo root, with forward slashes. A JSON Schema (a subset: type, enum, required, properties,
// additionalProperties, items, anyOf), checked by `validateScan` with no dependency.

const str = { type: 'string' }, int = { type: 'integer' }, bool = { type: 'boolean' }, num = { type: 'number' };
const nstr = { type: ['string', 'null'] };
const STATUS = { enum: ['exact', 'inferred', 'ambiguous', 'unresolved'] };
const site = { type: 'array', items: int };                      // [line, column], both from 1
const obj = (props, required = Object.keys(props), extra = false) => ({ type: 'object', required, properties: props, additionalProperties: extra });
const map = value => ({ type: 'object', additionalProperties: value });

const SCAN_SCHEMA = obj({
  version: { enum: [2] },
  repo: obj({ name: str, root: str, remote: str, sha: str, branch: str, pushed: bool, dirty: int, scanned: str }),
  refs: obj({ bases: { type: 'array', items: str }, heads: { type: 'array', items: obj({ name: str, label: str, t: int, current: bool }) }, all: { type: 'array', items: str } }),
  // the folders read, what each holds (code, unit tests, browser specs) and how it was found (by the layout, by --src,
  // or by a deployment manifest)
  roots: { type: 'array', items: obj({ path: str, role: { enum: ['code', 'test', 'e2e'] }, pkg: nstr, found: { enum: ['auto', '--src', 'manifest'] } }) },
  files: map(obj({
    lang: str, lines: int, test: bool, pkg: nstr,
    flags: obj({ server: bool, client: bool, middleware: bool }),
    appDir: str,                                                  // the Next.js app folder the file is in
    entry: obj({ kind: str, variant: str, route: str }),          // a route file, or a handler's file (kind lambda)
    error: str,                                                   // why the file could not be parsed
    prov: str,
  }, ['lang', 'lines', 'test', 'pkg', 'flags', 'prov'])),
  // ids are path#Qualified.name; a second declaration of the same name gets #2, then #3; a member's `parent` is the
  // symbol it is declared in (its class, its object's constant, the function holding its class), null at the top
  symbols: { type: 'array', items: obj({ id: str, file: str, name: str, qname: str, kind: str, line: int, end: int, exported: bool, sig: str, doc: str, member: bool, parent: nstr, prov: str }) },
  // from a symbol id, or a file path for code outside any symbol; sites in source order
  relations: { type: 'array', items: obj({ from: str, to: str, rel: { enum: ['call', 'ref', 'import', 'type'] }, sites: { type: 'array', items: site }, n: int, status: STATUS, prov: str }) },
  entries: { type: 'array', items: obj({
    id: str, kind: { enum: ['page', 'layout', 'route', 'action', 'middleware', 'lambda', 'job', 'cli', 'event'] }, variant: str, route: nstr, method: nstr,
    handler: nstr, trigger: str, name: str, evidence: obj({ file: str, line: int }), prov: str, status: STATUS,
  }, ['id', 'kind', 'variant', 'route', 'method', 'handler', 'evidence', 'prov', 'status']) },
  // resource ids are store:package:name, so two User models never collide
  resources: map(obj({ store: str, kind: { enum: ['table', 'collection', 'bucket', 'queue', 'topic', 'unknown'] }, name: str, pkg: nstr, file: str, line: int, end: int, fields: int, rel: { type: 'array', items: str }, prov: str, status: STATUS })),
  data: { type: 'array', items: obj({ from: str, resource: nstr, op: { enum: ['read', 'write', 'rw'] }, sites: { type: 'array', items: site }, n: int, status: STATUS, prov: str }) },
  tests: map(obj({
    runner: str, runnerProv: str,
    imports: { type: 'array', items: obj({ file: str, line: int, status: STATUS, prov: str }) },
    visits: { type: 'array', items: obj({ route: str, line: int, status: STATUS, prov: str }) },
  })),
  // a changed or added declaration is named at the head, a deleted one at the base; models are the resource ids of
  // the models a change touches
  compare: { type: 'array', items: obj({
    base: str, head: str, baseLabel: str, headLabel: str, baseSha: str, headSha: str, mb: str, ahead: int, behind: int, t: int,
    files: { type: 'array', items: { type: 'array', items: str } }, syms: map({ type: 'array', items: str }), models: { type: 'array', items: str },
    changed: { type: 'array', items: obj({ id: str, at: { enum: ['head', 'base'] } }) },
    incomplete: str,                                              // why only part of the comparison could be read
  }, ['base', 'head', 'baseLabel', 'headLabel', 'baseSha', 'headSha', 'mb', 'ahead', 'behind', 't', 'files', 'syms', 'models', 'changed']) },
  // skipped inside the roots (by extension, root and reason), the files in folders left out inside them (build output,
  // dot-folders: by extension and reason), and every file outside them (by extension and top folder); `unreadable`
  // counts the folders an inventory without git could not read
  skipped: obj({ byExt: map(int), byRoot: map(int), reasons: map(int),
    folders: obj({ files: int, byExt: map(int), byReason: map(int) }),
    outside: obj({ files: int, byExt: map(int), byDir: map(int), from: { enum: ['git ls-files', 'the folder'] }, unreadable: int }, ['files', 'byExt', 'byDir', 'from']) }),
  unresolved: map(map(int)),
  // covers: the file extensions a code adapter reads (branch changes in other files are listed, not parsed)
  adapters: { type: 'array', items: obj({ name: str, version: str, files: int, facts: int, ms: num, covers: { type: 'array', items: str }, sha256: str }, ['name', 'version', 'files', 'facts', 'ms']) },
  summary: str,
});

// errors as "path: message", empty when the value fits
function validate(v, s, at = '$', out = []) {
  if (s.anyOf) { if (!s.anyOf.some(x => !validate(v, x, at, []).length)) out.push(`${at}: matches none of the allowed shapes`); return out; }
  if (s.enum && !s.enum.includes(v)) { out.push(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.join(', ')}`); return out; }
  if (s.type) {
    const t = Array.isArray(s.type) ? s.type : [s.type];
    const is = x => (x === 'integer' ? Number.isInteger(v) : x === 'number' ? typeof v === 'number' && isFinite(v) : x === 'array' ? Array.isArray(v) : x === 'null' ? v === null : x === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : typeof v === x);
    if (!t.some(is)) { out.push(`${at}: expected ${t.join(' or ')}, got ${v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v}`); return out; }
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => validate(x, s.items, `${at}[${i}]`, out));
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of s.required || []) if (!(k in v)) out.push(`${at}: missing ${k}`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties && s.properties[k]) validate(x, s.properties[k], `${at}.${k}`, out);
      else if (s.additionalProperties === false) out.push(`${at}: unexpected ${k}`);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') validate(x, s.additionalProperties, `${at}[${JSON.stringify(k)}]`, out);
    }
  }
  return out;
}

// what a schema cannot say: ids are unique, every reference resolves, sites and spans are well formed
function semantic(S) {
  const out = [], ids = new Set(), dup = new Set();
  for (const s of S.symbols) { if (ids.has(s.id)) dup.add(s.id); ids.add(s.id); if (!S.files[s.file]) out.push(`symbol ${s.id}: file ${s.file} not scanned`); if (s.line < 1 || s.end < s.line) out.push(`symbol ${s.id}: lines ${s.line}-${s.end}`); }
  for (const d of dup) out.push(`symbol id ${d} is not unique`);
  for (const s of S.symbols) if (s.parent !== null && !ids.has(s.parent)) out.push(`symbol ${s.id}: parent ${s.parent} unknown`); else if (s.member && s.parent && s.parent === s.id) out.push(`symbol ${s.id}: its own parent`);
  const end = x => ids.has(x) || !!S.files[x];
  const sites = (what, ss) => { for (const t of ss) if (t.length !== 2 || !(t[0] >= 1) || !(t[1] >= 1)) { out.push(`${what}: site ${JSON.stringify(t)}`); break; } };
  S.relations.forEach((r, i) => { if (!end(r.from)) out.push(`relations[${i}]: from ${r.from} unknown`); if (!ids.has(r.to)) out.push(`relations[${i}]: to ${r.to} unknown`); if (r.n !== r.sites.length || !r.n) out.push(`relations[${i}]: n ${r.n} but ${r.sites.length} sites`); sites(`relations[${i}]`, r.sites); });
  S.data.forEach((d, i) => { if (!end(d.from)) out.push(`data[${i}]: from ${d.from} unknown`); if (d.resource !== null && !S.resources[d.resource]) out.push(`data[${i}]: resource ${d.resource} unknown`); if (d.resource === null && d.status !== 'unresolved') out.push(`data[${i}]: no resource but ${d.status}`); if (!d.sites.length || d.n !== d.sites.length) out.push(`data[${i}]: n ${d.n} but ${d.sites.length} sites`); sites(`data[${i}]`, d.sites); });
  for (const [id, r] of Object.entries(S.resources)) { if (r.end < r.line) out.push(`resource ${id}: lines ${r.line}-${r.end}`); for (const x of r.rel) if (!S.resources[x]) out.push(`resource ${id}: refers to unknown ${x}`); }
  const eids = new Set();
  for (const e of S.entries) { if (eids.has(e.id)) out.push(`entry id ${e.id} is not unique`); eids.add(e.id); if (e.handler !== null && e.status !== 'unresolved' && !end(e.handler)) out.push(`entry ${e.id}: handler ${e.handler} unknown`); }
  for (const [f, t] of Object.entries(S.tests)) for (const x of t.imports) if (!S.files[x.file]) out.push(`tests ${f}: imports unknown ${x.file}`);
  return out;
}

const validateScan = S => { const e = validate(S, SCAN_SCHEMA); return e.length ? e : semantic(S); };

module.exports = { SCAN_SCHEMA, validateScan };
