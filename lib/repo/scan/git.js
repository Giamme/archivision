'use strict';
// Read-only git with argument lists, never a shell. Whatever the scanned repo's config defines never runs:
// - no optional locks (a plain `git status` rewrites .git/index otherwise), no fsmonitor hook;
// - every filter driver found in its config is replaced by `cat` (a racy-clean `git status` would run it);
// - diffs never use an external diff tool or a textconv driver;
// - submodules are not entered (`status` ignores them, `diff` shows only their commit ids);
// - a partial clone never fetches a missing object, and no transport may run at all.
// If the config cannot be read, git is not used: a map without comparisons rather than one that ran something.
// A fixture with a hostile local config proves none of these runs (test/hostile-git.test.js).
const { spawnSync } = require('child_process');

const LIMITS = { timeout: 120e3, maxBuffer: 1 << 28 };
const GUARD = ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '-c', 'diff.submodule=short'];

// `--no-lazy-fetch` exists from git 2.44; older gits refuse a partial clone instead (see below)
let LAZY = null;
const lazyFlag = () => { if (LAZY === null) LAZY = spawnSync('git', ['--no-lazy-fetch', 'version'], { encoding: 'utf8' }).status === 0 ? ['--no-lazy-fetch'] : []; return LAZY; };

function makeGit(ROOT) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_PROTOCOL_FROM_USER: '0' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_EXTERNAL_DIFF']) delete env[k];
  const raw = (args, opts = {}) => {
    const r = spawnSync('git', [...lazyFlag(), '-C', ROOT, ...GUARD, ...args], { encoding: 'utf8', env, ...LIMITS, ...opts });
    if (r.error) throw r.error;
    if (r.status !== 0) { const e = new Error(`git ${args[0]} failed: ${String(r.stderr || '').trim().slice(0, 300)}`); e.status = r.status; throw e; }
    return r.stdout;
  };
  // filter drivers from every config level the repo sees (reading config runs nothing)
  let neutral = null;
  try {
    const names = raw(['config', '--list', '--name-only']).split('\n');
    const drivers = [...new Set(names.map(n => (n.match(/^filter\.(.+)\.(clean|smudge|process|required)$/) || [])[1]).filter(Boolean))].sort();
    neutral = drivers.flatMap(d => ['-c', `filter.${d}.clean=cat`, '-c', `filter.${d}.smudge=cat`, '-c', `filter.${d}.process=`, '-c', `filter.${d}.required=false`]);
    // a partial clone fetches missing objects on its own; without the flag to stop that, git is not used
    if (!lazyFlag().length && names.some(n => /^extensions\.partialclone$|^remote\..+\.promisor$/i.test(n))) neutral = null;
  } catch (e) { neutral = null; }
  const closed = () => { throw new Error('git is not used: its config could not be read, so its filters cannot be switched off'); };
  const DIFF = new Set(['diff', 'log', 'show']);
  const git = (...args) => {
    if (!neutral) closed();
    const [cmd, ...rest] = args;
    return raw([...neutral, cmd, ...(DIFF.has(cmd) ? ['--no-ext-diff', '--no-textconv', '--submodule=short'] : []), ...(cmd === 'status' ? ['--ignore-submodules=all'] : []), ...rest]).trim();
  };
  // many file versions in one process; blobs are read raw, so no filter applies
  git.blobs = keys => {
    const out = {}; if (!keys.length) return out;
    if (!neutral) closed();
    const r = spawnSync('git', [...lazyFlag(), '-C', ROOT, ...GUARD, ...neutral, 'cat-file', '--batch'], { input: keys.join('\n') + '\n', env, timeout: LIMITS.timeout, maxBuffer: 1 << 30 });
    if (r.error) throw r.error;
    const buf = r.stdout; let i = 0;
    for (const k of keys) {
      const nl = buf.indexOf(10, i), head = buf.slice(i, nl).toString(); i = nl + 1;
      if (/ missing$/.test(head)) continue;
      const size = +head.split(' ')[2]; out[k] = buf.slice(i, i + size).toString('utf8'); i += size + 1;
    }
    return out;
  };
  return git;
}

module.exports = { makeGit };
