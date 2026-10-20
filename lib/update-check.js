'use strict';
// On each run, ask the npm registry for the latest archivision and, when it is newer than the one running, say so on
// stderr with the command that updates it. It never installs anything, never writes to stdout (the page or a summary
// may be piped), and never slows a command down by more than its timeout or breaks one: any error means no notice.
const fs = require('fs'), path = require('path');

const LATEST = 'https://registry.npmjs.org/archivision/latest';
const TIMEOUT_MS = 1500;   // from the start of the run; the command's own work counts towards it
const GRACE_MS = 200;      // after a long command, a reply already on its way still gets this long to arrive

// 0.5, 0.5.0 and v0.5.0 are the same version; a pre-release or anything else unreadable is null
const parse = v => { const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v).trim()); return m && [+m[1], +m[2], +(m[3] || 0)]; };
function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// why not to check, or null to check: off by flag or ARCHIVISION_NO_UPDATE_CHECK, in CI, or when nobody reads stderr
function skipReason({ env = process.env, isTTY = process.stderr.isTTY, flag = false } = {}) {
  if (flag) return '--no-update-check';
  if (env.ARCHIVISION_NO_UPDATE_CHECK && env.ARCHIVISION_NO_UPDATE_CHECK !== '0') return 'ARCHIVISION_NO_UPDATE_CHECK';
  if (env.CI && env.CI !== 'false' && env.CI !== '0') return 'CI';
  if (!isTTY) return 'stderr is not a terminal';
  return null;
}

// how this copy was installed decides the command: a git clone pulls, npx runs @latest, anything else is npm -g
function updateCommand(root = path.join(__dirname, '..'), exists = fs.existsSync) {
  if (exists(path.join(root, '.git'))) return `git -C ${JSON.stringify(root)} pull && npm --prefix ${JSON.stringify(root)} install`;
  if (/[\\/]_npx[\\/]/.test(root)) return 'npx archivision@latest …';
  return 'npm i -g archivision@latest';
}

const notice = (current, latest, command) => `\narchivision ${latest} is out (you have ${current}). Update with:\n  ${command}\n` +
  'Turn this check off with --no-update-check or ARCHIVISION_NO_UPDATE_CHECK=1.\n';

// the latest version on npm, or null on any failure; `fetch` is injectable so tests never touch the network
async function fetchLatest(fetch, signal) {
  try {
    const r = await fetch(LATEST, { signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const { version } = await r.json();
    return parse(version) ? String(version) : null;
  } catch { return null; }
}

// the request runs in a worker thread with its own event loop, so it really goes on while a command keeps the main
// thread busy (repo mode parses synchronously); its reply waits in the message queue until the command is done
function workerLookup(timeoutMs) {
  const { Worker } = require('worker_threads');
  const w = new Worker(`const { parentPort, workerData: d } = require('worker_threads');
    require(d.file).fetchLatest(fetch, AbortSignal.timeout(d.ms)).then(v => parentPort.postMessage(v), () => parentPort.postMessage(null));`,
    { eval: true, workerData: { file: __filename, ms: timeoutMs }, stdout: true, stderr: true, env: {} });
  w.unref();
  const version = new Promise(res => { w.once('message', res); w.once('error', () => res(null)); w.once('exit', () => res(null)); });
  return { version, stop: () => { w.terminate().catch(() => {}); } };
}

// starts the lookup now; finish() resolves to the notice text, or null, by the deadline at the latest
function startUpdateCheck({ current, lookup = workerLookup, timeoutMs = TIMEOUT_MS, graceMs = GRACE_MS, command = updateCommand, now = Date.now, ...skip } = {}) {
  if (skipReason(skip)) return { finish: async () => null };
  const deadline = now() + timeoutMs;
  let started;
  try { started = lookup(timeoutMs); } catch { return { finish: async () => null }; }
  const reply = Promise.resolve(started.version).then(v => (isNewer(v, current) ? notice(current, v, command()) : null), () => null);
  return {
    async finish() {
      let t;
      const wait = new Promise(res => { t = setTimeout(res, Math.max(graceMs, deadline - now()), null); });
      try { return await Promise.race([reply, wait]); } catch { return null; } finally { clearTimeout(t); try { started.stop(); } catch {} }
    },
  };
}

module.exports = { isNewer, skipReason, updateCommand, fetchLatest, startUpdateCheck, LATEST };
