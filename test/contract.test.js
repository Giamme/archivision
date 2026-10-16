'use strict';
// The scan contract, version 2 (lib/scan-schema.js): every fixture's scan fits the schema, its ids hold
// together, and two scans of the same commit are the same.
const test = require('node:test'), assert = require('node:assert/strict');
const { scanRepo } = require('../lib');
const { validateScan } = require('../lib/scan-schema');
const { makeRepo } = require('./support/fixture-repo');

// a scan without what changes from run to run: the clock and timings
const stable = S => JSON.stringify({ ...S, repo: { ...S.repo, scanned: null }, adapters: S.adapters.map(a => ({ ...a, ms: null })), summary: null });

for (const name of ['mini-shop', 'next-full', 'lib-mixed', 'plain-js']) {
  test(`contract: ${name}`, () => {
    const r = makeRepo(name);
    try {
      const S = scanRepo(r.root, { since: 100000 });
      assert.deepEqual(validateScan(S), []);
      const ids = new Set(S.symbols.map(s => s.id));
      assert.equal(ids.size, S.symbols.length, 'symbol ids are unique');
      for (const s of S.symbols) { assert.ok(S.files[s.file], `${s.id}: its file is scanned`); assert.ok(s.line >= 1 && s.end >= s.line, `${s.id}: lines`); }
      for (const x of S.relations) {
        assert.ok(ids.has(x.to), `relation to ${x.to}`);
        assert.ok(ids.has(x.from) || S.files[x.from], `relation from ${x.from}`);
        assert.equal(x.n, x.sites.length, `${x.from} -> ${x.to}: one site per reference`);
      }
      for (const d of S.data) { assert.ok(S.resources[d.resource], `data on ${d.resource}`); assert.ok(ids.has(d.from) || S.files[d.from]); }
      for (const res of Object.values(S.resources)) for (const id of res.rel) assert.ok(S.resources[id], `${res.name} refers to ${id}`);
      for (const e of S.entries) assert.ok(e.handler === null || ids.has(e.handler) || S.files[e.handler], `entry ${e.id}`);
      for (const [f, t] of Object.entries(S.tests)) for (const i of t.imports) assert.ok(S.files[i.file], `${f} imports ${i.file}`);
      for (const c of S.compare) for (const x of c.changed) {
        assert.match(x.id, /#|^prisma:/, `changed id ${x.id}`);
        // a declaration named at the head of the checked-out branch is one of this scan's symbols or resources
        if (x.at === 'head' && c.headSha === S.repo.sha) assert.ok(ids.has(x.id) || S.resources[x.id], `${c.base}..${c.head}: ${x.id} is not a symbol of the head`);
      }
      assert.ok(S.adapters.some(a => a.name === 'tsc' && a.files > 0));
      // the same commit scans the same
      assert.equal(stable(scanRepo(r.root, { since: 100000 })), stable(S));
    } finally { r.cleanup(); }
  });
}

test('contract: the schema rejects a wrong status and a missing field', () => {
  const r = makeRepo('mini-shop');
  try {
    const S = scanRepo(r.root, { since: 100000 });
    S.relations[0].status = 'probably';
    delete S.files[Object.keys(S.files)[0]].lines;
    const errs = validateScan(S);
    assert.ok(errs.some(e => /relations\[0\]\.status/.test(e)), errs.join('\n'));
    assert.ok(errs.some(e => /missing lines/.test(e)), errs.join('\n'));
  } finally { r.cleanup(); }
});

test('contract: a deleted declaration is named at the base, a changed one at the head', () => {
  const r = makeRepo('next-full');
  try {
    const S = scanRepo(r.root, { bases: 'dev', since: 100000 });
    const c = S.compare.find(x => x.base === 'dev' && x.head === 'feature/rename');
    assert.ok(c, S.compare.map(x => `${x.base}..${x.head}`).join(', '));
    const changed = c.changed.map(x => `${x.at} ${x.id}`);
    assert.ok(changed.includes('head src/lib/pricing.ts#grandTotal'), changed.join('\n'));
    assert.ok(changed.includes('base src/lib/pricing.ts#total'), changed.join('\n'));
    assert.ok(changed.includes('base src/lib/pricing.ts#legacyPrice'), changed.join('\n'));
    assert.ok(changed.includes('head prisma:.:Order'), changed.join('\n'));
  } finally { r.cleanup(); }
});
