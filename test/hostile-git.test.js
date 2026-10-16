'use strict';
// A scanned repo whose own git config defines an fsmonitor hook, a filter driver, a textconv driver and an
// external diff tool, each writing a marker file when it runs. Mapping it must run none of them. A plain `git status` afterwards proves the fixture really is hostile.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const { makeRepo } = require('./support/fixture-repo');

test('mapping a repo runs none of the commands its git config names', () => {
  const r = makeRepo('next-full');
  const marks = path.join(r.dir, 'marks'); fs.mkdirSync(marks);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('git', ['-C', r.root, ...a], { encoding: 'utf8', env });
  try {
    const touch = n => `sh -c 'touch ${marks}/${n}; cat'`;
    git('config', 'core.fsmonitor', `sh -c 'touch ${marks}/fsmonitor'`);
    git('config', 'filter.evil.clean', touch('clean'));
    git('config', 'filter.evil.smudge', touch('smudge'));
    git('config', 'filter.evil.process', `sh -c 'touch ${marks}/process'`);
    git('config', 'diff.evil.textconv', `sh -c 'touch ${marks}/textconv; cat "$0"'`);
    git('config', 'diff.external', `sh -c 'touch ${marks}/external'`);
    fs.writeFileSync(path.join(r.root, '.gitattributes'), '* filter=evil diff=evil\n');
    // a tracked file with a new time and the same size: `git status` has to read it again, through the filter
    const f = path.join(r.root, 'src/lib/pricing.ts'), later = new Date(Date.now() + 3600e3);
    fs.utimesSync(f, later, later);

    const out = path.join(r.dir, 'out', 'next-full.archivision.html');
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'archivision.js'), 'repo', r.root, '--out', out, '--bases', 'dev'], { encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /branch comparisons/);
    assert.deepEqual(fs.readdirSync(marks), [], 'archivision ran a command from the scanned repo\'s config');

    // the same repo without archivision's guards does run them
    spawnSync('git', ['-C', r.root, 'status', '--porcelain'], { env: { ...env, GIT_OPTIONAL_LOCKS: '0' } });
    assert.ok(fs.readdirSync(marks).length > 0, 'the fixture is not hostile: plain git ran none of its commands');
  } finally { r.cleanup(); }
});
