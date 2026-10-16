'use strict';
// The semantic projection: the facts a scan and a build stand for, in a shape that does not depend on the
// scan's internal structure, so the golden can stay identical while that structure changes.
// Unordered collections are sorted; ordered ones (walkthrough steps, zones, parts, layers) keep their order.
// Timestamps, timings, absolute paths and commit hashes are left out.

const cmp = (a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
const sorted = a => a.slice().sort(cmp);
const b01 = v => (v ? 1 : 0);

// scan facts, read from the scan contract (version 2) in the shape the facts had before it (version 1), so the
// golden stays the same while the structure changes; facts that version 2 adds are not part of it
function projectScan(S) {
  if (S.version !== 2) throw new Error(`projectScan: scan version ${S.version}`);
  const F = S.files, SYM = new Map(S.symbols.map(s => [s.id, s]));
  const end = x => (SYM.has(x) ? [SYM.get(x).file, SYM.get(x).name] : [x, null]);
  const res = id => S.resources[id];
  // references: a pair of symbols with a reference and a type reference is one fact, as before
  const pair = new Map();
  for (const r of S.relations) {
    if (r.rel !== 'ref' && r.rel !== 'type') continue;
    const k = `${r.from}|${r.to}`, p = pair.get(k) || { from: r.from, to: r.to, n: 0 };
    p.n += r.n; p[r.rel] = r; pair.set(k, p);
  }
  const lam = sorted((S.entries || []).filter(e => e.variant !== 'next-app').map(e => [e.id, e.kind, e.name || null, e.handler, e.status, e.route, e.method, e.trigger || null]));
  const other = sorted(Object.entries(S.resources).filter(([, r]) => r.store !== 'prisma').map(([id, r]) => [id, r.kind, r.file, r.line, r.status]));
  return {
    files: sorted(Object.entries(F).map(([p, f]) => [p, f.lines, b01(f.test)])),
    flags: sorted(Object.entries(F).filter(([, f]) => f.flags.server || f.flags.client).map(([p, f]) => [p, b01(f.flags.server), b01(f.flags.client)])),
    entries: sorted(Object.entries(F).filter(([, f]) => f.entry).map(([p, f]) => [p, f.entry.route, f.entry.kind])),
    symbols: sorted(S.symbols.filter(s => !s.member).map(s => [s.file, s.name, s.kind, s.line, s.end, b01(s.exported)])),
    refs: sorted([...pair.values()].map(p => [...end(p.from), ...end(p.to), p.n, (p.ref || p.type).sites[0][0], b01(!p.ref)])),
    data: sorted(S.data.map(x => [...end(x.from), x.resource ? res(x.resource).name : null, b01(x.op !== 'write'), b01(x.op !== 'read'), x.sites[0][0]])),
    models: sorted(Object.values(S.resources).filter(r => r.store === 'prisma').map(r => [r.name, r.line, r.end, r.fields])),
    visits: sorted(Object.entries(S.tests).filter(([, t]) => t.visits.length).map(([f, t]) => [f, sorted(t.visits.map(v => v.route))])),
    refs_heads: sorted(((S.refs && S.refs.heads) || []).map(h => [h.name, b01(h.current)])),
    refs_bases: (S.refs && S.refs.bases) || [],
    compare: sorted((S.compare || []).map(c => [c.base, c.head, c.ahead, c.behind, sorted(c.files), sorted(Object.entries(c.syms).map(([p, ns]) => [p, sorted(ns)])), sorted(c.models)])),
    // Lambda handlers and stores other than Prisma, where a repo has them (a TypeScript repo's projection is as before)
    ...(lam.length ? { lambdas: lam } : {}),
    ...(other.length ? { stores: other } : {}),
  };
}

// build facts: what the page shows
function projectBuild({ ATLAS: A, SCENE: S }) {
  const code = c => (c ? [c.p || null, c.l || null, c.e || null, c.sym || null, c.sel || null, c.pc || null, b01(c.db)] : null);
  return {
    mode: A.mode,
    layers: A.layers.map(l => [l.id, l.name]),
    blocks: A.modules.map(m => ({
      id: m.id, layer: m.layer, name: m.name, short: m.short,
      zones: (m.zones || []).map(z => [z.name, z.parts]),
      parts: m.parts.map(p => ({
        id: p.id, name: p.name, kind: p.kind || null, cell: [p.col ?? null, p.row ?? null], ports: p.ports || null,
        files: p.code ? sorted(p.code.files.map(f => f[0])) : [],
        tests: p.code ? [p.code.vitest, p.code.e2e] : null,
        db: p.code ? sorted(p.code.db) : null,
        pieces: (p.children || []).map(c => [c.id, c.name, c.kind, c.code ? [c.code.p, c.code.l, c.code.e, c.code.sym, c.code.nCallers, c.code.nCalls, c.code.nUses ?? null] : null]),
        links: sorted((p.links || []).map(l => [l.from, l.to, l.label])),
      })),
      links: sorted((m.links || []).map(l => [l.from, l.to, l.n ?? null, l.label])),
    })),
    flows: sorted(A.flows.map(f => [f.from, f.to, f.kind, f.n ?? null, f.label, f.ports || null])),
    journeys: A.journeys.map(j => [j.name, j.group, j.steps, (j.code || []).map(code)]),
    groups: (A.groups || []).map(g => [g.n, g.id, g.name, g.models, sorted(g.users || [])]),
    cmp: {
      bases: A.cmp.bases, def: A.cmp.def,
      list: A.cmp.list.map(c => [c.base, c.head, sorted(c.f.map(([i, s]) => [A.cmp.paths[i], s])), sorted(c.mods.map(([m, n, ps]) => [m, n, sorted(ps)])), c.nsym, c.src, sorted(c.db), sorted(Object.entries(c.blast).map(([b, l]) => [b, sorted(l)]))]),
    },
    rail: S.rail, railTxt: S.railTxt, ports: S.ports,
    place: sorted(Object.entries(S.place)), districts: S.districts, plate: [S.px, S.py], demoOpen: S.demoOpen,
    totals: A.totals,
  };
}

module.exports = { projectScan, projectBuild };
