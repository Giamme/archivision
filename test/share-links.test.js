'use strict';
// Links into a page: #<node id> in the URL opens that block, part or piece, with no tour, and an id the map does not
// have opens the page as usual. The page runs in test/check-page.mjs, which also checks that the hash follows what is open.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { validate, archToScene, writePage } = require('../lib');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-links-')), PAGE = path.join(dir, 'shop.archivision.html');
const { model } = validate(JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'shop', 'shop.arch.json'), 'utf8')));
writePage(archToScene(model, { by: 'hand', source: 'test' }), 'Corner Shop', PAGE);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const m = model.modules.find(x => x.parts.some(p => p.children.length)), p = m.parts.find(x => x.children.length), c = p.children[0];
const check = q => spawnSync(process.execPath, [path.join(ROOT, 'test', 'check-page.mjs'), PAGE], { encoding: 'utf8', env: { ...process.env, Q: q, SAMPLE: '1' }, timeout: 240e3 });

for (const [what, id] of [['a piece', `${m.id}/${p.id}/${c.id}`], ['a part', `${m.id}/${p.id}`], ['a block', m.id]]) {
  test(`a link to ${what} opens it with no tour`, () => {
    const r = check(`#${encodeURIComponent(id).replace(/%2F/g, '/')}`);
    assert.match(r.stdout, new RegExp(`link: opened ${id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} from the URL, no tour`), r.stdout.slice(-1500) + r.stderr.slice(-500));
    assert.equal(r.status, 0, r.stdout.slice(-1500));
  });
}

test('a link to an id the map does not have opens the page as usual', () => {
  const r = check('?still#no-such-block/nothing');
  assert.match(r.stdout, /link: #no-such-block\/nothing names nothing on the map, normal start/);
  assert.equal(r.status, 0, r.stdout.slice(-1500));
});
