'use strict';
// Code roots are folders given relative to the repo root, with '.' for the repo itself. A file belongs to the
// most specific root that holds it, so a package inside a root that covers the whole repo keeps its own files.

const depthOf = r => (r === '.' ? 0 : r.split('/').length);
// whether a repo path is inside a root
const under = (root, p) => (root === '.' ? !p.startsWith('../') && p !== '..' : p.startsWith(root + '/'));
// the most specific root holding a path, or null
function rootOf(roots, p) {
  let best = null;
  for (const r of roots) if (under(r, p) && (best === null || depthOf(r) > depthOf(best))) best = r;
  return best;
}
// a path inside its root, and a folder joined to a root
const inRoot = (root, p) => (root === '.' ? p : p.slice(root.length + 1));
const join = (root, x) => (root === '.' ? x : `${root}/${x}`);

module.exports = { depthOf, under, rootOf, inRoot, join };
