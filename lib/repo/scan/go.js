'use strict';
// Go declarations read from the text, with no Go toolchain: the top-level functions, methods (with the type they are
// declared on), types (struct, interface or other, with an interface's methods), constants and variables of one file,
// each with its first and last line and the line of its name. Strings (interpreted, raw and runes), comments and
// brackets are followed, so a brace in a string or a comment ends nothing; names are Go's (any Unicode letter). It
// reads gofmt'ed code: a declaration starts at the beginning of a line, and ends where Go would end the statement (its
// brackets closed, and the line's last token one after which Go inserts a semicolon). It serves diffs (which
// declarations a change touches), and it is the independent reading the ripwire symbols are checked against.
const ID = '[\\p{L}_][\\p{L}\\p{Nd}_]*';
const RE = {
  start: /^(func|type|const|var)(?![\p{L}\p{Nd}_])\s*(.*)$/u,
  recv: new RegExp(`^\\(\\s*(?:${ID}\\s+)?\\*?\\s*(${ID})(?:\\[[^\\]]*\\])?\\s*,?\\s*\\)\\s*(${ID})`, 'u'),
  fn: new RegExp(`^(${ID})`, 'u'),
  id: new RegExp(`^${ID}`, 'u'),
  tkind: new RegExp(`^${ID}\\s*(?:\\[[^\\]]*\\])?\\s*(=\\s*)?(interface|struct)(?![\\p{L}\\p{Nd}_])`, 'u'),
  imethod: new RegExp(`^(${ID})\\s*\\(`, 'u'),
  pkg: new RegExp(`^package\\s+(${ID})`, 'u'),
  ends: /[\p{L}\p{Nd}_)\]}"'`]$|\+\+$|--$/u,
};
// text without its comments, each character of one a space (lines keep their place): strings, runes and raw strings
// are followed, so // or /* in one is no comment, and /* in a line comment opens none
function uncomment(t) {
  let out = '', str = null, line = false, block = false;
  for (let j = 0; j < t.length; j++) {
    const c = t[j];
    if (line) { if (c === '\n') { line = false; out += c; } else out += ' '; continue; }
    if (block) { if (c === '*' && t[j + 1] === '/') { block = false; out += '  '; j++; } else out += c === '\n' ? c : ' '; continue; }
    if (str) {
      out += c;
      if (str !== '`' && c === '\\' && j + 1 < t.length) { out += t[++j]; continue; }
      if (c === str || (c === '\n' && str !== '`')) str = null;
      continue;
    }
    if (c === '/' && t[j + 1] === '/') { line = true; out += '  '; j++; continue; }
    if (c === '/' && t[j + 1] === '*') { block = true; out += '  '; j++; continue; }
    if (c === '"' || c === '`' || c === "'") str = c;
    out += c;
  }
  return out;
}
// a line's code without its comments, for matching what starts it
const code = s => uncomment(s);

// [{ name, kind: function|method|type|const|var, line, nameLine, end, recv (methods: the type, without * and type
// parameters), tkind (types: struct|interface|other), methods (interfaces: [{ name, line }]), inGroup }]
function goDecls(text) {
  const L = text.split('\n'), out = [];
  let str = null, block = false, depth = 0;      // inside: a string ('"', '`', "'"), a /* comment */; bracket depth
  let cur = null, group = null;                   // the declaration being read; a grouped `const (`, `var (`, `type (`
  for (let i = 0; i < L.length; i++) {
    const s = L[i], startDepth = depth, inside = str !== null || block;
    // a declaration starts at column 0 with its keyword, at depth 0, outside strings and comments
    if (!inside && startDepth === 0 && !cur) {
      const m = s.match(RE.start);
      if (m) {
        const [, kw, rest] = m;
        if (kw === 'func') {
          // the receiver and the name may run over lines: read up to ten, without their comments (a comment may run
          // over lines too)
          const head = uncomment([rest, ...L.slice(i + 1, i + 10)].join('\n')), r = head.match(RE.recv), f = code(rest).match(RE.fn);
          if (r) {
            const at = r[0].length - r[2].length, nameLine = i + 1 + head.slice(0, at).split('\n').length - 1;
            cur = { name: r[2], kind: 'method', line: i + 1, nameLine, recv: r[1], base: 0 };
          } else if (f) cur = { name: f[1], kind: 'function', line: i + 1, nameLine: i + 1, base: 0 };
        } else if (/^\(\s*$/.test(code(rest))) group = kw;
        else { const t = code(rest); if (RE.id.test(t)) cur = spec(t, kw, i + 1, 0); }
      }
    } else if (!inside && group && startDepth === 1 && !cur) {
      // a spec inside a group: `Name …` (a type, or one or more constants or variables)
      const t = code(s).trim();
      if (RE.id.test(t)) cur = { ...spec(t, group, i + 1, 1), inGroup: true };
    } else if (!inside && cur && cur.tkind === 'interface' && startDepth === cur.base + 1) {
      // an interface's own methods (an embedded interface, a type union or a constraint is none)
      const m = code(s).trim().match(RE.imethod);
      if (m) cur.methods.push({ name: m[1], line: i + 1 });
    }
    // follow strings, comments and brackets to the end of the line; the last token's character, for where it ends
    let last = '';
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (block) { if (c === '*' && s[j + 1] === '/') { block = false; j++; } continue; }
      if (str) {
        if (str !== '`' && c === '\\') { j++; continue; }
        if (c === str) { str = null; last = c; }
        continue;
      }
      if (c === '/' && s[j + 1] === '/') break;
      if (c === '/' && s[j + 1] === '*') { block = true; j++; continue; }
      if (c === '"' || c === '`' || c === "'") { str = c; continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
      if (!/\s/.test(c)) last = (c === '+' || c === '-') && s[j - 1] === c ? c + c : c;
    }
    if (str === '"' || str === "'") str = null;  // an interpreted string or a rune never runs past its line
    if (str !== null || block) continue;
    // a declaration ends at the end of a line where its brackets close and Go ends the statement (`var x =` goes on)
    if (cur && depth === cur.base && last && RE.ends.test(last)) {
      const end = i + 1, { names, base, ...d } = cur;
      if (names) for (const n of names) out.push({ ...d, name: n, end });
      else out.push({ ...d, end });
      cur = null;
    }
    if (group && depth === 0 && !cur) group = null;
  }
  return out;
}

// a spec: the names it declares (`A, B = 1, 2` → A, B; a type spec declares one) and, for a type, its kind
function spec(t, kw, line, base) {
  const d = { kind: kw, line, nameLine: line, base };
  if (kw === 'type') {
    const m = t.match(RE.tkind), methods = [];
    // `interface { M(); N() }` on its one line: its methods are there
    const body = m && m[2] === 'interface' ? t.slice(m[0].length).match(/^\s*\{(.*)\}\s*$/) : null;
    if (body) for (const part of topLevel(body[1])) { const x = part.trim().match(RE.imethod); if (x) methods.push({ name: x[1], line }); }
    return { ...d, names: [t.match(RE.id)[0]], tkind: m ? m[2] : 'other', methods };
  }
  const list = t.match(new RegExp(`^${ID}(?:\\s*,\\s*${ID})*`, 'u'))[0];
  return { ...d, names: list.split(',').map(x => x.trim()).filter(n => n !== '_') };
}

// a body's elements: split at its own semicolons, not at those of a type inside it (`M(x interface{ A(); B() })`)
function topLevel(t) {
  const out = []; let d = 0, str = null, from = 0;
  for (let j = 0; j < t.length; j++) {
    const c = t[j];
    if (str) { if (str !== '`' && c === '\\') j++; else if (c === str) str = null; continue; }
    if (c === '"' || c === '`' || c === "'") str = c;
    else if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d = Math.max(0, d - 1);
    else if (c === ';' && d === 0) { out.push(t.slice(from, j)); from = j + 1; }
  }
  out.push(t.slice(from));
  return out;
}
// the package a file belongs to (its package clause, the first code it has), or null
function goPackage(text) {
  for (const s of uncomment(text).split('\n')) {
    if (!s.trim()) continue;
    const m = s.trim().match(RE.pkg);
    return m ? m[1] : null;
  }
  return null;
}

// for diffs: [name, first line, last line, id, the id without its path]; a method is named by its type, so a change to
// it lights the type, and its id is Type.Method; a second declaration of a name (init) gets #2
function goRanges(p, text) {
  const count = new Map();
  return goDecls(text).map(d => {
    const q = d.recv ? `${d.recv}.${d.name}` : d.name, k = (count.get(q) || 0) + 1; count.set(q, k);
    const id = `${p}#${q}${k > 1 ? `#${k}` : ''}`;
    return [d.recv || d.name, d.line, d.end, id, id.slice(p.length)];
  });
}

module.exports = { goDecls, goPackage, goRanges };
