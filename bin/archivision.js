#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync, spawn } = require('child_process');

const HELP = `archivision: a 3D iso map you can open, linked to the code

  archivision repo <path> [options]        parse a TypeScript, JavaScript, Python or Go repo and map it (no AI)
    --out <file.html>       the page (default: ./<repo>.archivision.html)
    --src <folder>          a code root, repeatable or comma-separated (default: src/, the workspace
                            packages, or the whole repo when it has neither)
    --map <map.json>        group with this map instead of the saved one
    --remap                 write the saved map again from the code
    --bases dev,main        branches to compare against (default: dev,main,master)
    --since <days>          compare branches active in the last <days> days (default 60)
    --max <n>               at most <n> branches (default 24)
    --compare a..b,c..d     extra pairs to compare
    --fetch                 git fetch --prune first (off by default)
    --ripwire <binary>      ripwire, for Go (default: ARCHIVISION_RIPWIRE, else ripwire on the PATH; never one in the repo)

  archivision arch <files or folders…> [options]   draw an architecture from documents and diagrams (AI)
    --out <file.html>       the page (default: ./<name>.archivision.html)
    --name <name>           the system's name
    --ai <backend>          auto (default), claude or codex: the CLIs you are logged in to
    --model <id>            model for that backend
    --effort <level>        low, medium, high (default), xhigh or max
    --focus <text>          what to concentrate on

  archivision render <model.arch.json> [--out file.html]   draw an architecture model again, after editing it by hand

  Any command: --open opens the page when it is written.
  Each run checks npm for a newer archivision and says so on stderr; --no-update-check (or
  ARCHIVISION_NO_UPDATE_CHECK=1) turns that off. It is also off in CI and when stderr is not a terminal.

  Sources for arch: .md .txt .mmd .puml .dot .json .yaml .html .svg .drawio, images (.png .jpg .webp .gif) and PDFs.
  The repo map (<page>.map.json) and the architecture model (<page>.arch.json) sit next to the page; edit them and run again.
  birdview, the old name, runs the same commands.`;

const BOOL = new Set(['remap', 'fetch', 'open', 'help', 'no-update-check']), MANY = new Set(['src']);
function parse(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') o.help = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      const put = x => { o[k] = MANY.has(k) ? [...(o[k] || []), x] : x; };
      if (v !== undefined) put(v);
      else if (BOOL.has(k)) o[k] = true;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) put(argv[++i]);
      else throw new Error(`--${k} needs a value`);
    } else pos.push(a);
  }
  return { pos, o };
}

const rel = p => path.relative(process.cwd(), p) || p;
const say = s => process.stdout.write(s + '\n');
const stem = out => out.replace(/\.html?$/i, '');
// a page's name without the tool's suffix: x.archivision.arch.json and x.birdview.arch.json (the old name) are both x
const base = f => f.replace(/(\.(archivision|birdview))?(\.arch)?\.json$/i, '');
const openIt = file => { try { spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [file], { detached: true, stdio: 'ignore' }).unref(); } catch {} };
const lib = () => require('../lib');

function cmdRepo(pos, o) {
  const { scanRepo, autoMap, buildRepo, writePage } = lib();
  const REPO = path.resolve(pos[0] || '.');
  if (!fs.existsSync(REPO)) throw new Error(`no such folder: ${REPO}`);
  const name = path.basename(REPO), OUT = path.resolve(o.out || `${name}.archivision.html`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const t0 = Date.now();
  if (o.fetch) { say('fetching…'); execFileSync('git', ['-C', REPO, 'fetch', '--prune'], { stdio: 'inherit' }); }
  // 1. parse
  const S = scanRepo(REPO, { bases: o.bases, since: o.since, max: o.max, compare: o.compare, src: o.src, ripwire: o.ripwire });
  say(`1 parse   ${S.summary}`);
  // 2. group: a given map, the map from an earlier run, or a new one from the code
  const mapF = o.map ? path.resolve(o.map) : `${stem(OUT)}.map.json`;
  // the map an earlier run saved under the old name (<repo>.birdview.map.json) carries over, with its edits by hand
  const oldF = path.resolve(`${name}.birdview.map.json`);
  if (!o.out && !o.map && !o.remap && !fs.existsSync(mapF) && fs.existsSync(oldF)) { fs.copyFileSync(oldF, mapF); say(`          carried over ${rel(oldF)} → ${rel(mapF)}`); }
  let map;
  if (!o.map && (o.remap || !fs.existsSync(mapF))) {
    map = autoMap(S); const { summary, ...keep } = map;
    fs.writeFileSync(mapF, JSON.stringify(keep, null, 2) + '\n'); say(`2 group   ${summary} → ${rel(mapF)}`);
  } else { map = JSON.parse(fs.readFileSync(mapF, 'utf8')); say(`2 group   using ${rel(mapF)}`); }
  // 3. join the map with the parse, check every anchor
  const B = buildRepo(map, S);
  say('3 build   ' + B.summary.join('\n          '));
  if (B.warnings.length) say('          ' + B.warnings.slice(0, 20).join('\n          ') + (B.warnings.length > 20 ? `\n          … ${B.warnings.length - 20} more` : ''));
  // 4. the page
  const size = writePage(B, `${S.repo.name} · archivision`, OUT);
  say(`4 page    ${rel(OUT)} · ${(size / 1e6).toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return OUT;
}

function report(fixes, unclear) {
  if (fixes.length) say(`          repaired ${fixes.length}:\n            ${fixes.slice(0, 15).join('\n            ')}${fixes.length > 15 ? `\n            … ${fixes.length - 15} more` : ''}`);
  if (unclear && unclear.length) say(`          the sources leave open:\n            ${unclear.join('\n            ')}`);
}

async function cmdArch(pos, o) {
  const { readInputs, generate, validate, archToScene, writePage } = lib();
  if (!pos.length) throw new Error('give the documents or folders to read: archivision arch docs/ diagram.png');
  const t0 = Date.now();
  const { docs, skipped } = readInputs(pos);
  if (!docs.length) throw new Error(`nothing readable in ${pos.join(', ')}${skipped.length ? `: ${skipped.join('; ')}` : ''}`);
  say(`1 read    ${docs.length} sources: ${docs.map(d => `${d.name} (${d.type})`).join(', ')}`);
  if (skipped.length) say(`          skipped ${skipped.join('; ')}`);
  const r = await generate(docs, { ai: o.ai, model: o.model, effort: o.effort, name: o.name, focus: o.focus, log: s => say('          ' + s.trim()) });
  say(`2 model   by ${r.by} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const { model, fixes } = validate(r.model);
  if (o.name) model.title = o.name;
  const OUT = path.resolve(o.out || `${require('../lib/arch/model').slug(model.title)}.archivision.html`), modelF = `${stem(OUT)}.arch.json`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const source = `drawn by ${r.by} from ${docs.map(d => d.name).join(', ')} · ${new Date().toISOString().slice(0, 10)}`;
  fs.writeFileSync(modelF, JSON.stringify({ ...model, _by: r.by, _source: source }, null, 2) + '\n');
  say(`3 check   ${rel(modelF)}`); report(fixes, model.unclear);
  const data = archToScene(model, { by: r.by, source });
  say(`          ${data.summary}`);
  const size = writePage(data, `${model.title} · archivision`, OUT);
  say(`4 page    ${rel(OUT)} · ${(size / 1e6).toFixed(1)} MB`);
  return OUT;
}

function cmdRender(pos, o) {
  const { validate, archToScene, writePage } = lib();
  if (!pos[0]) throw new Error('give the model file: archivision render system.arch.json');
  const F = path.resolve(pos[0]), raw = JSON.parse(fs.readFileSync(F, 'utf8'));
  const { model, fixes } = validate(raw);
  if (o.name) model.title = o.name;
  report(fixes, []);
  const OUT = path.resolve(o.out || `${base(F)}.archivision.html`);
  const data = archToScene(model, { by: raw._by || 'hand', source: raw._source || `from ${path.basename(F)}` });
  const size = writePage(data, `${model.title} · archivision`, OUT);
  say(`${data.summary}\npage ${rel(OUT)} · ${(size / 1e6).toFixed(1)} MB`);
  return OUT;
}

(async () => {
  let args;
  try { args = parse(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const { pos, o } = args, cmd = pos.shift();
  if (!cmd || o.help || cmd === 'help') { say(HELP); return; }
  const run = { repo: cmdRepo, arch: cmdArch, render: cmdRender }[cmd];
  if (!run) { console.error(`unknown command «${cmd}»\n\n${HELP}`); process.exit(2); }
  // the update check runs alongside the command and only speaks, on stderr, once the command is done
  const update = require('../lib/update-check').startUpdateCheck({ current: require('../package.json').version, flag: !!o['no-update-check'] });
  try {
    const out = await run(pos, o);
    if (o.open && out) openIt(out);
    const note = await update.finish();
    if (note) process.stderr.write(note);
  } catch (e) {
    console.error(`archivision ${cmd}: ${e.message}`);
    if (process.env.ARCHIVISION_DEBUG || process.env.BIRDVIEW_DEBUG) console.error(e.stack);
    process.exit(1);
  }
})();
