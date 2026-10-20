'use strict';
// The update check: it compares versions as numbers, stays quiet (and asks nothing) when it is turned off, in CI or when
// stderr is not a terminal, and any failure or a slow registry means no notice. No test here touches the network.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('path');
const { isNewer, updateCommand, fetchLatest, startUpdateCheck, LATEST } = require('../lib/update-check');

test('update check: a version is newer only when it is a higher release', () => {
  for (const [latest, current, newer, what] of [
    ['0.6.0', '0.5.0', true, 'minor'],
    ['0.10.0', '0.9.0', true, 'compared as numbers, not text'],
    ['1.0.0', '0.9.9', true, 'major'],
    ['0.5.1', '0.5.0', true, 'patch'],
    ['0.5', '0.5.0', false, 'the same version written two ways'],
    ['0.5.0', '0.5.0', false, 'equal'],
    ['0.4.0', '0.5.0', false, 'older'],
    ['0.6.0-beta.1', '0.5.0', false, 'a pre-release is not offered'],
    ['latest', '0.5.0', false, 'not a version'],
    [undefined, '0.5.0', false, 'missing'],
  ]) assert.equal(isNewer(latest, current), newer, what);
});

// a lookup that answers with `version` and records that it was asked
const answering = version => { const l = () => { l.calls++; return { version: Promise.resolve(version), stop() { l.stopped = true; } }; }; l.calls = 0; return l; };
const ON = { current: '0.5.0', isTTY: true, env: {}, flag: false, command: () => 'npm i -g archivision@latest' };

test('update check: a newer release gives a notice with both versions and the update command', async () => {
  const lookup = answering('0.6.0');
  const note = await startUpdateCheck({ ...ON, lookup }).finish();
  assert.match(note, /0\.5\.0/);
  assert.match(note, /0\.6\.0/);
  assert.ok(note.includes('npm i -g archivision@latest'));
  assert.equal(lookup.stopped, true, 'the lookup is stopped once answered');
  assert.equal(await startUpdateCheck({ ...ON, lookup: answering('0.5.0') }).finish(), null, 'no notice when up to date');
});

test('update check: off by flag, by ARCHIVISION_NO_UPDATE_CHECK, in CI and when stderr is not a terminal, without asking', async () => {
  for (const [change, what] of [
    [{ flag: true }, '--no-update-check'],
    [{ env: { ARCHIVISION_NO_UPDATE_CHECK: '1' } }, 'ARCHIVISION_NO_UPDATE_CHECK=1'],
    [{ env: { CI: 'true' } }, 'CI'],
    [{ isTTY: false }, 'stderr piped'],
    [{ isTTY: undefined }, 'stderr not a TTY stream'],
  ]) {
    const lookup = answering('0.6.0');
    assert.equal(await startUpdateCheck({ ...ON, ...change, lookup }).finish(), null, what);
    assert.equal(lookup.calls, 0, `${what}: no request`);
  }
});

test('update check: an error or a registry slower than the timeout means no notice, on time', async () => {
  assert.equal(await startUpdateCheck({ ...ON, lookup: () => ({ version: Promise.reject(new Error('offline')), stop() {} }) }).finish(), null, 'rejected');
  assert.equal(await startUpdateCheck({ ...ON, lookup: () => { throw new Error('no workers'); } }).finish(), null, 'lookup throws');
  let stopped = false;
  const t0 = Date.now();
  const note = await startUpdateCheck({ ...ON, timeoutMs: 50, graceMs: 0, lookup: () => ({ version: new Promise(() => {}), stop() { stopped = true; } }) }).finish();
  assert.equal(note, null);
  assert.ok(Date.now() - t0 < 1000, 'finish does not wait past the timeout');
  assert.equal(stopped, true, 'a hanging lookup is stopped');
});

test('update check: reads the version from the npm registry reply, and nothing from a bad one', async () => {
  const reply = (ok, body) => async url => { assert.equal(url, LATEST); return { ok, json: async () => body }; };
  assert.equal(LATEST, 'https://registry.npmjs.org/archivision/latest');
  assert.equal(await fetchLatest(reply(true, { version: '0.6.0' })), '0.6.0');
  assert.equal(await fetchLatest(reply(false, { version: '0.6.0' })), null, 'HTTP error');
  assert.equal(await fetchLatest(reply(true, { version: '<b>' })), null, 'not a version');
  assert.equal(await fetchLatest(async () => { throw new Error('ENOTFOUND'); }), null, 'offline');
});

test('update check: the command matches how archivision was installed', () => {
  const root = path.join('/home', 'me', 'archivision');
  assert.match(updateCommand(root, p => p === path.join(root, '.git')), /git -C ".*archivision" pull/, 'a git clone pulls');
  assert.equal(updateCommand('/home/me/.npm/_npx/1a2b/node_modules/archivision', () => false), 'npx archivision@latest …', 'npx');
  assert.equal(updateCommand('/usr/lib/node_modules/archivision', () => false), 'npm i -g archivision@latest', 'npm -g');
});
