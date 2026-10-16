'use strict';
// Playwright specs under e2e/: which routes each one visits (page.goto and toHaveURL with a literal path).
const fs = require('fs');
const NAME = 'playwright', VERSION = '1';

function playwrightAdapter(files, rel) {
  const t0 = Date.now(), tests = {};
  const lineAt = (t, i) => t.slice(0, i).split('\n').length;
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8'), seen = new Map();
    for (const m of t.matchAll(/\.goto\(\s*[`'"]([^`'"]+)[`'"]/g)) { const u = m[1].replace(/\$\{[^}]+\}/g, ':x').split(/[?#]/)[0]; if (u.startsWith('/') && !seen.has(u)) seen.set(u, lineAt(t, m.index)); }
    for (const m of t.matchAll(/toHaveURL\(\s*[`'"]([^`'"]+)[`'"]/g)) { const u = m[1].split(/[?#]/)[0]; if (u.startsWith('/') && !seen.has(u)) seen.set(u, lineAt(t, m.index)); }
    tests[rel(f)] = { runner: NAME, runnerProv: 'the e2e/ folder', imports: [], visits: [...seen].map(([route, line]) => ({ route, line, status: 'exact', prov: NAME })) };
  }
  const ms = Date.now() - t0;
  const info = () => ({ name: NAME, version: VERSION, files: files.length, facts: Object.values(tests).reduce((a, x) => a + x.visits.length, 0), ms });
  return { tests, info };
}

module.exports = { playwrightAdapter };
