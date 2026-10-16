'use strict';
// Golden files: a projection compared with its saved copy, and the first place they differ when they do.
//   UPDATE_GOLDEN=1 npm test   re-baselines them on purpose
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

const GOLDEN = path.join(__dirname, '..', 'golden');
const UPDATE = !!process.env.UPDATE_GOLDEN;

// the first differing path, so a failure says where, not just that
function firstDiff(a, b, at = '$') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) { const d = firstDiff(a[k], b[k], `${at}.${k}`); if (d) return d; }
  }
  return `${at}: expected ${JSON.stringify(b)?.slice(0, 300)}, got ${JSON.stringify(a)?.slice(0, 300)}`;
}

function check(name, actual, file = path.join(GOLDEN, `${name}.json`)) {
  const txt = JSON.stringify(actual, null, 1) + '\n';
  if (UPDATE || !fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, txt); if (!UPDATE) assert.fail(`${name}: no golden yet, wrote ${file}; check it and run again`); return; }
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  const d = firstDiff(JSON.parse(txt), want);
  assert.equal(d, null, `${name} differs from its golden (UPDATE_GOLDEN=1 to re-baseline on purpose)\n  ${d}`);
}

module.exports = { GOLDEN, UPDATE, check, firstDiff };
