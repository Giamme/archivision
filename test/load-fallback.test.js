'use strict';
// What a page shows when the map cannot start: the loading panel says why (no WebGL, three.js not reachable from the
// CDN, an error while starting), and the shell's own demo controls stay hidden. jsdom runs the page's classic script
// but never its module, which is the case of a module that could not load.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { validate, archToScene, renderPage } = require('../lib');

const MODEL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'shop', 'shop.arch.json'), 'utf8'));
const page = (() => { const { model } = validate(MODEL); return renderPage(archToScene(model, { by: 'hand', source: 'test' }), 'Corner <Shop>'); })();

// the page in jsdom, with WebGL there or not, and optionally the module's script failing to fetch or throwing
function open({ webgl, fetchFails = false, throws = null }) {
  return new Promise(resolve => {
    const dom = new JSDOM(page, { runScripts: 'dangerously', virtualConsole: new VirtualConsole(), beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = function (k) { return webgl && /webgl/.test(k) ? {} : null; };
      win.document.addEventListener('DOMContentLoaded', () => {
        const mod = win.document.querySelector('script[type="module"]');
        if (fetchFails) mod.dispatchEvent(new win.Event('error'));
        if (throws) win.dispatchEvent(new win.ErrorEvent('error', { message: throws }));
      });
    } });
    dom.window.addEventListener('load', () => setTimeout(() => resolve(dom.window.document), 5));
  });
}
const panel = doc => { const el = doc.getElementById('az-load'); return el && { cls: el.className, role: el.getAttribute('role'), h: el.querySelector('h2').textContent, text: [...el.querySelectorAll('p')].map(p => p.textContent).join(' ') }; };

test('the page carries a loading panel with its title, and hides the shell controls until the map starts', () => {
  assert.match(page, /<div id="az-load" role="status"[^>]*><h2>Corner &lt;Shop&gt;<\/h2><p>Loading the 3D map…<\/p>/);
  assert.match(page, /html:not\(\.az-up\) body > \.ui \{ visibility:hidden !important; \}/);
  assert.match(page, /document\.documentElement\.classList\.add\('az-up'\); \{ const l = document\.getElementById\('az-load'\); if \(l\) l\.remove\(\); \}\nrequestAnimationFrame\(frame\);\n<\/script>/);
});

test('three.js not reachable: the panel names the CDN', async () => {
  for (const fetchFails of [true, false]) {
    const p = panel(await open({ webgl: true, fetchFails }));
    assert.equal(p.cls, 'fail'); assert.equal(p.role, 'alert'); assert.equal(p.h, 'Corner <Shop>');
    assert.match(p.text, /three\.js 0\.160\.0\) could not be loaded from cdn\.jsdelivr\.net/);
    assert.doesNotMatch(p.text, /Loading/);
  }
});

test('no WebGL: the panel says so, whatever else failed', async () => {
  const p = panel(await open({ webgl: false, fetchFails: true }));
  assert.equal(p.cls, 'fail');
  assert.match(p.text, /no WebGL/);
});

test('an error while the map starts: the panel gives its message', async () => {
  const p = panel(await open({ webgl: true, throws: 'boom at start' }));
  assert.match(p.text, /The map stopped while it was starting: boom at start\./);
});

test('a map that started keeps no panel', async () => {
  const doc = await new Promise(resolve => {
    const dom = new JSDOM(page, { runScripts: 'dangerously', virtualConsole: new VirtualConsole(), beforeParse(win) {
      win.document.addEventListener('DOMContentLoaded', () => { win.document.documentElement.classList.add('az-up'); win.document.getElementById('az-load').remove(); });
    } });
    dom.window.addEventListener('load', () => setTimeout(() => resolve(dom.window.document), 5));
  });
  assert.equal(doc.getElementById('az-load'), null);
});
