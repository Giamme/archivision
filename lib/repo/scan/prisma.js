'use strict';
// Prisma: the models in each package's prisma/schema.prisma (or prisma/schema/*.prisma) become resources (with the
// models each one refers to), and calls such as prisma.order.create(...) become data uses, read while the
// TypeScript adapter walks each file. A call is matched to its own package's schema first.
const fs = require('fs'), path = require('path');
const NAME = 'prisma', VERSION = '2';
const OPS = { findMany: 'r', findFirst: 'r', findUnique: 'r', findFirstOrThrow: 'r', findUniqueOrThrow: 'r', count: 'r', aggregate: 'r', groupBy: 'r',
  create: 'w', createMany: 'w', createManyAndReturn: 'w', update: 'w', updateMany: 'w', updateManyAndReturn: 'w', upsert: 'w', delete: 'w', deleteMany: 'w' };
const RECEIVER = /^(prisma|db|tx|trx|client|prismaClient|database|p)$/i;
const SCHEMA = /(^|\/)prisma\/(schema\.prisma|schema\/[^/]+\.prisma)$/;

// [name, first line, last line] of every model in a schema text
const modelRanges = text => { const o = []; let cur = null; text.split('\n').forEach((ln, i) => { const m = ln.match(/^model\s+(\w+)\s*\{/); if (m) cur = [m[1], i + 1, i + 1]; else if (cur && /^\}/.test(ln)) { cur[2] = i + 1; o.push(cur); cur = null; } }); return o; };

// D: what discover found (its packages, pkgOf and inside)
function prismaAdapter(ROOT, D) {
  const t0 = Date.now(), inside = D.inside || (() => true);
  const pkgOf = p => (D.pkgOf ? D.pkgOf(p) : D.pkg) || null;
  const idOf = (pkg, name) => `${NAME}:${pkg || '.'}:${name}`;
  // the schema files: prisma/schema.prisma, or the files of prisma/schema/, in the repo and in each package
  const schemaFiles = [];
  for (const dir of ['.', ...(D.packages || []).map(p => p.dir)]) {
    const base = dir === '.' ? 'prisma' : `${dir}/prisma`, one = `${base}/schema.prisma`, many = `${base}/schema`;
    // nothing is listed or read through a symlink that leads out of the repo
    if (fs.existsSync(path.join(ROOT, one))) { if (inside(path.join(ROOT, one))) schemaFiles.push(one); }
    else if (fs.existsSync(path.join(ROOT, many)) && inside(path.join(ROOT, many))) try { for (const f of fs.readdirSync(path.join(ROOT, many)).sort()) if (f.endsWith('.prisma')) schemaFiles.push(`${many}/${f}`); } catch {}
  }
  const resources = {}, DELEGATE = {};   // DELEGATE[pkg][order] = resource id
  for (const rel of schemaFiles) {
    const file = path.join(ROOT, rel); if (!inside(file)) continue;   // a schema file that is a symlink out of the repo is not read
    const pkg = pkgOf(rel), L = fs.readFileSync(file, 'utf8').split('\n'), here = []; let cur = null;
    L.forEach((ln, i) => {
      const m = ln.match(/^model\s+(\w+)\s*\{/);
      if (m) { cur = resources[idOf(pkg, m[1])] = { store: NAME, kind: 'table', name: m[1], pkg, file: rel, line: i + 1, end: i + 1, fields: 0, rel: [], prov: NAME, status: 'exact' }; here.push(cur); }
      else if (cur && /^\}/.test(ln)) { cur.end = i + 1; cur = null; }
      else if (cur && /^\s+\w+\s+\w/.test(ln) && !/^\s*@@/.test(ln)) cur.fields++;
    });
    for (const r of here) (DELEGATE[pkg || '.'] = DELEGATE[pkg || '.'] || {})[r.name[0].toLowerCase() + r.name.slice(1)] = idOf(pkg, r.name);
  }
  // the models each model refers to, in the order its fields name them (within its package)
  for (const r of Object.values(resources)) {
    const L = fs.readFileSync(path.join(ROOT, r.file), 'utf8').split('\n'), names = new Set(Object.values(resources).filter(x => x.pkg === r.pkg).map(x => x.name));
    r.rel = [...new Set(L.slice(r.line, r.end - 1).map(l => (l.match(/^\s+\w+\s+(\w+)/) || [])[1]).filter(t => t && t !== r.name && names.has(t)))].map(n => idOf(r.pkg, n));
  }
  const DATA = new Map(); let unmatched = 0, ambiguous = 0, unknownModel = 0, ms = Date.now() - t0;
  // the resource a delegate names, from a file: its own package's schema, else the one schema that has it
  const resourceFor = (file, delegate) => {
    const own = DELEGATE[pkgOf(file) || '.']; if (own && own[delegate]) return own[delegate];
    const hits = Object.values(DELEGATE).map(d => d[delegate]).filter(Boolean);
    if (hits.length > 1) { ambiguous++; return null; }
    return hits[0] || null;
  };
  const known = d => Object.values(DELEGATE).some(x => x[d]);

  // called by the TypeScript adapter for every node; ctx gives the file, the enclosing symbol and positions
  function onNode(ts, node, ctx) {
    if (!(ts.isPropertyAccessExpression(node) && OPS[node.name.text] && ts.isPropertyAccessExpression(node.expression))) return;
    const t = Date.now();
    const recv = node.expression.expression.getText(ctx.sf), last = recv.split('.').pop().replace(/[!?]+$/, ''), isClient = RECEIVER.test(last);
    // prisma.missing.findMany(): a client's call on a model no schema has is counted, not dropped
    if (!known(node.expression.name.text)) { if (isClient && Object.keys(resources).length) unknownModel++; ms += Date.now() - t; return; }
    if (!isClient) { unmatched++; ms += Date.now() - t; return; }
    const resource = resourceFor(ctx.file, node.expression.name.text); if (!resource) { ms += Date.now() - t; return; }
    const from = ctx.from(node), op = OPS[node.name.text], k = `${from}|${resource}`, site = ctx.site(node);
    const e = DATA.get(k);
    if (e) { e.n++; e.sites.push(site); if (op === 'w') e.w = true; else e.r = true; }
    else DATA.set(k, { from, resource, sites: [site], n: 1, r: op === 'r', w: op === 'w' });
    ms += Date.now() - t;
  }
  function data() {
    // inferred: the call is recognised by its shape and its receiver's name (prisma, db, tx…), not by its type
    return [...DATA.values()].map(({ r, w, ...d }) => ({ ...d, op: r && w ? 'rw' : w ? 'write' : 'read', status: 'inferred', prov: NAME }));
  }
  // compare: which models a diff touches, from one version of a schema file
  const owns = p => SCHEMA.test(p);
  const ranges = (p, text) => modelRanges(text).map(([n, a, b]) => [n, a, b, idOf(pkgOf(p), n), n]);
  const info = () => ({ name: NAME, version: VERSION, files: new Set(Object.values(resources).map(r => r.file)).size, facts: Object.keys(resources).length + DATA.size, ms });
  return { name: NAME, resources, onNode, data, owns, ranges, info, unresolved: () => ({ data: unmatched, 'data-ambiguous': ambiguous, 'data-unknown-model': unknownModel }) };
}

module.exports = { prismaAdapter, modelRanges };
