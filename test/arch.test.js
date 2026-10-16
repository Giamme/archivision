'use strict';
// Architecture mode without calling a model: the checks and repairs, the page data, the source readers,
// backend selection, the CLI, and the example rendered and clicked through offline.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), { spawnSync } = require('child_process');
const { validate, archToScene, readInputs, generate, writePage, ARCH_SCHEMA } = require('../lib');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-arch-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const BIN = path.join(__dirname, '..', 'bin', 'archivision.js');

const messy = () => ({
  title: 'Shop', intro: 'A shop.',
  layers: [{ id: 'front', name: 'Front', blurb: '', tip: '' }, { id: 'empty', name: 'Empty', blurb: '', tip: '' }],
  modules: [
    { id: 'Web Shop', layer: 'front', name: 'Web shop', short: 'Web', role: 'Sells', tip: 'x'.repeat(400),
      zones: [{ name: 'In', tip: '', parts: ['cart', 'ghost'] }],
      parts: [{ id: 'cart', name: 'Cart', kind: 'widget', what: '', tip: '', children: [{ id: 'a', name: 'A', kind: 'ui', what: '', tip: '' }, { id: 'a', name: 'A2', kind: 'ui', what: '', tip: '' }], links: [{ from: 'a', to: 'zzz', label: '' }] },
        { id: 'checkout', name: 'Checkout', kind: 'ui', what: '', tip: '', children: [], links: [] }],
      links: [{ from: 'cart', to: 'checkout', label: 'basket' }, { from: 'cart', to: 'nowhere', label: '' }] },
    { id: 'orders', layer: 'services', name: 'Orders', short: 'Orders', role: '', tip: '', zones: [], parts: [], links: [] },
  ],
  flows: [{ from: 'Web Shop', to: 'orders', label: 'POST /orders', kind: 'calls' }, { from: 'orders', to: 'orders', label: '', kind: '' }, { from: 'web-shop', to: 'orders', label: 'GET /orders', kind: 'calls' }, { from: 'x', to: 'orders', label: '', kind: '' }],
  bus: { name: 'NATS', tip: '', ports: [{ n: 2, name: 'order.confirmed', tip: '', modules: ['orders', 'nope'] }, { n: 2, name: 'parcel.shipped', tip: '', modules: ['web-shop'] }] },
  journeys: [{ name: 'Buy', group: '', caption: '', steps: [{ at: 'web-shop', part: 'cart', note: '' }, { at: 'orders', part: 'nope', note: '' }, { at: 'P2', part: '', note: '' }, { at: 'P9', part: '', note: '' }] },
    { name: 'Lonely', group: '', caption: '', steps: [{ at: 'orders', part: '', note: '' }] }],
  unclear: ['Refunds?'],
});

test('validate repairs what it can and says what it did', () => {
  const { model: M, fixes } = validate(messy());
  const web = M.modules.find(m => m.id === 'web-shop');
  assert.ok(web, 'ids become kebab-case');
  assert.equal(web.parts.find(p => p.id === 'cart').kind, 'process', 'unknown kind → process');
  assert.deepEqual(web.parts.find(p => p.id === 'cart').children.map(c => c.id), ['a', 'a-2'], 'duplicate ids made unique');
  assert.deepEqual(web.parts.find(p => p.id === 'cart').links, [], 'dangling piece link dropped');
  assert.deepEqual(web.links.map(l => `${l.from}>${l.to}`), ['cart>checkout']);
  assert.deepEqual(web.zones.map(z => [z.name, z.parts]), [['In', ['cart']], ['Other', ['checkout']]], 'loose parts get a zone');
  assert.ok(web.tip.length <= 220);
  const orders = M.modules.find(m => m.id === 'orders');
  assert.equal(orders.parts.length, 1, 'a block with no parts gets one');
  assert.ok(M.layers.some(l => l.id === 'services'), 'unknown layer added');
  assert.ok(!M.layers.some(l => l.id === 'empty'), 'empty layer dropped');
  assert.deepEqual(M.flows.map(f => `${f.from}>${f.to}:${f.label}`), ['web-shop>orders:POST /orders · GET /orders'], 'self, unknown and repeated flows handled');
  assert.deepEqual(M.bus.ports.map(p => [p.n, p.modules]), [[2, ['orders']], [1, ['web-shop']]].sort((a, b) => a[0] - b[0]), 'duplicate port renumbered, unknown block dropped');
  assert.equal(M.journeys.length, 1);
  assert.deepEqual(M.journeys[0].steps.map(s => `${s.at}/${s.part}`), ['web-shop/cart', 'orders/', 'P2/']);
  assert.ok(fixes.length >= 10, fixes.join('\n'));
  assert.ok(fixes.some(f => /kind «widget» → process/.test(f)));
});

test('validate rejects what it cannot repair', () => {
  assert.throws(() => validate(null), /not a JSON object/);
  assert.throws(() => validate({ title: 'x', modules: [] }), /no blocks/);
});

test('archToScene: a bus becomes the rail with one port each, none without', () => {
  const { model } = validate(messy());
  const d = archToScene(model, { by: 'test' });
  assert.equal(d.ATLAS.mode, 'arch');
  assert.equal(d.ATLAS.repo, null);
  assert.ok(d.SCENE.rail);
  assert.deepEqual(d.SCENE.ports.map(p => p.n).sort(), [1, 2]);
  assert.ok(d.ATLAS.modules.some(m => m.id === 'dock'));
  assert.ok(d.ATLAS.layers.some(l => l.id === 'dock'));
  assert.ok(d.ATLAS.flows.some(f => f.to === 'dock' && f.ports[0] === 2 && f.from === 'orders'));
  assert.deepEqual(d.ATLAS.journeys[0].code, [{ sel: 'web-shop/cart' }, null, null]);
  for (const m of d.ATLAS.modules.filter(x => x.id !== 'dock')) {
    assert.ok(d.SCENE.place[m.id], `${m.id} placed`);
    for (const p of m.parts) assert.ok(Number.isInteger(p.col) && Number.isInteger(p.row), `${m.id}/${p.id} has a cell`);
  }
  const plain = messy(); plain.bus = { name: '', tip: '', ports: [] }; plain.journeys = [];
  const d2 = archToScene(validate(plain).model);
  assert.equal(d2.SCENE.rail, null);
  assert.ok(!d2.ATLAS.modules.some(m => m.id === 'dock'));
});

test('the schema is strict: every object closed, every property required', () => {
  const walk = (s, at) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, at);
      assert.deepEqual(Object.keys(s.properties).sort(), [...s.required].sort(), at);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${at}.${k}`);
    } else if (s.type === 'array') walk(s.items, `${at}[]`);
  };
  walk(ARCH_SCHEMA, 'model');
});

test('sources: Markdown, HTML with Mermaid, SVG labels, draw.io (plain and compressed), images', () => {
  const dir = path.join(tmp, 'src'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.md'), '# Shop\nThe cart calls orders.');
  fs.writeFileSync(path.join(dir, 'b.html'), '<html><style>x{}</style><script>alert(1)</script><h2>Orders</h2><p>Writes &amp; reads</p><pre class="mermaid">graph LR; A--&gt;B</pre></html>');
  fs.writeFileSync(path.join(dir, 'c.svg'), '<svg><text x="1">Cart</text><text>Orders <tspan>API</tspan></text></svg>');
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Cart" vertex="1" parent="1"/><mxCell id="3" value="Orders &lt;b&gt;API&lt;/b&gt;" vertex="1" parent="1"/><mxCell id="4" value="POST" edge="1" source="2" target="3" parent="1"/></root></mxGraphModel>';
  fs.writeFileSync(path.join(dir, 'd.drawio'), `<mxfile><diagram name="Plain">${model}</diagram></mxfile>`);
  const packed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
  fs.writeFileSync(path.join(dir, 'e.drawio'), `<mxfile><diagram name="Packed">${packed}</diagram></mxfile>`);
  fs.writeFileSync(path.join(dir, 'f.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  fs.writeFileSync(path.join(dir, 'g.exe'), 'x');
  const { docs, skipped } = readInputs([dir]);
  const by = Object.fromEntries(docs.map(d => [d.name, d]));
  assert.deepEqual(Object.keys(by).sort(), ['a.md', 'b.html', 'c.svg', 'd.drawio', 'e.drawio', 'f.png']);
  assert.match(by['b.html'].text, /## Orders/); assert.match(by['b.html'].text, /Writes & reads/); assert.doesNotMatch(by['b.html'].text, /alert/);
  assert.match(by['b.html'].text, /graph LR; A-->B/);
  assert.match(by['c.svg'].text, /Cart/); assert.match(by['c.svg'].text, /API/);
  for (const k of ['d.drawio', 'e.drawio']) assert.match(by[k].text, /arrow «Cart» → «Orders API»: POST/, k);
  assert.equal(by['f.png'].mediaType, 'image/png');
  assert.ok(skipped.some(s => /g\.exe/.test(s)));
});

test('backends: only the CLIs; an unknown one is refused; with none available auto says what it tried', async () => {
  await assert.rejects(generate([], { ai: 'nope' }), /unknown --ai nope/);
  await assert.rejects(generate([], { ai: 'anthropic' }), /unknown --ai anthropic: use auto, claude or codex/, 'no API backend');
  const keep = process.env.PATH;
  process.env.PATH = path.join(tmp, 'empty-bin');
  try { await assert.rejects(generate([{ name: 'a.md', type: 'markdown', text: 'x' }], {}), e => /no AI backend could run/.test(e.message) && /claude: the claude CLI is not on PATH/.test(e.message) && /codex: the codex CLI is not on PATH/.test(e.message)); }
  finally { process.env.PATH = keep; }
});

test('auto: a claude CLI that is not logged in is skipped and codex answers', async () => {
  const bin = path.join(tmp, 'fake-bin'); fs.mkdirSync(bin);
  const node = `#!${process.execPath}\n`;
  // what `claude -p --output-format json` prints when nobody is logged in
  fs.writeFileSync(path.join(bin, 'claude'), node + `process.stdin.resume(); process.stdin.on('end', () => { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })); process.exit(1); });`, { mode: 0o755 });
  // codex: keeps the prompt and the arguments, writes a model to the -o file
  fs.writeFileSync(path.join(bin, 'codex'), node + `const fs = require('fs'), a = process.argv.slice(2); let s = ''; process.stdin.on('data', d => s += d).on('end', () => {
    fs.writeFileSync(${JSON.stringify(path.join(tmp, 'codex-call.json'))}, JSON.stringify({ args: a, prompt: s }));
    fs.writeFileSync(a[a.indexOf('-o') + 1], JSON.stringify({ title: 'Fake', intro: '', layers: [{ id: 'l', name: 'L', blurb: '', tip: '' }], modules: [{ id: 'm', layer: 'l', name: 'M', short: 'M', role: '', tip: '', zones: [], parts: [{ id: 'p', name: 'P', kind: 'process', what: '', tip: '', children: [], links: [] }], links: [] }], flows: [], bus: { name: '', tip: '', ports: [] }, journeys: [], unclear: [] }));
  });`, { mode: 0o755 });
  const keep = process.env.PATH, log = [];
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  try {
    const r = await generate([{ name: 'a.md', type: 'markdown', text: 'The cart calls orders.' }], { log: s => log.push(s) });
    assert.equal(r.backend, 'codex');
    assert.equal(r.model.title, 'Fake');
    assert.ok(log.some(l => /claude cannot run here: claude CLI: Not logged in/.test(l)), log.join('\n'));
    const call = JSON.parse(fs.readFileSync(path.join(tmp, 'codex-call.json'), 'utf8'));
    assert.ok(call.args.includes('read-only') && call.args.includes('--output-schema'));
    assert.match(call.prompt, /<source name="a\.md" type="markdown">\nThe cart calls orders\./);
  } finally { process.env.PATH = keep; }
});

test('CLI: render the shop example, then click through the page offline', () => {
  const out = path.join(tmp, 'shop.archivision.html');
  const r = spawnSync(process.execPath, [BIN, 'render', path.join(__dirname, '..', 'examples', 'shop', 'shop.arch.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /blocks 12 · parts 39/);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<title>Corner Shop · archivision<\/title>/);
  const c = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), out], { encoding: 'utf8', timeout: 300e3, env: { ...process.env, SAMPLE: '2' } });
  assert.equal(c.status, 0, c.stdout.slice(-2500) + c.stderr.slice(-800));
  assert.match(c.stdout, /mode architecture/);
  assert.match(c.stdout, /b in an architecture: branch false/);
  assert.match(c.stdout, /code links checked: 0/);
});

test('CLI: help, unknown commands and missing arguments', () => {
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: 'utf8' });
  assert.match(run().stdout, /archivision repo <path>/);
  assert.equal(run('fly').status, 2);
  const r = run('arch'); assert.equal(r.status, 1); assert.match(r.stderr, /give the documents/);
  const m = run('repo', '--bases'); assert.equal(m.status, 2); assert.match(m.stderr, /--bases needs a value/);
});
