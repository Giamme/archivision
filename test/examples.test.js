'use strict';
// The Corner Shop example the README pictures come from: its code maps with no AI to a full plate (TypeScript and
// Python, Prisma, DynamoDB, S3, walkthroughs), its branch steps give the branch view something to show, and every
// picture the README links to is in media/.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { scanRepo, autoMap, buildRepo } = require('../lib');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-examples-'));
const SHOP = path.join(tmp, 'corner-shop');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// the same git repo scripts/readme-media.mjs builds: the example, then each branch step on top of the one it starts from
async function shopRepo() {
  fs.cpSync(path.join(ROOT, 'examples', 'corner-shop'), SHOP, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', SHOP, '-c', 'user.name=archivision test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'Corner Shop');
  const { default: steps } = await import(pathToFileURL(path.join(ROOT, 'examples', 'corner-shop.branches.mjs')));
  for (const s of steps) {
    git('checkout', '-q', '-b', s.branch, s.from);
    for (const [p, t] of Object.entries(s.files || {})) {
      const f = path.join(SHOP, p);
      if (t === null) fs.rmSync(f); else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }
    }
    if (s.files) { git('add', '-A'); git('commit', '-q', '-m', s.message); }
  }
  git('checkout', '-q', 'feature/gift-cards');
  return steps;
}

let S, M, B;
test('examples: the Corner Shop maps with no AI, TypeScript and Python together', async () => {
  await shopRepo();
  S = scanRepo(SHOP, { since: 100000 }); M = autoMap(S); B = buildRepo(M, S);
  const files = S.symbols.map(s => s.id.split('#')[0]);
  for (const ext of ['.ts', '.tsx', '.py']) assert.ok(files.some(f => f.endsWith(ext)), `${ext} files are read`);
  const res = Object.values(S.resources).map(r => `${r.kind}:${r.name}`);
  for (const r of ['table:Order', 'table:Stock', 'table:GiftCard', 'queue:corner-shop-events-outbox', 'bucket:corner-shop-labels', 'table:parcels', 'table:sent_emails'])
    assert.ok(res.includes(r), `${r} is found (have ${res.join(', ')})`);
  assert.ok(M.modules.length >= 12, `a full plate (${M.modules.length} blocks)`);
  assert.ok(M.journeys.length >= 5, `walkthroughs (${M.journeys.length})`);
  assert.ok(M.journeys.some(j => j.name === '/checkout → Stock'), 'the README walkthrough, from the checkout page to the stock table');
  assert.match(B.summary[1], /unplaced 0/, 'every file is on the plate');
});

test('examples: the branch steps give the branch view a change to show', () => {
  const c = S.compare.find(x => x.base.endsWith('dev') && x.head === 'feature/gift-cards');
  assert.ok(c, `dev..feature/gift-cards compared (have ${S.compare.map(x => `${x.base}..${x.head}`).join(', ')})`);
  assert.equal(c.files.length, 9);
  assert.ok(S.compare.some(x => x.head === 'fix/discount-rounding' && x.files.length > 0), 'the second branch changes files too');
  assert.match(B.summary[2], /default dev\.\.feature\/gift-cards: 9 files/);
});

test('examples: every README picture is in media/, with words saying what it shows', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const pics = [...md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  assert.ok(pics.length >= 5, `the README shows the tour and four screenshots (has ${pics.length})`);
  for (const [, alt, url] of pics) {
    // a full URL, so the npm page shows it too
    const m = url.match(/^https:\/\/raw\.githubusercontent\.com\/Giamme\/archivision\/main\/(media\/[\w.-]+)$/);
    assert.ok(m, `${url} is a full GitHub URL into media/`);
    assert.ok(fs.existsSync(path.join(ROOT, m[1])), `${m[1]} exists`);
    assert.ok(alt.length > 40, `${m[1]} has alt text`);
  }
});
