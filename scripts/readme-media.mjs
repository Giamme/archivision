#!/usr/bin/env node
// The README's screenshots and animation, made again from the examples: the Corner Shop codebase
// (examples/corner-shop, made a git repo with the branches in examples/corner-shop.branches.mjs) and its architecture
// (examples/shop). Pages are built in a fresh folder, opened in a headless Chrome driven through the DevTools
// protocol (no packages, no downloads; its own profile, killed when done), and written to media/.
//   node scripts/readme-media.mjs [--only name,…] [--swiftshader] [--keep]
// Needs Google Chrome (CHROME=/path/to/chrome elsewhere) and ffmpeg.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { scanRepo, autoMap, buildRepo, writePage, validate, archToScene } = require(path.join(ROOT, 'lib'));
const MEDIA = path.join(ROOT, 'media');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2), ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = s => process.stdout.write(s + '\n');

/* ---------- the pages ---------- */

// the example codebase as a git repo with its branches, at fixed dates, in a folder whose path the pages may show
function demoRepo(dir) {
  const root = path.join(dir, 'corner-shop');
  fs.cpSync(path.join(ROOT, 'examples', 'corner-shop'), root, { recursive: true });
  let n = 0;
  const git = (...a) => {
    const d = `2026-09-${String(10 + n).padStart(2, '0')}T10:00:00Z`;
    return execFileSync('git', ['-C', root, '-c', 'user.name=Corner Shop', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', ...a],
      { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  };
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'Corner Shop'); n++;
  return import(pathToFileURL(path.join(ROOT, 'examples', 'corner-shop.branches.mjs'))).then(({ default: steps }) => {
    for (const s of steps) {
      git('checkout', '-q', '-b', s.branch, s.from);
      for (const [p, t] of Object.entries(s.files || {})) {
        const f = path.join(root, p);
        if (t === null) fs.rmSync(f, { force: true }); else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }
      }
      if (s.files) { git('add', '-A'); git('commit', '-q', '-m', s.message); n++; }
    }
    const show = steps.filter(s => s.files).map(s => s.branch)[0];
    git('checkout', '-q', show);
    return root;
  });
}

async function pages(dir) {
  const root = await demoRepo(dir);
  const S = scanRepo(root, { since: 100000 });
  const B = buildRepo(autoMap(S), S);
  const repo = path.join(dir, 'corner-shop.html');
  writePage(B, 'corner-shop · archivision', repo);
  say(`repo page: ${B.summary[0]}`);
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'shop', 'shop.arch.json'), 'utf8'));
  const { model } = validate(raw);
  const arch = path.join(dir, 'corner-shop-architecture.html');
  writePage(archToScene(model, { by: raw._by || 'hand', source: raw._source || '' }), `${model.title} · archivision`, arch);
  return { repo: pathToFileURL(repo).href, arch: pathToFileURL(arch).href };
}

/* ---------- a headless Chrome through the DevTools protocol ---------- */

async function chrome({ width = 1280, height = 800, scale = 1, limitMs = 240e3 } = {}) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-chrome-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, `--window-size=${width},${height}`, '--hide-scrollbars',
    '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--force-color-profile=srgb'];
  if (argv.includes('--swiftshader')) flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const proc = spawn(CHROME, [...flags, 'about:blank'], { stdio: 'ignore' });
  const kill = () => { try { proc.kill('SIGKILL'); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
  const timer = setTimeout(() => { console.error('time limit: Chrome killed'); kill(); process.exit(3); }, limitMs);
  let port;
  for (let i = 0; i < 100 && !port; i++) { try { port = fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); } }
  if (!port) { kill(); throw new Error(`Chrome did not start (${CHROME})`); }
  let target;
  for (let i = 0; i < 50 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { await sleep(100); } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const wait = new Map(), on = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && wait.has(m.id)) { const { res, rej } = wait.get(m.id); wait.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method && on.has(m.method)) for (const f of on.get(m.method)) f(m.params);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; wait.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
  const listen = (method, f) => { on.set(method, [...(on.get(method) || []), f]); return () => on.set(method, on.get(method).filter(g => g !== f)); };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  const KEYS = { ArrowRight: [39, 'ArrowRight'], ArrowLeft: [37, 'ArrowLeft'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], ' ': [32, 'Space', ' '], b: [66, 'KeyB', 'b'], i: [73, 'KeyI', 'i'] };
  return {
    async goto(url, settle = 0) { const loaded = new Promise(r => { const off = listen('Page.loadEventFired', () => { off(); r(); }); }); await send('Page.navigate', { url }); await loaded; await sleep(settle); },
    async keys(...ks) {
      for (const k of ks) {
        if (typeof k === 'number') { await sleep(k); continue; }
        const [code, name, text] = KEYS[k];
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: name, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: name, windowsVirtualKeyCode: code });
        await sleep(350);
      }
    },
    async png(file) { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(data, 'base64')); return file; },
    async record(dir) {
      fs.mkdirSync(dir, { recursive: true }); const frames = [];
      const off = listen('Page.screencastFrame', p => {
        const f = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`); fs.writeFileSync(f, Buffer.from(p.data, 'base64'));
        frames.push({ file: f, t: p.metadata.timestamp }); send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      });
      await send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
      return async () => { await send('Page.stopScreencast'); off(); return frames; };
    },
    close() { clearTimeout(timer); try { ws.close(); } catch {} kill(); },
  };
}

/* ---------- images ---------- */

const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'inherit', 'inherit'] });
const webp = (png, out, width = 1600) => ff('-i', png, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '88', '-compression_level', '6', out);
// frames at the times the page painted them, as an animated WebP that plays at their speed (a GIF of the same is
// over twice the size and banded; every current browser, GitHub and npm show WebP)
function animation(frames, out, { from = 0, width = 960, fps = 15, quality = 70 } = {}) {
  const keep = frames.filter(f => f.t >= frames[0].t + from), list = `${out}.txt`;
  fs.writeFileSync(list, keep.map((a, i) => `file '${a.file}'\nduration ${((keep[i + 1] || a).t - a.t || 1.5).toFixed(4)}`).join('\n') + `\nfile '${keep.at(-1).file}'\n`);
  ff('-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${fps},scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp_anim', '-quality', String(quality), '-compression_level', '5', '-loop', '0', out);
  fs.rmSync(list);
}
// panels side by side, each with a caption above it
function strip(pngs, captions, out, { width = 1600 } = {}) {
  const w = Math.floor(width / pngs.length) - 8, ins = pngs.flatMap(p => ['-i', p]);
  const each = pngs.map((_, i) => `[${i}:v]crop=iw*0.66:ih*0.94:iw*0.34:ih*0.03,scale=${w}:-2:flags=lanczos,pad=iw+8:ih+44:4:40:color=0x111214,drawtext=text='${captions[i]}':x=12:y=12:fontsize=20:fontcolor=0xd8d8d8[p${i}]`).join(';');
  ff(...ins, '-filter_complex', `${each};${pngs.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${pngs.length}[s]`, '-map', '[s]', '-c:v', 'libwebp', '-quality', '88', out);
}

/* ---------- what each image shows ---------- */

const SHOTS = {
  // the GIF: the page's own opening tour (fly in, open a block, explain a part, a level deeper), a walkthrough, the branches
  async tour(b, P, tmp) {
    const stop = await b.record(path.join(tmp, 'frames'));
    await b.goto(P.repo); await sleep(13000);
    await b.keys('Escape', 1500, ' ', 9000, 'Escape', 1500, 'b', 4000);
    animation(await stop(), path.join(MEDIA, 'tour.webp'), { from: 1.0 });
  },
  async levels(b, P, tmp) {
    await b.goto(`${P.repo}?still`, 5000);
    const one = await b.png(path.join(tmp, 'level-1.png'));
    // the Orders package: its parts, then one part's functions (the order's steps)
    await b.keys(...Array(13).fill('ArrowRight'), 'Enter', 6500);
    const two = await b.png(path.join(tmp, 'level-2.png'));
    await b.keys('Enter', 6500);                                  // its first part (Logic) is selected: open it
    const three = await b.png(path.join(tmp, 'level-3.png'));
    strip([one, two, three], ['1 · the whole repo', '2 · a block and its parts', '3 · a part and its functions'], path.join(MEDIA, 'levels.webp'), { width: 2700 });
  },
  // the first walkthrough at its last step, back on the whole map with the path lit from the page to the data write
  async journey(b, P, tmp) { await b.goto(`${P.repo}?still`, 5000); await b.keys(' ', 16000); webp(await b.png(path.join(tmp, 'journey.png')), path.join(MEDIA, 'journey.webp')); },
  async branches(b, P, tmp) { await b.goto(`${P.repo}?branch&still`, 6000); webp(await b.png(path.join(tmp, 'branches.png')), path.join(MEDIA, 'branches.webp')); },
  async architecture(b, P, tmp) { await b.goto(`${P.arch}?still`, 5000); webp(await b.png(path.join(tmp, 'architecture.png')), path.join(MEDIA, 'architecture.webp')); },
};

// a fixed, neutral folder: a repo page shows where it was read from ("build it again with: archivision repo <path>")
const tmp = '/tmp/archivision-demo';
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(MEDIA, { recursive: true });
try {
  const P = await pages(tmp);
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    // the GIF at the size it is shown; stills at twice that, for sharp text on high-density screens
    const b = await chrome({ scale: name === 'tour' ? 1 : 2 });
    try { await shot(b, P, tmp); } finally { b.close(); }
    for (const f of fs.readdirSync(MEDIA).filter(f => f.startsWith(name))) say(`${f}  ${(fs.statSync(path.join(MEDIA, f)).size / 1e6).toFixed(2)} MB`);
  }
} finally { if (argv.includes('--keep')) say(`kept ${tmp}`); else fs.rmSync(tmp, { recursive: true, force: true }); }
