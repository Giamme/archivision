'use strict';
// One self-contained HTML page: the iso-glow 3D shell, the archivision figure module and the data.
// The page loads three.js from a CDN the first time it opens; everything else is inline.
const fs = require('fs'), path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const dump = o => JSON.stringify(o).replace(/<\//g, '<\\/').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// the licences of what every page carries (archivision's own code and the iso-glow shell), as a comment in its head
const NOTICE = () => {
  const read = f => fs.readFileSync(f, 'utf8').trim().replace(/--/g, '- -');
  return `<!--\narchivision, https://github.com/Giamme/archivision\n\n${read(path.join(__dirname, '..', 'LICENSE'))}\n\n`
    + `The 3D shell is iso-glow:\n\n${read(path.join(ASSETS, 'ISO-GLOW-LICENSE'))}\n\n`
    + 'three.js 0.160.0 (MIT, Copyright (c) 2010-2023 three.js authors) is loaded from cdn.jsdelivr.net.\n-->';
};

function renderPage({ ATLAS, SCENE }, title) {
  const js = fs.readFileSync(path.join(ASSETS, 'figure.js'), 'utf8')
    .replace('__ATLAS__', () => dump(ATLAS)).replace('__SCENE__', () => dump(SCENE)).replace("'__NAME__'", () => dump(String(title)));   // a JSON string: quotes, newlines, </script> and U+2028 are all safe
  let shell = fs.readFileSync(path.join(ASSETS, 'shell-3d.html'), 'utf8');
  for (const [a, r] of [['<title>Iso 3D</title>', `<title>${escHtml(title)}</title>\n${NOTICE()}`], ['<i></i>Iso 3D</div>', `<i></i>${escHtml(title)}</div>`], ['/* paste 3D figure modules here */', js]]) {
    if (!shell.includes(a)) throw new Error(`assets/shell-3d.html changed: «${a}» not found`);
    shell = shell.replace(a, () => r);
  }
  return shell;
}

function writePage(data, title, out) {
  const html = renderPage(data, title);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  return html.length;
}

module.exports = { renderPage, writePage };
