'use strict';
// Checks an architecture model (from an LLM or by hand), repairs what it safely can and reports each repair,
// then turns it into the page data: the same shape a repo build makes, without code anchors or branches.
const { KINDS } = require('./schema');
const { plate, cells, orderLayers } = require('../layout');

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const s0 = v => (v == null ? '' : String(v)).trim();
const clip = (s, n) => { s = s0(s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const A = v => (Array.isArray(v) ? v : []);

function validate(input) {
  const fixes = [], fix = s => fixes.push(s);
  if (!input || typeof input !== 'object') throw new Error('the model is not a JSON object');
  const M = JSON.parse(JSON.stringify(input));
  const uid = (id, name, seen, where) => {
    let base = slug(s0(id) || s0(name)), v = base, i = 2;
    if (s0(id) && base !== s0(id)) fix(`${where}: id «${id}» → «${base}»`);
    while (seen.has(v)) v = `${base}-${i++}`;
    if (v !== base) fix(`${where}: duplicate id «${base}» → «${v}»`);
    seen.add(v); return v;
  };
  const remap = {};   // old id → new id, per scope

  M.title = s0(M.title) || 'Architecture';
  M.intro = s0(M.intro);

  // layers
  const lseen = new Set(), lmap = {};
  M.layers = A(M.layers).map(l => { const id = uid(l.id, l.name, lseen, 'layer'); lmap[s0(l.id)] = id; return { id, name: s0(l.name) || id, blurb: s0(l.blurb), tip: clip(l.tip, 220) }; });

  // blocks, their parts and pieces
  const mseen = new Set(['dock']);
  M.modules = A(M.modules).map(m => {
    const id = uid(m.id, m.name, mseen, 'block'); if (s0(m.id)) remap[s0(m.id)] = id; if (s0(m.name)) remap['name:' + slug(m.name)] = remap['name:' + slug(m.name)] || id;
    let layer = lmap[s0(m.layer)] || (lseen.has(slug(m.layer)) ? slug(m.layer) : null);
    if (!layer) {
      if (s0(m.layer)) { layer = uid('', m.layer, lseen, 'layer'); M.layers.push({ id: layer, name: s0(m.layer), blurb: '', tip: '' }); fix(`block ${id}: unknown layer «${m.layer}», added it`); }
      else { layer = M.layers[0] ? M.layers[0].id : (M.layers.push({ id: 'system', name: 'System', blurb: '', tip: '' }), 'system'); fix(`block ${id}: no layer, put in «${layer}»`); }
    }
    const pseen = new Set(), pmap = {};
    let parts = A(m.parts).map(p => {
      const pid = uid(p.id, p.name, pseen, `part in ${id}`); if (s0(p.id)) pmap[s0(p.id)] = pid;
      let kind = s0(p.kind); if (!KINDS.includes(kind)) { if (kind) fix(`part ${id}/${pid}: kind «${kind}» → process`); kind = 'process'; }
      const cseen = new Set(), cmap = {};
      const children = A(p.children).map(c => {
        const cid = uid(c.id, c.name, cseen, `piece in ${id}/${pid}`); if (s0(c.id)) cmap[s0(c.id)] = cid;
        let ck = s0(c.kind); if (!KINDS.includes(ck)) ck = kind;
        const o = { id: cid, name: s0(c.name) || cid, tag: s0(c.tag) || s0(c.name) || cid, kind: ck, what: s0(c.what), tip: clip(c.tip, 220) };
        for (const k of ['col', 'row', 'cspan', 'rspan']) if (Number.isInteger(c[k])) o[k] = c[k];
        if (c.status) o.status = s0(c.status);
        return o;
      });
      const links = A(p.links).map(l => ({ from: cmap[s0(l.from)] || s0(l.from), to: cmap[s0(l.to)] || s0(l.to), label: s0(l.label) }))
        .filter(l => { const ok = l.from !== l.to && cseen.has(l.from) && cseen.has(l.to); if (!ok) fix(`part ${id}/${pid}: dropped link ${l.from} → ${l.to}`); return ok; });
      const out = { id: pid, name: s0(p.name) || pid, tag: s0(p.tag) || s0(p.name) || pid, kind, what: s0(p.what), tip: clip(p.tip, 220), children, links };
      for (const k of ['col', 'row', 'cspan', 'rspan']) if (Number.isInteger(p[k])) out[k] = p[k];
      if (p.status) out.status = s0(p.status);
      return out;
    });
    if (!parts.length) { parts = [{ id: 'core', name: s0(m.name) || id, tag: s0(m.short || m.name) || id, kind: 'process', what: s0(m.role), tip: clip(m.tip, 220), children: [], links: [] }]; fix(`block ${id}: had no parts, gave it one`); }
    const zones = A(m.zones).map(z => ({ name: s0(z.name) || 'Parts', tip: s0(z.tip), parts: A(z.parts).map(x => pmap[s0(x)] || slug(x)).filter(x => pseen.has(x)) }));
    const inZ = new Set(); for (const z of zones) z.parts = z.parts.filter(x => !inZ.has(x) && inZ.add(x));
    const kept = zones.filter(z => z.parts.length);
    const loose = parts.filter(p => !inZ.has(p.id)).map(p => p.id);
    const placed = parts.every(p => Number.isInteger(p.col) && Number.isInteger(p.row));   // parts with their own cells: zones only frame some of them
    if (kept.length && loose.length && !placed) { kept.push({ name: 'Other', tip: 'Parts the sources did not place in a step.', parts: loose }); fix(`block ${id}: parts outside any zone (${loose.join(', ')}) went to «Other»`); }
    const links = A(m.links).map(l => ({ from: pmap[s0(l.from)] || s0(l.from), to: pmap[s0(l.to)] || s0(l.to), label: s0(l.label) }))
      .filter(l => { const ok = l.from !== l.to && pseen.has(l.from) && pseen.has(l.to); if (!ok) fix(`block ${id}: dropped link ${l.from} → ${l.to}`); return ok; });
    const out = { id, layer, name: s0(m.name) || id, short: s0(m.short) || s0(m.name) || id, role: s0(m.role), tip: clip(m.tip, 220), zones: kept, parts, links };
    if (m.layout) out.layout = m.layout;
    return out;
  });
  if (!M.modules.length) throw new Error('the model has no blocks');
  const MOD = Object.fromEntries(M.modules.map(m => [m.id, m]));
  const mid = x => !s0(x) ? null : remap[s0(x)] || (MOD[slug(x)] ? slug(x) : remap['name:' + slug(x)] || null);
  M.layers = M.layers.filter(l => M.modules.some(m => m.layer === l.id) || (fix(`layer ${l.id}: no blocks, dropped`), false));

  // flows between blocks, merged when the same pair repeats
  const fseen = {};
  M.flows = A(M.flows).map(f => ({ from: mid(f.from), to: mid(f.to), label: s0(f.label), kind: s0(f.kind) || 'uses', _raw: `${f.from} → ${f.to}` }))
    .filter(f => { if (!f.from || !f.to || f.from === f.to) { fix(`dropped flow ${f._raw}`); return false; } return true; })
    .filter(f => { const k = `${f.from}|${f.to}`; if (fseen[k]) { fseen[k].label = [fseen[k].label, f.label].filter(Boolean).join(' · '); fix(`merged flow ${f._raw}`); return false; } fseen[k] = f; return true; })
    .map(({ _raw, ...f }) => f);

  // the bus: numbered ports, each with the blocks on it
  const b = M.bus || {}, nseen = new Set();
  let ports = A(b.ports).map(p => ({ n: Number.isInteger(p.n) && p.n > 0 ? p.n : 0, name: s0(p.name) || 'Port', tip: s0(p.tip), modules: [...new Set(A(p.modules).map(mid).filter(Boolean))], _n: p.n }));
  let next = 1;
  for (const p of ports) {
    if (!p.n || nseen.has(p.n)) { while (nseen.has(next)) next++; if (p._n != null) fix(`port «${p.name}»: number ${p._n} → ${next}`); p.n = next; }
    nseen.add(p.n); delete p._n;
  }
  ports.sort((x, y) => x.n - y.n);
  M.bus = { name: s0(b.name), tip: s0(b.tip), ports };
  if (ports.length && !M.bus.name) { M.bus.name = 'Bus'; fix('the bus had ports but no name: called it «Bus»'); }
  if (!ports.length && M.bus.name) fix(`the bus «${M.bus.name}» has no ports: no rail drawn`);

  // walkthroughs: steps at blocks (with a part when known) or at bus ports
  M.journeys = A(M.journeys).map(j => {
    const steps = A(j.steps).map(s => {
      const at = s0(s.at);
      if (/^P\d+$/i.test(at)) return nseen.has(+at.slice(1)) ? { at: 'P' + +at.slice(1), part: '', note: s0(s.note) } : (fix(`walkthrough «${j.name}»: unknown port ${at}`), null);
      const m = mid(at); if (!m) { fix(`walkthrough «${j.name}»: unknown block ${at}`); return null; }
      const ps = MOD[m].parts, part = s0(s.part) && (ps.find(p => p.id === s0(s.part)) || ps.find(p => p.id === slug(s.part)));
      if (s0(s.part) && !part) fix(`walkthrough «${j.name}»: unknown part ${m}/${s.part}`);
      return { at: m, part: part ? part.id : '', note: s0(s.note) };
    }).filter(Boolean);
    return { name: s0(j.name) || 'Walkthrough', group: s0(j.group), caption: s0(j.caption), steps };
  }).filter(j => j.steps.length > 1 || (fix(`walkthrough «${j.name}»: fewer than two steps, dropped`), false));
  M.unclear = A(M.unclear).map(s0).filter(Boolean);
  return { model: M, fixes };
}

// the page data: ATLAS (what the panel reads) and SCENE (where things sit)
function archToScene(model, meta = {}) {
  const M = JSON.parse(JSON.stringify(model));
  const ports = M.bus.ports, hasBus = ports.length > 0;
  const modules = M.modules.map(m => {
    const mod = { ...m, count: `${m.parts.length} parts`, disp: `${m.parts.length} parts`,
      parts: m.parts.map(p => ({ ...p, tag: p.tag || p.name, children: p.children.map(c => ({ ...c, tag: c.tag || c.name })) })) };
    cells(mod); return mod;
  });
  // ports go under the blocks on them; flows to the rail make the cables
  const users = {};
  for (const p of ports) users[p.n] = p.modules.map(m => [m, 1, '']);
  const groups = ports.map(p => ({ n: p.n, id: `p${p.n}-${slug(p.name)}`, name: p.name, tip: p.tip, models: [], modelsInfo: [], users: users[p.n] }));
  const P = plate({ modules, layers: M.layers, groups });
  const railLayer = hasBus ? { id: 'dock', name: M.bus.name, blurb: `${ports.length} ports`, tip: M.bus.tip || `${M.bus.name}: ${ports.length} numbered ports; cables show which blocks plug into each.` } : null;
  const layers = orderLayers(M.layers, P.districts, P.rail, railLayer);
  const flows = M.flows.map(f => ({ from: f.from, to: f.to, label: f.label, kind: f.kind }));
  for (const p of ports) for (const m of p.modules) flows.push({ from: m, to: 'dock', ports: [p.n], kind: 'on the bus', label: `P${p.n}: ${p.name}` });
  const dock = hasBus ? { id: 'dock', layer: 'dock', name: M.bus.name, short: M.bus.name, role: M.bus.tip || `${ports.length} ports`, count: `${ports.length} ports`, tip: railLayer.tip,
    parts: ports.map(p => ({ id: `p${p.n}`, name: p.name, what: p.tip || `${p.modules.length} blocks`, ports: [p.n] })) } : null;
  const journeys = M.journeys.map(j => ({ name: j.name, group: j.group, caption: j.caption, steps: j.steps.map(s => s.at), notes: j.steps.map(s => s.note),
    code: j.steps.map(s => (s.part ? { sel: `${s.at}/${s.part}` } : null)) }));
  const nParts = modules.reduce((a, m) => a + m.parts.length, 0), nPieces = modules.reduce((a, m) => a + m.parts.reduce((b, p) => b + p.children.length, 0), 0);
  const ATLAS = { mode: 'arch', title: M.title, intro: M.intro, generator: meta.by || 'hand', source: meta.source || '', repo: null,
    layers, modules: dock ? [...modules, dock] : modules, flows, journeys, groups,
    cmp: { paths: [], hash: [], list: [], def: 0, bases: [], heads: [] },
    rail: dock ? { tip: railLayer.tip, label: M.bus.name.toLowerCase() } : null,
    ports: Object.fromEntries(ports.map(p => [p.n, { name: p.name, tip: p.tip }])),
    totals: { blocks: modules.length, parts: nParts, pieces: nPieces, ports: ports.length } };
  const demo = modules.slice().sort((a, b) => b.parts.filter(p => p.children.length).length - a.parts.filter(p => p.children.length).length || b.parts.length - a.parts.length)[0];
  const firstJ = journeys[0] && journeys[0].steps.find(x => !/^P\d+$/.test(x));
  const SCENE = { px: P.px, py: P.py, place: P.place, districts: P.districts, rail: P.rail, ports: P.ports,
    railTxt: hasBus ? `${M.bus.name.toUpperCase()} · ${ports.length} PORTS` : '', portmap: {}, front: '__none__', demoOpen: firstJ || demo.id, labels: {} };
  const summary = `blocks ${modules.length} · parts ${nParts} · pieces ${nPieces} · flows ${M.flows.length} · walkthroughs ${journeys.length} · ports ${ports.length} · plate ${P.px}×${P.py}`;
  return { ATLAS, SCENE, summary };
}

module.exports = { validate, archToScene, slug };
