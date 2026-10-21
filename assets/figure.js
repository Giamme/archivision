FIGS3D.push({ id: 'az', name: '__NAME__', mod: (() => {
  const AZ = __ATLAS__;       // three levels deep: blocks, parts, pieces (parsed symbols in a repo, named pieces in an architecture)
  const SCENE = __SCENE__;    // where each block sits on the plate
  const REPO = AZ.repo || null, ARCH = !REPO;
  // the code roots, test runners and data store the scan found; the defaults are what older pages assumed
  const ROOTS = AZ.roots || ['src'], ROOTS_TXT = ROOTS.map(r => r === '.' ? 'the repo' : r).join(', '), RUN = AZ.runner || { unit: 'Vitest', e2e: 'Playwright' }, STORE = AZ.store || { label: 'Prisma', what: 'models' };
  const TEST_RE = new RegExp(`^(${[...ROOTS.map(r => r === '.' ? '__tests__' : `${r}/__tests__`), ...(AZ.testRoots || ['tests', 'e2e'])].map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})/`);
  const RL = (AZ.rail && AZ.rail.label) || 'database', RLC = RL[0].toUpperCase() + RL.slice(1), WHOLE = REPO ? 'Whole repo' : 'Whole map';
  const STILL = /[?&]still\b/.test(location.search);
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers (as in the flat version) ---------- */
  const clamp = v => Math.max(0, Math.min(1, v));
  const segT = (v, a, b) => clamp((v - a) / (b - a));
  const ez = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const back = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  const CW = .61;                                           // monospace advance, in em
  const words = s => String(s).replace(/ ·/g, ' ·').split(' ');
  const wrap = (s, n) => {
    const o = []; let c = '';
    const add = (w, sep) => { if (!c) c = w; else if ((c + sep + w).length <= n) c += sep + w; else { o.push(c); c = w; } };
    for (const w of words(s)) {
      if (w.length <= n) add(w, ' ');
      else w.split(/(?<=[_(\/.-])|(?<=[a-z0-9])(?=[A-Z])/).forEach((q, i) => add(q, i ? '' : ' '));   // long identifiers break after _ ( / . - and between camelCase words
    }
    if (c) o.push(c); return o;
  };
  const fit = (s, width, hmax, fmax, lines, fmin = 3.5, step = .5) => {
    for (let f = fmax; f >= fmin; f -= step) {
      const n = Math.floor(width / (CW * f)); if (n < 1) continue;
      const L = wrap(s, n);
      if (L.length <= lines && L.every(l => l.length <= n) && L.length * f * 1.18 <= hmax) return { f, L };
    }
    return null;
  };
  const num = i => String(i + 1).padStart(2, '0');
  const isPort = s => /^P\d+$/.test(s);
  const portsIn = label => (String(label).match(/P(\d+)/g) || []).map(s => +s.slice(1));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const KIND = {
    ui: { h: 14, label: 'surface the user sees' }, endpoint: { h: 12, label: 'entry point' }, agent: { h: 24, label: 'agent' },
    model: { h: 15, label: 'model' }, process: { h: 19, label: 'process' }, gate: { h: 12, label: 'check or decision' },
    queue: { h: 15, label: 'queue' }, store: { h: 22, label: 'data kept' }, external: { h: 12, label: 'outside service' },
    config: { h: 10, label: 'configuration' },
  };

  /* ---------- the blocks and what is inside them (the flat version's layout, unchanged) ---------- */
  const MOD = Object.fromEntries(AZ.modules.map(m => [m.id, m]));
  const LAYER = Object.fromEntries(AZ.layers.map(l => [l.id, l]));
  const PL = SCENE.place;
  const LIST = AZ.layers.flatMap(l => AZ.modules.filter(m => m.layer === l.id && (PL[m.id] || m.id === 'dock')));
  const PORT = Object.fromEntries(SCENE.ports.map(p => [p.n, p]));
  const DOCKSETS = MOD.dock ? MOD.dock.parts.map(p => p.ports) : [];
  const GROUP = Object.fromEntries(AZ.groups.map(g => [g.n, g]));
  const portsOf = f => f.ports || portsIn(f.label);
  const NODE = {};
  function layoutKids(n, items, layout, zones, links, level) {
    const L2 = level === 2, s = Math.min(n.w, n.d), hasZ = !!(zones && zones.length);
    const wide = L2 && Math.max(0, ...items.map(it => (it.col || 0) + (it.cspan || 1))) >= 6;
    const gx = L2 ? (wide ? 14 : 20) : Math.max(2.6, s * .08), gy = L2 ? (hasZ ? 26 : 20) : gx * .9;
    const padX = L2 ? 12 : Math.max(3, s * .09), padT = L2 ? (hasZ ? 26 : 14) : Math.max(3.4, s * .11), padB = L2 ? 14 : Math.max(3, s * .09);
    const iw = n.w - 2 * padX, id = n.d - padT - padB;
    const room = (c, r, nItems) => Math.min((iw - (c - 1) * gx) / c / 1.5, (id - (r - 1) * gy) / r) - (c * r - nItems) * s * .01;
    const cand = [];
    if (items.every(it => Number.isInteger(it.col) && Number.isInteger(it.row))) {
      const cells = items.map(it => [it.col, it.row, it.cspan || 1, it.rspan || 1]);
      const C = Math.max(...cells.map(c => c[0] + c[2])), R = Math.max(...cells.map(c => c[1] + c[3]));
      cand.push({ C, R, cells, score: room(C, R, items.length) + (L2 ? 1e6 : 0) });
      if (!L2) cand.push({ C: R, R: C, cells: cells.map(([c, r, cs, rs]) => [r, c, rs, cs]), score: room(R, C, items.length) });
    }
    if (!L2 || !cand.length) for (let c = 1; c <= items.length; c++) {
      const r = Math.ceil(items.length / c);
      cand.push({ C: c, R: r, cells: items.map((_, i) => [i % c, Math.floor(i / c), 1, 1]), score: room(c, r, items.length) });
    }
    const best = cand.reduce((a, b) => b.score > a.score * 1.08 ? b : a);
    const { C, R, cells } = best;
    const cw = (iw - (C - 1) * gx) / C, ch = (id - (R - 1) * gy) / R;
    const sc = L2 ? 1 : Math.max(.22, Math.min(1, s / 110));
    items.forEach((it, i) => {
      const [c, r, cs, rs] = cells[i], kind = KIND[it.kind] ? it.kind : 'process';
      const k = { id: `${n.id}/${it.id || i}`, level, item: it, idx: i, parent: n, name: it.name, tag: it.tag || it.name, tip: it.tip, what: it.what, kind,
        x: n.x + padX + c * (cw + gx), y: n.y + padT + r * (ch + gy), w: cs * cw + (cs - 1) * gx, d: rs * ch + (rs - 1) * gy, kids: [], links: [], zones: [] };
      if (kind === 'model' && k.d > k.w * .8) { const nd = k.w * .8; k.y += (k.d - nd) / 2; k.d = nd; }
      k.h = (KIND[kind].h + (it.children && it.children.length ? 5 : 0)) * sc;
      NODE[k.id] = k; n.kids.push(k);
    });
    const byId = Object.fromEntries(n.kids.map(k => [k.item.id, k]));
    n.links = (links || []).map(l => ({ a: byId[l.from], b: byId[l.to], label: l.label, status: l.status })).filter(l => l.a && l.b && l.a !== l.b);
    n.zones = (zones || []).map((z, zi) => {
      const ks = (z.parts || []).map(p => byId[p]).filter(Boolean); if (!ks.length) return null;
      const x0 = Math.min(...ks.map(k => k.x)), y0 = Math.min(...ks.map(k => k.y)), x1 = Math.max(...ks.map(k => k.x + k.w)), y1 = Math.max(...ks.map(k => k.y + k.d));
      return { id: `${n.id}#z${zi}`, kind: 'zone', parent: n, name: z.name, tip: z.tip, x: x0 - 7, y: y0 - 15, w: x1 - x0 + 14, d: y1 - y0 + 22 };
    }).filter(Boolean);
    for (const z of n.zones) NODE[z.id] = z;
    if (L2) for (const k of n.kids) if (k.item.children && k.item.children.length) layoutKids(k, k.item.children, null, null, k.item.links, 3);
  }
  for (const m of LIST) {
    const n = NODE[m.id] = { id: m.id, level: 1, m, name: m.name, tag: m.short, tip: m.tip, what: m.role, kind: m.id === 'dock' ? 'rail' : 'block', parent: null, kids: [], links: [], zones: [] };
    if (!PL[m.id]) continue;
    [n.x, n.y, n.w, n.d, n.h] = PL[m.id];
    layoutKids(n, m.parts, m.layout, m.zones, m.links, 2);
  }
  const openable = n => !!n && n.kind !== 'zone' && (n.level === 1 || (n.level === 2 && n.kids.length > 0));
  const rootOf = n => { while (n.parent) n = n.parent; return n; };
  const stagger = (n, i) => { const k = Math.min(.06, .3 / n.kids.length); return [.34 + i * k, .64 + i * k]; };
  const liftOf = n => n.level === 1 ? 170 : Math.max(16, Math.min(n.w, n.d) * 1.1);
  const PX = SCENE.px, PY = SCENE.py, R = SCENE.rail, ZM = Math.max(...Object.values(PL).map(p => p[4]));

  /* ---------- the cables between parts, as arcs from roof edge to roof edge ---------- */
  const ends = (a, b, ha, hb) => {
    const g = [b.x - a.x - a.w, a.x - b.x - b.w, b.y - a.y - a.d, a.y - b.y - b.d], k = g.indexOf(Math.max(...g));
    const ov = (a0, a1, b0, b1) => { const lo = Math.max(a0, b0), hi = Math.min(a1, b1); return lo < hi ? (lo + hi) / 2 : null; };
    if (k < 2) { const yc = ov(a.y, a.y + a.d, b.y, b.y + b.d), ya = yc ?? a.y + a.d / 2, yb = yc ?? b.y + b.d / 2;
      return k === 0 ? [[a.x + a.w, ya, ha], [b.x, yb, hb]] : [[a.x, ya, ha], [b.x + b.w, yb, hb]]; }
    const xc = ov(a.x, a.x + a.w, b.x, b.x + b.w), xa = xc ?? a.x + a.w / 2, xb = xc ?? b.x + b.w / 2;
    return k === 2 ? [[xa, a.y + a.d, ha], [xb, b.y, hb]] : [[xa, a.y, ha], [xb, b.y + b.d, hb]];
  };
  const curve = (A, B, lift0, k) => {
    const dist = Math.hypot(B[0] - A[0], B[1] - A[1]), c = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, Math.max(A[2], B[2]) + lift0 + dist * k], pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; pts.push([0, 1, 2].map(j => u * u * A[j] + 2 * u * t * c[j] + t * t * B[j])); }
    return pts;
  };

  /* ---------- 3D: per-element materials, so anything can dim, fade away or light up on its own ---------- */
  const g0 = new THREE.Group(); g0.visible = false; scene.add(g0);
  const OUT_FS = 'uniform vec3 color; uniform float opacity; void main() { gl_FragColor = vec4(color, opacity); }';
  const INKHI = new THREE.Color(), DETAIL = new THREE.Color(), LINK0 = new THREE.Color(), GLASSON = new THREE.Color(), TMPC = new THREE.Color();
  let PALC = null;                                          // canvas colours for the current theme and accent
  function palette() {
    const C = pal3(), light = theme === 'light', hi = TMPC.copy(accent).lerp(new THREE.Color(light ? 0x000000 : 0xffffff), light ? .3 : .42);
    PALC = { ...C, acc: '#' + accent.getHexString(), accHi: '#' + hi.getHexString(), light };
    INKHI.set(C.inkHi); DETAIL.set(light ? '#c3c6c8' : '#34373a'); GLASSON.set(C.glassOn);
  }
  palette();
  const setOp = (m, o) => { m.opacity = o; const t = o < .999; if (m.transparent !== t) m.transparent = t; };
  function lmat(o = {}) {
    const m = new LineMaterial({ color: 0x777777, linewidth: 1, resolution: devRes(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, ...o });
    m.uniforms.resolution = lineMat.uniforms.resolution;   // follows the shell's resize
    return m;
  }
  function mats() {
    const out = new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color() }, thickness: outlineMat.uniforms.thickness, res: outlineMat.uniforms.res, opacity: { value: 1 } },
      vertexShader: outlineMat.vertexShader, fragmentShader: OUT_FS, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 24 });
    return { body: bodyMat.clone(), out, line: lmat(), major: lmat(), labs: [] };
  }
  // vis: 1 normal → 0 gone into the background; hot: 0..1 toward the accent; hov: 0..1 brighter; op: lines and print; opB: the solid
  function paint(M, vis, hot, hov, op, opB) {
    const mix = (dst, base) => { dst.copy(base); if (hov > .01) dst.lerp(INKHI, hov * .5); if (hot > .01) dst.lerp(accent, hot); if (vis < .999) dst.lerp(BG_COL, 1 - vis); };
    mix(M.line.color, lineMat.color); mix(M.major.color, majorMat.color); mix(M.out.uniforms.color.value, outlineMat.uniforms.color.value);
    M.line.linewidth = M.major.linewidth = lineMat.linewidth * (1 + .5 * hot);
    M.body.color.copy(bodyMat.color); if (vis < .999) M.body.color.lerp(BG_COL, (1 - vis) * .6);
    setOp(M.body, opB); setOp(M.line, op); setOp(M.major, op);
    M.out.uniforms.opacity.value = op; if (M.out.transparent !== op < .999) M.out.transparent = op < .999;
    const lo = op * (.1 + .9 * vis); for (const m of M.labs) m.opacity = lo;
  }
  const lineCol = (m, base, hot, vis) => { m.color.copy(base); if (hot > .01) m.color.lerp(accent, hot); if (vis < .999) m.color.lerp(BG_COL, 1 - vis); };
  const noRay = o => { o.raycast = () => {}; return o; };
  // a box rounded in plan, with its own silhouette and crease hairlines (the shell's rbox, on this element's materials)
  function solid(x, y, z, w, d, h, r, M, parent, ud) {
    r = Math.max(.01, Math.min(r, w / 2 - .01, d / 2 - .01));
    const sh = new THREE.Shape(); roundRect(sh, x, -(y + d), w, d, r);
    const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: r > 3 ? 10 : 4 });
    g.rotateX(-Math.PI / 2); g.translate(0, z, 0); g.scale(TS, TS, TS);
    const m = new THREE.Mesh(g, M.body); m.userData = ud || {};
    m.add(noRay(new THREE.Mesh(g, M.out)));
    for (const [thr, mat] of [[30, M.line], [60, M.major]]) { const a = creaseLines(g, thr); if (a.length) { const l = noRay(fat(a, mat)); if (mat === M.major) l.renderOrder = 1; m.add(l); } }
    parent.add(m); return m;
  }
  const loopAt = (x, y, w, d, r, z, mat, parent, n = 8) => { const sh = new THREE.Shape(); roundRect(sh, x, -(y + d), w, d, Math.max(.01, Math.min(r, w / 2 - .01, d / 2 - .01)));
    const l = noRay(loopL(sh.getPoints(n).map(p => W(p.x, -p.y, z)), mat)); parent.add(l); return l; };

  /* ---------- print: canvases lying on faces, drawn in the flat version's units ---------- */
  const TXT = [];
  const font = (x, f, s, wt = 400) => { x.font = `${wt} ${(f * s).toFixed(2)}px ${MONO3}`; };
  function tplane(w, h, P, draw, parent, M, node) {
    const s = Math.max(.6, Math.min(P, 1024 / w, 1024 / h)), cw = Math.max(2, Math.ceil(w * s)), ch = Math.max(2, Math.ceil(h * s));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 });
    const mesh = noRay(new THREE.Mesh(new THREE.PlaneGeometry(w * TS, h * TS), mat)); mesh.renderOrder = 3;
    const t = { c, x: c.getContext('2d'), tex, s, w, h, mesh, mat, fonts: [], node, gone: false };
    t.redraw = () => { if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; } const x = t.x; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cw, ch); t.fonts = []; draw(x, s, PALC, t); t.gone = false; tex.needsUpdate = true; };
    tex.onUpdate = () => { c.width = c.height = 1; };      // once on the GPU the canvas is not needed until the next redraw
    mesh.onBeforeRender = () => { if (t.gone) t.redraw(); };
    mesh.userData.tp = t;
    t.redraw(); TXT.push(t); parent.add(mesh); if (M) M.labs.push(mat); return t;
  }
  // a box that closed: its print leaves the GPU and is drawn again the next time it is on screen
  const release = g => g.traverse(o => { const t = o.userData && o.userData.tp; if (t && !t.gone) { t.tex.dispose(); t.c.width = t.c.height = 1; t.gone = true; } });
  const roofAt = (t, x, y, z) => { t.mesh.rotation.x = -Math.PI / 2; t.mesh.position.copy(W(x + t.w / 2, y + t.h / 2, z + .14)); t.face = 'top'; return t; };
  const frontAt = (t, x, y, ztop) => { t.mesh.position.copy(W(x + t.w / 2, y + .14, ztop - t.h / 2)); t.face = 'front'; return t; };
  function lines(x, s, F, X, Y, color, maxW, t, wt) {
    font(x, F.f, s, wt); x.fillStyle = color; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    F.L.forEach((ln, i) => x.fillText(ln, X * s, (Y + F.f * (.82 + i * 1.18)) * s, maxW * s)); if (t) t.fonts.push(F.f);
  }
  const rr = (x, s, X, Y, w, h, r) => { x.beginPath(); x.roundRect(X * s, Y * s, Math.max(0, w) * s, Math.max(0, h) * s, Math.max(0, Math.min(r, w / 2, h / 2)) * s); };
  // device pixels per unit once the element around n is open and framed (sets how sharp its print is drawn)
  const pxIn = host => Math.max(2, Math.min(16, 2 * Math.min(1700, innerWidth) * .6 / Math.max(host.w, host.d * 1.6)));

  /* ---------- the plate, its districts and the dock (static) ---------- */
  const PICK = [], VIS = {};
  const first0 = twMeshes.length;
  const plate = rbox(-34, -34, -16, PX + 68, PY + 68, 16, 26, bodyMat, g0); plate.userData = { plate: true }; PICK.push(plate);
  loopAt(-22, -22, PX + 44, PY + 44, 18, .06, lineMat, g0, 12);
  for (const [a, b] of [[-11, -11], [PX + 11, -11], [-11, PY + 11], [PX + 11, PY + 11]]) {
    const sc = noRay(new THREE.Mesh(new THREE.CircleGeometry(5 * TS, 24), recessMat)); sc.rotation.x = -Math.PI / 2; sc.position.copy(W(a, b, .05)); g0.add(sc);
    seg([[[a - 3, b, .2], [a + 3, b, .2]]], g0);
  }
  const DIST = [];
  for (const dd of SCENE.districts) {
    inset(dd.x, dd.y, 0, dd.w, dd.d, 16, g0);
    const name = (SCENE.labels[dd.layer] || LAYER[dd.layer].name).toUpperCase(), f = Math.min(26, (dd.w - 70) / (name.length * (CW + .14)));
    roofAt(tplane(name.length * f * (CW + .14) + 6, f * 1.4, 4, (x, s, C, t) => { font(x, f, s); x.letterSpacing = `${(f * .14 * s).toFixed(1)}px`; x.fillStyle = C.ink; x.fillText(name, 0, f * 1.05 * s); x.letterSpacing = '0px'; t.fonts.push(f); }, g0), dd.x + 20, dd.y + 12, 0);
    DIST.push({ id: 'L:' + dd.layer, layer: dd.layer, at: [dd.x + 20 + f * name.length * (CW + .14) + 18, dd.y + 14 + f * .5, .3] });
  }
  const RT = SCENE.railTxt || '', RTW = 16 * RT.length * (CW + .14) + 8;
  if (R) {
  const rail = rbox(R.x, R.y, 0, R.w, R.d, 5, 10, bodyMat, g0); rail.userData = { rail: true }; PICK.push(rail);
  roofAt(tplane(RTW, 22, 5, (x, s, C, t) => { font(x, 16, s); x.letterSpacing = `${(16 * .14 * s).toFixed(1)}px`; x.fillStyle = C.ink; x.fillText(RT, 0, 17 * s); x.letterSpacing = '0px'; t.fonts.push(16); }, g0), R.x + 20, R.y + R.d - 28, 5);
  }
  creases(first0);
  const PORTV = {};
  for (const pt of SCENE.ports) {
    const M = mats(), P = PORTV[pt.n] = { M, hot: 0, dim: 0, hd: false };
    const b = solid(pt.x - 14, R.y + 6, 5, 28, 32, 6, 3, M, g0, { port: pt.n }); PICK.push(b);
    P.ledMat = new THREE.MeshBasicMaterial({ color: DETAIL.clone(), toneMapped: false, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 });
    const led = noRay(new THREE.Mesh(new THREE.PlaneGeometry(18 * TS, 3.5 * TS), P.ledMat)); led.rotation.x = -Math.PI / 2; led.position.copy(W(pt.x, R.y + 10.75, 11.16)); g0.add(led);
    P.lab = roofAt(tplane(28, 22, 7, (x, s, C, t) => { font(x, 14, s, 500); x.textAlign = 'center'; x.fillStyle = P.hd ? C.accHi : C.ink; x.fillText(String(pt.n), 14 * s, 17 * s); t.fonts.push(14); }, g0, M), pt.x - 14, R.y + 14, 11);
    P.glow = glowPoints([W(pt.x, R.y + 10.75, 11.6)], .32); g0.add(P.glow);
  }

  /* ---------- level 1: the blocks ---------- */
  function buildBlock(n) {
    const v = VIS[n.id] = { n, root: new THREE.Group(), cover: new THREE.Group(), M: mats(), inner: null, dim: 0, hot: 0, hov: 0, halo: 0, q: 1, hotDrawn: false };
    g0.add(v.root); v.root.add(v.cover);
    const { x, y, w, d, h } = n;
    PICK.push(solid(x, y, 0, w, d, h, 9, v.M, v.cover, { node: n, cover: true }));
    // the roof: a tint when lit, the name, one led per part
    v.tintMat = new THREE.MeshBasicMaterial({ color: GLASSON.clone(), toneMapped: false, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    { const sh = new THREE.Shape(); roundRect(sh, x + 1, -(y + d - 1), w - 2, d - 2, 8); const tg = new THREE.ShapeGeometry(sh, 8); tg.rotateX(-Math.PI / 2); tg.translate(0, h + .08, 0); tg.scale(TS, TS, TS);
      const tm = noRay(new THREE.Mesh(tg, v.tintMat)); tm.renderOrder = 2; v.cover.add(tm); }
    const nm = fit(n.m.short, w - 28, d - 44, 46, 2, 8);
    if (nm) v.name = roofAt(tplane(w - 24, nm.L.length * nm.f * 1.18 + 5, 4, (cx, s, C, t) => lines(cx, s, nm, 2, 2, v.hotDrawn ? C.accHi : C.inkHi, w - 28, t, 500), v.cover, v.M, n), x + 12, y + 10, h);
    v.ledMat = new THREE.MeshBasicMaterial({ color: DETAIL.clone(), toneMapped: false, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 });
    v.M.labs.push(v.ledMat);
    const ledPts = [], quad = [];
    n.m.parts.forEach((_, i) => { const lx = x + 14 + i * 10 + 3, ly = y + d - 15;
      for (const [a, b] of [[-3, -3], [-3, 3], [3, 3], [-3, -3], [3, 3], [3, -3]]) quad.push(...W(lx + a, ly + b, h + .16).toArray());
      ledPts.push(W(lx, ly, h + .6)); });
    { const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(quad, 3)); v.cover.add(noRay(new THREE.Mesh(lg, v.ledMat))); }
    v.ledGlow = glowPoints(ledPts, .16); v.cover.add(v.ledGlow);
    // the front: a small display with the count
    const cf = fit(n.m.disp || `${n.m.parts.length} parts`, w - 36, 12, 10, 1, 5);
    v.disp = frontAt(tplane(w - 24, 16, 4, (cx, s, C, t) => {
      const on = v.hotDrawn; cx.fillStyle = on ? C.glassOn : C.glassOff; cx.strokeStyle = on ? C.acc : C.detail; cx.lineWidth = Math.max(1, .5 * s);
      rr(cx, s, .5, .5, w - 25, 15, 3); cx.fill(); cx.stroke();
      if (cf) { font(cx, cf.f, s); cx.fillStyle = on ? C.accHi : C.ink; cx.textBaseline = 'middle'; cx.fillText(cf.L[0], 6 * s, 8.3 * s, (w - 36) * s); t.fonts.push(cf.f); }
    }, v.cover, v.M, n), x + 12, y + d, h - 10);
    // the side: vents
    const sl = []; for (let u = 16; u <= Math.min(d - 16, 72) + 1e-6; u += 8) sl.push([[x + w + .08, y + d - u, h - 10], [x + w + .08, y + d - u, 8]]);
    seg(sl, v.cover, v.M.line);
    // a pool of light on the plate around it, for the dark theme
    v.haloMat = softMat(0xffffff, true); v.haloMat.uniforms.color.value.copy(accent);
    const hm = noRay(new THREE.Mesh(new THREE.PlaneGeometry((w + 90) * TS, (d + 90) * TS), v.haloMat)); hm.rotation.x = -Math.PI / 2; hm.position.copy(W(x + w / 2, y + d / 2, .5)); v.root.add(hm);
  }
  for (const m of LIST) if (PL[m.id]) buildBlock(NODE[m.id]);

  /* ---------- levels 2 and 3: parts and the pieces inside them, built the first time they are needed ---------- */
  function buildPart(n) {
    const pv = VIS[n.parent.id];
    const v = VIS[n.id] = { n, root: new THREE.Group(), cover: new THREE.Group(), M: mats(), inner: null, dim: 0, hot: 0, q: 0, hotDrawn: false };
    pv.inner.add(v.root); v.root.add(v.cover); v.root.visible = false;
    const { x, y, w, d, kind } = n, sm = Math.min(w, d), hh = n.h, L3 = n.level === 3, P = pxIn(n.parent);
    const r = kind === 'model' ? sm / 2 : kind === 'store' ? sm * .3 : Math.min(4, sm * .07);
    PICK.push(solid(x, y, 0, w, d, hh, r, v.M, v.cover, { node: n, cover: true }));
    if (kind === 'store' && hh > sm * .18) for (const k of [1, 2]) loopAt(x, y, w, d, r, hh * k / 3, v.M.line, v.cover, 6);
    // roof: the name, a stack mark when there is another level inside, the led of a model
    const deeper = openable(n) && n.level === 2;
    const pad = Math.max(2.2, sm * .085), side = kind === 'model' ? r * .62 : pad, mark = deeper ? Math.max(5, sm * .16) : 0;
    const lab = fit(n.tag, w - 2 * side - (deeper ? mark * .9 : 0), d - 2 * pad, 12, 4, L3 ? .6 : 3.2, L3 ? .1 : .5);
    v.roof = roofAt(tplane(w, d, P, (cx, s, C, t) => {
      const on = v.hotDrawn;
      if (on) { cx.fillStyle = C.glassOn; rr(cx, s, .5, .5, w - 1, d - 1, r - .5); cx.fill(); }
      if (kind === 'external') { cx.setLineDash([2.4 * s, 1.8 * s]); cx.strokeStyle = on ? C.acc : C.line; cx.lineWidth = Math.max(1, .3 * s); rr(cx, s, 1.6, 1.6, w - 3.2, d - 3.2, r - 1.2); cx.stroke(); cx.setLineDash([]); }
      if (lab) lines(cx, s, lab, side, kind === 'model' ? (d - lab.L.length * lab.f * 1.18) / 2 : pad * .8, on ? C.accHi : C.inkHi, w - 2 * side, t, 500);
      if (deeper) { const m = mark, mx = w - pad - m, my = d - pad - m; cx.strokeStyle = on ? C.acc : C.ink; cx.lineWidth = Math.max(1, .045 * m * s);
        rr(cx, s, mx + m * .28, my, m * .72, m * .72, m * .1); cx.stroke(); rr(cx, s, mx, my + m * .28, m * .72, m * .72, m * .1); cx.fillStyle = on ? C.glassOn : PALC.light ? '#f1f1f0' : '#1b1c1f'; cx.fill(); cx.stroke(); }
      if (kind === 'model') { cx.fillStyle = on ? C.acc : C.detail; cx.beginPath(); cx.arc((w - r * .55) * s, d / 2 * s, Math.max(.6, sm * .07) * s, 0, 7); cx.fill(); }
    }, v.cover, v.M, n), x, y, hh);
    v.lab = lab;
    // front: the number, and a mark for what kind of thing it is
    if (kind !== 'model' && hh > sm * .12) {
      const fl = r + Math.max(1.5, sm * .05), fw = w - 2 * fl;
      v.front = frontAt(tplane(fw, hh, P, (cx, s, C, t) => {
        const on = v.hotDrawn, u = Math.max(1, sm * .05), fs = Math.min(6.5, hh * .42, sm * .14);
        font(cx, fs, s); cx.fillStyle = on ? C.accHi : C.ink; cx.fillText(num(n.idx), 0, Math.min(hh - u * .5, fs * 1.15) * s); t.fonts.push(fs);
        cx.strokeStyle = on ? C.acc : C.line; cx.lineWidth = Math.max(1, .25 * s); cx.fillStyle = on ? C.acc : C.detail;
        if (kind === 'ui' && hh > sm * .2) { cx.fillStyle = on ? C.glassOn : C.glassOff; rr(cx, s, fw * .3, hh * .22, fw * .66, hh * .5, u * .6); cx.fill(); cx.stroke(); }
        if (kind === 'agent') for (const k of [.82, .95]) { cx.beginPath(); cx.arc(fw * k * s, hh * .4 * s, u * .9 * s, 0, 7); cx.fill(); }
        if (kind === 'endpoint') { cx.fillStyle = C.recess; rr(cx, s, fw * .6, hh * .3, fw * .3, hh * .4, u * .5); cx.fill(); cx.stroke(); }
        if (kind === 'gate') for (let j = 0; j < 3; j++) { const gx = fw * (.55 + j * .13); cx.beginPath(); cx.moveTo(gx * s, hh * .25 * s); cx.lineTo((gx + fw * .06) * s, hh * .5 * s); cx.lineTo(gx * s, hh * .75 * s); cx.stroke(); }
        if (kind === 'queue') { cx.beginPath(); for (let k = fw * .5; k <= fw * .95; k += Math.max(1, fw * .07)) { cx.moveTo(k * s, hh * .25 * s); cx.lineTo(k * s, hh * .78 * s); } cx.stroke(); }
      }, v.cover, v.M, n), x + fl, y + d, hh);
      const sl = [];
      if (kind === 'process' && hh > sm * .2) for (let u = d * .2; u <= d * .8 + 1e-6; u += Math.max(1.2, d * .09)) sl.push([[x + w + .08, y + d - u, hh * .78], [x + w + .08, y + d - u, hh * .2]]);
      if (kind === 'config' && hh > sm * .2) for (let z = hh * .25; z <= hh * .8 + 1e-6; z += Math.max(1, hh * .18)) sl.push([[x + w + .08, y + d * .8, hh - z], [x + w + .08, y + d * .2, hh - z]]);
      if (sl.length) seg(sl, v.cover, v.M.line);
    }
  }
  function buildInner(n) {
    const v = VIS[n.id], L1 = n.level === 1, sm = Math.min(n.w, n.d);
    const G = v.inner = new THREE.Group(); G.visible = false; v.root.add(G);
    v.IM = { line: lmat(), zones: [], links: [] };
    const zf = L1 ? .2 : .45;
    v.floorMat = recessMat.clone();
    { const sh = new THREE.Shape(); roundRect(sh, n.x, -(n.y + n.d), n.w, n.d, L1 ? 9 : Math.max(.01, Math.min(4, sm * .07)));
      const fg = new THREE.ShapeGeometry(sh, 8); fg.rotateX(-Math.PI / 2); fg.translate(0, zf, 0); fg.scale(TS, TS, TS);
      const floor = new THREE.Mesh(fg, v.floorMat); floor.userData = { node: n, floor: true }; G.add(floor); PICK.push(floor); }
    loopAt(n.x, n.y, n.w, n.d, L1 ? 9 : Math.min(4, sm * .07), zf + .06, v.IM.line, G);
    for (const z of n.zones) {
      const Z = { z, hot: 0, dim: 0, hd: false, mat: lmat({ dashed: true, dashSize: 5 * TS, gapSize: 4 * TS }) };
      loopAt(z.x, z.y, z.w, z.d, 7, .32, Z.mat, G, 6).computeLineDistances();
      const f = Math.min(9, z.w / (z.name.length * (CW + .12) + 2)), nm = z.name.toUpperCase();
      Z.lab = roofAt(tplane(Math.min(z.w - 10, nm.length * f * (CW + .12) + 4), f * 1.5, pxIn(n), (cx, s, C, t) => {
        font(cx, f, s); cx.letterSpacing = `${(f * .12 * s).toFixed(2)}px`; cx.fillStyle = Z.hd ? C.accHi : C.ink; cx.fillText(nm, 0, f * 1.1 * s); cx.letterSpacing = '0px'; t.fonts.push(f);
      }, G, null, z), z.x + 9, z.y + 3, .3);
      v.IM.zones.push(Z);
    }
    for (const k of n.kids) buildPart(k);
    const seen = new Set();
    for (const l of n.links) {
      const key = [l.a.id, l.b.id].sort().join('|'), twin = seen.has(key); seen.add(key);
      const [A, B] = ends(l.a, l.b, l.a.h, l.b.h), pts = curve(A, B, (L1 ? 10 : sm * .06) * (twin ? 2.2 : 1), L1 ? .16 : .14);
      // a cable that is not exact (matched by name) is dashed
      const exact = !l.status || l.status === 'exact';
      const mat = lmat({ polygonOffsetFactor: -3, polygonOffsetUnits: -8, ...(exact ? {} : { dashed: true, dashSize: 4 * TS, gapSize: 3 * TS }) }), line = noRay(polyLine(pts, mat, G));
      if (!exact) line.computeLineDistances();
      const a = L1 ? 5 : Math.max(.5, sm * .04), e = W(...pts[24]), dir = e.clone().sub(W(...pts[21])).normalize();
      const am = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true });
      const cone = noRay(new THREE.Mesh(new THREE.ConeGeometry(a * .7 * TS, a * 1.9 * TS, 14), am));
      cone.position.copy(e).addScaledVector(dir, -a * .95 * TS); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); G.add(cone);
      v.IM.links.push({ l, n, line, mat, cone, am, pts, cum: cumLen(pts), hot: 0, dim: 0, ph: (v.IM.links.length * .37) % 1, size: L1 ? .16 : .07, r: L1 ? 2.6 : Math.max(.45, sm * .022) });
    }
  }
  function ensureInner(n) {
    if (!n || n.id === 'dock') return;
    if (n.level === 2) ensureInner(n.parent);
    if (!VIS[n.id].inner) buildInner(n);
  }

  /* ---------- travelling lights: pulses on lit cables and journeys ---------- */
  const beadMat = new THREE.MeshBasicMaterial({ color: accent.clone(), toneMapped: false });
  const BEADS = [];
  for (let i = 0; i < 28; i++) {
    const m = noRay(new THREE.Mesh(new THREE.SphereGeometry(TS, 12, 8), beadMat)); m.visible = false; g0.add(m);
    const gl = glowPoints([new THREE.Vector3()], .3); gl.visible = false; g0.add(gl); BEADS.push({ m, gl });
  }
  function beads(list) {
    BEADS.forEach((b, i) => {
      const w = list[i]; b.m.visible = b.gl.visible = !!w; if (!w) return;
      const p = alongPts(w.pts, w.cum, w.t); b.m.position.copy(W(...p)); b.m.scale.setScalar(w.r);
      b.gl.material.uniforms.size.value = w.size; moveGlow(b.gl, p, w.k);
    });
  }
  const JB = [];                                            // journey pulses in flight
  const arcsG = new THREE.Group(); g0.add(arcsG);
  const flowsG = new THREE.Group(); g0.add(flowsG);
  const faintMat = lmat({ dashed: true, dashSize: 9 * TS, gapSize: 7 * TS });
  const clearG = g => { for (const o of [...g.children]) { g.remove(o); o.geometry && o.geometry.dispose(); } };

  /* ---------- journeys between blocks (as on the flat overview) ---------- */
  const portPt = n => [PORT[n].x, R.y + 22, 12];
  const anchorB = (s, label) => {
    if (isPort(s)) return portPt(+s.slice(1));
    if (s === 'dock') return portPt(portsIn(label)[0] || 1);
    const [x, y, w, d, h] = PL[s]; return [x + w / 2, y + d / 2, h + 2];
  };
  const sideOf = s => isPort(s) || s === 'dock' ? 'dock' : MOD[s].layer === SCENE.front ? 'front' : 'back';
  const via = (a, b) => {
    const sa = sideOf(a), sb = sideOf(b); if (sa === 'dock' || sb === 'dock' || sa === sb) return null;
    const f = sa === 'front' ? a : b, k = sa === 'front' ? `${a}|${b}` : `${b}|${a}`;
    return SCENE.portmap[k] || SCENE.ports.find(p => p.mod === f).n;
  };
  const arc = (a, b) => {
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]), t0 = Math.max(a[2], b[2]) + 40 + Math.min(260, dist * .26);
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, t0], pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40, u = 1 - t; pts.push([0, 1, 2].map(k => u * u * a[k] + 2 * u * t * c[k] + t * t * b[k])); }
    return pts;
  };
  const hop = (a, b, label) => {
    const v = via(a, b);
    if (v) return [{ pts: arc(anchorB(a), portPt(v)), port: v }, { pts: arc(portPt(v), anchorB(b)), port: v }];
    return [{ pts: arc(anchorB(a, label), anchorB(b, label)), port: isPort(b) ? +b.slice(1) : isPort(a) ? +a.slice(1) : null }];
  };
  const flowArcs = f => (f.from === 'dock' || f.to === 'dock')
    ? portsOf(f).map(n => arc(anchorB(f.from === 'dock' ? 'P' + n : f.from), anchorB(f.to === 'dock' ? 'P' + n : f.to)))
    : hop(f.from, f.to).map(s => s.pts);

  /* ---------- state, clock and timers ---------- */
  const st = { path: [], sel: null, focus: null, hover: null, hoverPort: null, jour: null, touched: false, dockSel: 0, branch: !ARCH && /[?&]branch\b/.test(location.search), gaps: false };
  const prog = {};
  for (const id in NODE) if (openable(NODE[id]) && NODE[id].kind !== 'rail') prog[id] = { p: 0, t: 0 };
  const top = () => st.path[st.path.length - 1] || null;
  let NOW = 0;
  const TIMERS = [];
  const after = (ms, fn) => { const t = { at: NOW + ms, fn }; TIMERS.push(t); return t; };
  const cancel = t => { const i = TIMERS.indexOf(t); if (i >= 0) TIMERS.splice(i, 1); };
  const runTimers = () => { for (const t of TIMERS.filter(t => t.at <= NOW)) { cancel(t); t.fn(); } };

  /* ---------- camera: frame what is open in the free part of the window, keeping the user's angle ---------- */
  const DIR_ISO = new THREE.Vector3(1, 1, 1).normalize(), UP = new THREE.Vector3(0, 1, 0);
  const BOX0 = [-34, -34, -16, PX + 34, PY + 34, ZM];
  const FREE = { w: innerWidth, h: innerHeight, px: 0, top: 0, bot: 0 };
  let CUR = BOX0, CAMT = null;
  function boxFor(id) {
    if (!id) return BOX0;
    if (id === 'dock') return [R.x, R.y, 0, R.x + R.w, R.y + R.d, 60];
    const n = NODE[id], hs = Math.max(4, ...n.kids.map(k => k.h));
    return [n.x, n.y, 0, n.x + n.w, n.y + n.d, hs * 1.4];
  }
  function fitFor(box, dir) {
    const c = W((box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2);
    const f = dir.clone().negate(), r = new THREE.Vector3().crossVectors(f, UP).normalize(), u = new THREE.Vector3().crossVectors(r, f);
    const tv = Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)), tvF = tv * FREE.h / innerHeight, thF = tv * FREE.w / innerHeight;
    let D = .5;
    for (const X of [box[0], box[3]]) for (const Y of [box[1], box[4]]) for (const Z of [box[2], box[5]]) {
      const p = W(X, Y, Z).sub(c), px = p.dot(r), py = p.dot(u), pz = p.dot(f);
      D = Math.max(D, Math.abs(px) / (thF * .92) - pz, Math.abs(py) / (tvF * .86) - pz);
    }
    return { c, D };
  }
  function layoutView() {
    const wide = innerWidth >= 820, pw = wide ? Math.round(Math.min(400, Math.max(310, innerWidth * .27))) : 0;
    ins.style.width = wide ? pw + 'px' : '';
    FREE.px = wide ? pw + 28 : 0; FREE.top = wide ? 0 : 128; FREE.bot = wide ? 0 : Math.round(Math.min(innerHeight * .4, 340)) + 48;   // narrow: top bar and buttons above, panel below
    FREE.w = innerWidth - FREE.px; FREE.h = innerHeight - FREE.top - FREE.bot;
    for (const c of [persp, ortho]) c.setViewOffset(innerWidth, innerHeight, -FREE.px / 2, (FREE.bot - FREE.top) / 2, innerWidth, innerHeight);
  }
  function frameBox(box, dur = 900, minEl = 26) {
    CUR = box;
    let dir = camera.position.clone().sub(controls.target);
    dir = dir.lengthSq() > 1e-8 ? dir.normalize() : DIR_ISO.clone();
    const el = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), lo = THREE.MathUtils.degToRad(minEl);
    if (el < lo) { const hz = Math.hypot(dir.x, dir.z) || 1; dir.set(dir.x / hz * Math.cos(lo), Math.sin(lo), dir.z / hz * Math.cos(lo)); }
    const { c, D } = fitFor(box, dir);
    if (VIEWS.az) { VIEWS.az.target.copy(fitFor(box, DIR_ISO).c); VIEWS.az.dist = () => fitFor(CUR, DIR_ISO).D; }
    const to = { t: c, off: dir.clone().multiplyScalar(D), zoom: camera === ortho ? orthoH / (D * fovK()) : null };
    if (REDUCE || dur <= 1) { controls.target.copy(to.t); camera.position.copy(to.t).add(to.off); if (to.zoom) { ortho.zoom = to.zoom; ortho.updateProjectionMatrix(); } return; }
    if (!CAMT) CAMT = { spin: controls.autoRotate };
    Object.assign(CAMT, { t0: NOW, dur, fromT: controls.target.clone(), fromO: camera.position.clone().sub(controls.target), fromZ: camera === ortho ? ortho.zoom : null, to });
    controls.autoRotate = false; controls.enableDamping = false;
  }
  function camStep() {
    if (!CAMT) return;
    if (camAnim) { controls.autoRotate = CAMT.spin; CAMT = null; return; }       // the Iso view snap takes over
    const k = ez(clamp((NOW - CAMT.t0) / CAMT.dur));
    controls.target.lerpVectors(CAMT.fromT, CAMT.to.t, k);
    camera.position.copy(controls.target).add(CAMT.fromO.clone().lerp(CAMT.to.off, k));
    if (camera === ortho && CAMT.to.zoom && CAMT.fromZ) { ortho.zoom = THREE.MathUtils.lerp(CAMT.fromZ, CAMT.to.zoom, k); ortho.updateProjectionMatrix(); }
    if (k >= 1) { controls.enableDamping = true; controls.autoRotate = CAMT.spin; CAMT = null; }
  }
  const cancelCam = () => { if (CAMT) { controls.enableDamping = true; controls.autoRotate = CAMT.spin; CAMT = null; } };

  /* ---------- every frame: open, dim, light ---------- */
  function update(dt) {
    for (const id in prog) {
      const pr = prog[id]; if (pr.p === pr.t) continue;
      const lv = NODE[id].level;
      pr.p = pr.t > pr.p ? Math.min(pr.t, pr.p + dt * 1000 / (lv === 1 ? 1500 : 1100)) : Math.max(pr.t, pr.p - dt * 1000 / 600);
    }
    const root = st.path[0], J = st.jour, steps = J ? AZ.journeys[J.k].steps : [], cur = J && J.i >= 0 ? steps[J.i] : null, done = J ? steps.slice(0, Math.max(0, J.i)) : [];
    const kk = REDUCE ? 1 : Math.min(1, dt * 7);
    for (const m of LIST) {
      const v = VIS[m.id]; if (!v) continue;
      const n = v.n, p = prog[n.id].p;
      v.dim += ((root && root !== n.id ? 1 : 0) - v.dim) * kk;
      v.hot += ((n.id === cur ? 1 : done.includes(n.id) ? .5 : !J && st.branch && !st.cmpWant && !root ? (BRM.has(n.id) ? 1 : BRHIT.has(n.id) ? .45 : 0) : !J && st.gaps && !root ? gapHeat(n.id) : 0) - v.hot) * kk;
      v.hov += ((!root && !J && (st.hover === n.id || st.focus === n.id) ? 1 : 0) - v.hov) * kk;
      v.halo += ((n.id === cur ? .36 : root === n.id ? .2 : 0) - v.halo) * kk;
      const up = ez(segT(p, .04, .46)), ob = 1 - segT(p, .06, .3), ol = 1 - segT(p, .14, .46);
      v.cover.visible = ol > .003;
      v.cover.position.y = liftOf(n) * up * TS;
      v.cover.scale.y = 1 - .62 * v.dim;
      paint(v.M, 1 - .86 * v.dim, v.hot, v.hov, ol, ob);
      const hd = v.hot > .75; if (hd !== v.hotDrawn) { v.hotDrawn = hd; if (v.name) v.name.redraw(); v.disp.redraw(); }
      v.ledMat.color.copy(hd ? accent : DETAIL);
      v.ledGlow.material.uniforms.intensity.value = hd ? .85 * ol : 0;
      v.tintMat.color.copy(GLASSON); v.tintMat.opacity = clamp((v.hot - .5) * 2) * ob;
      v.haloMat.uniforms.opacity.value = v.halo;
      if (v.inner) { const vis = p > .002; if (!vis && v.inner.visible) release(v.inner); v.inner.visible = vis; if (vis) updateInner(n, p, kk); }
    }
    const lit = root === 'dock' ? new Set(DOCKSETS[st.dockSel]) : J ? J.ports : new Set([...(st.branch && !root ? BRDB : []), ...(st.hoverPort ? [st.hoverPort] : [])]);
    for (const pt of SCENE.ports) {
      const P = PORTV[pt.n];
      P.hot += ((lit.has(pt.n) ? 1 : 0) - P.hot) * kk; P.dim += ((root && root !== 'dock' && !(J && lit.has(pt.n)) ? 1 : 0) - P.dim) * kk;
      paint(P.M, 1 - .8 * P.dim, P.hot, 0, 1, 1);
      const hd = P.hot > .5; if (hd !== P.hd) { P.hd = hd; P.lab.redraw(); }
      P.ledMat.color.copy(hd ? accent : DETAIL); P.ledMat.opacity = 1 - .8 * P.dim;
      P.glow.material.uniforms.intensity.value = hd ? .9 : 0;
    }
    // travelling lights
    const want = [];
    for (let i = JB.length - 1; i >= 0; i--) { const b = JB[i], t = (NOW - b.t0) / 1100; if (t > 1) { JB.splice(i, 1); continue; } if (t >= 0) want.push({ pts: b.pts, cum: b.cum, t, size: .5, r: 4.5, k: Math.sin(Math.PI * t) * .9 + .1 }); }
    for (const L of HOTL) want.push({ pts: L.pts, cum: L.cum, t: (NOW / 1500 + L.ph) % 1, size: L.size, r: L.r, k: .8 });
    beads(want);
  }
  let HOTL = [];
  function updateInner(n, p, kk) {
    const v = VIS[n.id], pi = st.path.indexOf(n.id), deeper = pi >= 0 ? st.path[pi + 1] || null : null;
    const fo = segT(p, 0, .3);
    v.floorMat.color.copy(recessMat.color); setOp(v.floorMat, fo);
    lineCol(v.IM.line, lineMat.color, 0, 1); v.IM.line.linewidth = lineMat.linewidth; setOp(v.IM.line, fo);
    const sel = st.sel && NODE[st.sel];
    for (const Z of v.IM.zones) {
      const z = Z.z, hot = !deeper && sel && sel.parent === n && sel.x >= z.x && sel.y >= z.y && sel.x + sel.w <= z.x + z.w && sel.y + sel.d <= z.y + z.d ? 1 : 0;
      Z.hot += (hot - Z.hot) * kk; Z.dim += ((deeper ? 1 : 0) - Z.dim) * kk;
      lineCol(Z.mat, majorMat.color, Z.hot, 1 - .8 * Z.dim); Z.mat.color.lerp(INKHI, .18 * (1 - Z.hot)); Z.mat.linewidth = lineMat.linewidth * (1 + .4 * Z.hot); setOp(Z.mat, fo);
      const hd = Z.hot > .5; if (hd !== Z.hd) { Z.hd = hd; Z.lab.redraw(); } Z.lab.mat.opacity = fo * (1 - .8 * Z.dim);
    }
    for (const k of n.kids) {
      const kv = VIS[k.id], [a, b] = stagger(n, k.idx), q = back(segT(p, a, b));
      kv.q = q; kv.root.visible = q > .001; if (!kv.root.visible) continue;
      const pk = prog[k.id] ? prog[k.id].p : 0;
      kv.dim += ((deeper && deeper !== k.id ? 1 : 0) - kv.dim) * kk;
      kv.hot += ((k.id === st.sel ? 1 : st.branch && isCh(k) ? .7 : st.gaps && isGap(k) ? .7 : 0) - kv.hot) * kk;
      const up = ez(segT(pk, .04, .46)), ob = 1 - segT(pk, .06, .3), ol = 1 - segT(pk, .14, .46);
      kv.cover.visible = ol > .003; kv.cover.scale.y = Math.max(.001, q); kv.cover.position.y = liftOf(k) * up * TS;
      paint(kv.M, 1 - .86 * kv.dim, kv.hot, 0, ol, ob);
      const hd = kv.hot > .5; if (hd !== kv.hotDrawn) { kv.hotDrawn = hd; kv.roof.redraw(); if (kv.front) kv.front.redraw(); }
      if (kv.inner) { const vis = pk > .002; if (!vis && kv.inner.visible) release(kv.inner); kv.inner.visible = vis; if (vis) updateInner(k, pk, kk); }
    }
    for (const L of v.IM.links) {
      const o = segT(Math.min(VIS[L.l.a.id].q, VIS[L.l.b.id].q), .7, 1);
      const hot = !deeper && st.sel && (L.l.a.id === st.sel || L.l.b.id === st.sel) ? 1 : 0;
      L.hot += (hot - L.hot) * kk; L.dim += ((deeper ? 1 : 0) - L.dim) * kk;
      L.line.visible = L.cone.visible = o > .01;
      lineCol(L.mat, LINK0, L.hot, 1 - .86 * L.dim); L.mat.linewidth = lineMat.linewidth * (1.15 + .55 * L.hot); setOp(L.mat, o);
      L.am.color.copy(L.mat.color); L.am.opacity = o;
      if (L.hot > .5 && o > .95) HOTL.push(L);
    }
  }

  /* ---------- opening and closing, at any level ---------- */
  function open(id, selId) {
    const n = NODE[id]; if (!n) return;
    stopJourney(true); J_OPENED = false; showLinks(null); hideTip(true);
    if (n.level === 1) {
      if (st.path[0] && st.path[0] !== id) { for (const o of st.path) if (prog[o]) prog[o].t = 0; }
      else if (st.path[1]) prog[st.path[1]].t = 0;
      st.path = [id];
    } else {
      if (st.path[0] !== n.parent.id) { for (const o of st.path) if (prog[o]) prog[o].t = 0; }
      else if (st.path[1] && st.path[1] !== id) prog[st.path[1]].t = 0;
      st.path = [n.parent.id, id];
      if (prog[n.parent.id]) prog[n.parent.id].t = 1;
    }
    if (prog[id]) prog[id].t = 1;
    ensureInner(n);
    st.focus = rootOf(n).id;
    st.sel = id === 'dock' ? null : selId || (n.kids[0] ? n.kids[0].id : null);
    if (id === 'dock') st.dockSel = selId || 0;
    if (REDUCE) jump();
    frameBox(boxFor(id), n.level === 1 ? 1000 : 850, 46); refresh(); ins.scrollTop = 0;
  }
  function back1() {
    const id = top(); if (!id) return;
    if (prog[id]) prog[id].t = 0;
    st.path.pop();
    st.sel = st.path.length ? id : null;
    if (REDUCE) jump();
    frameBox(boxFor(top()), 850, top() ? 46 : 26); refresh();
  }
  const closeAll = () => { while (st.path.length) back1(); };
  function jump() { for (const k in prog) prog[k].p = prog[k].t; }
  function select(id) {
    if (id === st.sel) return;
    st.sel = id; say(); syncPins(); renderCode();
    ins.querySelectorAll('.row[data-n]').forEach(r => r.classList.toggle('on', r.dataset.n === id));
    const r = [...ins.querySelectorAll('.row[data-n]')].find(x => x.dataset.n === id && !x.dataset.link); if (r) r.scrollIntoView({ block: 'nearest', behavior: REDUCE ? 'auto' : 'smooth' });
  }
  const openPort = n => open('dock', Math.max(0, DOCKSETS.findIndex(s => s.includes(n))));
  const kidsOfTop = () => { const t = top(); return t && t !== 'dock' ? NODE[t].kids : []; };
  const refresh = () => { panel(); say(); syncPins(); if (!st.path.length && !st.jour && !st.hover && !st.hoverPort) showLinks(null); };

  /* ---------- journeys ---------- */
  function playJourney(k) {
    if (!AZ.journeys[k]) return;
    const wasOpen = st.path.length > 0;
    stopJourney(true); J_OPENED = false; closeAll(); showLinks(null); hideTip(true);
    st.jour = { k, i: -1, t: null, ports: new Set() };
    refresh();
    st.jour.t = after(wasOpen ? 800 : 80, () => stepJourney(k));
    frameBox(BOX0, 900);
  }
  const modAt = (steps, i, d) => { for (let j = i + d; j >= 0 && j < steps.length; j += d) if (!isPort(steps[j])) return steps[j]; return null; };
  function jOpen(id) {                                      // open a block for a walkthrough without stopping it
    if (st.path.length === 1 && st.path[0] === id) return false;
    for (const o of st.path) if (prog[o]) prog[o].t = 0;
    st.path = [id]; prog[id].t = 1; ensureInner(NODE[id]); st.focus = id; J_OPENED = true;
    if (REDUCE) jump();
    frameBox(boxFor(id), 1000, 46); return true;
  }
  function jClose(frame) { if (!st.path.length) return; for (const o of st.path) if (prog[o]) prog[o].t = 0; st.path = []; st.sel = null; if (frame) frameBox(BOX0, 1000); }
  let J_OPENED = false;
  function stepJourney(k) {
    const J = st.jour; if (!J || J.k !== k) return;
    const jj = AZ.journeys[k], steps = jj.steps; J.i++;
    const s = steps[J.i], c = (jj.code || [])[J.i], mv = isPort(s) ? null : s;
    const inside = mv && c && c.sel && NODE[c.sel] && (modAt(steps, J.i, -1) === mv || modAt(steps, J.i, 1) === mv);
    let moved = false;
    if (isPort(s)) J.ports.add(+s.slice(1));
    else if (inside) { moved = jOpen(mv); st.sel = c.sel; }
    else if (st.path.length) { jClose(true); moved = true; }
    const prev = J.i > 0 ? steps[J.i - 1] : null;
    if (prev && prev !== s && !(isPort(prev) && modAt(steps, J.i, -1) === s)) hop(isPort(s) ? prev : (isPort(prev) ? modAt(steps, J.i, -1) || prev : prev), s).forEach((h, j) => {
      noRay(polyLine(h.pts, accentLineMat, arcsG));
      JB.push({ pts: h.pts, cum: cumLen(h.pts), t0: NOW + (moved ? 500 : 0) + j * 320 });
      if (h.port) J.ports.add(h.port);
    });
    refresh();
    const on = ins.querySelector('.row.on'); if (on) on.scrollIntoView({ block: 'nearest', behavior: REDUCE ? 'auto' : 'smooth' });
    J.t = J.i < steps.length - 1 ? after(moved ? 1900 : 1350, () => stepJourney(k)) : after(6000, () => { if (st.jour === J) { stopJourney(); } });
  }
  function stopJourney(quiet) {
    const J = st.jour; if (!J) return;
    cancel(J.t); st.jour = null; clearG(arcsG); JB.length = 0;
    if (J_OPENED) { J_OPENED = false; if (!quiet) { jClose(true); } }
    if (!quiet) refresh();
  }
  function showLinks(id, port) {
    if (st.jour) return;
    clearG(flowsG); if (st.path.length) return;
    const fs = port ? AZ.flows.filter(f => (f.from === 'dock' || f.to === 'dock') && portsOf(f).includes(port))
      : id ? AZ.flows.filter(f => f.from === id || f.to === id) : [];
    if (!fs.length && st.branch) {                          // the branch view: dashed arcs from the blocks that call changed code
      for (const [b, l] of Object.entries(CUR_C && !st.cmpWant ? CUR_C.blast : {})) for (const [a] of l.slice(0, 4)) if (PL[a] && PL[b]) noRay(polyLine(arc(anchorB(a), anchorB(b)), faintMat, flowsG)).computeLineDistances();
      return;
    }
    const arcs = fs.flatMap(f => port ? [arc(anchorB(f.from === 'dock' ? 'P' + port : f.from), anchorB(f.to === 'dock' ? 'P' + port : f.to))] : flowArcs(f));
    for (const pts of arcs) noRay(polyLine(pts, faintMat, flowsG)).computeLineDistances();
  }

  /* ---------- overlay: info buttons on every element in view, and the tooltip card ---------- */
  const css = document.createElement('style');
  css.textContent = `
    :root { --hi:#eef1f6; --tipbg:rgba(19,20,22,.97); --slab:#0c0d0e; --pinbg:rgba(22,23,24,.94); }
    :root[data-theme="light"] { --hi:#16181a; --tipbg:rgba(251,251,250,.98); --slab:#d9dbdb; --pinbg:rgba(250,250,249,.96); }
    #info { display:none !important; }
    #ctl-az { top:auto !important; bottom:58px; right:16px; width:auto !important; max-width:calc(100vw - 440px); flex-direction:row !important; flex-wrap:wrap; justify-content:flex-end; }
    #ctl-az .sep { display:none; }
    #ctl-az button { gap:10px; padding:6px 10px; }
    @media (max-width:819px) { #ctl-az { top:84px !important; bottom:auto; left:12px; right:12px; max-width:none; justify-content:flex-start; } #ctl-az button kbd { display:none; } }
    #az-ins { position:fixed; z-index:4; left:16px; top:64px; bottom:60px; width:340px; overflow:auto; display:grid; gap:18px; align-content:start;
      padding:18px 14px 20px; background:var(--panel); border:1px solid var(--line); border-radius:16px; -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); scrollbar-width:thin; }
    @media (max-width:819px) { #az-ins { top:auto; left:12px; right:12px; bottom:40px; width:auto !important; max-height:40vh; } #hint { display:none; } }
    #az-ins .k { text-transform:uppercase; letter-spacing:.14em; font-size:10.5px; color:var(--dim); }
    #az-ins .k b { color:var(--accent); font-weight:500; }
    #az-ins .head { display:grid; gap:8px; padding:0 4px; }
    #az-ins h2 { margin:0; font:500 19px/1.25 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color:var(--hi); text-wrap:balance; }
    #az-ins p { margin:0; font-size:12px; line-height:1.6; color:var(--ink); }
    #az-ins p.lead { color:var(--hi); }
    #az-ins section { display:grid; gap:2px; }
    #az-ins section > .k { padding:0 10px 6px; }
    #az-ins .chip { display:inline-block; width:fit-content; padding:3px 10px; border:1px solid var(--line); border-radius:999px; font-size:11px; letter-spacing:.06em; color:var(--hi); }
    #az-ins .crumbs { display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); }
    #az-ins .crumbs button { all:unset; cursor:pointer; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:4px 9px; }
    #az-ins .crumbs button:hover { color:var(--hi); border-color:var(--dim); }
    #az-ins .crumbs span { color:var(--hi); padding:4px 2px; }
    #az-ins .row { all:unset; box-sizing:border-box; cursor:pointer; display:grid; grid-template-columns:24px minmax(0,1fr) auto; gap:3px 8px;
      padding:8px 10px; border:1px solid transparent; border-radius:10px; transition:border-color .2s, background .2s; }
    #az-ins .row:hover, #az-ins .row.on { border-color:var(--line); background:var(--bg); }
    #az-ins .row .n { color:var(--dim); font-size:11px; line-height:18px; font-variant-numeric:tabular-nums; transition:color .2s; }
    #az-ins .row.on .n { color:var(--accent); text-shadow:0 0 8px var(--accent); }
    #az-ins .row .t { color:var(--hi); font-size:12.5px; line-height:18px; min-width:0; overflow-wrap:anywhere; }
    #az-ins .row .c { color:var(--dim); font-size:10.5px; line-height:18px; white-space:nowrap; }
    #az-ins .row .c.go { color:var(--accent); }
    #az-ins .row .d { grid-column:2 / 4; font-size:11.5px; line-height:1.55; color:var(--ink); min-width:0; }
    #az-ins .row:focus-visible, #az-ins .crumbs button:focus-visible, #az-ins .back:focus-visible { outline:1px solid var(--accent); outline-offset:1px; }
    #az-ins .back { all:unset; cursor:pointer; color:var(--ink); border:1px solid var(--line); border-radius:10px; padding:6px 12px; width:fit-content; text-transform:uppercase; letter-spacing:.14em; font-size:10.5px; }
    #az-ins .back:hover { color:var(--hi); border-color:var(--dim); }
    #az-ins .keys { font-size:10.5px; line-height:1.9; color:var(--dim); letter-spacing:.04em; padding:0 4px; }
    #az-ins .keys b { color:var(--ink); font-weight:500; }
    #az-ins .code { display:grid; gap:2px; padding:12px 12px 14px; border:1px solid var(--line); border-radius:12px; min-width:0; }
    #az-ins .code > .k { padding:0 0 6px; }
    #az-ins .code .k.sub { padding:10px 0 4px; }
    #az-ins .code p { padding:2px 0; }
    #az-ins p.meta { font-size:11px; line-height:1.55; color:var(--dim); font-variant-numeric:tabular-nums; }
    #az-ins p.meta b { color:var(--ink); font-weight:500; }
    #az-ins p.meta b.gap { color:var(--accent); }
    #az-ins a.src { display:flex; align-items:baseline; gap:8px; padding:4px 6px; margin:0 -6px; border-radius:6px; color:var(--hi); text-decoration:none; min-width:0;
      font:11.5px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace; transition:background .15s; }
    #az-ins a.src span { flex:1; min-width:0; overflow-wrap:anywhere; }
    #az-ins a.src i { font-style:normal; color:var(--dim); transition:color .15s; }
    #az-ins a.src em { font-style:normal; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--accent); white-space:nowrap; }
    #az-ins a.src:hover { background:var(--bg); }
    #az-ins a.src:hover i { color:var(--accent); }
    #az-ins a.src:focus-visible, #az-ins .seg button:focus-visible, #az-ins .chip-b:focus-visible, #az-ins .copy:focus-visible, #az-ins .branch-b:focus-visible { outline:1px solid var(--accent); outline-offset:1px; }
    #az-ins .head a.src { margin:4px -6px 0; }
    #az-ins pre.sig { margin:6px 0 2px; padding:8px 10px; background:var(--bg); border:1px solid var(--line); border-radius:8px; color:var(--ink);
      font:11px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
    #az-ins details > summary { cursor:pointer; font-size:11px; color:var(--dim); padding:4px 0; list-style-position:inside; }
    #az-ins details > summary:hover { color:var(--ink); }
    #az-ins details.sites { margin:-4px 10px 6px 42px; }
    #az-ins .step-src { margin:-6px 10px 4px 36px; }
    #az-ins .chips { display:flex; flex-wrap:wrap; gap:6px; padding:2px 0; }
    #az-ins .chip-b { all:unset; cursor:pointer; font-size:11px; line-height:1.4; padding:3px 9px; border:1px solid var(--line); border-radius:999px; color:var(--hi); transition:border-color .15s; }
    #az-ins .chip-b em { font-style:normal; color:var(--dim); margin-left:4px; }
    #az-ins .chip-b:hover { border-color:var(--accent); }
    #az-ins .copy { all:unset; cursor:pointer; margin-top:10px; width:fit-content; font-size:11px; padding:5px 11px; border:1px solid var(--line); border-radius:9px; color:var(--ink); }
    #az-ins .copy:hover { color:var(--hi); border-color:var(--dim); }
    #az-ins textarea.copied { box-sizing:border-box; width:100%; height:120px; margin-top:6px; padding:8px; font:11px/1.5 ui-monospace, Menlo, monospace; color:var(--hi); background:var(--bg); border:1px solid var(--line); border-radius:8px; }
    #az-ins .branch-b { all:unset; box-sizing:border-box; cursor:pointer; display:grid; gap:2px; margin-top:4px; padding:9px 12px; border:1px solid var(--line); border-radius:10px; transition:border-color .2s; }
    #az-ins .branch-b span { font-size:12.5px; color:var(--hi); }
    #az-ins .branch-b em { font-style:normal; font-size:11px; color:var(--accent); }
    #az-ins .branch-b:hover { border-color:var(--accent); }
    #az-ins .openin { display:grid; gap:8px; padding:0 4px; }
    #az-ins .seg { display:flex; width:fit-content; border:1px solid var(--line); border-radius:9px; overflow:hidden; }
    #az-ins .seg button { all:unset; cursor:pointer; padding:5px 11px; font-size:11px; color:var(--ink); }
    #az-ins .seg button + button { border-left:1px solid var(--line); }
    #az-ins .seg button.on { background:var(--bg); color:var(--accent); }
    #az-ins label.root { display:grid; gap:4px; font-size:10.5px; color:var(--dim); }
    #az-ins label.root input { box-sizing:border-box; width:100%; padding:6px 8px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--hi); font:11px ui-monospace, "SF Mono", Menlo, monospace; outline:none; }
    #az-ins label.root input:focus { border-color:var(--accent); }
    #az-ins p.warn { font-size:11px; line-height:1.5; color:var(--accent); }
    #az-ins .cmpctl { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:end; gap:8px; margin:4px 0 6px; }
    #az-ins .cmpctl label { display:grid; gap:4px; min-width:0; }
    #az-ins .cmpctl select { box-sizing:border-box; width:100%; min-width:0; padding:6px 8px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--hi);
      font:11.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
    #az-ins .cmpctl select:focus-visible { outline:1px solid var(--accent); outline-offset:1px; }
    #az-ins .cmpctl .swap { all:unset; box-sizing:border-box; cursor:pointer; height:30px; padding:0 9px; border:1px solid var(--line); border-radius:8px; color:var(--ink); display:grid; place-items:center; }
    #az-ins .cmpctl .swap:hover:not(:disabled) { color:var(--accent); border-color:var(--accent); }
    #az-ins .cmpctl .swap:disabled { opacity:.35; cursor:default; }
    #az-ins .cmpctl .swap:focus-visible { outline:1px solid var(--accent); outline-offset:1px; }
    #az-pins { position:fixed; inset:0; pointer-events:none; z-index:3; overflow:hidden; }
    .az-pin { all:unset; position:absolute; left:0; top:0; width:22px; height:31px; margin:-31px 0 0 -11px; display:flex; flex-direction:column; align-items:center;
      pointer-events:auto; cursor:help; transition:opacity .2s; will-change:transform; }
    .az-pin i { box-sizing:border-box; width:16px; height:16px; border-radius:50%; border:1px solid var(--dim); background:var(--pinbg); color:var(--ink);
      font:italic 600 10.5px/14px Georgia, "Times New Roman", serif; text-align:center; transition:border-color .2s, color .2s, box-shadow .2s; }
    .az-pin b { width:1px; flex:1; background:var(--dim); opacity:.75; }
    .az-pin:hover i, .az-pin.on i, .az-pin:focus-visible i { border-color:var(--accent); color:var(--accent); box-shadow:0 0 10px -1px var(--accent); }
    .az-pin:hover b, .az-pin.on b { background:var(--accent); opacity:1; }
    .az-pin.off { opacity:0; pointer-events:none; }
    #az-tip { position:fixed; z-index:6; left:0; top:0; width:264px; pointer-events:none; transform-origin:0 100%;
      transition:transform .3s cubic-bezier(.2,.9,.25,1.12), opacity .22s; }
    #az-tip.fold { transform:perspective(640px) rotateX(-82deg) rotateY(10deg); opacity:0; transition:none; }
    #az-tip .card { position:relative; padding:12px 14px 13px; background:var(--tipbg); border:1px solid var(--accent); border-radius:2px; box-shadow:0 22px 40px -18px rgba(0,0,0,.55); }
    #az-tip .card::before { content:""; position:absolute; left:-1px; right:-1px; top:-9px; height:8px; background:var(--slab); border:1px solid var(--accent); border-bottom:0;
      transform:skewX(45deg); transform-origin:0 100%; }
    #az-tip .card::after { content:""; position:absolute; top:-1px; bottom:-1px; left:-9px; width:8px; background:var(--slab); border:1px solid var(--accent); border-right:0;
      transform:skewY(45deg); transform-origin:100% 0; }
    #az-tip .meta { font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); }
    #az-tip .title { margin-top:6px; font-size:13.5px; line-height:1.3; font-weight:500; color:var(--hi); }
    #az-tip .body { margin-top:9px; padding-top:9px; border-top:1px solid var(--line); font-size:11.5px; line-height:1.5; color:var(--ink); }
    #az-tip .foot { margin-top:10px; font-size:10px; letter-spacing:.06em; color:var(--accent); }
    #az-lead { position:fixed; left:0; top:0; width:100vw; height:100vh; pointer-events:none; z-index:5; display:none; overflow:visible; }
    #az-lead.on { display:block; }
    #az-lead line { stroke:var(--accent); stroke-width:1; stroke-dasharray:2 3; }
    #az-find { position:fixed; z-index:7; left:50%; top:64px; transform:translateX(-50%); width:min(520px, calc(100vw - 24px)); padding:8px; background:var(--tipbg); border:1px solid var(--line); border-radius:12px;
      box-shadow:0 10px 30px rgba(0,0,0,.25); font:12px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
    #az-find[hidden] { display:none; }
    #az-find input { all:unset; box-sizing:border-box; width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:8px; color:var(--hi); background:var(--bg); font-size:13px; }
    #az-find input:focus-visible { border-color:var(--accent); }
    #az-find ul { list-style:none; margin:6px 0 0; padding:0; max-height:min(52vh, 420px); overflow:auto; scrollbar-width:thin; }
    #az-find li { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; padding:6px 10px; border-radius:7px; cursor:pointer; color:var(--ink); }
    #az-find li[aria-selected="true"] { background:var(--bg); box-shadow:0 0 0 1px var(--accent) inset; }
    #az-find li .lv { grid-row:span 2; align-self:center; font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); min-width:4.6em; }
    #az-find li b { font-weight:500; color:var(--hi); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #az-find li small { color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #az-find .none { padding:8px 10px 4px; color:var(--dim); }
  `;
  document.head.appendChild(css);
  const ins = document.createElement('aside'); ins.id = 'az-ins'; ins.setAttribute('aria-label', 'What is inside'); document.body.appendChild(ins);
  const pinsEl = document.createElement('div'); pinsEl.id = 'az-pins'; document.body.appendChild(pinsEl);
  const leadEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); leadEl.id = 'az-lead'; leadEl.innerHTML = '<line x1="0" y1="0" x2="0" y2="0"/>'; document.body.appendChild(leadEl);
  const tipEl = document.createElement('div'); tipEl.id = 'az-tip'; tipEl.hidden = true; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl);

  function pinTargets() {
    const t = top(), out = [];
    const railPin = { id: 'rail', at: () => [R.x + 20 + RTW + 14, R.y + R.d - 16, 5.2] };
    if (!t) {
      for (const d of DIST) out.push({ id: d.id, at: () => d.at });
      if (R) out.push(railPin);
      for (const m of LIST) if (PL[m.id]) { const n = NODE[m.id]; out.push({ id: n.id, at: () => [n.x + n.w - 16, n.y + 16, n.h * VIS[n.id].cover.scale.y + .3] }); }
    } else if (t === 'dock') {
      out.push(railPin);
      for (const pt of SCENE.ports) out.push({ id: 'P:' + pt.n, at: () => [pt.x, R.y + 8, 11.3] });
    } else {
      const n = NODE[t];
      out.push({ id: n.id, at: () => [n.x + 4, n.y + 4, .6] });
      for (const z of n.zones) out.push({ id: z.id, at: () => [z.x + 9 + Math.min(9, z.w / (z.name.length * (CW + .12) + 2)) * z.name.length * (CW + .12) + 9, z.y + 7, .4] });
      for (const k of n.kids) out.push({ id: k.id, at: () => { const s = Math.min(k.w, k.d), m = k.kind === 'model' ? s * .5 : s * .12; return [k.x + k.w - m, k.y + Math.min(m, k.d * .3), k.h * (VIS[k.id] ? VIS[k.id].q : 0) + .2]; } });
    }
    return out;
  }
  const PINS = new Map();
  function syncPins() {
    const T = pinTargets(), want = new Set(T.map(p => p.id));
    for (const [id, P] of PINS) if (!want.has(id)) { P.el.remove(); PINS.delete(id); }
    for (const t of T) {
      let P = PINS.get(t.id);
      if (!P) {
        const el = document.createElement('button'); el.type = 'button'; el.className = 'az-pin off'; el.dataset.tip = t.id;
        const inf = tipInfo(t.id); el.setAttribute('aria-label', `What is ${inf ? inf.title : 'this'}?`); el.innerHTML = '<i>i</i><b></b>';
        pinsEl.appendChild(el); P = { el, occ: false, vis: false, sx: -99, sy: -99 }; PINS.set(t.id, P);
      }
      P.at = t.at;
    }
    pinsOn(); occTick = 0;
  }
  const pinsOn = () => { for (const [id, P] of PINS) P.el.classList.toggle('on', !!tip && tip.id === id); };
  const VP = new THREE.Vector3(), ORAY = new THREE.Raycaster(), ONDC = new THREE.Vector2();
  let occTick = 0;
  const ownHit = (ud, id) => (ud.node && (ud.node.id === id || (ud.floor && id.startsWith(ud.node.id + '#')))) || (ud.port && id === 'P:' + ud.port) || (ud.rail && id === 'rail') || ud.plate;
  function occluded(wp, id) {
    ORAY.setFromCamera(ONDC.set(VP.x, VP.y), camera);
    const dist = ORAY.ray.origin.distanceTo(wp);
    for (const h of ORAY.intersectObjects(pickList(), false)) {
      if (h.distance > dist - .015) return false;
      if (!pickable(h.object)) continue;
      if (ownHit(h.object.userData, id)) continue;
      return true;
    }
    return false;
  }
  function placePins() {
    const occNow = occTick++ % 6 === 0;
    for (const [id, P] of PINS) {
      const wp = W(...P.at()); VP.copy(wp).project(camera);
      const on = VP.z < 1 && VP.z > -1 && Math.abs(VP.x) < 1.04 && Math.abs(VP.y) < 1.04;
      P.sx = (VP.x + 1) / 2 * innerWidth; P.sy = (1 - VP.y) / 2 * innerHeight;
      if (occNow) P.occ = on && occluded(wp, id);
      const vis = on && !P.occ;
      if (vis !== P.vis) { P.vis = vis; P.el.classList.toggle('off', !vis); }
      P.el.style.transform = `translate(${P.sx.toFixed(1)}px, ${P.sy.toFixed(1)}px)`;
    }
    placeTip();
  }

  /* ---------- the tooltip: an extruded card that unfolds from its pin ---------- */
  let tip = null, tipHide = null;
  function tipInfo(id) {
    if (id.startsWith('L:')) { const l = LAYER[id.slice(2)]; return { meta: 'layer', title: l.name, body: l.tip || l.blurb }; }
    if (id === 'rail') return { meta: RL, title: MOD.dock.name, body: AZ.rail && AZ.rail.tip || MOD.dock.role, foot: `${AZ.groups.length} ${ARCH ? 'ports' : 'groups'} · click the rail to list them` };
    if (id.startsWith('P:')) { const n = +id.slice(2), g = GROUP[n]; return { meta: `${RL} · port ${n}${g.models.length ? ` · ${g.models.length} models` : ''}`, title: g.name, body: `${g.tip || ''} ${g.models.slice(0, 8).join(', ')}${g.models.length > 8 ? '…' : ''}`.trim(), foot: g.users.length ? `used by ${g.users.slice(0, 3).map(u => MOD[u[0]] ? MOD[u[0]].short : u[0]).join(', ')}${g.users.length > 3 ? ` +${g.users.length - 3}` : ''}` : (ARCH ? 'no block uses it' : 'no calls found') }; }
    const n = NODE[id]; if (!n) return null;
    if (n.kind === 'zone') return { meta: `group in ${n.parent.tag}`, title: n.name, body: n.tip || '' };
    if (n.level === 1) return { meta: LAYER[n.m.layer].name, title: n.name, body: n.tip || n.what, foot: st.path[0] === n.id ? `${n.kids.length} parts inside` : `click to open · ${n.kids.length} parts inside` };
    const stt = n.item && n.item.status ? ` · ${n.item.status}` : '';
    return { meta: `${KIND[n.kind].label}${stt} · in ${n.parent.tag}`, title: n.name, body: n.tip || n.what,
      foot: openable(n) ? (st.path.includes(n.id) ? `${n.kids.length} inside` : `click to open · ${n.kids.length} inside`) : '' };
  }
  function showTip(id, pinned) {
    cancel(tipHide);
    if (tip && tip.id === id) { tip.pinned = tip.pinned || pinned; return; }
    const info = tipInfo(id); if (!info) return;
    tip = { id, pinned, info };
    tipEl.innerHTML = `<div class="card"><div class="meta">${esc(info.meta)}</div><div class="title">${esc(info.title)}</div>${info.body ? `<div class="body">${esc(info.body)}</div>` : ''}${info.foot ? `<div class="foot">${esc(info.foot)}</div>` : ''}</div>`;
    tipEl.hidden = false; tipEl.classList.add('fold'); leadEl.classList.add('on');
    placeTip(); after(0, () => tipEl.classList.remove('fold'));
    pinsOn();
  }
  function hideTip(now) {
    cancel(tipHide);
    const go = () => { tip = null; tipEl.hidden = true; tipEl.innerHTML = ''; leadEl.classList.remove('on'); pinsOn(); };
    if (now) go(); else tipHide = after(160, go);
  }
  function placeTip() {
    if (!tip) return;
    const P = PINS.get(tip.id); if (!P) return hideTip(true);
    tipEl.style.visibility = P.vis ? '' : 'hidden'; leadEl.classList.toggle('on', P.vis);
    if (!P.vis) return;
    const ax = P.sx, ay = P.sy - 23, cw = tipEl.offsetWidth || 264, ch = tipEl.offsetHeight || 150;
    let left = ax + 22, y = ay - 20 - ch, flip = false;
    if (left + cw + 14 > innerWidth) { left = ax - 22 - cw; flip = true; }
    if (left < FREE.px + 12) { left = FREE.px + 12; }
    if (y < 60) y = Math.min(innerHeight - ch - 14, ay + 34);
    tipEl.style.left = left.toFixed(1) + 'px'; tipEl.style.top = y.toFixed(1) + 'px'; tipEl.style.transformOrigin = flip ? '100% 100%' : '0 100%';
    const ln = leadEl.firstChild, cx = flip ? left + cw : left, cy = y + ch > ay ? y : y + ch;
    ln.setAttribute('x1', ax.toFixed(1)); ln.setAttribute('y1', ay.toFixed(1)); ln.setAttribute('x2', cx.toFixed(1)); ln.setAttribute('y2', cy.toFixed(1));
  }
  pinsEl.addEventListener('pointerover', e => { const b = e.target.closest('.az-pin'); if (b && (!tip || !tip.pinned)) showTip(b.dataset.tip, false); });
  pinsEl.addEventListener('pointerout', e => { const b = e.target.closest('.az-pin'); if (b && tip && !tip.pinned && !(e.relatedTarget && b.contains(e.relatedTarget))) hideTip(); });
  pinsEl.addEventListener('click', e => {
    const b = e.target.closest('.az-pin'); if (!b) return;
    st.touched = true; const id = b.dataset.tip;
    if (tip && tip.id === id && tip.pinned) hideTip(true); else { hideTip(true); showTip(id, true); }
    b.blur();
  });

  /* ---------- links into the code: GitHub at the scanned commit, or the viewer's editor ---------- */
  const PREF = { open: REPO && REPO.pushed && REPO.remote ? 'github' : 'vscode', root: REPO ? REPO.root : '' };
  try { const j = JSON.parse((localStorage.getItem('archivision-open') || localStorage.getItem('birdview-open')) || 'null'); if (j && j.open) Object.assign(PREF, j); } catch {}
  const savePref = () => { try { localStorage.setItem('archivision-open', JSON.stringify(PREF)); } catch {} };
  const encP = p => p.split('/').map(encodeURIComponent).join('/');
  function href(p, l, e) {
    if (PREF.open === 'github') return `${REPO.remote}/blob/${REPO.sha}/${encP(p)}${l ? `#L${l}${e && e > l ? `-L${e}` : ''}` : ''}`;
    const root = String(PREF.root || REPO.root).replace(/\/+$/, '');
    return `${PREF.open}://file${encodeURI(root + '/' + p)}${l ? `:${l}` : ''}`;
  }
  const diffHref = p => CUR_C ? `${REPO.remote}/compare/${encodeURIComponent(CUR_C.bl)}...${encodeURIComponent(CUR_C.hl)}${p in PIDX ? `#diff-${CM.hash[PIDX[p]]}` : ''}` : '#';
  // a path inside its code root: the most specific root holding it (a package's src/ inside the repo's)
  const unroot = p => { const r = ROOTS.filter(x => x !== '.' && String(p).startsWith(x + '/')).sort((a, b) => b.length - a.length)[0]; return r ? String(p).slice(r.length + 1) : String(p); };
  const loc = (p, l) => `${unroot(p)}${l ? `:${l}` : ''}`;
  // xa: more data-* attributes, as a data use of a store other than Prisma carries its store and resource name
  const aSrc = (p, l, e, txt, kind, name, tgt, col, xa) => `<a class="src" href="${esc(href(p, l, e))}" target="_blank" rel="noopener" title="${esc(p)}${l ? ':' + l : ''}" data-kind="${kind}" data-path="${esc(p)}"${l ? ` data-line="${l}"` : ''}${col ? ` data-col="${col}"` : ''}${e ? ` data-end="${e}"` : ''}${name ? ` data-name="${esc(name)}"` : ''}${tgt && tgt[0] ? ` data-target="${esc(`${tgt[0]}:${tgt[1]}-${tgt[2]}`)}"` : ''}${xa ? Object.entries(xa).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('') : ''}><span>${esc(txt || loc(p, l))}</span><i aria-hidden="true">↗</i></a>`;
  const aDiff = (p, s) => !(REPO && REPO.remote) ? `<span class="src diff" data-path="${esc(p)}" data-status="${esc(s)}"><span>${esc(loc(p))}</span><em>${esc(CHL[s] || s)}</em></span>` : `<a class="src diff" href="${esc(diffHref(p))}" target="_blank" rel="noopener" title="diff of ${esc(p)}" data-kind="diff" data-path="${esc(p)}" data-status="${esc(s)}"><span>${esc(loc(p))}</span><em>${esc(CHL[s] || s)}</em><i aria-hidden="true">↗</i></a>`;
  const CHL = { A: 'new', M: 'changed', D: 'deleted', R: 'renamed', C: 'copied', T: 'type' };
  const KL = { page: 'page', layout: 'layout', component: 'component', hook: 'hook', handler: 'API route', lambda: 'Lambda handler', action: 'server action', function: 'function', class: 'class', const: 'constant', enum: 'enum' };
  const PLUR = { page: 'pages', action: 'actions', handler: 'API routes', lambda: 'Lambda handlers', component: 'components', hook: 'hooks', function: 'functions' };
  // a data use links its line: a Prisma call by its model, any other store's call by its store and resource
  const dataLink = (p, l, txt, m, st, res) => aSrc(p, l, null, txt, st ? 'data-op' : 'data-use', m, null, null, st ? { store: st, res } : null);
  const RW = { r: 'reads', w: 'writes', rw: 'reads, writes' };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const more = (list, n, fn, label) => list.length <= n ? list.map(fn).join('') : list.slice(0, n).map(fn).join('') + `<details><summary>${list.length - n} more ${label}</summary>${list.slice(n).map(fn).join('')}</details>`;
  const pieceCh = c => !c || !c.p ? '' : CHF.get(c.p) === 'A' ? 'added' : CHS.has(`${c.p}#${c.sym}`) ? 'changed' : '';
  /* ---------- test gaps (repo pages): the parts no unit test file or browser spec reaches, biggest first ---------- */
  const codeOf = k => k && k.item && k.item.code && k.item.code.files ? k.item.code : null;
  const isGap = k => { const c = codeOf(k); return !!c && !(c.vitest || []).length && !(c.e2e || []).length; };
  const PARTS = REPO ? Object.values(NODE).filter(n => n.level === 2 && codeOf(n)) : [];
  const GAPS = PARTS.filter(isGap).sort((a, b) => codeOf(b).nLines - codeOf(a).nLines || a.name.localeCompare(b.name));
  const GAP_LINES = GAPS.reduce((t, k) => t + codeOf(k).nLines, 0);
  // a block lights up by the share of its lines in untested parts: some light at all, full light when none is tested
  const GAPB = new Map();
  for (const k of PARTS) { const b = k.parent.id, g = GAPB.get(b) || { gap: 0, all: 0 }; g.all += codeOf(k).nLines; if (isGap(k)) g.gap += codeOf(k).nLines; GAPB.set(b, g); }
  for (const [b, g] of GAPB) if (!g.gap) GAPB.delete(b);
  const gapHeat = id => { const g = GAPB.get(id); return g ? .45 + .55 * (g.all ? g.gap / g.all : 1) : 0; };
  const isCh = k => { const c = k && k.item && k.item.code; if (!c) return false; return c.files ? c.files.some(f => CHF.has(f[0])) : !!pieceCh(c); };
  function openIn() {
    if (!REPO) return '';
    return `<div class="openin"><span class="k">Code opens in</span><div class="seg">${[['github', 'GitHub'], ['vscode', 'VS Code'], ['cursor', 'Cursor']].map(([k, l]) => `<button type="button" data-open="${k}" class="${PREF.open === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${PREF.open !== 'github' ? `<label class="root"><span>Your checkout of ${esc(REPO.name)}</span><input type="text" data-root value="${esc(PREF.root)}" spellcheck="false" autocomplete="off"></label>` : REPO.pushed ? '' : `<p class="warn">Commit ${esc(REPO.sha.slice(0, 7))} is not on GitHub yet: these links work once ${esc(REPO.branch)} is pushed.</p>`}</div>`;
  }
  function partCode(k, title) {
    const c = k.item && k.item.code; if (!c || !c.files) return '';
    const cnt = Object.entries(c.counts).filter(([, v]) => v).map(([kk, v]) => `${v} ${v === 1 ? KL[kk] : PLUR[kk]}`).join(' · ');
    const files = c.files.slice().sort((a, b) => (st.branch ? (CHF.has(b[0]) ? 1 : 0) - (CHF.has(a[0]) ? 1 : 0) : 0) || b[1] - a[1]);
    let h = `<section class="code"><span class="k">${title || 'Code'} · ${esc(k.name)}</span><p class="meta">${plural(c.files.length, 'file')} · ${c.nLines.toLocaleString('en-US')} lines${cnt ? ` · ${cnt}` : ''}</p>`;
    h += more(files, 8, f => st.branch && CHF.has(f[0]) ? aDiff(f[0], CHF.get(f[0])) : aSrc(f[0], null, null, `${loc(f[0])}  ·  ${f[1]}`, 'file'), 'files');
    if (c.db.length) h += `<span class="k sub">${esc(RLC)}</span><div class="chips">${c.db.map(([m, r, g]) => `<button type="button" class="chip-b" data-port="${g}" title="${RW[r]} ${esc(m)}">${esc(m)} <em>${r === 'rw' ? 'r/w' : r}</em></button>`).join('')}</div>`;
    h += `<span class="k sub">Tests</span><p class="meta">${plural(c.vitest.length, `${RUN.unit} file`)} · ${plural(c.e2e.length, `${RUN.e2e} spec`)}${!c.vitest.length && !c.e2e.length ? ' · <b class="gap">no test reaches this part</b>' : ''}</p>`;
    if (c.vitest.length + c.e2e.length) h += more([...c.vitest.map(f => [f, (AZ.runners || {})[f] || RUN.unit]), ...c.e2e.map(f => [f, (AZ.runners || {})[f] || RUN.e2e])], 3, ([f, w]) => aSrc(f, null, null, `${w} · ${f.replace(TEST_RE, '')}`, 'test'), 'tests');
    h += `<button type="button" class="copy" data-copy="${esc(k.id)}">Copy context for Claude</button> <button type="button" class="copy" data-link>Copy link</button></section>`;
    return h;
  }
  function pieceCode(k) {
    const c = k.item && k.item.code; if (!c) return '';
    let h = `<section class="code"><span class="k">${esc(KL[k.item.sk] || 'symbol')} · ${esc(c.sym)}${st.branch && pieceCh(c) ? ` · <b>${esc(pieceCh(c))} in ${esc(CUR_C.hl)}</b>` : ''}</span>${aSrc(c.p, c.l, c.e, `${loc(c.p)}:${c.l}–${c.e}`, 'symbol', c.sym)}`;
    if (c.sig) h += `<pre class="sig">${esc(c.sym + c.sig)}</pre>`;
    if (c.doc) h += `<p>${esc(c.doc)}</p>`;
    h += `<span class="k sub">Used by · ${c.nCallers}</span>${c.callers.length ? more(c.callers, 4, ([p, l, fs, st, , k, cn, col]) => aSrc(p, l, null, `${fs || 'module'} · ${loc(p, l)}`, k === 'call' ? 'call-site' : 'ref-site', k === 'call' ? cn : c.sym, [c.p, c.l, c.e], col, k === 'call' && st ? { st } : null), 'callers') : `<p class="meta">Nothing in ${esc(ROOTS_TXT)} calls it directly (a page, a route or an entry point).</p>`}`;
    if (c.nCallers > c.callers.length) h += `<p class="meta">and ${c.nCallers - c.callers.length} more places</p>`;
    if (c.calls.length) h += `<span class="k sub">Calls · ${c.nCalls}</span>${more(c.calls, 4, ([sym, p, l, , , e]) => aSrc(p, l, e || null, `${sym} · ${loc(p)}`, 'symbol', sym), 'calls')}`;
    if (c.uses && c.uses.length) h += `<span class="k sub">Uses · ${c.nUses}</span>${more(c.uses, 4, ([sym, p, l, , , e]) => aSrc(p, l, e || null, `${sym} · ${loc(p)}`, 'symbol', sym), 'uses')}`;
    if (c.db.length) h += `<span class="k sub">${esc(RLC)}</span>${c.db.map(([m, r, l, st, res]) => dataLink(c.p, l, `${RW[r]} ${m} · line ${l}`, m, st, res)).join('')}`;
    return h + '</section>';
  }
  function groupCode(i) {
    const g = GROUP[DOCKSETS[i][0]];
    if (!g.models.length) return `<section class="code"><span class="k">Port ${g.n} · ${esc(g.name)}</span>${g.tip ? `<p>${esc(g.tip)}</p>` : ''}<span class="k sub">Blocks on this port</span>${g.users.length ? g.users.map(([m, , r]) => row(`data-m="${esc(m)}"`, '←', MOD[m] ? MOD[m].name : m, r || '', '')).join('') : '<p class="meta">No block uses this port.</p>'}</section>`;
    let h = `<section class="code"><span class="k">Port ${g.n} · ${esc(g.name)}</span>${g.tip ? `<p>${esc(g.tip)}</p>` : ''}<span class="k sub">${esc(STORE.what[0].toUpperCase() + STORE.what.slice(1))} · ${g.models.length}</span>`;
    // a Prisma model links its block in the schema; a bucket, a table or a queue the line that names it
    h += more(g.modelsInfo, 10, ([m, l, e, nf, file, sto, res]) => { const ch = st.branch && CUR_C && CUR_C.models.includes(m) ? ' · changed' : '';
      return sto ? aSrc(file, l, e, `${m} · ${(STORE.of || {})[sto] || sto}${nf ? ` · ${nf} fields` : ''}${ch}`, 'resource', m, null, null, { store: sto, res }) : aSrc(file || 'prisma/schema.prisma', l, e, `${m} · ${nf} fields${ch}`, 'model', m); }, STORE.what);
    h += `<span class="k sub">Used by</span>${g.users.length ? g.users.map(([m, n, r]) => row(`data-m="${esc(m)}"`, '←', MOD[m] ? MOD[m].name : m, RW[r], `${plural(n, 'call site')}`)).join('') : `<p class="meta">No ${esc(STORE.label)} calls found for these ${esc(STORE.what)}.</p>`}`;
    return h + '</section>';
  }
  function codeFor() {
    const t = top(), s = st.sel && NODE[st.sel];
    if (t === 'dock') return groupCode(st.dockSel);
    if (!t) return '';
    const n = NODE[t];
    if (n.level === 1) return s && s.parent === n ? partCode(s) : '';
    return (s && s.parent === n ? pieceCode(s) : '') + partCode(n, 'All code');
  }
  const renderCode = () => { const el = ins.querySelector('#az-code'); if (el) el.innerHTML = codeFor(); };
  /* ---------- links: the URL's #hash names what is open (a block, a part, a function or piece), so a link opens it again ---------- */
  const hashOf = id => id ? '#' + encodeURIComponent(id).replace(/%2F/g, '/') : '';
  const nodeOfHash = () => {
    let h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch { return null; }
    const n = h && Object.prototype.hasOwnProperty.call(NODE, h) ? NODE[h] : null;
    return n && n.level && n.kind !== 'zone' ? n : null;
  };
  const LINKED = nodeOfHash();
  // what the URL names: the selection inside what is open, else what is open; nothing on the whole map
  const here = () => !st.path.length ? '' : st.sel && NODE[st.sel] && NODE[st.sel].kind !== 'zone' ? st.sel : top();
  function goNode(n) {
    if (n.level === 1) open(n.id);
    else open(n.parent.id, n.id);   // a part: its block open, it selected; a piece: its part open, it selected
  }
  let HASHED = LINKED ? location.hash : '';   // a #hash that names nothing stays as it is until something opens
  function syncHash() {
    const want = hashOf(here());
    if (want === HASHED || (!want && !HASHED)) return;
    HASHED = want;
    try { history.replaceState(history.state, '', want || location.pathname + location.search); } catch {}
  }
  addEventListener('hashchange', () => {
    HASHED = location.hash;
    const n = nodeOfHash(); st.touched = true;
    if (n) goNode(n); else if (!location.hash) { stopJourney(true); closeAll(); frameBox(BOX0, 900); }
  });
  function copyLink(b) {
    syncHash();
    const url = location.href, label = b && b.firstChild ? b.firstChild : null, was = label ? label.textContent : '';
    const done = ok => { if (!label) return; label.textContent = ok ? 'Copied' : was; setTimeout(() => { label.textContent = was; }, 1400); if (!ok) prompt('Copy this link', url); };
    try { navigator.clipboard.writeText(url).then(() => done(true), () => done(false)); } catch { done(false); }
  }
  function copyContext(id) {
    const k = NODE[id], c = k.item.code;
    const txt = `In ${REPO.name} (commit ${REPO.sha.slice(0, 7)}), look at «${k.name}» inside the «${k.parent.name}» block: ${k.tip || k.what || ''}\nFiles:\n${c.files.map(f => `- ${f[0]}`).join('\n')}\n${c.db.length ? `It touches these ${STORE.label} ${STORE.what}: ${c.db.map(d => d[0]).join(', ')}.\n` : ''}`;
    const done = ok => { const b = ins.querySelector(`[data-copy="${CSS.escape(id)}"]`); if (b) { b.textContent = ok ? 'Copied' : 'Select and copy below'; } if (!ok && b) { const ta = document.createElement('textarea'); ta.className = 'copied'; ta.value = txt; b.after(ta); ta.select(); } };
    try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch { done(false); }
  }

  /* ---------- readout and side panel ---------- */
  const stepName = s => isPort(s) ? `${RLC} · ${GROUP[+s.slice(1)].name}` : MOD[s].name;
  // the comparison on show: which files and functions changed, which blocks light, which tables
  const CM = AZ.cmp, PATHS = CM.paths, PIDX = Object.fromEntries(PATHS.map((p, i) => [p, i]));
  const lab = r => { const h = CM.heads.find(x => x[0] === r); return h ? h[1] : String(r).replace(/^(origin|upstream)\//, ''); };
  let CUR_C = null, CHF = new Map(), CHS = new Set(), BRM = new Map(), BRDB = new Set(), BRHIT = new Set();
  function setCmp(i) {
    CUR_C = CM.list[i] || null; st.cmpI = i;
    CHF = new Map((CUR_C ? CUR_C.f : []).map(([x, s]) => [PATHS[x], s]));
    CHS = new Set(CUR_C ? Object.entries(CUR_C.s).flatMap(([x, ns]) => ns.map(n => `${PATHS[x]}#${n}`)) : []);
    BRM = new Map((CUR_C ? CUR_C.mods : []).map(x => [x[0], x]));
    BRDB = new Set(CUR_C ? CUR_C.db : []);
    BRHIT = new Set(Object.values(CUR_C ? CUR_C.blast : {}).flatMap(l => l.map(x => x[0])).filter(m => !BRM.has(m)));
  }
  setCmp(CM.def);
  function pickCmp(base, head) {
    const i = CM.list.findIndex(c => c.base === base && c.head === head);
    if (i >= 0) { st.cmpWant = null; setCmp(i); } else st.cmpWant = { base, head };
    if (!st.path.length && !st.jour) showLinks(null);
    const y = ins.scrollTop; panel(); say(); ins.scrollTop = y;
  }
  function say() {
    if (active !== 'az') return;
    const el = document.getElementById('read'), out = s => { el.textContent = s; };
    const J = st.jour, t = J ? null : top();
    if (t === 'dock') return out(`${RL} · port ${DOCKSETS[st.dockSel][0]} · ${GROUP[DOCKSETS[st.dockSel][0]].name.toLowerCase()}`);
    if (t) { const s = st.sel && NODE[st.sel]; return out(`${st.path.map(i => NODE[i].tag.toLowerCase()).join(' › ')}${s ? ` · ${s.tag.toLowerCase()}` : ''}${s && openable(s) ? ' · enter opens it' : ''}`); }
    if (J) { const jj = AZ.journeys[J.k]; return out(`walkthrough ${J.k + 1} · step ${Math.max(1, J.i + 1)} of ${jj.steps.length} · ${stepName(jj.steps[Math.max(0, J.i)]).toLowerCase()}`); }
    if (st.hoverPort) return out(`port ${st.hoverPort} · ${GROUP[st.hoverPort].name.toLowerCase()}`);
    const f = st.hover || st.focus;
    if (st.gaps && !f) return out(`test gaps · ${GAPS.length} of ${PARTS.length} parts no test reaches · ${GAPB.size} blocks lit`);
    if (st.branch && !f) return out(CUR_C && !st.cmpWant ? `${CUR_C.hl} vs ${CUR_C.bl} · ${CUR_C.f.length} files changed · ${CUR_C.mods.length} blocks lit` : 'compare branches · pick a pair');
    out(f ? `${MOD[f].short.toLowerCase()} · ${MOD[f].parts.length} parts · ${MOD[f].count}` : `${LIST.filter(m => m.id !== 'dock').length} blocks · ${REPO ? `${AZ.totals.files} files · ` : ''}${AZ.journeys.length} walkthroughs · drag to orbit`);
  }
  const row = (attrs, n, t, c, d, on, go) => `<button type="button" class="row${on ? ' on' : ''}" ${attrs}><span class="n">${n}</span><span class="t">${esc(t)}</span><span class="c${go ? ' go' : ''}">${esc(c || '')}</span>${d ? `<span class="d">${esc(d)}</span>` : ''}</button>`;
  const sites = list => list && list.length ? `<details class="sites"><summary>${plural(list.length, 'place')} in the code</summary>${list.map(([p, l, fs, ts, tp, tl, te, st, , k, cn, col]) => aSrc(p, l, null, `${fs || 'module'} → ${ts} · ${loc(p, l)}`, k === 'call' ? 'call-site' : 'ref-site', k === 'call' ? cn : ts, [tp, tl, te], col, k === 'call' && st ? { st } : null)).join('')}</details>` : '';
  const keysTxt = `<b>click</b> a block to open it · <b>ⓘ</b> or <b>i</b> explains · <b>← →</b> move · <b>enter</b> open · <b>space</b> next walkthrough${ARCH ? '' : ' · <b>b</b> this branch · <b>g</b> test gaps'} · <b>esc</b> back`;
  function panel() {
    const J = st.jour, t = J ? null : top();
    if (t === 'dock') {
      const m = MOD.dock;
      ins.innerHTML = `<nav class="crumbs"><button type="button" data-act="root">${WHOLE}</button>›<span>${esc(RLC)}</span></nav>
        <div class="head"><span class="k">${esc(LAYER.dock.name)}</span><h2>${esc(m.name)}</h2><p class="lead">${esc((AZ.rail && AZ.rail.tip) || m.role)}</p><span class="chip">${esc(m.count)}</span></div>
        <section><span class="k">${ARCH ? 'Ports' : 'Groups · one port each'}</span>${m.parts.map((p, i) => row(`data-dock="${i}"`, String(p.ports[0]).padStart(2, '0'), p.name, st.branch && BRDB.has(p.ports[0]) ? 'changed' : '', p.what, i === st.dockSel)).join('')}</section>
        <div id="az-code">${codeFor()}</div>${openIn()}
        <div class="keys"><b>↑ ↓</b> ${ARCH ? 'ports' : 'groups'} · <b>esc</b> back to the whole ${REPO ? 'repo' : 'map'}</div>`;
      return;
    }
    if (t) {
      const n = NODE[t], crumbs = st.path.map((id, i) => i < st.path.length - 1 ? `<button type="button" data-n-crumb="${esc(id)}">${esc(NODE[id].tag)}</button>›` : `<span>${esc(NODE[id].tag)}</span>`).join('');
      const kick = n.level === 1 ? esc(LAYER[n.m.layer].name) : `${KIND[n.kind].label} · inside ${esc(n.parent.name)}`;
      let h = `<nav class="crumbs"><button type="button" data-act="root">${WHOLE}</button>›${crumbs}</nav>
        <div class="head"><span class="k">${kick}</span><h2>${esc(n.name)}</h2>${n.tip ? `<p class="lead">${esc(n.tip)}</p>` : ''}${n.what && n.what !== n.tip ? `<p>${esc(n.what)}</p>` : ''}${n.level === 1 && n.m.count ? `<span class="chip">${esc(n.m.count)}</span>` : ''}</div>`;
      const cc = k => { if (st.gaps && isGap(k)) return 'no test reaches it'; if (st.branch && isCh(k)) return k.item.code.files ? `${k.item.code.files.filter(f => CHF.has(f[0])).length} changed` : pieceCh(k.item.code); return openable(k) ? `▸ ${k.kids.length} inside` : (n.level === 2 && k.item.sk ? KL[k.item.sk] : KIND[k.kind].label); };
      h += `<section><span class="k">Inside · ${n.kids.length} ${n.level === 1 ? 'parts' : REPO ? 'symbols' : 'pieces'}</span>${n.kids.map(k => row(`data-n="${esc(k.id)}"`, num(k.idx), k.name, cc(k), k.what, k.id === st.sel, openable(k) || (st.branch && isCh(k)))).join('')}</section>`;
      h += `<div id="az-code">${codeFor()}</div>`;
      if (n.links.length) h += `<section><span class="k">Connections inside</span>${n.links.map(l => { const L = (n.level === 1 ? n.m.links : n.item.links || []).find(x => x.from === l.a.item.id && x.to === l.b.item.id); return row(`data-n="${esc(l.a.id)}" data-link="1"`, '→', `${l.a.tag} → ${l.b.tag}`, L && L.n ? plural(L.n, 'call') : '', l.label, false) + sites(L && L.sites); }).join('')}</section>`;
      if (n.level === 1) {
        const outs = AZ.flows.filter(f => f.from === n.id && MOD[f.to] && f.to !== 'dock'), inn = AZ.flows.filter(f => f.to === n.id && MOD[f.from]), db = AZ.flows.filter(f => f.from === n.id && f.to === 'dock');
        if (outs.length + inn.length) h += `<section><span class="k">Connections to other blocks</span>${outs.map(f => row(`data-m="${f.to}"`, '→', MOD[f.to].name, `${f.kind}${f.n ? ` · ${f.n}` : ''}`, f.label) + sites(f.sites)).join('')}${inn.map(f => row(`data-m="${f.from}"`, '←', MOD[f.from].name, `${f.kind}${f.n ? ` · ${f.n}` : ''}`, f.label) + sites(f.sites)).join('')}</section>`;
        if (db.length) h += `<section><span class="k">${esc(RLC)}</span>${db.map(f => row(`data-m="P${f.ports[0]}"`, String(f.ports[0]).padStart(2, '0'), GROUP[f.ports[0]].name, `${f.kind}${f.n ? ` · ${f.n}` : ''}`, f.label.split(': ')[1] || '')).join('')}</section>`;
      }
      h += openIn();
      h += `<div class="keys"><b>↑ ↓</b> ${n.level === 1 ? 'parts' : 'symbols'} · <b>enter</b> opens a part with ▸ · <b>i</b> explains · <b>← →</b> next ${n.level === 1 ? 'block' : 'part'} · <b>esc</b> one level up · <b>drag</b> to look around</div>`;
      ins.innerHTML = h;
      return;
    }
    if (J) {
      const jj = AZ.journeys[J.k];
      ins.innerHTML = `<button type="button" class="back" data-act="stop">← ${WHOLE}</button>
        <div class="head"><span class="k">Walkthrough <b>${J.k + 1}</b> of ${AZ.journeys.length}${jj.group ? ` · ${esc(jj.group)}` : ''}</span><h2>${esc(jj.name)}</h2><p>${esc(jj.caption)}</p></div>
        <section><span class="k">Steps · click one to open it</span>${jj.steps.map((s, i) => { const c = (jj.code || [])[i];
          return row(`data-m="${s}"${c && c.sel ? ` data-sel="${esc(c.pc || c.sel)}"` : ''}`, num(i), c && c.sym && !c.db ? c.sym : stepName(s), isPort(s) ? RLC : MOD[s].short, (jj.notes || [])[i] || '', i === J.i) + (c && c.p ? `<div class="step-src">${(c.db ? dataLink(c.p, c.l, loc(c.p, c.l), c.m, c.st, c.res) : aSrc(c.p, c.l, c.e, loc(c.p, c.l), 'symbol', c.sym))}</div>` : ''); }).join('')}</section>
        ${openIn()}<div class="keys"><b>space</b> next walkthrough · <b>esc</b> stop</div>`;
      return;
    }
    if (st.gaps) {
      const none = PARTS.length && GAPS.length === PARTS.length;
      ins.innerHTML = `<button type="button" class="back" data-act="gaps">← Leave the test gaps view</button>
        <div class="head"><span class="k">Test gaps</span>
          <h2>${GAPS.length ? `${plural(GAPS.length, 'part')} no test reaches` : 'A test reaches every part'}</h2>
          <p class="meta">${GAPS.length} of ${plural(PARTS.length, 'part')} · ${GAP_LINES.toLocaleString('en-US')} lines untested · ${plural(GAPB.size, 'block')} lit</p>
          <p>${none ? `The scan found no ${esc(RUN.unit)} file or ${esc(RUN.e2e)} spec that reaches this code, so every part is a gap.` : `A part is a gap when no ${esc(RUN.unit)} file imports its code and no ${esc(RUN.e2e)} spec visits it. Lit blocks hold gaps: the brighter, the bigger the untested share of their lines.`} Biggest gap first; open one to see its code.</p></div>
        ${GAPS.length ? `<section><span class="k">Untested parts · biggest first</span>${GAPS.map(k => row(`data-m="${esc(k.parent.id)}" data-sel="${esc(k.id)}"`, '○', k.name, `${codeOf(k).nLines.toLocaleString('en-US')} lines`, `${k.parent.name} · ${plural(codeOf(k).files.length, 'file')}`, false, true)).join('')}</section>` : ''}
        <div class="keys"><b>g</b> or <b>esc</b> leaves the test gaps view · ${keysTxt}</div>`;
      return;
    }
    if (st.branch) {
      const B = CUR_C, sel = st.cmpWant || (B ? { base: B.base, head: B.head } : { base: CM.bases[0], head: (CM.heads[0] || [])[0] });
      const ctl = `<div class="cmpctl">
          <label><span class="k">Base</span><select data-cmp="base">${CM.bases.map(b => `<option value="${esc(b)}"${b === sel.base ? ' selected' : ''}>${esc(lab(b))}</option>`).join('')}</select></label>
          <button type="button" class="swap" data-act="swap" title="Swap the two branches" aria-label="Swap the two branches"${CM.bases.includes(sel.head) ? '' : ' disabled'}>⇄</button>
          <label><span class="k">Compare</span><select data-cmp="head">${CM.heads.map(([n, l, , c]) => `<option value="${esc(n)}"${n === sel.head ? ' selected' : ''}>${esc(l)}${c ? ' · checked out' : ''}</option>`).join('')}</select></label></div>`;
      if (!B || st.cmpWant) {
        const same = sel.base === sel.head;
        ins.innerHTML = `<button type="button" class="back" data-act="branch">← Leave the branch view</button>
          <div class="head"><span class="k">Compare branches</span>${ctl}<h2>${same ? 'Pick two different branches' : 'This pair is not in the build'}</h2>
          ${same ? '' : `<p>This page carries the ${CM.list.length} comparisons made when it was built. To add ${esc(lab(sel.base))} → ${esc(lab(sel.head))}, build it again with:</p><pre class="sig">archivision repo ${esc(REPO.root)} --compare ${esc(sel.base)}..${esc(sel.head)}</pre>`}</div>`;
        return;
      }
      const day = new Date(B.t * 1000).toISOString().slice(0, 10);
      ins.innerHTML = `<button type="button" class="back" data-act="branch">← Leave the branch view</button>
        <div class="head"><span class="k">Compare branches</span>${ctl}
          <h2>${B.f.length ? `${plural(B.f.length, 'file')} changed` : 'Nothing new'}</h2>
          <p class="meta">${plural(B.ahead, 'commit')} on ${esc(B.hl)} that ${esc(B.bl)} does not have · ${plural(B.behind, 'commit')} the other way · last commit ${day}</p>
          ${B.inc ? `<p class="meta"><b class="gap">${esc(B.inc)}</b></p>` : ''}
          ${B.f.length ? `<p>${B.src} of them are code in ${esc(ROOTS_TXT)}, in ${plural(B.mods.length, 'block')}, touching ${plural(B.nsym, 'top-level symbol')}. Lit blocks hold the changes; dashed arcs come from blocks that call the changed code. Open a block to see which parts and functions changed.</p>` : `<p>${esc(B.hl)} has no changes that ${esc(B.bl)} lacks.</p>`}
          ${REPO.remote ? `<a class="src" href="${esc(`${REPO.remote}/compare/${encodeURIComponent(B.bl)}...${encodeURIComponent(B.hl)}`)}" target="_blank" rel="noopener" data-kind="compare" data-base="${esc(B.bl)}" data-head="${esc(B.hl)}"><span>Compare ${esc(B.bl)}…${esc(B.hl)} on GitHub</span><i aria-hidden="true">↗</i></a>` : ''}</div>
        ${B.mods.length ? `<section><span class="k">Blocks with changes</span>${B.mods.slice().sort((a, b) => b[1] - a[1]).map(([m, nf, ps]) => MOD[m] ? row(`data-m="${m}"`, '●', MOD[m].name, plural(nf, 'file'), ps.map(p => (MOD[m].parts.find(x => x.id === p) || {}).name).filter(Boolean).join(', '), false, true) : '').join('')}</section>` : ''}
        ${Object.keys(B.blast).length ? `<section><span class="k">Who calls the changed code</span>${Object.entries(B.blast).filter(([b]) => MOD[b]).map(([b, l]) => row(`data-m="${b}"`, '←', MOD[b].name, '', `called from ${l.slice(0, 4).map(([a, k]) => `${MOD[a] ? MOD[a].short : a} (${k})`).join(', ')}${l.length > 4 ? ` +${l.length - 4}` : ''}`)).join('')}</section>` : ''}
        ${B.db.length ? `<section><span class="k">Database groups with changed models</span>${B.db.map(n => row(`data-m="P${n}"`, String(n).padStart(2, '0'), GROUP[n].name, `${GROUP[n].models.filter(m => B.models.includes(m)).length} changed`, B.models.filter(m => GROUP[n].models.includes(m)).join(', '))).join('')}</section>` : ''}
        ${B.other.length ? `<section class="code"><span class="k">Outside the mapped code · ${B.other.length}</span>${more(B.other, 6, ([x, s]) => aDiff(PATHS[x], s), 'files')}</section>` : ''}
        <div class="keys"><b>b</b> or <b>esc</b> leaves the branch view · ${keysTxt}</div>`;
      return;
    }
    const T = AZ.totals || {};
    ins.innerHTML = (REPO ? `<div class="head"><span class="k">Archivision · repo</span><h2>${esc(REPO.name)}</h2><p>${esc(AZ.intro)}</p>
        <p class="meta">${T.files.toLocaleString('en-US')} files · ${T.lines.toLocaleString('en-US')} lines · ${T.symbols.toLocaleString('en-US')} symbols${T.models ? ` · ${T.models} ${esc(STORE.label)} ${esc(STORE.what)}` : ''}<br>read from <b>${esc(REPO.branch)}</b> at ${esc(REPO.sha.slice(0, 7))} · ${esc(REPO.scanned.slice(0, 10))}</p>
        <button type="button" class="branch-b" data-act="branch"><span>Compare branches</span><em>${CUR_C ? `${esc(CUR_C.hl)} vs ${esc(CUR_C.bl)}: ${plural(CUR_C.f.length, 'file')} changed` : 'no comparisons in this build'}</em></button>
        <button type="button" class="branch-b" data-act="gaps"><span>Test gaps</span><em>${GAPS.length ? `${GAPS.length} of ${plural(PARTS.length, 'part')} no test reaches` : 'a test reaches every part'}</em></button>`
      : `<div class="head"><span class="k">Archivision · architecture</span><h2>${esc(AZ.title)}</h2><p>${esc(AZ.intro)}</p>
        <p class="meta">${plural(T.blocks, 'block')} · ${plural(T.parts, 'part')} · ${plural(T.pieces, 'piece')}${T.ports ? ` · ${plural(T.ports, 'port')}` : ''}${AZ.source ? `<br>${esc(AZ.source)}` : ''}</p>`) + `
        <p>Drag to turn the model, scroll to zoom, right-drag to pan.</p></div>
      ${[...new Set(AZ.journeys.map(j => j.group || 'Walkthroughs'))].map(g => `<section><span class="k">Walkthroughs · ${esc(g)}</span>${AZ.journeys.map((j, i) => (j.group || 'Walkthroughs') !== g ? '' : row(`data-j="${i}"`, String(i + 1), j.name, `${j.steps.length} steps${j.status === 'unresolved' ? ' · not traced' : j.status && j.status !== 'exact' ? ' · inferred' : ''}`, '')).join('')}</section>`).join('')}
      ${AZ.layers.map(l => { const ms = LIST.filter(m => m.layer === l.id); return ms.length ? `<section><span class="k">${esc(l.name)}</span>${ms.map(m => { const deep = m.id === 'dock' ? 0 : NODE[m.id].kids.filter(openable).length; return row(`data-m="${m.id}"`, num(LIST.indexOf(m)), m.name, m.id === 'dock' ? `${AZ.groups.length} ${ARCH ? 'ports' : 'groups'}` : `${m.parts.length} parts${deep ? ` · ${deep} ▸` : ''}`, '', m.id === st.focus); }).join('')}</section>` : ''; }).join('')}
      ${coverage()}${openIn()}<div class="keys">${keysTxt}</div>`;
  }
  // what the map covers and leaves out: everything not read, not resolved or not placed is counted (repo pages)
  function coverage() {
    const C = AZ.coverage; if (!REPO || !C) return '';
    return `<section class="code coverage"><span class="k">Coverage</span>${C.lines.map(l => `<p class="meta">${esc(l[0].toUpperCase() + l.slice(1))}.</p>`).join('')}</section>`;
  }
  function setGaps(on) {
    st.gaps = !!(on && REPO); if (st.gaps) st.branch = false; stopJourney(true); hideTip(true);
    if (!st.path.length) showLinks(null);
    refresh(); ins.scrollTop = 0;
  }
  function setBranch(on) {
    st.branch = on && !ARCH; if (st.branch) st.gaps = false; stopJourney(true); hideTip(true);
    if (!st.path.length) showLinks(null);
    refresh(); ins.scrollTop = 0;
  }
  ins.addEventListener('click', e => {
    if (e.target.closest('a')) { st.touched = true; return; }
    const b = e.target.closest('button'); if (!b) return;
    st.touched = true;
    if (b.dataset.act === 'root') { closeAll(); }
    else if (b.dataset.act === 'stop') stopJourney();
    else if (b.dataset.act === 'branch') setBranch(!st.branch);
    else if (b.dataset.act === 'gaps') setGaps(!st.gaps);
    else if (b.dataset.act === 'swap') { const bs = ins.querySelector('select[data-cmp="base"]'), hs = ins.querySelector('select[data-cmp="head"]'); if (bs && hs) pickCmp(hs.value, bs.value); }
    else if (b.dataset.open) { PREF.open = b.dataset.open; savePref(); const y = ins.scrollTop; panel(); ins.scrollTop = y; }
    else if (b.dataset.copy) { copyContext(b.dataset.copy); return; }
    else if (b.dataset.link !== undefined) { copyLink(b); return; }
    else if (b.dataset.port) openPort(+b.dataset.port);
    else if (b.dataset.nCrumb) { while (st.path.length && top() !== b.dataset.nCrumb) back1(); }
    else if (b.dataset.dock !== undefined) { st.dockSel = +b.dataset.dock; say(); renderCode(); ins.querySelectorAll('.row[data-dock]').forEach(r => r.classList.toggle('on', r === b)); }
    else if (b.dataset.n) { const n = NODE[b.dataset.n]; if (openable(n) && !b.dataset.link) open(n.id); else select(n.id); }
    else if (b.dataset.m) { if (isPort(b.dataset.m)) openPort(+b.dataset.m.slice(1)); else { const sel = b.dataset.sel && NODE[b.dataset.sel]; if (sel && sel.level === 3) { open(sel.parent.id, sel.id); } else open(b.dataset.m, sel ? sel.id : undefined); } }
    else if (b.dataset.j !== undefined) playJourney(+b.dataset.j);
    b.blur();
  });
  ins.addEventListener('change', e => { if (e.target.matches('select[data-cmp]')) { st.touched = true; pickCmp(ins.querySelector('select[data-cmp="base"]').value, ins.querySelector('select[data-cmp="head"]').value); return; } if (e.target.matches('input[data-root]')) { PREF.root = e.target.value.trim() || REPO.root; savePref(); const y = ins.scrollTop; panel(); ins.scrollTop = y; } });
  ins.addEventListener('keydown', e => { if (e.target.matches('input, textarea, select')) e.stopPropagation(); }, true);
  ins.addEventListener('pointerover', e => {
    const b = e.target.closest('button.row'); if (!b) return;
    if (b.dataset.n && top()) select(b.dataset.n);
    else if (b.dataset.dock !== undefined && top() === 'dock' && +b.dataset.dock !== st.dockSel) { st.dockSel = +b.dataset.dock; say(); renderCode(); ins.querySelectorAll('.row[data-dock]').forEach(r => r.classList.toggle('on', r === b)); }
    else if (!top() && !st.jour && b.dataset.m && b.dataset.m !== st.hover && MOD[b.dataset.m] && b.dataset.m !== 'dock') { st.hover = b.dataset.m; showLinks(st.hover); say(); }
  });
  ins.addEventListener('pointerleave', () => { if (!top() && !st.jour && st.hover) { st.hover = null; showLinks(null); say(); } });

  /* ---------- pointer on the model ---------- */
  const RAY = new THREE.Raycaster(), NDC = new THREE.Vector2();
  function pickable(o) {
    for (let x = o; x; x = x.parent) if (!x.visible) return false;
    const ud = o.userData;
    if (ud.cover && ud.node) { const pr = prog[ud.node.id]; if (pr && pr.p > .22) return false; if (ud.node.level > 1 && VIS[ud.node.id].q < .5) return false; }
    return true;
  }
  let PICKV = null, PICKF = -1, FRAME = 0;
  const pickList = () => { if (PICKF !== FRAME) { PICKF = FRAME; PICKV = PICK.filter(o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; }); } return PICKV; };
  function pickAt(cx, cy) {
    NDC.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); RAY.setFromCamera(NDC, camera);
    for (const h of RAY.intersectObjects(pickList(), false)) if (pickable(h.object)) return h.object.userData;
    return null;
  }
  function onClick(ud) {
    st.touched = true;
    if (tip && tip.pinned) hideTip(true);
    if (!ud || ud.plate) { if (st.path.length) back1(); else if (st.jour) stopJourney(); return; }
    if (ud.port) return openPort(ud.port);
    if (ud.rail) return open('dock');
    const n = ud.node, t = top();
    if (ud.floor) { if (n.id !== t) while (st.path.length && top() !== n.id) back1(); return; }
    if (n.level === 1) { if (n.id !== st.path[0]) open(n.id); return; }
    if (n.parent && n.parent.id === t) return openable(n) ? open(n.id) : select(n.id);
    if (n.parent && st.path.includes(n.parent.id)) return openable(n) ? open(n.id) : (back1(), select(n.id));
  }
  function onHover(ud) {
    const cv = renderer.domElement;
    cv.style.cursor = ud && (ud.node || ud.port || ud.rail) && !(ud.floor && ud.node.id === top()) ? 'pointer' : '';
    if (st.path.length) { if (!st.jour && ud && ud.cover && ud.node.parent && ud.node.parent.id === top()) select(ud.node.id); return; }
    const hp = ud && ud.port || null, id = ud && ud.node && ud.node.level === 1 ? ud.node.id : null;
    if (hp !== st.hoverPort || id !== st.hover) { st.hoverPort = hp; st.hover = id; showLinks(id, hp); say(); }
  }
  let HP = null, hoverDirty = false, pressed = false;
  const cvs = renderer.domElement;
  cvs.addEventListener('pointermove', e => { HP = [e.clientX, e.clientY]; hoverDirty = true; });
  cvs.addEventListener('pointerleave', () => { HP = null; hoverDirty = true; });
  cvs.addEventListener('pointerdown', () => { pressed = true; st.touched = true; cancelCam(); });
  addEventListener('pointerup', () => { pressed = false; });
  cvs.addEventListener('wheel', () => { st.touched = true; cancelCam(); }, { passive: true });
  addEventListener('resize', () => { if (inited) { layoutView(); } });

  // pins follow the camera after the controls have moved it, just before the frame is drawn
  const _render = composer.render.bind(composer);
  composer.render = (...a) => { if (active === 'az' && inited) { camera.updateMatrixWorld(); placePins(); } return _render(...a); };

  themeHooks.push(() => {
    palette(); LINK0.copy(outlineMat.uniforms.color.value).lerp(INKHI, .3);
    faintMat.color.set(PALC.ink); beadMat.color.copy(accent);
    for (const m of LIST) if (VIS[m.id]) VIS[m.id].haloMat.uniforms.color.value.copy(accent);
    TXT.forEach(t => t.redraw());
  });

  /* ---------- keys ---------- */
  const move = d => {
    const t = top();
    if (t && NODE[t] && NODE[t].level === 2) {
      const sib = NODE[t].parent.kids.filter(openable), i = sib.indexOf(NODE[t]);
      if (sib.length > 1) open(sib[(i + d + sib.length) % sib.length].id);
      return;
    }
    const cur = st.path[0] || st.focus, i = cur ? LIST.findIndex(m => m.id === cur) : (d > 0 ? -1 : 0), nx = LIST[(i + d + LIST.length) % LIST.length].id;
    if (st.path.length) open(nx); else { st.focus = nx; showLinks(nx === 'dock' ? null : nx); refresh(); }
  };
  const cycle = d => {
    const t = top();
    if (t === 'dock') { st.dockSel = (st.dockSel + d + DOCKSETS.length) % DOCKSETS.length; panel(); say(); return; }
    const ks = kidsOfTop(); if (!ks.length) return;
    const i = ks.findIndex(k => k.id === st.sel); select(ks[(i + d + ks.length) % ks.length].id);
  };
  const explain = () => {
    const id = st.path.length ? (st.sel || top()) : (st.focus || st.hover);
    const want = id && (PINS.has(id) ? id : null);
    if (!want) return;
    if (tip && tip.id === want) hideTip(true); else { hideTip(true); showTip(want, true); }
  };
  /* ---------- the controls sheet: "?" (or the ? button) lists every key, the bar's buttons and the mouse or touch gestures ---------- */
  const NJ = Math.min(9, AZ.journeys.length);
  const KEYS = [
    ['esc', 'goes back one level, stops a walkthrough, closes a card'],
    ['← →', 'the next block, or the next part when a part is open'],
    ['↑ ↓', 'the next part or piece inside what is open'],
    ['enter', 'opens the block or part that is selected'],
    ['i', 'explains what is selected (as ⓘ does)'],
    ...(AZ.journeys.length ? [['space', 'plays the next walkthrough']] : []),
    ...(NJ ? [[NJ > 1 ? `1–${NJ}` : '1', NJ > 1 ? 'plays that walkthrough' : 'plays the walkthrough']] : []),
    ...(ARCH ? [] : [['b', 'shows what a branch changes'], ['g', 'lights the parts no test reaches']]),
    ['t', 'switches the light and dark theme'],
    ['?', 'shows or hides this list'],
  ];
  const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const GESTURES = TOUCH
    ? [['tap', 'opens a block or a part'], ['drag', 'turns the model'], ['pinch', 'zooms'], ['two fingers', 'pan']]
    : [['click', 'opens a block or a part'], ['drag', 'turns the model'], ['scroll', 'zooms'], ['right-drag', 'pans']];
  const keysCss = document.createElement('style');
  keysCss.textContent = `
    #az-keys-b { all:unset; cursor:pointer; width:28px; height:28px; display:grid; place-items:center; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--ink); font-size:13px; font-weight:600; }
    #az-keys-b:hover, #az-keys-b[aria-expanded="true"] { border-color:var(--accent); color:var(--accent); }
    #az-keys-b:focus-visible { outline:1px solid var(--accent); outline-offset:2px; }
    #az-keys { position:fixed; z-index:8; right:16px; top:64px; width:min(380px, calc(100vw - 24px)); max-height:calc(100vh - 140px); overflow:auto; padding:14px 16px 16px; background:var(--tipbg); border:1px solid var(--line); border-radius:14px;
      box-shadow:0 10px 30px rgba(0,0,0,.25); font:12px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color:var(--ink); scrollbar-width:thin; }
    #az-keys[hidden] { display:none; }
    #az-keys header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
    #az-keys h2 { margin:0; font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); }
    #az-keys header button { all:unset; cursor:pointer; color:var(--dim); padding:2px 6px; border-radius:6px; }
    #az-keys header button:hover, #az-keys header button:focus-visible { color:var(--hi); outline:1px solid var(--line); }
    #az-keys h3 { margin:12px 0 4px; font-size:10px; font-weight:500; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
    #az-keys dl { display:grid; grid-template-columns:max-content 1fr; gap:5px 12px; margin:0; }
    #az-keys dt { white-space:nowrap; }
    #az-keys dd { margin:0; color:var(--ink); }
    #az-keys kbd { display:inline-block; min-width:1.4em; padding:1px 6px; border:1px solid var(--line); border-bottom-width:2px; border-radius:5px; background:var(--bg); color:var(--hi); font:inherit; text-align:center; }
    @media (max-width:819px) { #az-keys { left:12px; right:12px; width:auto; top:56px; } }
  `;
  document.head.appendChild(keysCss);
  const keysEl = document.createElement('div'); keysEl.id = 'az-keys'; keysEl.hidden = true;
  keysEl.setAttribute('role', 'dialog'); keysEl.setAttribute('aria-label', 'Keys and controls');
  document.body.appendChild(keysEl);
  const keysBtn = document.createElement('button'); keysBtn.id = 'az-keys-b'; keysBtn.type = 'button'; keysBtn.textContent = '?';
  keysBtn.title = 'Keys and controls (?)'; keysBtn.setAttribute('aria-label', 'Keys and controls'); keysBtn.setAttribute('aria-expanded', 'false'); keysBtn.setAttribute('aria-controls', 'az-keys');
  { const th = document.getElementById('theme'); if (th && th.parentNode) th.parentNode.insertBefore(keysBtn, th); else document.body.appendChild(keysBtn); }
  const kbds = k => k.split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ');
  // the bar's buttons, read from the page, so a button added there (with its key) shows here too
  const barKeys = () => [...document.querySelectorAll('#ctl-az button')].map(b => { const k = b.querySelector('kbd'); return [k ? k.textContent.trim() : '', b.firstChild ? String(b.firstChild.textContent || '').trim() : b.textContent.trim()]; })
    .filter(([k, l]) => k && l && k !== '▶' && !KEYS.some(([x]) => x === k));   // ▶ marks the tour button, it is no key
  function drawKeys() {
    const bar = barKeys();
    keysEl.innerHTML = `<header><h2>Keys and controls</h2><button type="button" data-close aria-label="Close">esc ✕</button></header>`
      + `<h3>${TOUCH ? 'Touch' : 'Mouse'}</h3><dl>${GESTURES.map(([g, w]) => `<dt>${esc(g)}</dt><dd>${esc(w)}</dd>`).join('')}</dl>`
      + `<h3>Keys</h3><dl>${KEYS.map(([k, w]) => `<dt>${kbds(k)}</dt><dd>${esc(w)}</dd>`).join('')}</dl>`
      + (bar.length ? `<h3>Buttons below</h3><dl>${bar.map(([k, l]) => `<dt>${kbds(k)}</dt><dd>${esc(l)}</dd>`).join('')}</dl>` : '');
  }
  function showKeys(on) {
    if (on) { hideTip(true); drawKeys(); }
    keysEl.hidden = !on; keysBtn.setAttribute('aria-expanded', String(!!on));
  }
  keysBtn.addEventListener('click', () => { st.touched = true; showKeys(keysEl.hidden); keysBtn.blur(); });
  keysEl.addEventListener('click', e => { if (e.target.closest('[data-close]')) showKeys(false); });

  function key(e) {
    st.touched = true;
    if (e.key === '?' || (e.key === 'Escape' && !keysEl.hidden)) { showKeys(e.key === '?' ? keysEl.hidden : false); return true; }
    if (e.key === 'Escape') { if (tip && tip.pinned) hideTip(true); else if (st.jour) { const o = J_OPENED; stopJourney(); if (o || st.path.length) { closeAll(); frameBox(BOX0, 900); } } else if (st.path.length) back1(); else if (st.branch) setBranch(false); else if (st.gaps) setGaps(false); else { st.focus = null; showLinks(null); refresh(); frameBox(BOX0, 900); } return true; }
    if (!ARCH && (e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey) { setBranch(!st.branch); return true; }
    if (REPO && (e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey) { setGaps(!st.gaps); return true; }
    if (e.key === ' ') { if (!e.repeat) playJourney(st.jour ? (st.jour.k + 1) % AZ.journeys.length : 0); return true; }
    if (/^[1-9]$/.test(e.key) && +e.key <= AZ.journeys.length) { playJourney(+e.key - 1); return true; }
    if (e.key === 'i' || e.key === 'I') { explain(); return true; }
    if (e.key === '/') { openFind(); return true; }
    if (e.key === 'ArrowRight') { move(1); return true; }
    if (e.key === 'ArrowLeft') { move(-1); return true; }
    if (st.path.length && e.key === 'ArrowDown') { cycle(1); return true; }
    if (st.path.length && e.key === 'ArrowUp') { cycle(-1); return true; }
    if (e.key === 'Enter') {
      if (!st.path.length && st.focus) { st.focus === 'dock' ? open('dock') : open(st.focus); return true; }
      const s = st.sel && NODE[st.sel]; if (s && openable(s) && s.parent && s.parent.id === top()) { open(s.id); return true; }
    }
    return false;
  }

  /* ---------- find: "/" opens a box that jumps to any block, part or piece (a function, a file) by its name or path ---------- */
  const LVL = { 1: 'block', 2: 'part', 3: REPO ? 'code' : 'piece' };
  const FIND = Object.values(NODE).filter(n => n.level && n.kind !== 'zone' && n.id !== 'dock').map(n => {
    const c = (n.item && n.item.code) || {}, where = [n.parent && n.parent.parent && n.parent.parent.name, n.parent && n.parent.name].filter(Boolean).join(' › ');
    return { n, where, keys: [[n.name, 1], [n.tag, 1], [c.sym, 1], [c.p, .7], [c.p && c.p.split('/').pop(), .9]].filter(([t]) => t).map(([t, w]) => [String(t).toLowerCase(), w]) };
  });
  // how well one text matches the query: the whole of it, its start, a word's start, anywhere, then letters in order
  const scoreText = (t, q) => {
    if (t === q) return 100;
    if (t.startsWith(q)) return 70 - Math.min(20, t.length - q.length) / 2;
    const i = t.indexOf(q);
    if (i > 0) return (/[\s/._\-›()[\]:#]/.test(t[i - 1]) ? 50 : 35) - Math.min(15, i) / 3;
    let j = 0; for (const ch of t) if (ch === q[j]) j++;
    return j === q.length && q.length > 1 ? 8 + q.length / t.length * 10 : 0;
  };
  function findAll(query, max = 12) {
    const words = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const f of FIND) {
      let total = 0;
      for (const q of words) { let best = 0; for (const [t, w] of f.keys) best = Math.max(best, scoreText(t, q) * w); if (!best) { total = 0; break; } total += best; }
      if (total) out.push({ f, s: total + (3 - f.n.level) });
    }
    return out.sort((a, b) => b.s - a.s || a.f.n.name.length - b.f.n.name.length).slice(0, max).map(x => x.f);
  }
  // fly to a node found: a block opens; a part opens its block with it selected; a piece opens its part with it selected
  function goTo(id) {
    const n = NODE[id]; if (!n) return;
    st.touched = true;
    if (n.level === 1) open(n.id);
    else if (n.level === 2) { if (top() === n.parent.id && st.path.length === 1) select(n.id); else open(n.parent.id, n.id); }
    else { if (top() === n.parent.id) select(n.id); else open(n.parent.id, n.id); }
  }
  const findEl = document.createElement('div'); findEl.id = 'az-find'; findEl.hidden = true; findEl.setAttribute('role', 'dialog'); findEl.setAttribute('aria-label', 'Find on the map');
  findEl.innerHTML = `<input type="search" placeholder="Find a block, part${REPO ? ', function or file' : ' or piece'}…" aria-label="Find" role="combobox" aria-expanded="false" aria-controls="az-find-list" aria-autocomplete="list" autocomplete="off" spellcheck="false"><ul id="az-find-list" role="listbox"></ul>`;
  document.body.appendChild(findEl);
  const findIn = findEl.querySelector('input'), findUl = findEl.querySelector('ul');
  let FOUND = [], FOUNDI = 0;
  function drawFound() {
    const q = findIn.value.trim();
    FOUND = findAll(q); FOUNDI = Math.min(FOUNDI, Math.max(0, FOUND.length - 1));
    findUl.innerHTML = FOUND.map((f, i) => { const c = (f.n.item && f.n.item.code) || {};
      return `<li role="option" id="az-find-${i}" data-n="${esc(f.n.id)}" aria-selected="${i === FOUNDI}"><span class="lv">${LVL[f.n.level]}</span><b>${esc(f.n.name)}</b><small>${esc([f.where, c.p ? `${unroot(c.p)}${c.l ? ':' + c.l : ''}` : ''].filter(Boolean).join(' · ') || (f.n.what || ''))}</small></li>`; }).join('')
      || (q ? `<li class="none" role="presentation">Nothing on the map is called «${esc(q)}».</li>` : '');
    findIn.setAttribute('aria-expanded', String(FOUND.length > 0));
    if (FOUND.length) findIn.setAttribute('aria-activedescendant', `az-find-${FOUNDI}`); else findIn.removeAttribute('aria-activedescendant');
    const on = findUl.querySelector('[aria-selected="true"]'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function openFind() { st.touched = true; hideTip(true); findEl.hidden = false; findIn.select(); FOUNDI = 0; drawFound(); findIn.focus(); }
  function closeFind() { findEl.hidden = true; findIn.blur(); }
  findIn.addEventListener('input', () => { FOUNDI = 0; drawFound(); });
  findIn.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (FOUND.length) { FOUNDI = (FOUNDI + (e.key === 'ArrowDown' ? 1 : -1) + FOUND.length) % FOUND.length; drawFound(); } }
    else if (e.key === 'Enter') { e.preventDefault(); const f = FOUND[FOUNDI]; if (f) { closeFind(); goTo(f.n.id); } }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  findUl.addEventListener('pointerdown', e => e.preventDefault());   // keep the focus in the box until the jump
  findUl.addEventListener('click', e => { const li = e.target.closest('li[data-n]'); if (li) { closeFind(); goTo(li.dataset.n); } });
  findIn.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== findIn) findEl.hidden = true; }, 0); });

  /* ---------- start: fly in to the whole plate, then a short tour unless the viewer takes over ---------- */
  let inited = false;
  function demo() {                                         // open company state, explain a part, go one level deeper
    const cs = NODE[SCENE.demoOpen]; if (!cs) return;
    st.touched = false;
    open(cs.id);
    after(2100, () => { if (st.touched) return; const k = cs.kids.find(openable) || cs.kids[0]; select(k.id); showTip(k.id, false); });
    after(5000, () => { if (st.touched) return; const k = cs.kids.find(openable); hideTip(true); if (k) open(k.id); });
    after(7200, () => { if (st.touched) return; const t = NODE[top()]; if (t && t.kids[1]) { select(t.kids[1].id); showTip(t.kids[1].id, false); } });
  }
  function init() {
    inited = true;
    layoutView();
    LINK0.copy(outlineMat.uniforms.color.value).lerp(INKHI, .3);
    const { c, D } = fitFor(BOX0, DIR_ISO);
    controls.minDistance = .35; controls.maxDistance = Math.max(90, D * 2.6);   // a big repo on a narrow screen needs the camera further out
    if (STILL || REDUCE || LINKED) { frameBox(BOX0, 0); if (LINKED) { st.touched = true; goNode(LINKED); } }   // a link opens what it names, with no tour
    else {
      controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(-.35, .8, 1).normalize().multiplyScalar(D * 2.3));
      frameBox(BOX0, 2200);
      after(2600, () => { if (!st.touched) demo(); });
    }
    refresh();
  }

  window.__az3 = { findAll, goTo, openFind, findEl: () => findEl, NODE, VIS, st, prog, TXT, PINS, PICK, open, back1, select, pickAt, onClick, playJourney, frameBox, boxFor, FREE, tipEl: () => tipEl, tip: () => tip, ins, key, cam: () => camera, W, TS, BOX0, AZ, href, PREF, setBranch, codeFor, flowsG, PORTV, SCENE, pickCmp, cmp: () => CUR_C, CM };

  return {
    group: g0, readout: say, demo: () => { st.touched = false; demo(); }, stop: () => {},
    key,
    click: (hit, e) => { if (e) onClick(pickAt(e.clientX, e.clientY)); },
    tick: (now, dt) => {
      NOW = now; FRAME++; if (!inited) init();
      runTimers(); camStep(); syncHash();
      HOTL = []; update(dt);
      if (hoverDirty && !pressed) { hoverDirty = false; onHover(HP ? pickAt(HP[0], HP[1]) : null); }
    },
    panel: [[WHOLE, 'esc', () => { st.touched = true; stopJourney(); closeAll(); frameBox(BOX0, 900); }],
            ['Copy link', '', () => { st.touched = true; copyLink(document.querySelector('#ctl-az button[data-x="link"]')); }, 'link'],
            ['Next walkthrough', 'space', () => { st.touched = true; playJourney(st.jour ? (st.jour.k + 1) % AZ.journeys.length : 0); }],
            ...(ARCH ? [] : [['Branches', 'b', () => { st.touched = true; setBranch(!st.branch); }], ['Test gaps', 'g', () => { st.touched = true; setGaps(!st.gaps); }]]),
            ['Explain', 'i', () => { st.touched = true; explain(); }],
            ['Find', '/', () => openFind()],
            ['Tour', '▶', () => { stopJourney(true); closeAll(); demo(); }]],
    view: { target: W(PX / 2, PY / 2, 0), dist: 34 },
    info: `<h2>${esc(REPO ? REPO.name : AZ.title)}</h2><p>Click a block to open it.</p>`,
    hint: `click a block · ⓘ explains${ARCH ? '' : ' · b shows this branch'} · space plays a walkthrough · / finds · drag to orbit`,
  };
})() });
