'use strict';
// archivision never writes into the repo it maps, .git included.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const { makeRepo } = require('./support/fixture-repo');

// every file and directory under root, with a content hash for files and the mtime for everything
function snapshot(root) {
  const out = {};
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), st = fs.lstatSync(p), k = path.relative(root, p);
      if (e.isDirectory()) { out[k + '/'] = st.mtimeMs; walk(p); }
      else out[k] = `${st.mtimeMs} ${e.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'link'}`;
    }
  };
  out['./'] = fs.statSync(root).mtimeMs; walk(root);
  return out;
}

test('mapping a repo writes nothing into it, not even .git', () => {
  const r = makeRepo('next-full');
  try {
    const before = snapshot(r.root);
    const out = path.join(r.dir, 'out', 'next-full.archivision.html');
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'archivision.js'), 'repo', r.root, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(out));
    const after = snapshot(r.root);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]);
    assert.deepEqual(changed, [], `archivision changed files in the scanned repo: ${changed.join(', ')}`);
  } finally { r.cleanup(); }
});
