'use strict';
// Phase 1 acceptance on real repos, opt-in and local (their structure is not ours to commit):
//   ARCHIVISION_ACCEPT=/path/to/repo,/path/to/other npm test
// For each repo: every code root holds exactly the code `git ls-files` lists under it (no dot-folders, no .d.ts,
// no build output when the root is a whole package folder), each workspace package with no app routes is a district
// of its own, and every tracked Python file is either mapped or counted as not mapped, never lost.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('path'), { execFileSync } = require('child_process');
const { scanRepo, autoMap } = require('../lib');
const { rootOf } = require('../lib/repo/roots');

const REPOS = (process.env.ARCHIVISION_ACCEPT || '').split(',').map(s => s.trim()).filter(Boolean);
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/;
for (const repo of REPOS) test(`acceptance: ${path.basename(repo)}`, () => {
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  const S = scanRepo(repo, {});
  const roots = S.roots.map(r => r.path);
  // Go is code when ripwire read it, and counted as not read otherwise
  const goRead = Object.keys(S.files).some(f => f.endsWith('.go')), code = f => CODE.test(f) || (goRead && f.endsWith('.go'));
  for (const r of S.roots) {
    const want = tracked.filter(f => rootOf(roots, f) === r.path && code(f) && !/\.d\.[cm]?ts$/.test(f) && !/(^|\/)\.(?!well-known\/)/.test(f.slice(r.path === '.' ? 0 : r.path.length + 1)) && !/\.min\.[cm]?js$/.test(f)).sort();
    // browser specs are read by the Playwright adapter, everything else by the compiler
    const got = Object.keys(r.role === 'e2e' ? S.tests : S.files).filter(f => rootOf(roots, f) === r.path).sort();
    const whole = !/(^|\/)src$/.test(r.path) && r.role === 'code';   // a whole package folder skips its build output and tool configs
    const miss = want.filter(f => !got.includes(f)), extra = got.filter(f => !want.includes(f));
    assert.deepEqual(whole ? extra : [extra, miss], whole ? [] : [[], []], `${r.path}: extra ${extra.slice(0, 5)} missing ${miss.slice(0, 5)}`);
  }
  const M = autoMap(S), pkgs = S.roots.filter(r => r.role === 'code' && r.pkg && !Object.values(S.files).some(f => f.entry && f.pkg === r.pkg));
  if (new Set(S.roots.filter(r => r.role === 'code').map(r => r.pkg)).size > 1) for (const p of pkgs) assert.ok(M.layers.some(l => l.name === `Package ${p.pkg}`), `${p.pkg} has a district`);
  const py = tracked.filter(f => f.endsWith('.py')).length;
  const mapped = new Set([...Object.keys(S.files), ...Object.keys(S.tests)].filter(f => f.endsWith('.py'))).size;
  assert.equal(mapped + (S.skipped.outside.byExt['.py'] || 0) + (S.skipped.byExt['.py'] || 0), py, 'every Python file is mapped or counted as not mapped');
});
