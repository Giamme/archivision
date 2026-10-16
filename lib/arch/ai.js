'use strict';
// Sends the sources to a model and gets the architecture model back as JSON that matches the schema.
// Only through the AI CLIs already installed and logged in on this machine; archivision never asks for an API key.
//   claude     the Claude Code CLI (`claude -p`), with the user's own login
//   codex      the Codex CLI (`codex exec`), read-only sandbox, with the user's own login
// `auto` tries them in that order and moves on when one cannot run here (no CLI, not logged in).
const fs = require('fs'), os = require('os'), path = require('path'), { spawn, spawnSync } = require('child_process');
const { ARCH_SCHEMA } = require('./schema');
const { SYSTEM, userText } = require('./prompt');

class Unavailable extends Error {}
const DEFAULTS = { claude: 'opus', codex: 'gpt-6-astra' };
const which = cmd => spawnSync('/bin/sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;

// the sources as one text prompt, for the CLIs; binary files they cannot take inline are listed by path
function textPrompt(docs, opts, { images }) {
  const parts = [SYSTEM, '', '<sources>'];
  const byPath = [];
  for (const d of docs) {
    if (d.type === 'image') { if (images) continue; byPath.push(d); continue; }
    if (d.type === 'pdf' && !d.text) { byPath.push(d); continue; }
    parts.push(`<source name="${d.name}" type="${d.type}">`, d.text, '</source>');
  }
  parts.push('</sources>');
  if (byPath.length) parts.push('', 'Also read these files with your file tools:', ...byPath.map(d => `- ${d.file} (${d.type})`));
  if (images && docs.some(d => d.type === 'image')) parts.push('', `The attached images are: ${docs.filter(d => d.type === 'image').map(d => d.name).join(', ')}.`);
  parts.push('', userText(docs, opts), '', 'Reply with the JSON object only.');
  return parts.join('\n');
}

const parseJson = s => {
  const t = String(s).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch (e) {
    const i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i >= 0 && j > i) return JSON.parse(t.slice(i, j + 1));
    throw new Error(`the model did not return JSON: ${e.message}`);
  }
};

function run(cmd, args, input, { log, timeout = 45 * 60e3, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let out = '', err = '';
    const t0 = Date.now(), tick = setInterval(() => log && log(`  ${cmd} working · ${Math.round((Date.now() - t0) / 1000)} s`), 30e3);
    const kill = setTimeout(() => { p.kill('SIGTERM'); }, timeout);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearInterval(tick); clearTimeout(kill); reject(e); });
    p.on('close', code => { clearInterval(tick); clearTimeout(kill); resolve({ code, out, err }); });
    p.stdin.end(input);
  });
}

/* ---------- Claude Code ---------- */
async function viaClaude(docs, opts) {
  if (!which('claude')) throw new Unavailable('the claude CLI is not on PATH');
  const binary = docs.filter(d => d.type === 'image' || (d.type === 'pdf' && !d.text));
  const dirs = [...new Set(binary.map(d => path.dirname(d.file)))];
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(ARCH_SCHEMA), '--model', opts.model || DEFAULTS.claude,
    '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch'];
  if (binary.length) args.push('--allowedTools', 'Read', ...dirs.flatMap(d => ['--add-dir', d]));
  const r = await run('claude', args, textPrompt(docs, opts, { images: false }), { log: opts.log });
  let env = null; try { env = JSON.parse(r.out); } catch {}
  const msg = env ? String(env.result || '') : (r.err || r.out).trim();
  if (!env || env.is_error || r.code) {
    if (/log ?in|\/login|api key|authenticat|credit balance|not logged/i.test(msg + r.err)) throw new Unavailable(`claude CLI: ${msg.split('\n')[0] || r.err.split('\n')[0]}`);
    throw new Error(`claude CLI failed (exit ${r.code}): ${(msg || r.err).slice(0, 400)}`);
  }
  return { model: env.structured_output || parseJson(env.result), by: 'Claude Code CLI', usage: env.usage };
}

/* ---------- Codex ---------- */
async function viaCodex(docs, opts) {
  if (!which('codex')) throw new Unavailable('the codex CLI is not on PATH');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-')), schemaF = path.join(tmp, 'schema.json'), outF = path.join(tmp, 'out.json');
  fs.writeFileSync(schemaF, JSON.stringify(ARCH_SCHEMA));
  const imgs = docs.filter(d => d.type === 'image');
  const args = ['exec', '-m', opts.model || DEFAULTS.codex, '-s', 'read-only', '--skip-git-repo-check', '-C', opts.cwd || process.cwd(),
    '-c', `model_reasoning_effort=${opts.effort === 'max' ? 'xhigh' : opts.effort || 'high'}`, '--output-schema', schemaF, '-o', outF, '-', ...imgs.map(d => `--image=${d.file}`)];
  try {
    const r = await run('codex', args, textPrompt(docs, opts, { images: true }), { log: opts.log });
    if (r.code || !fs.existsSync(outF)) {
      const e = (r.err || r.out).trim().split('\n').slice(-6).join('\n');
      if (/log ?in|auth|api key|401/i.test(e)) throw new Unavailable(`codex CLI: ${e.split('\n').pop()}`);
      throw new Error(`codex failed (exit ${r.code}): ${e.slice(0, 600)}`);
    }
    return { model: parseJson(fs.readFileSync(outF, 'utf8')), by: `${opts.model || DEFAULTS.codex} (Codex CLI)` };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const BACKENDS = { claude: viaClaude, codex: viaCodex };

async function generate(docs, opts = {}) {
  const want = opts.ai || 'auto', log = opts.log || (() => {});
  const order = want === 'auto' ? ['claude', 'codex'] : [want];
  if (!order.every(k => BACKENDS[k])) throw new Error(`unknown --ai ${want}: use auto, claude or codex`);
  const tried = [];
  for (const k of order) {
    try {
      log(`asking ${k}${opts.model ? ` (${opts.model})` : ''}…`);
      return { ...(await BACKENDS[k](docs, { ...opts, log })), backend: k };
    } catch (e) {
      if (!(e instanceof Unavailable)) throw e;
      tried.push(`${k}: ${e.message}`); log(`  ${k} cannot run here: ${e.message}`);
    }
  }
  throw new Error(`no AI backend could run:\n  ${tried.join('\n  ')}`);
}

module.exports = { generate, Unavailable, DEFAULTS };
