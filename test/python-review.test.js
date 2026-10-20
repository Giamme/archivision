'use strict';
// The cases the review of phase 3 (Python, Lambda manifests, data) found, one test each: what the scan finds, what
// the map shows, and what the page checker refuses.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync, execFileSync } = require('child_process');
const { scanRepo, autoMap, buildRepo, writePage } = require('../lib');
const { findPython } = require('../lib/repo/scan/python');

// python3 3.10 or later, as the scan needs
const HAS_PY = spawnSync('python3', ['-c', 'import sys; sys.exit(sys.version_info < (3, 10))'], { encoding: 'utf8' }).status === 0;
const skip = !HAS_PY && 'no python3 3.10 or later';
const SCAN = path.join(__dirname, '..', 'python', 'scan.py'), PYCALL = path.join(__dirname, 'support', 'pycall.py');
const write = (root, files) => { for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); } };
function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-pyreview-')), root = path.join(dir, 'repo');
  fs.mkdirSync(root); write(root, files);
  return { root, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
// python/scan.py on files given in memory
function pyScan(files, extra = {}) {
  const r = spawnSync('python3', ['-I', '-S', '-B', SCAN, '--memory-mb=2048'], { input: JSON.stringify({ files, ...extra }), encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const calls = o => o.relations.filter(x => x.rel === 'call').map(x => `${x.from} -> ${x.to} ${x.status}`).sort();
const data = o => o.data.map(d => `${d.from} ${d.store} ${d.name[0] === 'literal' ? d.name[1] : d.name[0] === 'env' ? '$' + d.name[1] : '?'} ${d.op}`).sort();
const scanOf = files => { const r = repoWith(files); try { return scanRepo(r.root, {}); } finally { r.cleanup(); } };
const lambdas = S => S.entries.filter(e => e.kind === 'lambda').map(e => `${e.name} ${e.status} ${e.evidence.file}:${e.evidence.line}`).sort();
const handler = n => `def ${n}(event, context):\n    return 1\n`;

/* ---------- isolation ---------- */

test('review 3.1: a python3 on the PATH that is a symlink into the repo is never chosen', { skip }, () => {
  const r = repoWith({ 'a.py': 'x = 1\n', 'bin/python3': '#!/bin/sh\nexit 1\n' });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-pyreview-bin-')), PATH = process.env.PATH;
  try {
    fs.chmodSync(path.join(r.root, 'bin/python3'), 0o755);
    fs.symlinkSync(path.join(r.root, 'bin/python3'), path.join(out, 'python3'));
    process.env.PATH = `${out}${path.delimiter}${PATH}`;
    const py = findPython(r.root);
    assert.ok(py, 'a python3 outside the repo is found');
    assert.ok(!fs.realpathSync(py).startsWith(fs.realpathSync(r.root) + path.sep), `not the repo's: ${py}`);
  } finally { process.env.PATH = PATH; fs.rmSync(out, { recursive: true, force: true }); r.cleanup(); }
});

test('a python3 older than 3.10 is named as the reason the Python files are not read', () => {
  // the adapter and the page, with a python3 that answers as scan.py does on an older Python
  const r = repoWith({ 'a.py': 'def f():\n    return 1\n' });
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-pyreview-old-')), PATH = process.env.PATH;
  try {
    fs.writeFileSync(path.join(bin, 'python3'), "#!/bin/sh\necho \"archivision's Python reader needs Python 3.10 or later; this python3 is 3.9.6\" >&2\nexit 2\n");
    fs.chmodSync(path.join(bin, 'python3'), 0o755);
    process.env.PATH = bin;
    const S = scanRepo(r.root, {});
    assert.deepEqual(S.unresolved.ast, { 'python-too-old': 1 });
    assert.throws(() => buildRepo(autoMap(S), S), /the 1 Python files could not be read \(python3 is older than 3\.10\)/);
  } finally { process.env.PATH = PATH; fs.rmSync(bin, { recursive: true, force: true }); r.cleanup(); }
  // and scan.py itself, on an older Python when this machine has one (macOS ships 3.9 as /usr/bin/python3)
  const old = ['/usr/bin/python3'].find(p => spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info < (3, 10) else 1)']).status === 0);
  if (!old) return;
  const o = spawnSync(old, ['-I', '-S', '-B', SCAN], { input: '{"files":{}}', encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(o.status, 2);
  assert.match(o.stderr, /^archivision's Python reader needs Python 3\.10 or later; this python3 is 3\.\d+\.\d+\n$/);
});

test('a python3 older than 3.10 is named as the reason even when the request is bigger than the pipe (EPIPE)', () => {
  // scan.py exits before it reads stdin, so Node's write of a big request meets a closed pipe; that is still "too old"
  const files = {}; for (let i = 0; i < 300; i++) files[`pkg/m${i}.py`] = `def f${i}():\n    return ${JSON.stringify('x'.repeat(2000))}\n`;
  const r = repoWith(files);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'archivision-pyreview-epipe-')), PATH = process.env.PATH;
  try {
    fs.writeFileSync(path.join(bin, 'python3'), "#!/bin/sh\necho \"archivision's Python reader needs Python 3.10 or later; this python3 is 3.9.6\" >&2\nexit 2\n");
    fs.chmodSync(path.join(bin, 'python3'), 0o755);
    process.env.PATH = bin;
    for (let k = 0; k < 3; k++) {
      const S = scanRepo(r.root, {});
      assert.deepEqual(S.unresolved.ast, { 'python-too-old': 300 });
      const ast = S.adapters.find(a => a.name === 'ast');
      assert.ok(!/EPIPE/.test(JSON.stringify(ast)), JSON.stringify(ast));
    }
  } finally { process.env.PATH = PATH; fs.rmSync(bin, { recursive: true, force: true }); r.cleanup(); }
});

test('review 3.2: a FIFO named like a Python file is skipped, a file over 2 MiB is counted, and the scan ends', { skip }, () => {
  const r = repoWith({ 'a.py': 'def f():\n    return 1\n', 'big.py': `X = "${'x'.repeat(2.2 * 1024 * 1024)}"\n` });
  try {
    execFileSync('mkfifo', [path.join(r.root, 'blocked.py')]);
    const S = scanRepo(r.root, {});
    assert.ok(S.files['a.py'] && !S.files['blocked.py'] && !S.files['big.py']);
    assert.equal(S.unresolved.ast['too-large'], 1);
    assert.ok(S.skipped.reasons && JSON.stringify(S.skipped).includes('not a regular file'));
  } finally { r.cleanup(); }
});

/* ---------- bindings ---------- */

test('review 3.3: an import rebound, imported in two branches, or offered by two star imports is never exact', { skip }, () => {
  const o = pyScan({
    'a.py': '__all__ = ["f"]\ndef f():\n    return 1\n', 'b.py': 'def f():\n    return 2\n', 'c.py': '__all__ = []\ndef f():\n    return 3\n',
    'rebound.py': 'from a import f\nf = lambda: None\ndef run():\n    f()\n',
    'branch.py': 'import os\nif os.environ.get("X"):\n    from a import f\nelse:\n    from b import f\ndef run():\n    f()\n',
    'stars.py': 'from a import *\nfrom b import *\ndef run():\n    f()\n',
    'hidden.py': 'from c import *\ndef run():\n    f()\n',
  });
  const C = calls(o);
  for (const m of ['rebound', 'branch', 'stars']) {
    const mine = C.filter(c => c.startsWith(`${m}.py#run `));
    assert.ok(mine.length && mine.every(c => / ambiguous$/.test(c)), `${m}: ${mine.join(' | ')}`);
  }
  assert.ok(C.some(c => c === 'branch.py#run -> a.py#f ambiguous') && C.some(c => c === 'branch.py#run -> b.py#f ambiguous'), 'either branch');
  assert.ok(!C.some(c => c.startsWith('hidden.py#run ')), 'a name __all__ leaves out is not imported by *');
});

test('review 3.4: lambda and comprehension parameters, a walrus, a match capture and nonlocal hide the module function', { skip }, () => {
  const o = pyScan({ 'm.py': [
    'def f():\n    return 1',
    'g = lambda f: f()',
    'def comp(callbacks):\n    return [f() for f in callbacks]',
    'def walrus(cb):\n    x = (f := cb)\n    return f()',
    'def matcher(v):\n    match v:\n        case {"f": f}:\n            return f()',
    'def outer(f):\n    def inner():\n        nonlocal f\n        return f()\n    return inner',
  ].join('\n\n\n') + '\n' });
  assert.deepEqual(calls(o).filter(c => / -> m\.py#f /.test(c)), []);
});

test('review 3.5: super() follows the C3 order (a diamond reaches the sibling, not the shared base)', { skip }, () => {
  const o = pyScan({ 'd.py': 'class A:\n    def m(self):\n        return 1\nclass B(A):\n    pass\nclass C(A):\n    def m(self):\n        return 2\nclass D(B, C):\n    def run(self):\n        return super().m()\n' });
  const C = calls(o).filter(c => c.startsWith('d.py#D.run '));
  assert.ok(C.length === 1 && C[0].startsWith('d.py#D.run -> d.py#C.m '), C.join(' | '));
});

test('review 3.6: a method replaced on its class or on self, or a name rebound to another object, is not exact', { skip }, () => {
  const o = pyScan({ 'm.py': [
    'class C:\n    def m(self):\n        return 1',
    'def patched():\n    C.m = lambda self: None\n    return C().m()',
    'def rebound():\n    x = C()\n    x = object()\n    return x.m()',
    'class S:\n    def run(self):\n        return self.m()\n    def m(self):\n        return 1\n    def swap(self):\n        self.m = print',
  ].join('\n\n\n') + '\n' });
  const C = calls(o);
  assert.ok(C.includes('m.py#patched -> m.py#C.m ambiguous') && C.includes('m.py#S.run -> m.py#S.m ambiguous'), C.join(' | '));
  assert.ok(!C.some(c => c.startsWith('m.py#rebound -> m.py#C.m')), 'a name rebound to another object no longer holds a C');
});

test('review 3.7: a call to what a decorator wraps is inferred unless the decorator is a known identity one, by its import', { skip }, () => {
  const o = pyScan({ 'm.py': [
    'import functools\nimport typing',
    'def cache(fn):\n    return fn',
    '@functools.lru_cache(maxsize=None)\ndef cached():\n    return 1',
    '@cache\ndef local_cache():\n    return 1',
    '@typing.final\ndef final():\n    return 1',
    'def run():\n    return cached(), local_cache(), final()',
  ].join('\n\n\n') + '\n' });
  const C = calls(o).filter(c => c.startsWith('m.py#run '));
  assert.deepEqual(C, ['m.py#run -> m.py#cached inferred', 'm.py#run -> m.py#final exact', 'm.py#run -> m.py#local_cache inferred']);
});

/* ---------- SQL ---------- */

test('review 3.8: a table named at run time is an unknown resource, counted, whatever fills it in', { skip }, () => {
  const o = pyScan({ 'app.py': [
    'import sqlite3',
    'def run(tenant, table):',
    '    cur = sqlite3.connect("x").cursor()',
    '    cur.execute(f"SELECT * FROM tenant_{tenant}")',
    '    cur.execute("SELECT * FROM %s" % table)',
    '    cur.execute("DELETE FROM {} WHERE id = 1".format(table))',
    '    cur.execute("SELECT * FROM " + table + " JOIN real ON true")',
    '    cur.execute("SELECT * FROM t WHERE id = %s", (1,))',
  ].join('\n') + '\n' });
  assert.deepEqual(data(o), ['app.py#run sql ? read', 'app.py#run sql ? read', 'app.py#run sql ? read', 'app.py#run sql ? write', 'app.py#run sql real read', 'app.py#run sql t read']);
  assert.equal(o.unresolved['data-unknown-name'], 4);
  assert.ok(!data(o).some(d => /tenant_/.test(d)), 'no table made of the static half of a name');
});

test('review 3.9: a statement writes only its own target: a CTE before DELETE, a data-modifying CTE, MERGE and its source', { skip }, () => {
  const o = pyScan({ 'app.py': [
    'import psycopg2',
    'def run():',
    '    c = psycopg2.connect("").cursor()',
    '    c.execute("""WITH x AS (SELECT * FROM source)\nDELETE FROM target WHERE id IN (SELECT id FROM x)""")',
    '    c.execute("MERGE INTO tgt USING src ON tgt.id = src.id WHEN MATCHED THEN UPDATE SET a = src.a")',
    '    c.execute("WITH moved AS (DELETE FROM old RETURNING *) INSERT INTO new SELECT * FROM moved")',
    '    c.execute("INSERT INTO t (a) SELECT a FROM s ON CONFLICT (a) DO UPDATE SET a = 1")',
    '    c.execute("SELECT * FROM locked FOR UPDATE")',
  ].join('\n') + '\n' });
  assert.deepEqual(data(o), ['new write', 'old write', 'locked read', 's read', 'source read', 'src read', 't write', 'target write', 'tgt write'].map(x => `app.py#run sql ${x}`).sort());
});

test('review 3.10: SQL is read as tokens: strings, quoted names, comments, CTE scope, lists of tables, functions', { skip }, () => {
  const o = pyScan({ 'app.py': [
    'import sqlite3',
    'def run():',
    '    c = sqlite3.connect("x").cursor()',
    `    c.execute("SELECT '--' AS marker FROM real")`,
    `    c.execute('SELECT * FROM "order items"')`,
    `    c.execute('WITH "recent" AS (SELECT 1) SELECT * FROM "recent"')`,
    `    c.execute("WITH recent AS (SELECT 1) SELECT * FROM public.recent JOIN recent ON true")`,
    `    c.execute("SELECT * FROM a, b WHERE x IS DISTINCT FROM y")`,
    `    c.execute("SELECT EXTRACT(YEAR FROM created) FROM generate_series(1, 3) g, events -- FROM nothing")`,
    `    c.execute("SELECT $$ FROM fake $$ FROM [dbo].[orders]")`,
  ].join('\n') + '\n' });
  assert.deepEqual(data(o), ['a', 'b', 'dbo.orders', 'events', 'order items', 'public.recent', 'real'].map(x => `app.py#run sql ${x} read`));
});

/* ---------- data provenance ---------- */

test('review 3.11: boto3 and DB-API are known by their imports: a parameter called boto3 is not boto3, mysql.connector is', { skip }, () => {
  const o = pyScan({
    'app.py': 'import boto3\ndef run(boto3):\n    boto3.client("s3").get_object(Bucket="wrong")\ndef ok():\n    boto3.client("s3").get_object(Bucket="right")\n',
    'db.py': 'import mysql.connector\ndef run():\n    c = mysql.connector.connect().cursor()\n    c.execute("SELECT * FROM users")\n',
  });
  assert.deepEqual(data(o), ['app.py#ok s3 right read', 'db.py#run sql users read']);
});

test('review 3.12: a model is one whose bases trace to SQLAlchemy or Django, and a query counts only on a traced session', { skip }, () => {
  const o = pyScan({
    'ghost.py': 'class Ghost:\n    __tablename__ = "ghost"\ndef run(thing):\n    return thing.query(Ghost)\n',
    'models.py': 'from django.db import models as dm\nclass Base(dm.Model):\n    class Meta:\n        abstract = True\nclass Order(Base):\n    pass\n',
    'views.py': 'from models import Order\ndef run():\n    return Order.objects.all(), Order.objects.create(x=1)\n',
    'db.py': [
      'import sqlalchemy',
      'from sqlalchemy.orm import declarative_base, DeclarativeBase, Session, sessionmaker',
      'from sqlalchemy import select, delete, text, create_engine',
      'Base = declarative_base()',
      'SessionLocal = sessionmaker(bind=create_engine("sqlite://"))',
      'class Line(Base):\n    __tablename__ = "lines"',
      'class B2(DeclarativeBase):\n    pass',
      'class Item(B2):\n    __tablename__ = "items"',
      'def run(session: Session):\n    session.query(Line).all()\n    session.execute(select(Item.id).where(Item.id == 1))\n    session.execute(delete(Line))\n    session.execute(text("UPDATE audit SET x = 1"))',
      'def made():\n    with SessionLocal() as s:\n        return s.scalars(select(Item)).all()',
      'def untraced(other):\n    other.query(Line)\n    other.execute(sqlalchemy.text("DELETE FROM ghost"))\n    other.execute(select(Item))',
    ].join('\n') + '\n',
    'flask.py': 'from flask_sqlalchemy import SQLAlchemy\nfrom sqlmodel import SQLModel, Session, select\ndb = SQLAlchemy()\nclass OrderItem(db.Model):\n    pass\nclass Hero(SQLModel, table=True):\n    pass\nclass HeroBase(SQLModel):\n    pass\ndef run(session: Session):\n    session.exec(select(Hero))\ndef rows():\n    return db.session.query(OrderItem).all()\n',
  });
  assert.deepEqual(o.resources.map(r => `${r.store}:${r.name}`).sort(), ['django:Order', 'sql:hero', 'sql:items', 'sql:lines', 'sql:order_item']);
  assert.deepEqual(data(o), [
    'db.py#made sql items read', 'db.py#run sql audit write', 'db.py#run sql items read', 'db.py#run sql lines read', 'db.py#run sql lines write',
    'flask.py#rows sql order_item read', 'flask.py#run sql hero read', 'views.py#run django Order read', 'views.py#run django Order write']);
  assert.equal(o.unresolved['data-untraced'], 3, 'the three calls on `other` (thing.query(Ghost) is on no model)');
});

test('review 3.13: a module-level client defined after the function that uses it is still traced', { skip }, () => {
  const o = pyScan({ 'app.py': 'import boto3\ndef run():\n    s3.get_object(Bucket="real")\ns3 = boto3.client("s3")\n' });
  assert.deepEqual(data(o), ['app.py#run s3 real read']);
});

/* ---------- manifests ---------- */

const sls = (fns, provider = '') => `service: s\nprovider:\n  name: aws\n  runtime: python3.11\n${provider}functions:\n${fns}`;
const getBucket = 'import os, boto3\ndef run(e, c):\n    boto3.client("s3").get_object(Bucket=os.environ["UPLOADS_BUCKET"], Key="k")\n';

test('review 3.14: a variable is named by the deployments that run the code, their own value over the provider\'s', { skip }, () => {
  const own = scanOf({ 'serverless.yml': sls('  up:\n    handler: up.run\n    environment:\n      UPLOADS_BUCKET: actual-bucket\n  other:\n    handler: other.run\n', '  environment:\n    UPLOADS_BUCKET: provider-bucket\n'), 'up.py': getBucket, 'other.py': handler('run') });
  assert.deepEqual(Object.keys(own.resources), ['s3:.:actual-bucket']);
  const unrelated = scanOf({ 'serverless.yml': sls('  up:\n    handler: up.run\n  other:\n    handler: other.run\n    environment:\n      UPLOADS_BUCKET: unrelated-bucket\n'), 'up.py': getBucket, 'other.py': handler('run') });
  assert.deepEqual(Object.keys(unrelated.resources), ['s3:.:$UPLOADS_BUCKET'], 'another function\'s value is not this one\'s');
  const shared = scanOf({ 'serverless.yml': sls('  a:\n    handler: a.run\n    environment:\n      B: one\n  b:\n    handler: b.run\n    environment:\n      B: two\n'),
    'a.py': 'from lib import put\ndef run(e, c):\n    put()\n', 'b.py': 'from lib import put\ndef run(e, c):\n    put()\n',
    'lib.py': 'import os, boto3\ndef put():\n    boto3.client("s3").put_object(Bucket=os.environ["B"], Key="k", Body=b"")\n' });
  assert.deepEqual(Object.keys(shared.resources), ['s3:.:$B'], 'shared code run with two values keeps the variable');
  assert.equal(shared.unresolved.ast['data-env-varies'], 1);
});

test('review 3.15: a SAM intrinsic (!Ref, !Sub) is an expression, never a resource name', { skip }, () => {
  const S = scanOf({ 'template.yaml': 'Transform: AWS::Serverless-2016-10-31\nResources:\n  Up:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: ./src/\n      Handler: app.run\n      Runtime: python3.11\n      Environment:\n        Variables:\n          UPLOADS_BUCKET: !Ref UploadsBucket\n', 'src/app.py': getBucket });
  assert.deepEqual(Object.keys(S.resources), ['s3:.:$UPLOADS_BUCKET']);
  const sub = scanOf({ 'template.yaml': 'Transform: AWS::Serverless-2016-10-31\nResources:\n  Up:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: ./src/\n      Handler: app.run\n      Runtime: python3.11\n      Environment:\n        Variables:\n          UPLOADS_BUCKET: !Sub "${AWS::StackName}-uploads"\n', 'src/app.py': getBucket });
  assert.deepEqual(Object.keys(sub.resources), ['s3:.:$UPLOADS_BUCKET']);
});

test('review 3.16: flow YAML with JSON keys and brackets in strings is read; one that never closes is reported, the rest read', { skip }, () => {
  const json = scanOf({ 'serverless.yml': 'service: s\nprovider: {name: aws, runtime: python3.11}\nfunctions: {"f":{"handler":"app.run"}}\n', 'app.py': handler('run') });
  assert.deepEqual(lambdas(json), ['f exact serverless.yml:3']);
  const bracket = scanOf({ 'serverless.yml': 'service: s\ncustom: {text: "["}\n' + sls('  f:\n    handler: app.run\n').replace('service: s\n', ''), 'app.py': handler('run') });
  assert.deepEqual(lambdas(bracket).map(x => x.split(' ')[0]), ['f']);
  const open = scanOf({ 'serverless.yml': 'service: s\ncustom: {text: [1, 2\n' + sls('  f:\n    handler: app.run\n').replace('service: s\n', ''), 'app.py': handler('run') });
  assert.deepEqual(lambdas(open).map(x => x.split(' ')[0]), ['f'], 'the lines after it are still read');
  assert.deepEqual(open.unresolved['lambda-manifest'], { 'a flow collection that does not close': 1 });
  const alias = scanOf({ 'serverless.yml': sls('  f: *base\n  g:\n    <<: *base\n    handler: app.run\n'), 'app.py': handler('run') });
  assert.deepEqual(alias.unresolved['lambda-manifest'], { 'a merge key (<<) not followed': 1, 'an alias not followed': 2 });
  const B = buildRepo(autoMap(open), open);
  assert.ok(B.ATLAS.coverage.lines.some(l => /^Lambda manifests, parts not read .*: 1 a flow collection that does not close$/.test(l)), B.ATLAS.coverage.lines.join('\n'));
});

test('review 3.17: functions included with ${file(…)} are read inside the repo, and what cannot be read is reported', { skip }, () => {
  const one = scanOf({ 'serverless.yml': sls('').replace('functions:\n', 'functions: ${file(./functions.yml)}\n'), 'functions.yml': 'f:\n  handler: app.run\ng:\n  handler: app.nope\n', 'app.py': handler('run') });
  assert.deepEqual(lambdas(one), ['f exact functions.yml:2', 'g unresolved functions.yml:4']);
  const list = scanOf({ 'serverless.yml': sls('  - ${file(./a.yml)}\n  - ${file(../outside.yml)}\n  - ${file(./${self:custom.x}.yml)}\n  - ${file(./missing.yml)}\n'), 'a.yml': 'f:\n  handler: app.run\n', 'app.py': handler('run') });
  assert.deepEqual(lambdas(list), ['f exact a.yml:2']);
  assert.deepEqual(list.unresolved['lambda-manifest'], { 'a file included by a variable': 1, 'an included file not found': 1, 'an included file outside the repo': 1 });
});

test('review 3.18: a SAM handler is a module under CodeUri: dots are folders of the module, never of ./', { skip }, () => {
  const S = scanOf({ 'template.yaml': 'Transform: AWS::Serverless-2016-10-31\nResources:\n  Up:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: ./src/\n      Handler: pkg.app.run\n      Runtime: python3.11\n  Far:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri:\n        Bucket: b\n        Key: k.zip\n      Handler: app.run\n      Runtime: python3.11\n',
    'src/pkg/__init__.py': '', 'src/pkg/app.py': handler('run') });
  assert.deepEqual(lambdas(S), ['Far unresolved template.yaml:15', 'Up exact template.yaml:7']);
  assert.deepEqual(S.unresolved.lambda, { 'code that is not in a folder of the repo (CodeUri)': 1 });
});

test('review 3.19: a literal sys.path edit is relative to where the program runs: inferred, ambiguous when two places differ', { skip }, () => {
  const one = pyScan({ 'main.py': 'import sys\nsys.path.insert(0, "lib")\nfrom helper import f\ndef run():\n    f()\n', 'lib/helper.py': 'def f():\n    pass\n' });
  assert.deepEqual(calls(one), ['main.py#run -> lib/helper.py#f inferred']);
  assert.equal(one.unresolved['syspath-not-static'], 0);
  const two = pyScan({ 'svc/main.py': 'import sys\nsys.path.insert(0, "lib")\nfrom helper import f\ndef run():\n    f()\n', 'lib/helper.py': 'def f():\n    pass\n', 'svc/lib/helper.py': 'def f():\n    pass\n' });
  assert.deepEqual(calls(two), ['svc/main.py#run -> lib/helper.py#f ambiguous']);
  const abs = pyScan({ 'main.py': 'import sys\nsys.path.append("/opt/python")\n' });
  assert.equal(abs.unresolved['syspath-not-static'], 0, 'an absolute path is outside the repo, and static');
});

/* ---------- the map ---------- */

test('review 3.20: two resources with one name in two stores are two resources on the map', { skip }, () => {
  const S = scanOf({ 'app.py': 'import boto3\ndef run():\n    boto3.client("s3").get_object(Bucket="orders", Key="k")\n    boto3.client("dynamodb").get_item(TableName="orders", Key={})\n' });
  const B = buildRepo(autoMap(S), S), ms = B.ATLAS.groups.flatMap(g => g.modelsInfo.map(m => [m[0], m[5], m[6]]));
  assert.deepEqual(ms.sort(), [['orders · DynamoDB', 'dynamodb', 'orders'], ['orders · S3', 's3', 'orders']]);
});

/* ---------- the checker ---------- */

const CHECKER = {
  'pkg/__init__.py': '', 'pkg/a/__init__.py': 'from .impl import f\n', 'pkg/a/impl.py': 'def f():\n    return 1\n', 'pkg/a/unrelated.py': 'def f():\n    return 2\n',
  'main.py': [
    'from pkg.a import f', 'from pkg.a import f as g', 'import pkg.a as pa', '', '',
    'class A:', '    def m(self):', '        return 1', '', '',
    'class B:', '    def m(self):', '        return 2', '', '    def run(self):', '        return self.m()', '', '',
    'class C(A):', '    def m(self):', '        return super().m()', '', '',
    'def h():', '    return f(), pa.f()', '', '',
    'k = lambda f: f()', '', '',
    'def over():', '    return g()', '', '',
    'g = 3', '',
  ].join('\n'),
};

test('review 3.21: the call-site checker reads bindings, receivers and modules itself, and refuses wrong links', { skip }, () => {
  const r = repoWith(CHECKER);
  try {
    const L = CHECKER['main.py'].split('\n'), at = (line, s, k = 0) => { let i = -1; for (let n = 0; n <= k; n++) i = L[line - 1].indexOf(s, i + 1); return i + 1; };
    const T = { impl: ['pkg/a/impl.py', 1, 2], unrelated: ['pkg/a/unrelated.py', 1, 2], Am: ['main.py', 7, 8], Bm: ['main.py', 12, 13] };
    const cases = [
      // [what, line, column, name, target, status, holds]
      ['an import through a package\'s re-export', 25, at(25, 'f()'), 'f', T.impl, 'exact', true],
      ['an import linked to another file of the package', 25, at(25, 'f()'), 'f', T.unrelated, 'exact', false],
      ['a module\'s member through its re-export', 25, at(25, 'f()', 1), 'f', T.impl, 'exact', true],
      ['a module\'s member in another file of the package', 25, at(25, 'f()', 1), 'f', T.unrelated, 'exact', false],
      ['a lambda parameter called', 28, at(28, 'f()'), 'f', T.impl, 'exact', false],
      ['self.m in B to B.m', 16, at(16, 'm()'), 'm', T.Bm, 'inferred', true],
      ['self.m in B to the unrelated A.m', 16, at(16, 'm()'), 'm', T.Am, 'inferred', false],
      ['self.m in B to the lines of class B (the top-level symbol the page links)', 16, at(16, 'm()'), 'm', ['main.py', 11, 16], 'inferred', true],
      ['self.m in B to the lines of class A', 16, at(16, 'm()'), 'm', ['main.py', 6, 8], 'inferred', false],
      ['super().m in C to its base A', 21, at(21, 'm()'), 'm', T.Am, 'exact', true],
      ['super().m in C to B, no base of it', 21, at(21, 'm()'), 'm', T.Bm, 'exact', false],
      ['a name bound twice, ambiguous', 32, at(32, 'g()'), 'f', T.impl, 'ambiguous', true],
      ['a name bound twice, called exact', 32, at(32, 'g()'), 'f', T.impl, 'exact', false],
    ];
    const req = { root: r.root, checks: cases.map(([, line, col, name, target, status]) => ({ file: 'main.py', line, col, name, target, status })) };
    const out = JSON.parse(spawnSync('python3', ['-I', '-B', PYCALL], { input: JSON.stringify(req), encoding: 'utf8' }).stdout);
    cases.forEach(([what, , , , , , holds], i) => assert.equal(out[i] === null, holds, `${what}: ${out[i]}`));
  } finally { r.cleanup(); }
});

test('review 3.21: a page whose links were corrupted fails the page check', { skip }, () => {
  const src = path.join(__dirname, 'fixtures', 'py-lambda'), r = repoWith({});
  try {
    fs.cpSync(src, r.root, { recursive: true });
    // a second binding of fmt_money (its call is then ambiguous), and the archive bucket named in another function
    fs.appendFileSync(path.join(r.root, 'handlers/orders.py'), '\n\nfmt_money = fmt_money\n');
    fs.appendFileSync(path.join(r.root, 'handlers/uploads.py'), '\n\ndef unrelated():\n    return "elsewhere-bucket"\n');
    const S = scanRepo(r.root, {}), B = buildRepo(autoMap(S), S);
    const kids = B.ATLAS.modules.flatMap(m => m.parts.flatMap(p => p.children || []));
    const money = kids.find(c => c.code && c.code.callers && c.code.callers.some(x => x[6] === 'money'));
    const site = money.code.callers.find(x => x[6] === 'money');
    assert.equal(site[3], 'ambiguous', 'the scan says ambiguous');
    site[3] = 'exact';
    const load = kids.find(c => c.code && c.code.sym === 'load_order'), save = kids.find(c => c.code && c.code.sym === 'save_order');
    load.code.l = save.code.l; load.code.e = save.code.e;                       // load_order's callers now point at save_order
    const up = kids.find(c => c.code && (c.code.db || []).some(d => d[4] === 'shop-archive'));
    up.code.db.find(d => d[4] === 'shop-archive')[4] = 'elsewhere-bucket';
    const page = path.join(r.dir, 'bad.html'); writePage(B, 'bad', page);
    const c = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), page], { encoding: 'utf8', timeout: 180e3 });
    assert.equal(c.status, 1, c.stdout.slice(-2000));
    assert.match(c.stdout, /«money»: fmt_money is bound 2 times where it is called, so the link cannot be exact/);
    assert.match(c.stdout, /«load_order»: no def or class load_order in lib\/store\.py/);
    assert.match(c.stdout, /data-op handlers\/uploads.py:11 «elsewhere-bucket»: elsewhere-bucket is not what the operation is given \(shop-archive\)/);
  } finally { r.cleanup(); }
});

/* ---------- the second review ---------- */

test('review2 labels: resources whose names collide with other labels, or with Object.prototype, each keep a label of their own', { skip }, () => {
  const r = repoWith({ 'app.py': [
    'import boto3, sqlite3', 'def run():', '    s3 = boto3.client("s3")',
    '    s3.get_object(Bucket="x", Key="k")', '    s3.get_object(Bucket="x · SQL", Key="k")',
    '    s3.get_object(Bucket="constructor", Key="k")', '    s3.get_object(Bucket="__proto__", Key="k")',
    '    con = sqlite3.connect("a.db")', '    con.execute("SELECT * FROM x")', ''].join('\n') });
  try {
    const S = scanRepo(r.root, {}), B = buildRepo(autoMap(S), S);
    assert.equal(Object.keys(S.resources).length, 5);
    const labels = B.ATLAS.groups.flatMap(g => g.modelsInfo.map(m => m[0]));
    assert.equal(new Set(labels).size, 5, labels.join(' | '));
    assert.ok(labels.includes('constructor') && labels.includes('__proto__') && labels.includes('x · S3'), labels.join(' | '));
    const page = path.join(r.dir, 'p.html'); writePage(B, 'p', page);
    const c = spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), page], { encoding: 'utf8', timeout: 180e3 });
    assert.equal(c.status, 0, c.stdout.slice(-2000));
    assert.match(c.stdout, /all links: \d+ · bad 0 .*"resource":10/);
  } finally { r.cleanup(); }
});

test('review2 SQL: joins in parentheses, and a plain CTE that reads the table of its own name', { skip }, () => {
  const q = s => `import sqlite3\ndef run():\n    sqlite3.connect("a").execute("${s}")\n`;
  const tables = s => data(pyScan({ 'a.py': q(s) })).map(x => x.split(' ').slice(2).join(' '));
  assert.deepEqual(tables('SELECT * FROM (a JOIN b ON a.id = b.id)'), ['a read', 'b read']);
  assert.deepEqual(tables('SELECT * FROM ((a JOIN b USING (id)) LEFT JOIN c ON true) x'), ['a read', 'b read', 'c read']);
  assert.deepEqual(tables('WITH t AS (SELECT * FROM t) SELECT * FROM t'), ['t read']);
  assert.deepEqual(tables('WITH t AS (SELECT 1) SELECT * FROM t'), []);
  assert.deepEqual(tables('WITH RECURSIVE r AS (SELECT 1 UNION ALL SELECT n FROM r) SELECT * FROM r'), []);
  assert.deepEqual(tables('WITH a AS (SELECT * FROM b), b AS (SELECT 1) SELECT * FROM a'), ['b read']);
  assert.deepEqual(tables('SELECT * FROM x'), ['x read'], 'a table named last in the text');
  assert.deepEqual(tables('DELETE FROM d'), ['d write']);
});

test('review2 manifests: a manifest in flow style is read with its lines; a second document and tagged functions are reported', { skip }, () => {
  const flow = scanOf({ 'serverless.yml': '# flow\n{\n  service: s,\n  provider: {name: aws, runtime: python3.11},\n  functions: {\n    f: {handler: app.run},\n    g: {"handler": "app.nope"}\n  }\n}\n', 'app.py': handler('run') });
  assert.deepEqual(lambdas(flow), ['f exact serverless.yml:6', 'g unresolved serverless.yml:7']);
  assert.equal(flow.unresolved['lambda-manifest'], undefined);
  const two = scanOf({ 'serverless.yml': sls('  f:\n    handler: app.run\n') + '---\nfunctions:\n  g:\n    handler: app.run\n', 'app.py': handler('run') });
  assert.deepEqual(lambdas(two).map(x => x.split(' ')[0]), ['f']);
  assert.deepEqual(two.unresolved['lambda-manifest'], { 'a second YAML document, not read': 1 });
  const tagged = scanOf({ 'serverless.yml': 'service: s\nprovider:\n  name: aws\n  runtime: python3.11\nfunctions: !Ref Fns\n', 'app.py': handler('run') });
  assert.deepEqual(tagged.unresolved['lambda-manifest'], { 'functions given by a tag (!Ref, !If …)': 1 });
  const open = scanOf({ 'serverless.yml': '{service: s, functions: {f: {handler: app.run}}\n', 'app.py': handler('run') });
  assert.deepEqual(open.unresolved['lambda-manifest'], { 'a flow collection that does not close': 1 }, 'a manifest with no map to read still says why');
});

test('review2 isolation: a symlink loop is walked once; the checker reads nothing outside the repo', { skip }, () => {
  const r = repoWith({ 'a/b/x.py': 'def f():\n    return 1\n', 'main.py': 'from a.b.x import f\nf()\n' });
  try {
    const outside = path.join(r.dir, 'secret.py'); fs.writeFileSync(outside, 'def f():\n    return 1\nf()\n');
    fs.symlinkSync('..', path.join(r.root, 'a/b/up')); fs.symlinkSync('../..', path.join(r.root, 'a/b/top')); fs.symlinkSync('a', path.join(r.root, 'alias'));
    fs.symlinkSync(outside, path.join(r.root, 'leak.py'));
    const S = scanRepo(r.root, {});
    assert.deepEqual(Object.keys(S.files).sort(), ['a/b/x.py', 'main.py']);
    const req = { root: r.root, checks: [
      { file: '../secret.py', line: 3, col: 1, name: 'f', target: ['../secret.py', 1, 2], status: 'exact' },
      { file: 'leak.py', line: 3, col: 1, name: 'f', target: ['leak.py', 1, 2], status: 'exact' },
      { file: 'main.py', line: 2, col: 1, name: 'f', target: ['a/b/x.py', 1, 2], status: 'exact' }] };
    const out = JSON.parse(spawnSync('python3', ['-I', '-B', PYCALL], { input: JSON.stringify(req), encoding: 'utf8' }).stdout);
    assert.ok(out[0] && out[1], `outside the repo, by ../ or by a symlink, is no file: ${out.join(' | ')}`);
    assert.equal(out[2], null);
  } finally { r.cleanup(); }
});

test('review2 checker: super() reaches the nearest definer, A().m() stays in A\'s bases, self. and decorated targets are never exact', { skip }, () => {
  const src = [
    'def deco(f):', '    return f', '', '',                                                                     // 1-2
    'class A:', '    def m(self):', '        return 1', '', '',                                                // 5-7
    'class B(A):', '    def m(self):', '        return 2', '', '',                                             // 10-12
    'class C(B):', '    def m(self):', '        return super().m()', '', '    def n(self):', '        return self.m()', '', '',   // 15-20
    'class D(B):', '    pass', '', '',                                                                         // 23-24
    'class Other:', '    def m(self):', '        return 3', '', '',                                            // 27-29
    '@deco', 'def wrapped():', '    return 4', '', '',                                                         // 32-34
    'def use():', '    return D().m(), A().m(), wrapped()', '',                                              // 37-38
  ].join('\n');
  const r = repoWith({ 'main.py': src });
  try {
    const L = src.split('\n'), at = (line, s, k = 0) => { let i = -1; for (let n = 0; n <= k; n++) i = L[line - 1].indexOf(s, i + 1); return i + 1; };
    const T = { Am: ['main.py', 6, 7], Bm: ['main.py', 11, 12], Om: ['main.py', 28, 29], w: ['main.py', 32, 34] };
    const cases = [
      ['super().m in C to B.m, the nearest', 17, at(17, 'm()'), 'm', T.Bm, 'exact', true],
      ['super().m in C to A.m, passed over by B.m', 17, at(17, 'm()'), 'm', T.Am, 'exact', false],
      ['self.m called exact', 20, at(20, 'm()'), 'm', T.Bm, 'exact', false],
      ['self.m called inferred', 20, at(20, 'm()'), 'm', T.Bm, 'inferred', true],
      ['D().m to B.m, D\'s nearest', 38, at(38, 'm()'), 'm', T.Bm, 'exact', true],
      ['D().m to A.m, passed over', 38, at(38, 'm()'), 'm', T.Am, 'exact', false],
      ['A().m to Other.m, no base of A', 38, at(38, 'm()', 1), 'm', T.Om, 'inferred', false],
      ['a decorated function, exact', 38, at(38, 'wrapped()'), 'wrapped', T.w, 'exact', false],
      ['a decorated function, inferred', 38, at(38, 'wrapped()'), 'wrapped', T.w, 'inferred', true],
    ];
    const req = { root: r.root, checks: cases.map(([, line, col, name, target, status]) => ({ file: 'main.py', line, col, name, target, status })) };
    const out = JSON.parse(spawnSync('python3', ['-I', '-B', PYCALL], { input: JSON.stringify(req), encoding: 'utf8' }).stdout);
    cases.forEach(([what, , , , , , holds], i) => assert.equal(out[i] === null, holds, `${what}: ${out[i]}`));
    // and the scan agrees with the checker on its own links
    // and the scan's own links here are ones the checker lets through
    const S = scanRepo(r.root, {}), mine = S.relations.filter(x => x.rel === 'call' && x.from.startsWith('main.py')).map(x => `${x.from.split('#')[1] || '(module)'} -> ${x.to.split('#')[1]} ${x.status}`).sort();
    assert.deepEqual(mine, ['(module) -> deco exact', 'C.m -> B.m exact', 'C.n -> C.m inferred', 'use -> A exact', 'use -> A.m inferred', 'use -> B.m inferred', 'use -> D exact', 'use -> wrapped inferred']);
  } finally { r.cleanup(); }
});

test('review2 data-op check: the resource is named by what the call uses, through assignments and imported constants', { skip }, () => {
  const r = repoWith({
    'config.py': 'BUCKET = "conf-bucket"\n',
    'app.py': 'import boto3\nfrom config import BUCKET\n\n\ndef run():\n    decoy = "decoy-bucket"\n    name = BUCKET\n    b = name\n    boto3.client("s3").get_object(Bucket=b, Key="k")\n    return decoy\n',
  });
  try {
    const S = scanRepo(r.root, {});
    assert.deepEqual(Object.keys(S.resources), ['s3:.:conf-bucket']);
    const B = buildRepo(autoMap(S), S), check = (tag) => { const page = path.join(r.dir, `${tag}.html`); writePage(B, tag, page); return spawnSync(process.execPath, [path.join(__dirname, 'check-page.mjs'), page], { encoding: 'utf8', timeout: 180e3 }); };
    const ok = check('ok');
    assert.equal(ok.status, 0, ok.stdout.slice(-2000));
    // the same data use, said to be the decoy that sits in the function but is never passed to the call
    const kids = B.ATLAS.modules.flatMap(m => m.parts.flatMap(p => p.children || []));
    kids.find(c => c.code && (c.code.db || []).some(d => d[4] === 'conf-bucket')).code.db.find(d => d[4] === 'conf-bucket')[4] = 'decoy-bucket';
    const bad = check('bad');
    assert.equal(bad.status, 1, bad.stdout.slice(-2000));
    assert.match(bad.stdout, /decoy-bucket is not what the operation is given \(conf-bucket\)/);
  } finally { r.cleanup(); }
});

test('review2 scan: super(B, self), replaced methods, rebound decorators, shadowed handles and untraced receivers are never exact, and every lost call is counted', { skip }, () => {
  const run = src => { const o = pyScan({ 'a.py': src }); return [o.relations.filter(x => x.rel === 'call').map(x => `${x.from.split('#')[1] || '(module)'} -> ${x.to.split('#').slice(1).join('#')} ${x.status}`).sort(), o.data.length, Object.fromEntries(Object.entries(o.unresolved).filter(([, v]) => v))]; };
  // super(B, self) in C(B) goes on after B: A.m
  assert.deepEqual(run('class A:\n    def m(self):\n        return 1\n\n\nclass B(A):\n    def m(self):\n        return 2\n\n\nclass C(B):\n    def run(self):\n        return super(B, self).m()\n')[0], ['C.run -> A.m exact']);
  // a method defined twice, or replaced in the class body: either, never exact to the first
  assert.deepEqual(run('class C:\n    def m(self):\n        return 1\n\n    def m(self):\n        return 2\n\n\ndef use():\n    return C().m()\n')[0], ['use -> C exact', 'use -> C.m ambiguous']);
  assert.deepEqual(run('class C:\n    def m(self):\n        return 1\n    m = lambda self: 2\n\n\ndef use():\n    return C().m()\n')[0], ['use -> C exact', 'use -> C.m ambiguous']);
  // typing rebound, or a parameter called typing: its final is no identity decorator
  assert.deepEqual(run('import typing\nimport other\ntyping = other\n\n\n@typing.final\ndef f():\n    return 1\n\n\ndef use():\n    return f()\n')[0], ['use -> f inferred']);
  assert.deepEqual(run('def outer(typing):\n    @typing.final\n    def f():\n        return 1\n    return f()\n')[0], ['outer -> outer.f inferred']);
  // super() to a method a custom decorator wraps
  assert.deepEqual(run('def deco(x):\n    return x\n\n\nclass A:\n    @deco\n    def m(self):\n        return 1\n\n\nclass B(A):\n    def m(self):\n        return super().m()\n')[0], ['A -> deco exact', 'B.m -> A.m inferred'], 'the decorator is called by the class body it is in');
  // a lambda's or a comprehension's own s3 is not the module's client; an unknown receiver of a query or a statement
  // is counted, never a use
  const [, n1, u1] = run('import boto3\ns3 = boto3.client("s3")\n\n\ndef run(xs):\n    f = lambda s3: s3.get_object(Bucket="ghost", Key="k")\n    return [s3.get_object(Bucket="ghost2", Key="k") for s3 in xs], f\n');
  assert.equal(n1, 0); assert.equal(u1['data-untraced'], 2);
  const [, n2, u2] = run('import sqlalchemy\nfrom sqlalchemy.orm import DeclarativeBase\n\n\nclass Base(DeclarativeBase):\n    pass\n\n\nclass Real(Base):\n    __tablename__ = "real"\n\n\ndef run(other):\n    other.execute(sqlalchemy.text("DELETE FROM ghost"))\n    return other.query(Real)\n');
  assert.equal(n2, 0); assert.equal(u2['data-untraced'], 2);
  // a method on a value of unknown type, and one a repo class does not have: counted
  const [c3, , u3] = run('class C:\n    def m(self):\n        return 1\n\n\ndef run(obj):\n    obj.work()\n    return C().missing()\n');
  assert.deepEqual(c3, ['run -> C exact']); assert.deepEqual(u3, { 'call-member': 1, 'call-dynamic': 1 });
});

/* ---------- the third review ---------- */

test('review3 scan: a shadowed super, a value-only attribute in a subclass base, a custom .setter, a replaced with-handle and a lambda-shadowed name', { skip }, () => {
  const run = src => { const o = pyScan({ 'a.py': src }); return [o.relations.filter(x => x.rel === 'call').map(x => `${x.from.split('#')[1] || '(module)'} -> ${x.to.split('#').slice(1).join('#')} ${x.status}`).sort(), o.data.map(d => `${d.store} ${d.name[0] === 'literal' ? d.name[1] : d.name[0]} ${d.op}`), Object.fromEntries(Object.entries(o.unresolved).filter(([, v]) => v))]; };
  // `lambda super: super().m()`: that super is the lambda's
  assert.deepEqual(run('class A:\n    def m(self):\n        pass\n\n\nclass B(A):\n    def run(self):\n        return lambda super: super().m()\n')[0], []);
  // C(B, X) where X sets m = lambda: super().m() in B may reach X's value, so A.m is not exact
  assert.deepEqual(run('class A:\n    def m(self):\n        pass\n\n\nclass B(A):\n    def run(self):\n        return super().m()\n\n\nclass X(A):\n    m = lambda self: None\n\n\nclass C(B, X):\n    pass\n')[0], ['B.run -> A.m inferred']);
  // c.setter on an instance of a repo class is no property's setter; a real property's setter is no call to count
  assert.deepEqual(run('class C:\n    def setter(self, f):\n        return lambda: None\n\n\nc = C()\n\n\n@c.setter\ndef f():\n    pass\n\n\nf()\n')[0], ['(module) -> C exact', '(module) -> C.setter inferred', '(module) -> f inferred']);
  assert.deepEqual(run('class P:\n    @property\n    def x(self):\n        return 1\n\n    @x.setter\n    def x(self, v):\n        pass\n')[2], {});
  // a second `with … as s` replaces the session the first gave
  const [, d1, u1] = run('from sqlalchemy.orm import Session\nfrom sqlalchemy import text\n\n\ndef run(other):\n    with Session() as s:\n        pass\n    with other() as s:\n        s.execute(text("DELETE FROM ghost"))\n');
  assert.deepEqual(d1, []); assert.equal(u1['data-untraced'], 1);
  // a lambda's own BUCKET is not the module's
  const [, d2, u2] = run('import boto3\ns3 = boto3.client("s3")\nBUCKET = "real"\nf = lambda BUCKET: s3.get_object(Bucket=BUCKET, Key="k")\n');
  assert.deepEqual(d2, ['s3 unknown read']); assert.equal(u2['data-unknown-name'], 1);
  // super().missing(): counted
  assert.deepEqual(run('class A:\n    pass\n\n\nclass B(A):\n    def run(self):\n        super().missing()\n')[2], { 'call-member': 1 });
});

test('review3 SQL: a table function\'s arguments are no tables; a quoted name starts a join in parentheses', { skip }, () => {
  const tables = s => data(pyScan({ 'a.py': `import sqlite3\ndef run():\n    sqlite3.connect("a").execute(${JSON.stringify(s)})\n` })).map(x => x.split(' ').slice(2).join(' '));
  assert.deepEqual(tables('SELECT * FROM src, json_each(src.payload)'), ['src read']);
  assert.deepEqual(tables('SELECT * FROM ("order items" JOIN b ON true)'), ['b read', 'order items read']);
  assert.deepEqual(tables('SELECT * FROM (VALUES (1), (2)) v, (SELECT * FROM inner1) s'), ['inner1 read']);
});

test('review3 handlers: a handler name its module binds twice is the last binding, ambiguous', { skip }, () => {
  const S = scanOf({ 'serverless.yml': sls('  f:\n    handler: app.run\n  g:\n    handler: other.run\n'), 'app.py': 'def run(e, c):\n    return 1\n\n\ndef run(e, c):\n    return 2\n', 'other.py': 'def run(e, c):\n    return 1\n\n\nrun = lambda e, c: 2\n' });
  assert.deepEqual(S.entries.filter(e => e.kind === 'lambda').map(e => `${e.name} ${e.handler} ${e.status}`).sort(), ['f app.py#run#2 ambiguous', 'g other.py#run#2 ambiguous']);
});

test('review3 manifests: a tagged root flow collection is read, and each key keeps its own line', () => {
  const M = require('../lib/repo/scan/manifests');
  assert.deepEqual(M.readServerless('!!map {service: s, functions: {f: {handler: app.run}}}').functions.map(f => f.name), ['f']);
  const t = '{\n  service: s,\n  functions: {\n    f: {handler: app.run},\n    run: {handler: app.next},\n    "q": {"handler": "app.q"}\n  }\n}\n';
  assert.deepEqual(M.readServerless(t).functions.map(f => [f.name, f.line, f.handler.line]), [['f', 4, 4], ['run', 5, 5], ['q', 6, 6]]);
});

test('review3 checker: classes are told apart by file, identity decorators by import, and data uses by what the operation is given', { skip }, () => {
  const r = repoWith({
    'a.py': 'class A:\n    def m(self):\n        return 1\n\n\ndef use():\n    return A().m()\n',
    'b.py': 'class A:\n    def m(self):\n        return 2\n',
    'c.py': 'def final(f):\n    return lambda: None\n\n\n@final\ndef g():\n    pass\n\n\ng()\n',
    'd.py': 'from typing import final\n\n\n@final\ndef h():\n    pass\n\n\nh()\n',
    'e.py': 'import boto3\n\n\ndef run():\n    b = "real-bucket"\n    boto3.client("s3").get_object(Bucket=b, Key="key-name")\n    b = "wrong-bucket"\n',
    'conf.py': 'import os\nBUCKET = os.getenv("DEFS_BUCKET")\n',
    'g.py': 'import boto3\nfrom conf import BUCKET\ns3 = boto3.resource("s3")\n\n\ndef get(key, path):\n    s3.Bucket(BUCKET).download_file(key, path)\n',
  });
  try {
    const checks = [
      ['A().m to a.py\'s A', { file: 'a.py', line: 7, col: 16, name: 'm', target: ['a.py', 2, 3], status: 'exact' }, true],
      ['A().m to b.py\'s A of the same name', { file: 'a.py', line: 7, col: 16, name: 'm', target: ['b.py', 2, 3], status: 'exact' }, false],
      ['a custom final, exact', { file: 'c.py', line: 10, col: 1, name: 'g', target: ['c.py', 5, 7], status: 'exact' }, false],
      ['typing.final, exact', { file: 'd.py', line: 9, col: 1, name: 'h', target: ['d.py', 4, 6], status: 'exact' }, true],
      ['the bucket given', { kind: 'data', file: 'e.py', line: 6, store: 's3', raw: 'real-bucket', envs: [] }, true],
      ['a bucket assigned after the call', { kind: 'data', file: 'e.py', line: 6, store: 's3', raw: 'wrong-bucket', envs: [] }, false],
      ['the key, not the bucket', { kind: 'data', file: 'e.py', line: 6, store: 's3', raw: 'key-name', envs: [] }, false],
      ['a Bucket object names it; download_file\'s first argument is then the key', { kind: 'data', file: 'g.py', line: 7, store: 's3', raw: '$DEFS_BUCKET', envs: [] }, true],
      ['… so the key is no bucket there either', { kind: 'data', file: 'g.py', line: 7, store: 's3', raw: 'key', envs: [] }, false],
    ];
    const out = JSON.parse(spawnSync('python3', ['-I', '-B', PYCALL], { input: JSON.stringify({ root: r.root, checks: checks.map(c => c[1]) }), encoding: 'utf8' }).stdout);
    checks.forEach(([what, , holds], i) => assert.equal(out[i] === null, holds, `${what}: ${out[i]}`));
  } finally { r.cleanup(); }
});

/* ---------- the fourth review ---------- */

test('review4 handlers: a handler name an import, a del or a later star import rebinds is ambiguous', { skip }, () => {
  const S = scanOf({ 'serverless.yml': sls('  a:\n    handler: imp.run\n  b:\n    handler: dl.run\n  c:\n    handler: ok.run\n  d:\n    handler: star.run\n'),
    'imp.py': 'def run(e, c):\n    return 1\n\n\nfrom other import run\n', 'dl.py': 'def run(e, c):\n    return 1\n\n\ndel run\n',
    'ok.py': 'from x import *\n\n\ndef run(e, c):\n    return 1\n', 'star.py': 'def run(e, c):\n    return 1\n\n\nfrom x import *\n', 'other.py': 'def run(e, c):\n    return 2\n' });
  assert.deepEqual(S.entries.filter(e => e.kind === 'lambda').map(e => `${e.name} ${e.status}`).sort(), ['a ambiguous', 'b ambiguous', 'c exact', 'd ambiguous']);
});

test('review4 checker: values that no longer hold, lambda scope, SQL columns and strings, untraced receivers and a shadowed super are refused', { skip }, () => {
  const r = repoWith({
    'h.py': 'import boto3\ns3 = boto3.client("s3")\nBUCKET = "decoy"\n\n\ndef run():\n    b = "old"\n    b = "real"\n    s3.get_object(Bucket=b, Key="k")\n    f = lambda BUCKET: s3.get_object(Bucket=BUCKET, Key="k")\n    if b:\n        b = "maybe"\n    s3.get_object(Bucket=b, Key="k")\n    return f\n',
    'q.py': 'import sqlite3\n\n\ndef run():\n    c = sqlite3.connect("a")\n    c.execute("SELECT ghost FROM real")\n    c.execute("SELECT \'ghost\' FROM real, other o")\n',
    'x.py': 'class X:\n    def get_object(self, **kw):\n        return None\n\n\ndef run():\n    X().get_object(Bucket="ghost")\n',
    's.py': 'class A:\n    def m(self):\n        return 1\n\n\nclass B(A):\n    def run(self):\n        return lambda super: super().m()\n',
  });
  try {
    const d = (file, line, store, raw) => ({ kind: 'data', file, line, store, raw, envs: [] });
    const checks = [
      ['the bucket that holds', d('h.py', 9, 's3', 'real'), true],
      ['a bucket assigned before, then replaced', d('h.py', 9, 's3', 'old'), false],
      ['a module constant a lambda parameter hides', d('h.py', 10, 's3', 'decoy'), false],
      ['after a branch: the value before it', d('h.py', 13, 's3', 'real'), true],
      ['after a branch: the value in it', d('h.py', 13, 's3', 'maybe'), true],
      ['a SQL table', d('q.py', 6, 'sql', 'real'), true],
      ['a SQL column', d('q.py', 6, 'sql', 'ghost'), false],
      ['a SQL string', d('q.py', 7, 'sql', 'ghost'), false],
      ['a second table of a FROM list', d('q.py', 7, 'sql', 'other'), true],
      ['get_object on a class of the repo', d('x.py', 7, 's3', 'ghost'), false],
      ['super a lambda binds', { file: 's.py', line: 8, col: 37, name: 'm', target: ['s.py', 2, 3], status: 'exact' }, false],
    ];
    const out = JSON.parse(spawnSync('python3', ['-I', '-B', PYCALL], { input: JSON.stringify({ root: r.root, checks: checks.map(c => c[1]) }), encoding: 'utf8' }).stdout);
    checks.forEach(([what, , holds], i) => assert.equal(out[i] === null, holds, `${what}: ${out[i]}`));
  } finally { r.cleanup(); }
});

test('review4 manifests: a key inside a quoted value is no key', () => {
  const M = require('../lib/repo/scan/manifests');
  const t = '{\n  service: s,\n  functions: {\n    f: {handler: app.run, description: "x run: y"},\n    g: {handler: app.g},\n    run: {handler: app.next}\n  }\n}\n';
  assert.deepEqual(M.readServerless(t).functions.map(f => [f.name, f.line]), [['f', 4], ['g', 5], ['run', 6]]);
});
