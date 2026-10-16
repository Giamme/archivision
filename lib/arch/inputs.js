'use strict';
// Reads architecture sources: text, Markdown, Mermaid, PlantUML, Graphviz, JSON, YAML, HTML, SVG, draw.io,
// images and PDFs. Folders are read recursively. Text is kept as text; images and PDFs stay binary for
// backends that take them, with a text fallback for PDFs when pdftotext is installed.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), { spawnSync } = require('child_process');

const TEXT = { '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown', '.txt': 'text', '.rst': 'text', '.adoc': 'text',
  '.mmd': 'mermaid', '.mermaid': 'mermaid', '.puml': 'plantuml', '.plantuml': 'plantuml', '.dot': 'graphviz', '.gv': 'graphviz',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.d2': 'd2', '.prisma': 'prisma', '.graphql': 'graphql', '.proto': 'protobuf' };
const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const SKIP_DIR = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'coverage']);
const MAX_TEXT = 400000, MAX_IMAGE = 5 * 1024 * 1024, MAX_PDF = 30 * 1024 * 1024;

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const squash = s => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function htmlText(src) {
  const body = src.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  // keep Mermaid blocks whole: they are diagrams written as text
  return squash(decode(body.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/pre)\b[^>]*>/gi, '\n').replace(/<li\b[^>]*>/gi, '- ').replace(/<h([1-6])\b[^>]*>/gi, (_, n) => '\n' + '#'.repeat(+n) + ' ').replace(/<[^>]+>/g, '')));
}

function svgText(src) {
  const out = [];
  for (const m of src.matchAll(/<(text|tspan|title|desc)\b[^>]*>([\s\S]*?)<\/\1>/gi)) { const t = decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); if (t) out.push(t); }
  return [...new Set(out)].join('\n');
}

// draw.io: boxes with their labels and parents, then the edges between them
function drawioText(src) {
  let xml = src;
  const diagrams = [...src.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)];
  const pages = diagrams.length ? diagrams.map(d => {
    const name = (d[1].match(/name="([^"]*)"/) || [])[1] || 'page';
    let body = d[2].trim();
    if (body && !body.startsWith('<')) {
      try { body = decodeURIComponent(zlib.inflateRawSync(Buffer.from(body, 'base64')).toString('utf8')); } catch { body = ''; }
    }
    return { name, body };
  }) : [{ name: 'page', body: xml }];
  const out = [];
  for (const p of pages) {
    const cells = [...p.body.matchAll(/<mxCell\b([^>]*?)\/?>/g)].map(m => {
      const a = {}; for (const x of m[1].matchAll(/(\w+)="([^"]*)"/g)) a[x[1]] = decode(x[2]); return a;
    });
    const label = c => htmlText(c.value || '').replace(/\s+/g, ' ').trim();
    const byId = Object.fromEntries(cells.map(c => [c.id, c]));
    out.push(`## ${p.name}`);
    for (const c of cells) if (c.vertex === '1' && label(c)) { const par = byId[c.parent]; out.push(`- box «${label(c)}»${par && label(par) ? ` inside «${label(par)}»` : ''}`); }
    for (const c of cells) if (c.edge === '1') {
      const a = byId[c.source], b = byId[c.target];
      out.push(`- arrow ${a ? `«${label(a) || a.id}»` : '?'} → ${b ? `«${label(b) || b.id}»` : '?'}${label(c) ? `: ${label(c)}` : ''}`);
    }
  }
  return out.join('\n');
}

function pdfText(file) {
  try {
    const r = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    return r.status === 0 ? squash(r.stdout) : null;
  } catch { return null; }
}

function walk(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p).sort()) if (!e.startsWith('.') && !SKIP_DIR.has(e)) walk(path.join(p, e), out);
  } else out.push(p);
  return out;
}

// returns [{ name, file, type, text?, mediaType?, data? (base64), note? }] and the files it skipped
function readInputs(paths, { root } = {}) {
  const files = paths.flatMap(p => walk(path.resolve(p), []));
  const base = root || (paths.length === 1 && fs.statSync(paths[0]).isDirectory() ? path.resolve(paths[0]) : process.cwd());
  const docs = [], skipped = [];
  let total = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase(), name = path.relative(base, file) || path.basename(file), size = fs.statSync(file).size;
    let d = null;
    if (TEXT[ext]) d = { type: TEXT[ext], text: fs.readFileSync(file, 'utf8') };
    else if (ext === '.html' || ext === '.htm') {
      const src = fs.readFileSync(file, 'utf8'), mer = [...src.matchAll(/<pre class="mermaid">([\s\S]*?)<\/pre>/g)].map(m => decode(m[1]));
      d = { type: 'html', text: htmlText(src) + (mer.length ? '\n\nMermaid diagrams on the page:\n' + mer.join('\n\n') : '') };
    }
    else if (ext === '.svg') d = { type: 'svg', text: svgText(fs.readFileSync(file, 'utf8')), note: 'text labels from the drawing' };
    else if (ext === '.drawio' || (ext === '.xml' && /<mxfile|<mxGraphModel/.test(fs.readFileSync(file, 'utf8').slice(0, 2000)))) d = { type: 'draw.io', text: drawioText(fs.readFileSync(file, 'utf8')), note: 'boxes and arrows from the diagram' };
    else if (IMAGE[ext]) {
      if (size > MAX_IMAGE) { skipped.push(`${name}: image over 5 MB`); continue; }
      d = { type: 'image', mediaType: IMAGE[ext], data: fs.readFileSync(file).toString('base64') };
    } else if (ext === '.pdf') {
      if (size > MAX_PDF) { skipped.push(`${name}: PDF over 30 MB`); continue; }
      d = { type: 'pdf', mediaType: 'application/pdf', data: fs.readFileSync(file).toString('base64'), text: pdfText(file) };
    } else { skipped.push(`${name}: unsupported type`); continue; }
    if (d.text != null) {
      d.text = d.text.trim();
      if (!d.text && d.type !== 'pdf') { skipped.push(`${name}: no text in it`); continue; }
      if (total + d.text.length > MAX_TEXT) { skipped.push(`${name}: over the ${MAX_TEXT.toLocaleString('en-US')}-character budget`); continue; }
      total += d.text.length;
    }
    docs.push({ name, file, ...d });
  }
  return { docs, skipped };
}

module.exports = { readInputs, htmlText, drawioText, svgText };
