'use strict';
// Golden snapshots of the semantic projection. Any change to what a scan finds or a page shows
// fails here until it is re-baselined on purpose:   UPDATE_GOLDEN=1 npm test
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { scanRepo, autoMap, buildRepo, writePage } = require('../lib');
const { makeRepo } = require('./support/fixture-repo');
const { projectScan, projectBuild } = require('./support/project');
const { UPDATE, check } = require('./support/golden');

for (const name of ['mini-shop', 'next-full', 'lib-mixed', 'plain-js', 'py-lambda']) {
  test(`golden: ${name}`, () => {
    const r = makeRepo(name);
    try {
      const S = scanRepo(r.root, { since: 100000 });
      const map = autoMap(S);
      const B = buildRepo(map, S);
      check(`${name}.scan`, projectScan(S));
      check(`${name}.build`, projectBuild(B));
      // the same build from a saved map file, as people keep them: it must stay readable across versions
      const saved = path.join(__dirname, 'fixtures', 'maps', `${name}.map.json`);
      if (UPDATE || !fs.existsSync(saved)) { const { summary, generated, ...keep } = map; fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.writeFileSync(saved, JSON.stringify(keep, null, 1) + '\n'); }
      check(`${name}.build-from-saved-map`, projectBuild(buildRepo(JSON.parse(fs.readFileSync(saved, 'utf8')), S)));
      // and its page: every block, part, link (checked by kind), comparison and walkthrough, offline
      const page = path.join(r.dir, `${name}.archivision.html`);
      writePage(B, `${name} · archivision`, page);
      const c = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), page], { encoding: 'utf8', timeout: 180e3 });
      assert.equal(c.status, 0, c.stdout.slice(-3000) + c.stderr.slice(-800));
      assert.match(c.stdout, /bad 0/);
    } finally { r.cleanup(); }
  });
}
