'use strict';
// Next.js App Router: which files are routes, of which kind, at which URL; the middleware file; and the entry
// points those give (pages, layouts, route handlers per HTTP method, server actions, middleware).
const NAME = 'next-app', VERSION = '1';
const HTTP = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
const KINDS = 'page|layout|route|loading|error|not-found|template|default';

// appDirs: the app folders (app/ in each code root); codeRoots: where middleware may sit
function nextAdapter(appDirs, codeRoots) {
  const apps = appDirs.map(a => `${a}/`);
  const re = apps.length ? new RegExp(`^(${apps.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(.*?)(?:^|/)?(${KINDS})\\.(tsx?|jsx?|mjs)$`) : /$^/;
  // the URL and the kind of a route file, or null
  const routeOf = r => {
    const m = r.match(re); if (!m) return null;
    const segs = m[2].split('/').filter(Boolean).filter(s => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
    return { path: '/' + segs.join('/'), kind: m[3] };
  };
  const isMiddleware = r => codeRoots.some(root => new RegExp(`^${root === '.' ? '' : root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'}middleware\\.(ts|js|mjs)$`).test(r));
  // the app folder a file is in, route file or not (its helpers group with its routes)
  const appDirOf = r => { const a = apps.find(x => r.startsWith(x)); return a ? a.slice(0, -1) : null; };
  // entries from the files and symbols the TypeScript adapter read
  function entries(files, symbols) {
    const out = [], byFile = {};
    for (const s of symbols) if (!s.member) (byFile[s.file] = byFile[s.file] || []).push(s);
    for (const [f, F] of Object.entries(files)) {
      const syms = byFile[f] || [], ev = (s, line) => ({ file: f, line: s ? s.line : line || 1 });
      const firstOf = kind => syms.filter((x, i) => x.kind === kind && syms.findIndex(y => y.kind === kind && y.name === x.name) === i);   // overloads: one entry
      if (F.entry && (F.entry.kind === 'page' || F.entry.kind === 'layout')) {
        const s = syms.find(x => x.kind === F.entry.kind) || null;
        out.push({ id: `${NAME}:${F.entry.kind}:${f}`, kind: F.entry.kind, variant: NAME, route: F.entry.route, method: null, handler: s ? s.id : null, evidence: ev(s), prov: NAME, status: s ? 'exact' : 'unresolved' });
      }
      if (F.entry && F.entry.kind === 'route') for (const s of firstOf('handler'))
        out.push({ id: `${NAME}:route:${s.name}:${f}`, kind: 'route', variant: NAME, route: F.entry.route, method: s.name, handler: s.id, evidence: ev(s), prov: NAME, status: 'exact' });
      if (F.flags.server) for (const s of firstOf('action'))
        out.push({ id: `${NAME}:action:${s.id}`, kind: 'action', variant: NAME, route: null, method: null, handler: s.id, evidence: ev(s), prov: NAME, status: 'exact' });
      if (F.flags.middleware) {
        const s = syms.find(x => x.name === 'middleware' || x.name === 'default') || null;
        out.push({ id: `${NAME}:middleware:${f}`, kind: 'middleware', variant: NAME, route: null, method: null, handler: s ? s.id : f, evidence: ev(s), prov: NAME, status: s ? 'exact' : 'unresolved' });
      }
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return { name: NAME, version: VERSION, routeOf, appDirOf, isMiddleware, HTTP, entries };
}

module.exports = { nextAdapter };
