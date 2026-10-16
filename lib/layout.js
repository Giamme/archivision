'use strict';
// The plate both modes share: one district per layer (wrapped into rows), the blocks inside it,
// and, when there is a database or a bus, a rail across the middle with numbered ports under the blocks that use them.

const GAPX = 18, PADX = 22, TOPPAD = 44, BOTPAD = 16, ROWGAP = 18, DGAP = 18, RAILD = 72;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isInt = v => Number.isInteger(v) && v >= 0;

// Gives every part a cell inside its block: the model's own col/row when all parts have one and none overlap,
// else one column per zone (in zone order), else a near-square grid.
function cells(m) {
  const parts = m.parts || [];
  const taken = new Set();
  const own = parts.length && parts.every(p => isInt(p.col) && isInt(p.row)) && parts.every(p => {
    for (let c = p.col; c < p.col + (p.cspan || 1); c++) for (let r = p.row; r < p.row + (p.rspan || 1); r++) {
      if (taken.has(`${c},${r}`)) return false; taken.add(`${c},${r}`);
    }
    return true;
  });
  if (own) return 'own';
  for (const p of parts) { delete p.cspan; delete p.rspan; }
  const zones = (m.zones || []).filter(z => z.parts && z.parts.length);
  if (zones.length) {
    const at = {}; zones.forEach((z, c) => z.parts.forEach((id, r) => { at[id] = [c, r]; }));
    let extra = zones.length;
    const loose = parts.filter(p => !at[p.id]);
    loose.forEach((p, r) => { at[p.id] = [extra, r]; });
    for (const p of parts) [p.col, p.row] = at[p.id];
    return 'zones';
  }
  const C = Math.max(1, Math.ceil(Math.sqrt(parts.length)));
  parts.forEach((p, i) => { p.col = i % C; p.row = Math.floor(i / C); });
  return 'grid';
}

function grid(m) {
  const ps = m.parts || [];
  return [Math.max(1, ...ps.map(p => (p.col || 0) + (p.cspan || 1))), Math.max(1, ...ps.map(p => (p.row || 0) + (p.rspan || 1)))];
}

// footprint of a block: width and depth grow with its columns and rows, height a little with its part count
function blockSize(m) {
  const [C, R] = grid(m);
  return [clamp(24 + C * 70 + (C - 1) * 20, 190, 460), clamp(40 + R * 38 + (R - 1) * 26, 160, 300), 50 + Math.min(14, (m.parts || []).length * 1.6)];
}

// modules: [{ id, layer, parts }] already in display order; layers: [{ id }] in display order;
// groups: [{ n, name, users: [[moduleId, weight], …] }]: one port each; none means no rail.
function plate({ modules, layers, groups = [] }) {
  const size = blockSize;
  const used = layers.filter(l => modules.some(m => m.layer === l.id));
  // a plate about as deep as it is wide reads best in the iso view; a small system gets a smaller, slightly wider plate,
  // never narrower than its widest block
  const AREA = Math.sqrt(modules.reduce((t, m) => { const [w, d] = size(m); return t + (w + GAPX) * (d + TOPPAD + BOTPAD + ROWGAP); }, 0));
  const PXT = Math.max(2 * PADX + Math.max(...modules.map(m => size(m)[0])),
    Math.round((AREA * 1.12 >= 1600 ? AREA * 1.12 : Math.max(900, Math.min(1600, AREA * 1.35))) / 10) * 10);
  const dists = [];
  for (const l of used) {
    let chunk = [], cw = 2 * PADX - GAPX;
    for (const m of modules.filter(x => x.layer === l.id)) {
      const [w] = size(m);
      if (chunk.length && cw + GAPX + w > PXT) { dists.push({ layer: l.id, mods: chunk }); chunk = []; cw = 2 * PADX - GAPX; }
      chunk.push(m); cw += GAPX + w;
    }
    if (chunk.length) dists.push({ layer: l.id, mods: chunk });
  }
  const rows = []; let row = [], rx = 0;
  for (const d of dists) {
    d.w = 2 * PADX + d.mods.reduce((a, m) => a + size(m)[0], 0) + GAPX * (d.mods.length - 1);
    d.d = TOPPAD + Math.max(...d.mods.map(m => size(m)[1])) + BOTPAD;
    if (row.length && rx + DGAP + d.w > PXT) { rows.push(row); row = []; rx = 0; }
    row.push(d); rx += (row.length > 1 ? DGAP : 0) + d.w;
  }
  if (row.length) rows.push(row);
  const PX = Math.max(PXT, ...rows.map(r => r.reduce((a, d) => a + d.w, 0) + DGAP * (r.length - 1)));
  const place = {}, districts = [], hasRail = groups.length > 0;
  const railAfter = hasRail ? Math.max(0, Math.ceil(rows.length / 2) - 1) : -1;
  let y = 0, rail = null;
  rows.forEach((r, ri) => {
    const w0 = r.reduce((a, d) => a + d.w, 0) + DGAP * (r.length - 1), extra = PX - w0, dmax = Math.max(...r.map(d => d.d));
    let x = 0;
    r.forEach((d, i) => {
      const w = d.w + (i === r.length - 1 ? extra : 0);
      districts.push({ layer: d.layer, x, y, w, d: dmax });
      let bx = x + PADX;
      for (const m of d.mods) { const [bw, bd, bh] = size(m); place[m.id] = [bx, y + TOPPAD, bw, bd, Math.round(bh)]; bx += bw + GAPX; }
      x += w + DGAP;
    });
    y += dmax + ROWGAP;
    if (ri === railAfter) { rail = { x: 0, y, w: PX, d: RAILD }; y += RAILD + ROWGAP; }
  });
  const PY = y - ROWGAP;
  // ports sit on the rail under the blocks that use them most, at least `step` apart
  let ports = [];
  if (hasRail) {
    const x0 = 40, step = 40;
    const want = groups.map(g => {
      const ws = (g.users || []).filter(u => place[u[0]]), tw = ws.reduce((a, u) => a + u[1], 0);
      return { g, x: tw ? ws.reduce((a, u) => a + (place[u[0]][0] + place[u[0]][2] / 2) * u[1], 0) / tw : PX / 2 };
    }).sort((a, b) => a.x - b.x || a.g.n - b.g.n);
    let px = x0 - step; for (const w of want) { w.x = Math.max(w.x, px + step); px = w.x; }
    if (px > PX - 40) for (let i = want.length - 1; i >= 0; i--) { const lim = i === want.length - 1 ? PX - 40 : want[i + 1].x - step; want[i].x = Math.min(want[i].x, lim); }
    ports = want.map(w => ({ n: w.g.n, x: Math.round(w.x), mod: w.g.users && w.g.users[0] ? w.g.users[0][0] : null, name: w.g.name }));
  }
  return { px: PX, py: PY, place, districts, rail, ports, rows: rows.length };
}

// the layers in the order they appear on the plate, with the rail's own layer where the rail is
function orderLayers(layers, districts, rail, railLayer) {
  const firstY = l => Math.min(...districts.filter(d => d.layer === l.id).map(d => d.y));
  const lyr = layers.filter(l => districts.some(d => d.layer === l.id))
    .sort((a, b) => firstY(a) - firstY(b) || districts.findIndex(d => d.layer === a.id) - districts.findIndex(d => d.layer === b.id));
  if (rail && railLayer) { const below = lyr.findIndex(l => firstY(l) > rail.y); lyr.splice(below < 0 ? lyr.length : below, 0, railLayer); }
  return lyr;
}

module.exports = { plate, cells, blockSize, orderLayers };
