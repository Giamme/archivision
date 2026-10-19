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

// what the page shows until the map runs, and instead of it when the 3D engine cannot load: the shell's own demo
// controls stay hidden until then, and the panel says why the map is missing (no WebGL, three.js not reachable, an error)
const LOAD_CSS = `<style>
  html:not(.az-up) body > .ui { visibility:hidden !important; }
  #az-load { position:fixed; left:50%; top:50%; transform:translate(-50%, -50%); width:min(440px, calc(100vw - 32px)); padding:16px 18px; border:1px solid var(--line); border-radius:12px; background:var(--panel); color:var(--ink); font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; z-index:10; }
  #az-load h2 { margin:0 0 6px; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); font-weight:600; }
  #az-load p { margin:0; color:var(--dim); }
  #az-load.fail p { color:var(--ink); }
  #az-load.fail p + p { margin-top:8px; color:var(--dim); }
</style>\n</head>`;
const LOAD_BODY = title => `<body>
<div id="az-load" role="status" aria-live="polite"><h2>${escHtml(title)}</h2><p>Loading the 3D map…</p><noscript><p>This map needs JavaScript.</p></noscript></div>
<script>
(function () {
  var el = document.getElementById('az-load'), net = false, err = null;
  // a module that cannot be fetched fires a plain error event on its script; one that throws, an ErrorEvent
  addEventListener('error', function (e) { if (e instanceof ErrorEvent) { if (!err) err = e.message || 'an error'; } else if (e.target && e.target.tagName === 'SCRIPT') net = true; }, true);
  addEventListener('load', function () { setTimeout(function () {
    if (document.documentElement.classList.contains('az-up') || !document.getElementById('az-load')) return;
    var gl = false; try { var c = document.createElement('canvas'); gl = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) {}
    var why = !gl ? ['This browser has no WebGL, and the 3D map needs it.', 'Turn on hardware acceleration, or open the page in another browser.']
      : err && !net ? ['The map stopped while it was starting: ' + err + '.', 'Reload the page; if it happens again, write the page again with archivision.']
      : ['The 3D engine (three.js 0.160.0) could not be loaded from cdn.jsdelivr.net.', 'The page fetches it the first time it opens: check the connection, a proxy or a content blocker, then reload.'];
    el.className = 'fail'; el.setAttribute('role', 'alert');
    var p = el.querySelectorAll('p'); for (var i = p.length - 1; i >= 0; i--) p[i].remove();
    why.forEach(function (t) { var q = document.createElement('p'); q.textContent = t; el.appendChild(q); });
  }, 0); });
})();
</script>`;
const LOAD_UP = `document.documentElement.classList.add('az-up'); { const l = document.getElementById('az-load'); if (l) l.remove(); }
requestAnimationFrame(frame);
</script>`;

function renderPage({ ATLAS, SCENE }, title) {
  const js = fs.readFileSync(path.join(ASSETS, 'figure.js'), 'utf8')
    .replace('__ATLAS__', () => dump(ATLAS)).replace('__SCENE__', () => dump(SCENE)).replace('__NAME__', () => title.replace(/[\\']/g, '\\$&'));
  let shell = fs.readFileSync(path.join(ASSETS, 'shell-3d.html'), 'utf8');
  for (const [a, r] of [['<title>Iso 3D</title>', `<title>${escHtml(title)}</title>\n${NOTICE()}`], ['<i></i>Iso 3D</div>', `<i></i>${escHtml(title)}</div>`], ['/* paste 3D figure modules here */', js],
    ['</head>', LOAD_CSS], ['<body>', LOAD_BODY(title)], ['requestAnimationFrame(frame);\n</script>', LOAD_UP]]) {
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
