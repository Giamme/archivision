'use strict';
// Git: commit, remote, branches, and the branch comparisons the page can switch between. Each changed file is
// read by the adapter that owns it. A changed or added symbol is named at the head; a deleted one at the base.

function gitSection(git, ARGS, adapters) {
  const sha = git('rev-parse', 'HEAD'), branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  let remote = ''; try { remote = git('remote', 'get-url', 'origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/'); } catch {}
  let pushed = false; try { pushed = !!git('branch', '-r', '--contains', sha); } catch {}
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
  const strip = r => r.replace(/^[^/]+\//, m => /^(origin|upstream)\/$/.test(m) ? '' : m);
  // every branch, newest first; a local branch and its remote copy count once (the newer one)
  const REFS = [], seenR = new Map();
  for (const l of git('for-each-ref', '--sort=-committerdate', '--format=%(refname)%09%(refname:short)%09%(committerdate:unix)%09%(objectname)', 'refs/heads', 'refs/remotes').split('\n').filter(Boolean)) {
    const [full, name, t, obj] = l.split('\t');
    if (/\/HEAD$/.test(full)) continue;
    const key = strip(name), r = { name, label: key, t: +t, sha: obj, remote: full.startsWith('refs/remotes/') };
    if (key === branch && !r.remote) r.current = true;
    const o = seenR.get(key); if (o && o.t >= r.t && !r.current) continue;
    if (o) REFS.splice(REFS.indexOf(o), 1);
    seenR.set(key, r); REFS.push(r);
  }
  const want = (ARGS.bases || 'dev,main,master').split(',').map(s => s.trim()).filter(Boolean);
  const BASES = want.map(b => REFS.find(r => r.label === strip(b) || r.name === b)).filter(Boolean);
  const now = Date.now() / 1000, since = +(ARGS.since || 60), maxH = +(ARGS.max || 24);
  const HEADS = REFS.filter(r => r.current || BASES.includes(r) || now - r.t <= since * 86400).sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.t - a.t).slice(0, maxH);

  const owner = p => adapters.find(a => a.owns(p)) || null;
  const BLOB = {};
  const read = keys => Object.assign(BLOB, git.blobs(keys.filter(k => !(k in BLOB))));
  const uniq = a => [...new Set(a)];
  function compare(base, head) {
    let mb; try { mb = git('merge-base', base.sha, head.sha); } catch { return null; }
    try { return full(base, head, mb); }
    catch {
      // objects git may not read (a partial clone): the changed files alone, from the trees
      let files; try { files = git('diff', '--name-status', '--no-renames', mb, head.sha).split('\n').filter(Boolean).map(l => { const [s, p] = l.split('\t'); return [p, s[0]]; }); } catch { return null; }
      return { ...counts(base, head, mb), files, syms: {}, models: [], changed: [], incomplete: 'file contents missing (a partial clone?): changed files only' };
    }
  }
  const count = r => { try { return +git('rev-list', '--count', r); } catch { return 0; } };
  const counts = (base, head, mb) => ({ base: base.name, head: head.name, baseLabel: base.label, headLabel: head.label, baseSha: base.sha, headSha: head.sha, mb,
    ahead: count(`${mb}..${head.sha}`), behind: count(`${mb}..${base.sha}`), t: head.t });
  function full(base, head, mb) {
    // [path at head, status, path at base]
    const files = git('diff', '--name-status', '-M', mb, head.sha).split('\n').filter(Boolean).map(l => { const [s, ...p] = l.split('\t'); return [p[p.length - 1], s[0], p[0]]; });
    // file headers only count between `diff --git` and the first hunk, so a changed line that starts with
    // "++ " or "-- " is never taken for one
    const hunks = {}, gone = {}; let cur = null, old = null, header = false;
    for (const ln of git('diff', '-U0', '--no-color', '-M', mb, head.sha).split('\n')) {
      if (ln.startsWith('diff --git ')) { header = true; cur = old = null; }
      else if (header && ln.startsWith('--- ')) old = ln === '--- /dev/null' ? null : ln.slice(6);
      else if (header && ln.startsWith('+++ ')) { cur = ln === '+++ /dev/null' ? null : ln.slice(6); if (cur) hunks[cur] = []; if (old) gone[old] = gone[old] || []; }
      else if (ln.startsWith('@@')) {
        header = false;
        const m = ln.match(/-(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))?/);
        if (cur) { const s0 = +m[3], n = m[4] === undefined ? 1 : +m[4]; hunks[cur].push([Math.max(1, s0), Math.max(1, s0 + Math.max(n, 1) - 1)]); }
        if (old) { const s0 = +m[1], n = m[2] === undefined ? 1 : +m[2]; if (n > 0) gone[old].push([s0, s0 + n - 1]); }
      }
    }
    // which top-level declarations changed, read from the head's own version of each file
    read(files.filter(([p, s]) => s !== 'D' && owner(p)).map(([p]) => `${head.sha}:${p}`));
    const syms = {}, changed = []; let models = [];
    for (const [p, s] of files) {
      const text = BLOB[`${head.sha}:${p}`]; if (text == null) continue;
      const a = owner(p), H = hunks[p] || [], hit = (x, y) => s === 'A' || H.some(([u, v]) => u <= y && v >= x);
      let R; try { R = a.ranges(p, text).filter(([, x, y]) => hit(x, y)); } catch { continue; }
      for (const id of uniq(R.map(x => x[3]))) changed.push({ id, at: 'head' });
      if (a.name === 'prisma') { models = uniq([...models, ...R.map(m => m[3])]); continue; }   // resource ids: two packages' User stay two
      const n = uniq(R.map(x => x[0])); if (n.length) syms[p] = n;
    }
    // declarations the head no longer has, read from the base's version
    read(files.filter(([, s, bp]) => s !== 'A' && owner(bp)).map(([, , bp]) => `${mb}:${bp}`));
    for (const [p, s, bp] of files) {
      const text = BLOB[`${mb}:${bp}`]; if (text == null || s === 'A') continue;
      const a = owner(bp), G = gone[bp] || [], hit = (x, y) => s === 'D' || G.some(([u, v]) => u <= y && v >= x);
      let before, after = new Set();
      try { before = a.ranges(bp, text).filter(([, x, y]) => hit(x, y)); } catch { continue; }
      const now = s === 'D' ? null : BLOB[`${head.sha}:${p}`];
      if (now != null) try { after = new Set(a.ranges(p, now).map(x => x[4])); } catch {}
      for (const id of uniq(before.filter(x => !after.has(x[4])).map(x => x[3]))) changed.push({ id, at: 'base' });
    }
    return { ...counts(base, head, mb), files: files.map(([p, s]) => [p, s]), syms, models, changed };
  }
  const COMPARE = [];
  for (const h of HEADS) for (const b of BASES) if (b !== h) { const c = compare(b, h); if (c) COMPARE.push(c); }
  if (ARGS.compare) for (const pair of String(ARGS.compare).split(',')) {   // extra pairs: base..head
    const [b, h] = pair.split('..').map(x => REFS.find(r => r.name === x || r.label === strip(x)));
    if (b && h && !COMPARE.some(c => c.base === b.name && c.head === h.name)) { const c = compare(b, h); if (c) COMPARE.push(c); }
  }
  return { sha, branch, remote, pushed, dirty, REFS, BASES, HEADS, COMPARE };
}

module.exports = { gitSection };
