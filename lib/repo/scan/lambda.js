'use strict';
// Lambda handlers and their triggers, from the deployment manifests discovery read, matched to the symbols the code
// adapters found. Each handler is
//   configured: a manifest names it (`handler: dir/module.function`, a SAM Handler under its CodeUri, the CMD of a
//               local Docker image) and the function exists: exact;
//   unresolved: a manifest names it but it cannot be found (a remote image, an image or handler chosen by a variable,
//               a JavaScript `dist` build, a file that is not there);
//   conventional: no manifest names it, but a module-level `lambda_handler(event, context)` or `handler(event, context)`
//               looks like one: inferred.
// Every function gives a `lambda` entry, and each of its events one more: HTTP events are routes, schedules jobs,
// S3, SQS and the rest events; each carries the name the deployment gives the function (`name`). No call between a
// trigger and code is invented. What a manifest's reader could not follow is
// counted by reason (`manifest`), and every function found gives a deployment: its handler and the environment it
// runs with (the provider's, then its own over it), for naming resources by environment variables.
const posix = require('path').posix;
const NAME = 'serverless';
const EXT = { py: ['.py'], node: ['.js', '.mjs', '.cjs', '.ts'], any: ['.py', '.js', '.mjs', '.cjs', '.ts'] };

function lambdaEntries(manifests, files, symbols, conventional, rebound = {}) {
  const byFile = new Map();
  for (const s of symbols) if (!s.member) { if (!byFile.has(s.file)) byFile.set(s.file, []); byFile.get(s.file).push(s); }
  const entries = [], counts = { configured: 0, unresolved: 0, conventional: 0 }, why = {}, handlers = new Map(), manifest = {}, deploys = [];
  const miss = w => { counts.unresolved++; why[w] = (why[w] || 0) + 1; };
  // `dir/module.function` (or module.sub.function) from a folder: the symbol, or why there is none; the dots of the
  // module's own name are folders, never a ./ or ../ of its path
  const find = (dir, value, runtime) => {
    if (!value || /\$\{/.test(value)) return { why: 'a handler chosen by a variable' };
    const i = value.lastIndexOf('.'); if (i < 1) return { why: 'not module.function' };
    const mod = value.slice(0, i), fn = value.slice(i + 1), exts = /^python/.test(runtime || '') ? EXT.py : /^node/.test(runtime || '') ? EXT.node : EXT.any;
    const dotted = mod.split('/').map(x => (x === '.' || x === '..' ? x : x.replace(/\./g, '/'))).join('/');
    for (const m of [...new Set([mod, dotted])]) for (const e of exts) {
      const f = posix.normalize(posix.join(dir === '.' ? '' : dir, m + e));
      if (!files[f]) continue;
      // a name its module binds more than once (a second def, an assignment, an import, a del, one under a
      // condition, a star import after it): the last of its symbols, ambiguous
      const all = (byFile.get(f) || []).filter(x => x.name === fn).sort((a, b) => a.line - b.line);
      const again = all.length > 1 || (rebound[f] || []).includes(fn);
      return all.length ? { sym: all[all.length - 1], status: again ? 'ambiguous' : 'exact' } : { why: 'no such function in its file', file: f };
    }
    return { why: /(^|\/)dist\//.test(mod) ? 'a build output that is not in the repo' : 'no such file' };
  };
  const mark = (s, variant, route) => { if (!handlers.has(s.id)) handlers.set(s.id, { variant, route }); };
  const dockerAt = new Map((manifests || []).filter(m => m.kind === 'docker').map(m => [m.file, m])), usedDocker = new Set();

  for (const m of manifests || []) {
    if (m.kind !== 'serverless' && m.kind !== 'sam') continue;
    for (const p of m.data.problems || []) manifest[p.why] = (manifest[p.why] || 0) + 1;
    m.data.functions.forEach(fn => {
      let hit = null, line = fn.line;
      const home = fn.handler && fn.handler.dir ? posix.join(m.dir === '.' ? '' : m.dir, fn.handler.dir) || '.' : m.dir;
      if (fn.handler && fn.handler.why) { hit = { why: fn.handler.why }; line = fn.handler.line; }
      else if (fn.handler) { hit = find(home, fn.handler.value, fn.runtime); line = fn.handler.line; }
      else if (fn.image) {
        line = fn.image.line;
        const local = fn.image.path ? posix.normalize(posix.join(m.dir === '.' ? '' : m.dir, fn.image.path)) : null, d = local && dockerAt.get(posix.join(local, fn.image.file || 'Dockerfile'));
        if (d) usedDocker.add(d.file);
        hit = d && d.data.handler ? find(local, d.data.handler.value, d.data.python ? 'python' : '') : d ? { why: 'an image whose CMD names no handler' } : local ? { why: 'no Dockerfile at its path' } : { why: /\$\{/.test(fn.image.uri || '') ? 'an image chosen by a variable' : 'a remote image' };
      } else hit = { why: 'no handler or image' };
      const s = hit.sym || null, at = fn.file || m.file;
      if (s) { counts.configured++; mark(s, NAME, fn.name); } else miss(hit.why);
      // the environment it runs with: the provider's, its own over it (a SAM function's already holds Globals')
      const env = {}; for (const [k, v] of Object.entries(m.kind === 'sam' ? fn.environment : { ...m.data.environment, ...fn.environment })) env[k] = { ...v, file: v.file || m.file };
      if (s) deploys.push({ handler: s.id, name: fn.name, manifest: m.file, env });
      const base = { variant: m.kind === 'sam' ? 'sam' : NAME, handler: s ? s.id : null, prov: m.kind === 'sam' ? 'sam' : NAME, status: s ? hit.status : 'unresolved' };
      const live = fn.events.filter(e => !e.disabled);
      entries.push({ id: `${m.kind}:${m.file}:${fn.name}`, kind: 'lambda', name: fn.name, ...base, route: null, method: null, trigger: live.map(e => e.text).join(', ') || fn.name, evidence: { file: at, line } });
      live.forEach((e, i) => {
        const http = e.type === 'http' || e.type === 'httpApi';
        entries.push({ id: `${m.kind}:${m.file}:${fn.name}:${i + 1}`, kind: http ? 'route' : e.type === 'schedule' ? 'job' : 'event', name: fn.name, ...base,
          route: http ? e.path || '*' : null, method: http ? e.method || 'ANY' : null, trigger: e.text, evidence: { file: at, line: e.line } });
      });
    });
  }
  // a Docker image whose CMD names module.function next to its Dockerfile, and that no function above deploys: a
  // handler, a record of its own
  for (const m of manifests || []) {
    if (m.kind !== 'docker' || !m.data.handler || usedDocker.has(m.file)) continue;
    const hit = find(m.dir, m.data.handler.value, m.data.python ? 'python' : ''), s = hit.sym || null;
    if (!s && hit.why === 'no such file' && !m.data.python) continue;   // a CMD that is no handler of this repo's code
    const nm = m.dir === '.' ? 'image' : m.dir.split('/').pop();
    if (s) { counts.configured++; mark(s, 'docker', nm); } else miss(hit.why);
    entries.push({ id: `docker:${m.file}`, kind: 'lambda', name: nm, variant: 'docker', route: null, method: null, handler: s ? s.id : null, trigger: `image CMD ${m.data.handler.value}`, evidence: { file: m.file, line: m.data.handler.line }, prov: 'docker', status: s ? hit.status : 'unresolved' });
  }
  // by convention: a handler-shaped function no manifest names
  for (const c of conventional || []) {
    if (handlers.has(c.symbol) || !files[c.file] || files[c.file].test) continue;
    counts.conventional++; mark({ id: c.symbol }, 'convention', c.symbol.split('#').pop());
    entries.push({ id: `convention:${c.symbol}`, kind: 'lambda', variant: 'convention', route: null, method: null, handler: c.symbol, trigger: 'a handler by its name and parameters', evidence: { file: c.file, line: c.line }, prov: 'ast', status: 'inferred' });
  }
  return { entries, handlers, counts, why, manifest, deploys };
}

module.exports = { lambdaEntries };
