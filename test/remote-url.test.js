'use strict';
// The origin URL becomes the page's links into the code, and the page is a file people pass around: a user name,
// password or token in that URL must never reach it, and ssh forms must still give https links.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const { makeRepo } = require('./support/fixture-repo');
const { scanRepo } = require('../lib');

const CASES = [
  ['https with a user and password', 'https://someone:not-a-real-password@github.com/o/r.git', 'https://github.com/o/r'],
  ['https with a user only, trailing /', 'https://someone@github.com/o/r.git/', 'https://github.com/o/r'],
  ['scp-like ssh', 'git@github.com:o/r.git', 'https://github.com/o/r'],
  ['ssh:// with a port', 'ssh://git@github.com:2222/o/r.git', 'https://github.com/o/r'],
  ['plain https stays as it is', 'https://github.com/o/r', 'https://github.com/o/r'],
  ['a local path is no web address', '/srv/git/r.git', ''],
];

test('the scan names origin as a web address with no credentials', () => {
  const r = makeRepo('plain-js');
  try {
    execFileSync('git', ['-C', r.root, 'remote', 'add', 'origin', 'https://example.invalid/x']);
    for (const [what, url, want] of CASES) {
      execFileSync('git', ['-C', r.root, 'remote', 'set-url', 'origin', url]);
      assert.equal(scanRepo(r.root, { bases: 'dev' }).repo.remote, want, what);
    }
  } finally { r.cleanup(); }
});

test('a password in the origin URL is not written into the page', () => {
  const r = makeRepo('plain-js');
  try {
    execFileSync('git', ['-C', r.root, 'remote', 'add', 'origin', 'https://someone:not-a-real-password@github.com/o/r.git']);
    const out = path.join(r.dir, 'out', 'p.html');
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'archivision.js'), 'repo', r.root, '--out', out, '--bases', 'dev', '--no-update-check'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const html = fs.readFileSync(out, 'utf8');
    assert.ok(!html.includes('not-a-real-password'), 'the password is in the page');
    assert.ok(html.includes('"remote":"https://github.com/o/r"'), 'the page lost its link to the repo');
  } finally { r.cleanup(); }
});
