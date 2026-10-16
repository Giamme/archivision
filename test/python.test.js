'use strict';
// Python (phase 3): calls scored against a hand-labelled fixture, Lambda handlers and their triggers from deployment
// manifests, data access (boto3, DB-API, SQL in strings) with the cases that are not data, the map and its page,
// declarations read for diffs without Python, and what happens without python3 or with code that does not parse.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { scanRepo, validateScan, autoMap, buildRepo, writePage } = require('../lib');
const { pyRanges } = require('../lib/repo/scan/python');
const { makeRepo } = require('./support/fixture-repo');

const LABELLED = path.join(__dirname, 'fixtures', 'labelled', 'py'), LAMBDA = path.join(__dirname, 'fixtures', 'py-lambda');
// python3 3.10 or later, as the scan needs
const HAS_PY = spawnSync('python3', ['-c', 'import sys; sys.exit(sys.version_info < (3, 10))'], { encoding: 'utf8' }).status === 0;
const skip = !HAS_PY && 'no python3 3.10 or later';

function repoWith(files, from) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-py-')), root = path.join(dir, 'r');
  if (from) fs.cpSync(from.dir, path.join(root, from.as || ''), { recursive: true });
  for (const [p, t] of Object.entries(files || {})) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); }
  return { root, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
// Wilson score interval, 95%
function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}

// labels: `# CALL from -> to@column [status] {stratum}`, several separated by commas; the status is exact unless it
// says. Strata: same-file, cross-module, method (closed world), override, re-export, decorated, a
// name defined twice, and two more: a method of an attribute that always holds one repo class
// (`self.shape = Square()`), and of a parameter annotated with one (`sq: Square`)
test('python: the labelled fixture, every call site found once at its column, nothing else, by stratum', { skip }, t => {
  const r = repoWith({}, { dir: LABELLED, as: 'py' });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    const want = [], stratum = new Map();
    for (const abs of walk(path.join(r.root, 'py')).filter(f => f.endsWith('.py'))) fs.readFileSync(abs, 'utf8').split('\n').forEach((l, i) => {
      const m = l.match(/CALL\s+(\S+)\s+->\s+(.+)$/); if (!m) return;
      for (const x of m[2].split(',').map(s => s.trim())) {
        const [, to, col, st, sr] = x.match(/^(\S+)@(\d+)(?:\s+(\w+))?\s+\{([\w-]+)\}$/), k = `${m[1]} @${i + 1}:${col} -> ${to} ${st || 'exact'}`;
        want.push(k); stratum.set(k.replace(/ \w+$/, ''), sr);
      }
    });
    const got = S.relations.filter(x => x.rel === 'call').flatMap(x => x.sites.map(([l, c]) => `${x.from} @${l}:${c} -> ${x.to} ${x.status}`));
    assert.equal(want.length, 37, 'labels read');
    // precision and recall by stratum and by status, each with its count and a 95% Wilson interval; a found site
    // takes its stratum from the label at the same place (none: «unlabelled»)
    const W = new Set(want), G = new Set(got), lines = [], iv = (k, n) => `${k}/${n} [${wilson(k, n).map(v => v.toFixed(2)).join(', ')}]`;
    const of = k => stratum.get(k.replace(/ \w+$/, '')) || 'unlabelled', st = k => k.split(' ').pop();
    for (const [name, key] of [['stratum', of], ['status', st]]) for (const v of [...new Set([...want, ...got].map(key))].sort()) {
      const w = want.filter(x => key(x) === v), g = got.filter(x => key(x) === v);
      lines.push(`${name} ${v}: precision ${iv(g.filter(x => W.has(x)).length, g.length)} · recall ${iv(w.filter(x => G.has(x)).length, w.length)}`);
    }
    t.diagnostic(lines.join('\n'));
    // exact means exact; recall on the promised strata at least 0.95; ambiguous strata reported, not gated
    const ex = got.filter(x => st(x) === 'exact');
    assert.deepEqual(ex.filter(x => !W.has(x)), [], 'every exact relation is right');
    const promised = want.filter(x => !['override', 'redefined'].includes(of(x)));
    assert.ok(promised.filter(x => G.has(x)).length / promised.length >= 0.95, 'recall on the promised strata');
    const firm = x => st(x) !== 'ambiguous';
    assert.deepEqual(got.filter(firm).sort(), want.filter(firm).sort(), 'every labelled exact or inferred site, once, and nothing else');
    // what it does not follow is counted: a parameter called, a local lambda that shadows an import
    assert.equal(S.unresolved.ast['call-local'], 2, JSON.stringify(S.unresolved.ast));
  } finally { r.cleanup(); }
});

test('python: Lambda handlers from serverless.yml and a Docker image, their triggers, and why some are not found', { skip }, () => {
  const S = scanRepo(LAMBDA, {});
  assert.deepEqual(validateScan(S), []);
  const lam = S.entries.filter(e => e.kind === 'lambda'), by = st => lam.filter(e => e.status === st).map(e => e.name || e.handler).sort();
  assert.deepEqual(by('exact'), ['createOrder', 'getOrder', 'nightly', 'onUpload', 'pdf'], 'configured: the manifest names them and the code has them');
  assert.deepEqual(by('unresolved'), ['built', 'gone', 'thumbs']);
  assert.deepEqual(by('inferred'), ['tools/cleanup.py#lambda_handler'], 'by convention: a handler no manifest names');
  assert.deepEqual(S.unresolved.lambda, { 'no such file': 1, 'a build output that is not in the repo': 1, 'a remote image': 1 });
  assert.equal(lam.find(e => e.name === 'pdf').handler, 'images/pdf/app.py#handler', 'image: pdfimage → provider.ecr.images → its Dockerfile CMD');
  assert.ok(!S.entries.some(e => e.id.startsWith('docker:')), 'a Dockerfile a function deploys is not a second handler');
  // each event: HTTP events are routes, schedules jobs, the rest events
  const ev = S.entries.filter(e => e.kind !== 'lambda').map(e => [e.kind, e.name, e.method, e.route]).sort();
  assert.deepEqual(ev, [['event', 'onUpload', null, null], ['job', 'nightly', null, null], ['route', 'createOrder', 'POST', '/orders'], ['route', 'getOrder', 'GET', '/orders/{id}']]);
  assert.equal(S.symbols.find(s => s.id === 'handlers/orders.py#create').kind, 'handler');
  assert.deepEqual(S.files['handlers/orders.py'].entry, { kind: 'lambda', variant: 'serverless', route: 'createOrder' });
  // tests: the runner from the imports, the files they reach
  assert.deepEqual(S.tests['tests/test_store.py'].runner, 'pytest');
  assert.deepEqual(S.tests['tests/test_store.py'].imports.map(i => i.file), ['lib/store.py']);
});

test('python: data uses (boto3, DB-API SQL), named by the manifest, and what is not data', { skip }, () => {
  const S = scanRepo(LAMBDA, {}), R = S.resources;
  assert.deepEqual(Object.keys(R).sort(), ['dynamodb:.:$ORDERS_TABLE', 's3:.:shop-archive', 's3:.:shop-uploads', 'sql:.:daily_totals', 'sql:.:orders_archive', 'sqs:.:shop-jobs']);
  // a name from the environment: the manifest's literal value names it; a value with a variable keeps $NAME; either
  // way the evidence is the manifest's line
  const yml = fs.readFileSync(path.join(LAMBDA, 'serverless.yml'), 'utf8').split('\n'), lineOf = k => yml.findIndex(l => l.trim().startsWith(`${k}:`)) + 1;
  assert.deepEqual([R['s3:.:shop-uploads'].file, R['s3:.:shop-uploads'].line], ['serverless.yml', lineOf('UPLOADS_BUCKET')]);
  assert.deepEqual([R['dynamodb:.:$ORDERS_TABLE'].file, R['dynamodb:.:$ORDERS_TABLE'].line], ['serverless.yml', lineOf('ORDERS_TABLE')]);
  // SQL: tables where the query names them, CTE names and comments left out
  const jobs = fs.readFileSync(path.join(LAMBDA, 'handlers/jobs.py'), 'utf8').split('\n');
  for (const t of ['orders_archive', 'daily_totals']) assert.match(jobs[R[`sql:.:${t}`].line - 1], new RegExp(t));
  const D = S.data.map(d => [d.from, d.resource, d.op, d.status]).sort();
  assert.deepEqual(D, [
    ['handlers/jobs.py#nightly', null, 'read', 'unresolved'],
    ['handlers/jobs.py#nightly', 'sql:.:daily_totals', 'write', 'inferred'],
    ['handlers/jobs.py#nightly', 'sql:.:orders_archive', 'read', 'inferred'],
    ['handlers/uploads.py#on_upload', 's3:.:shop-archive', 'write', 'inferred'],
    ['handlers/uploads.py#on_upload', 's3:.:shop-uploads', 'read', 'inferred'],
    ['lib/store.py#load_order', 'dynamodb:.:$ORDERS_TABLE', 'read', 'inferred'],
    ['lib/store.py#save_order', 'dynamodb:.:$ORDERS_TABLE', 'write', 'inferred'],
    ['lib/store.py#save_order', 'sqs:.:shop-jobs', 'write', 'inferred'],
  ]);
  // not data: .execute on an object that is no cursor, SQL in comments, a CTE; counted: a table name made at run time,
  // a boto3 operation on a client passed in
  assert.ok(!Object.keys(R).some(k => /fake_table|ghost_table|comment_table|recent/.test(k)));
  assert.equal(S.unresolved.ast['data-unknown-name'], 1, 'the f-string table');
  assert.equal(S.unresolved.ast['data-untraced'], 1, 'client.put_object on a parameter');
});

test('python: the map and its page, with handlers, data stores and the coverage lines', { skip }, () => {
  const r = makeRepo('py-lambda');
  try {
    const S = scanRepo(r.root, { since: 100000 }), B = buildRepo(autoMap(S), S), A = B.ATLAS;
    const parts = A.modules.filter(m => m.id !== 'dock').flatMap(m => m.parts), handlers = parts.filter(p => p.name === 'Handlers');
    assert.ok(handlers.length >= 1);
    assert.deepEqual(handlers.flatMap(p => p.children.map(c => c.name)).sort(), ['createOrder', 'getOrder', 'lambda_handler', 'nightly', 'onUpload', 'pdf'], 'by the names their deployment gives them');
    assert.ok(handlers.flatMap(p => p.children).every(c => c.sk === 'lambda' && /^Lambda handler/.test(c.what)));
    assert.equal(B.SCENE.railTxt, 'DATA · 2 GROUPS · 6 RESOURCES');
    assert.deepEqual(A.store.of, { sql: 'SQL table', s3: 'S3 bucket', dynamodb: 'DynamoDB table', sqs: 'SQS queue' });
    assert.ok(A.journeys.some(j => j.name === 'POST /orders → $ORDERS_TABLE'), A.journeys.map(j => j.name).join(' | '));
    const cov = A.coverage.lines.join('\n');
    assert.match(cov, /mapped 8 files \(8 py\)/);
    assert.match(cov, /Python data calls not matched: 1 on names computed at run time, 1 on clients the scan cannot trace to boto3/);
    assert.match(cov, /Lambda handlers not found: 1 a build output that is not in the repo, 1 a remote image, 1 no such file/);
    // the page: every link checked by what it claims (Python call sites by test/support/pycall.py)
    const page = path.join(r.dir, 'py.html'); writePage(B, 'py-lambda', page);
    const c = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), page], { encoding: 'utf8', timeout: 180e3 });
    assert.equal(c.status, 0, c.stdout.slice(-3000) + c.stderr.slice(-800));
    assert.match(c.stdout, /all links: \d+ · bad 0 · by kind .*"call-site:py":\d+.*"resource":\d+/);
  } finally { r.cleanup(); }
});

test('python: declarations read for diffs number and place symbols as the scan does', { skip }, () => {
  const tricky = [
    'import os', 'try:', '    from fast import twice', 'except ImportError:', '    def twice(x):', '        return 2 * x', '',
    'X = 1', 'X = 2', 'if os.name == "nt":', '    SEP = "\\\\"', 'else:', '    SEP = "/"', '',
    'DOC = """', 'def not_a_function():', '"""', '', '@decorator(', '    arg=1,', ')', 'def decorated(', '    a,', '    b,', '):', '    return (a +', '            b)', '',
    'class Box:', '    def open(self):', '        def inner():', '            pass', '        return inner', '', 'def twice(x):', '    return x', '',
  ].join('\n');
  const r = repoWith({ 'tricky.py': tricky }, { dir: LAMBDA });
  try {
    const S = scanRepo(r.root, {});
    for (const f of Object.keys(S.files).filter(p => p.endsWith('.py'))) {
      const text = fs.readFileSync(path.join(r.root, f), 'utf8');
      const mine = pyRanges(f, text).map(([, l, e, id]) => [id, l, e]);
      const scan = S.symbols.filter(s => s.file === f && !s.member).map(s => [s.id, s.line, s.end]);
      assert.deepEqual(mine, scan, f);
    }
  } finally { r.cleanup(); }
});

test('python: without python3 the files are counted, not read, and the map goes on (or says why it cannot)', () => {
  const S = scanRepo(LAMBDA, { python: null });
  assert.deepEqual(validateScan(S), []);
  assert.equal(S.unresolved.ast['no-python'], 9);
  assert.ok(!Object.keys(S.files).some(f => f.endsWith('.py')));
  assert.throws(() => buildRepo(autoMap(S), S), /nothing to map: the 9 Python files could not be read \(python3 was not found on the PATH\)/);
  // with code besides Python, the map goes on and says what it did not read
  const r = repoWith({ 'web/app.ts': 'export function hello() { return 1; }\n' }, { dir: LAMBDA });
  try {
    const S2 = scanRepo(r.root, { python: null }), B = buildRepo(autoMap(S2), S2);
    assert.match(B.ATLAS.coverage.lines.join('\n'), /Python files: 9 not read \(no python3 on this machine\)/);
  } finally { r.cleanup(); }
});

test('python: a file that does not parse is a file with an error, and the rest is read', { skip }, () => {
  const r = repoWith({ 'app/ok.py': 'def fine():\n    return 1\n', 'app/broken.py': 'def broken(:\n    pass\n' });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(validateScan(S), []);
    assert.match(S.files['app/broken.py'].error, /line 1/);
    assert.equal(S.unresolved.ast['parse-error'], 1);
    assert.ok(S.symbols.some(s => s.id === 'app/ok.py#fine'));
    assert.match(buildRepo(autoMap(S), S).ATLAS.coverage.lines.join('\n'), /Python files: 1 that do not parse/);
  } finally { r.cleanup(); }
});

test('python: the scanned code never runs, and a python3 inside the repo is never used', { skip }, () => {
  const r = repoWith({
    'evil.py': "import os\nos.system('touch PWNED_IMPORT')\nopen('PWNED_OPEN', 'w').write('x')\n",
    'json.py': "open('PWNED_SHADOW', 'w').write('x')\n",
    'sitecustomize.py': "open('PWNED_SITE', 'w').write('x')\n",
    'usercustomize.py': "open('PWNED_USER', 'w').write('x')\n",
    'bin/python3': '#!/bin/sh\ntouch "$(dirname "$0")/../PWNED_BIN"\nexit 1\n',
  });
  fs.chmodSync(path.join(r.root, 'bin/python3'), 0o755);
  const PATH = process.env.PATH;
  try {
    process.env.PATH = `${path.join(r.root, 'bin')}${path.delimiter}bin${path.delimiter}${PATH}`;
    const S = scanRepo(r.root, {});
    assert.ok(S.symbols.length >= 0 && S.files['evil.py'], 'the repo is read');
    const left = walk(r.dir).filter(f => /PWNED/.test(f));
    assert.deepEqual(left, [], 'nothing in the repo ran');
    assert.ok(!fs.readdirSync(os.tmpdir()).some(f => /^PWNED/.test(f)), 'nor in the folder Python runs from');
  } finally { process.env.PATH = PATH; r.cleanup(); }
});
