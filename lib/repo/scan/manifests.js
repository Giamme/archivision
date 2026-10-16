'use strict';
// Deployment manifests, read as text and never evaluated: serverless.yml (functions, their handler or image, their
// events and environment), SAM templates (AWS::Serverless::Function), and Dockerfiles (the CMD a Lambda image runs).
// YAML is read by a small reader of the subset these files use (block maps and lists, plain and quoted scalars, flow
// collections over one or more lines, block scalars), with the line of every key, so every handler and event carries
// its evidence. Variables (`${self:…}`, `${env:…}`) are kept as written; a tagged value (`!Ref X`, `!Sub …`) is an
// expression CloudFormation evaluates, never a literal. What the reader cannot follow (an alias, a merge key, a flow
// collection that does not close, an include it cannot read) is reported as a problem of the manifest, with its line,
// so a function it hides is not silently missing. serverless.yml's `${file(…)}` includes of functions are followed
// when the caller lets them be read (inside the repo).

/* ---------- YAML, the subset manifests use ---------- */

// the line without its comment (a # at the start or after a space, outside quotes)
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q && !(q === '"' && s[i - 1] === '\\')) q = null; continue; }
    if (c === '"' || c === "'") { if (i === 0 || /[\s:[{,-]/.test(s[i - 1])) q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}
const unquote = s => {
  s = s.trim();
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\(["\\nt])/g, (_, c) => ({ n: '\n', t: '\t' }[c] || c));
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  return s.replace(/^&\S+\s*/, '');      // an anchor is dropped
};
// walk a flow text outside its quoted strings (a double-quoted one with \ escapes, a single-quoted one with '');
// `at(c, i)` sees every other character
function flowChars(s, at) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (q === '"' && c === '\\') i++; else if (c === q && !(q === "'" && s[i + 1] === "'")) q = null; else if (c === q) i++; continue; }
    if ((c === '"' || c === "'") && (i === 0 || /[\s[{,:]/.test(s[i - 1]))) { q = c; continue; }
    if (at(c, i) === false) return;
  }
}
// split a flow collection's inside at top-level commas
function splitFlow(s) {
  const out = []; let d = 0, from = 0;
  flowChars(s, (c, i) => { if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--; else if (c === ',' && d === 0) { out.push(s.slice(from, i)); from = i + 1; } });
  out.push(s.slice(from));
  return out.map(x => x.trim()).filter(Boolean);
}
// `key: rest`: a quoted key and a colon (`"f":{…}` in a flow map needs no space), or a plain key and a colon that ends
// the line or is followed by a space
function keyOf(s) {
  const q = s.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:\s*(.*)$/);
  if (q) return [unquote(q[1]), q[2].trim()];
  const m = s.match(/^([^\s"'#][^:#]*?|[^\s"'#][^#]*?[^\s:])\s*:(?:\s+(.*)|$)/);
  return m ? [unquote(m[1]), (m[2] || '').trim()] : null;
}
// YAML's core tags: they name what the node is anyway
const CORE = new Set(['!!str', '!!map', '!!seq']);
// a value: a flow list or map, an alias (*name, not followed), a tagged value (!Ref X: an expression), or a string
function scalar(s, line) {
  s = s.trim();
  const tag = s.match(/^(!!?[\w:.\/-]*)(?:\s+([\s\S]*))?$/);
  if (tag) { const n = scalar(tag[2] || '', line); if (!CORE.has(tag[1])) n.tag = tag[1]; return n; }
  if (/^\*[^\s,[\]{}]+$/.test(s)) return { t: 'alias', v: s.slice(1), line };
  if (/^\[.*\]$/.test(s)) return { t: 'seq', v: splitFlow(s.slice(1, -1)).map(x => scalar(x, line)), line };
  if (/^\{.*\}$/.test(s)) { const o = { t: 'map', v: Object.create(null), keys: [], line }; for (const p of splitFlow(s.slice(1, -1))) { const k = keyOf(p); if (k) { o.v[k[0]] = scalar(k[1], line); o.keys.push(k[0]); } } return o; }
  return { t: 'str', v: unquote(s), line };
}

// the document's first YAML document as nodes; `problems` collects what the reader could not follow (and a second
// document, which it does not read)
function parseYaml(text, problems = []) {
  const L = [], raws = text.split(/\r?\n/), clean = [];
  for (const [i, raw] of raws.entries()) {
    if (/^(---|\.\.\.)(\s|$)/.test(raw)) {
      if (!L.length) { clean.push(''); continue; }      // clean keeps one entry per line, so its lines are the file's
      const more = raws.slice(i + 1).findIndex(x => stripComment(x).trim() && !/^(---|\.\.\.)\s*$/.test(x));
      if (more >= 0) problems.push({ line: i + 2 + more, why: 'a second YAML document, not read' });
      break;
    }
    const s = stripComment(raw); clean.push(s); if (!s.trim()) continue;
    L.push({ ind: s.match(/^ */)[0].length, s: s.trim(), n: i + 1 });
  }
  let i = 0;
  const isItem = s => s === '-' || s.startsWith('- ');
  const block = ind => { const f = L[i]; if (!f || f.ind < ind) return null; return isItem(f.s) ? seq(f.ind) : map(f.ind); };
  function seq(ind) {
    const node = { t: 'seq', v: [], line: L[i].n };
    while (i < L.length && L[i].ind === ind && isItem(L[i].s)) {
      const ln = L[i], after = ln.s === '-' ? '' : ln.s.slice(2), rest = after.trim();
      if (!rest) { i++; node.v.push(block(ind + 1) || { t: 'str', v: '', line: ln.n }); continue; }
      if (keyOf(rest) && !/^[[{"']/.test(rest)) { L[i] = { ind: ind + 2 + (after.length - after.trimStart().length), s: rest, n: ln.n }; node.v.push(map(L[i].ind)); continue; }   // - key: value starts a map
      i++; node.v.push(flowValue(rest, ln.n));
    }
    return node;
  }
  // a flow collection may run over several lines: join them until its brackets close (brackets in strings do not
  // count); one that never closes is a problem, read as text, and the lines after it are read as they are
  function flowValue(rest, n) {
    const body = rest.replace(/^!!?[\w:.\/-]*\s+/, '');
    if (/^[[{]/.test(body)) {
      let open = 0, j = i, text = body;
      const count = s => flowChars(s, c => { open += c === '[' || c === '{' ? 1 : c === ']' || c === '}' ? -1 : 0; });
      count(body);
      while (open > 0 && j < L.length) { text += ' ' + L[j].s; count(L[j].s); j++; }
      if (open > 0) { problems.push({ line: n, why: 'a flow collection that does not close' }); return { t: 'str', v: rest, line: n }; }
      i = j; rest = rest.slice(0, rest.length - body.length) + text;
    }
    return scalar(rest, n);
  }
  function map(ind) {
    const node = { t: 'map', v: Object.create(null), keys: [], line: L[i].n };
    while (i < L.length && L[i].ind === ind && !isItem(L[i].s)) {
      const ln = L[i], k = keyOf(ln.s); i++;
      if (!k) continue;
      const [key, rest] = k; let val;
      const lone = rest.match(/^(?:&\S+\s*)?(!!?[\w:.\/-]*)?$/);   // nothing on the line but an anchor or a tag: the value is below
      if (lone) { val = i < L.length && (L[i].ind > ind || (L[i].ind === ind && isItem(L[i].s))) ? block(L[i].ind) : { t: 'str', v: '', line: ln.n }; if (lone[1] && !CORE.has(lone[1])) val.tag = lone[1]; }
      else if (/^[|>][-+0-9]*$/.test(rest)) { const parts = []; while (i < L.length && L[i].ind > ind) parts.push(L[i++].s); val = { t: 'str', v: parts.join(rest[0] === '|' ? '\n' : ' '), line: ln.n }; }
      else val = flowValue(rest, ln.n);
      val.keyLine = ln.n;
      if (!(key in node.v)) node.keys.push(key);
      node.v[key] = val;
    }
    return node;
  }
  if (!L.length) return null;
  // a document that is one flow collection ({…} over many lines, JSON among them): read as one, then each key given
  // the line it is on (keys are found in the text in their order)
  if (/^(?:!!?[\w:.\/-]*\s+)?[[{]/.test(L[0].s)) {
    i = 1;
    const n = flowValue(L[0].s, L[0].n), body = clean.join('\n');
    // where quoted strings are, so a key is never found inside one (`d: "run: …"`)
    const quoted = new Uint8Array(body.length + 1);
    for (let k = 0, q = null; k < body.length; k++) {
      const ch = body[k];
      if (q) { quoted[k] = 1; if (q === '"' && ch === '\\') { quoted[++k] = 1; continue; } if (ch === q) { if (q === "'" && body[k + 1] === "'") { quoted[++k] = 1; continue; } q = null; quoted[k] = 0; } continue; }
      if ((ch === '"' || ch === "'") && (k === 0 || /[\s[{,:]/.test(body[k - 1]))) q = ch;
    }
    let from = 0;
    const walk = (x, line) => {
      x.line = line;
      if (x.t === 'map') for (const k of x.keys) {
        const e = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp(`(?:^|[\\s{,])(?:"${e}"|'${e}'|${e})\\s*:`, 'g');
        re.lastIndex = from; let m = re.exec(body), at = -1;
        while (m && quoted[at = m.index + (/^[\s{,]/.test(m[0]) ? 1 : 0)]) { re.lastIndex = m.index + 1; m = re.exec(body); at = -1; }   // the key starts after the character before it
        const l = at >= 0 ? body.slice(0, at).split('\n').length : line; if (m) from = m.index + m[0].length; x.v[k].keyLine = l; walk(x.v[k], l);
      }
      else if (x.t === 'seq') for (const y of x.v) walk(y, line);
    };
    if (n.t !== 'str') walk(n, L[0].n);
    if (i < L.length) problems.push({ line: L[i].n, why: 'text after the flow collection, not read' });
    return n;
  }
  return block(L[0].ind);
}
// helpers over parsed nodes; a tagged value is no string
const get = (n, ...ks) => { for (const k of ks) { if (!n || n.t !== 'map') return null; n = n.v[k]; } return n || null; };
const str = n => (n && n.t === 'str' && !n.tag ? n.v : null);
const entries = n => (n && n.t === 'map' ? n.keys.map(k => [k, n.v[k]]) : []);
const items = n => (n && n.t === 'seq' ? n.v : []);
const lineOf = n => (n ? n.keyLine || n.line : 0);
// what the reader does not follow inside a node: aliases and merge keys
function unfollowed(n, problems) {
  if (!n) return;
  if (n.t === 'alias') problems.push({ line: n.line, why: 'an alias not followed' });
  else if (n.t === 'map') for (const k of n.keys) { if (k === '<<') problems.push({ line: lineOf(n.v[k]), why: 'a merge key (<<) not followed' }); unfollowed(n.v[k], problems); }
  else if (n.t === 'seq') for (const x of n.v) unfollowed(x, problems);
}
// a JSON file as the reader's nodes, each key with its line (keys are found in the text in the order JSON.parse keeps)
function jsonNodes(text) {
  const lineAt = i => text.slice(0, i).split('\n').length;
  let from = 0;
  const conv = (x, line) => {
    if (Array.isArray(x)) return { t: 'seq', v: x.map(y => conv(y, line)), line };
    if (x && typeof x === 'object') {
      const o = { t: 'map', v: Object.create(null), keys: [], line };
      for (const [k, y] of Object.entries(x)) { const i = text.indexOf(JSON.stringify(k), from), l = i >= 0 ? lineAt(i) : line; if (i >= 0) from = i + 1; const n = conv(y, l); n.keyLine = l; o.v[k] = n; o.keys.push(k); }
      return o;
    }
    return { t: 'str', v: x === null ? '' : String(x), line };
  };
  return conv(JSON.parse(text), 1);
}
// ${file(./x.yml)} or ${file(./x.yml):a.b}: [path, selector]; null for anything else
const fileRef = s => { const m = typeof s === 'string' && s.trim().match(/^\$\{file\(\s*(.+?)\s*\)(?::([\w.-]+))?\}$/); return m ? [m[1].replace(/^['"]|['"]$/g, ''), m[2] || null] : null; };
// a manifest the reader found no map in: nothing when it is simply not one, else what stopped the reader
const unread = problems => (problems.length ? { service: null, runtime: null, environment: {}, functions: [], problems: once(problems) } : null);
// each problem once (a node can be reached twice)
const once = ps => { const seen = new Set(); return ps.filter(p => { const k = `${p.file || ''}|${p.line}|${p.why}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

/* ---------- serverless.yml ---------- */

// { service, runtime, environment: {NAME: {value, line}}, functions: [{ name, line, file?, handler, image, runtime,
// environment, events }], problems: [{ line, file?, why }] }. `include(path)` reads a file a `${file(…)}` names,
// relative to the manifest's folder: { text, file } or { why }; without it no include is followed
function readServerless(text, include = null) {
  const problems = [];
  const doc = parseYaml(text, problems); if (!doc || doc.t !== 'map') return unread(problems);
  const env = (n, file) => Object.fromEntries(entries(n).map(([k, v]) => [k, { value: str(v), line: lineOf(v), ...(file ? { file } : {}) }]));
  const provider = get(doc, 'provider'), images = get(provider, 'ecr', 'images');
  const out = { service: str(get(doc, 'service')) || str(get(doc, 'service', 'name')), runtime: str(get(provider, 'runtime')), environment: env(get(provider, 'environment')), functions: [], problems };
  unfollowed(get(provider, 'environment'), problems);
  // the functions: a map, a list of maps, or ${file(…)} includes of either (at most 50 files, one level of includes
  // inside them); each function keeps the file it is declared in
  let reads = 0;
  const load = (ref, line, file) => {
    const [p, sel] = ref, at = { line, ...(file ? { file } : {}) };
    if (!include) { problems.push({ ...at, why: 'an included file not read' }); return null; }
    if (/\$\{/.test(p)) { problems.push({ ...at, why: 'a file included by a variable' }); return null; }
    if (++reads > 50) { problems.push({ ...at, why: 'more included files than the reader follows' }); return null; }
    const r = include(p);
    if (!r || r.why) { problems.push({ ...at, why: r ? r.why : 'an included file not read' }); return null; }
    const sub = []; let d = null;
    try { d = /\.json$/i.test(r.file) ? jsonNodes(r.text) : parseYaml(r.text, sub); } catch { problems.push({ ...at, why: 'an included file that does not parse' }); return null; }
    for (const x of sub) problems.push({ ...x, file: r.file });
    const n = sel ? get(d, ...sel.split('.')) : d;
    if (!n) problems.push({ ...at, why: 'an included file without what it names' });
    return n ? { n, file: r.file } : null;
  };
  const fnList = [];
  const collect = (n, file, depth) => {
    if (!n) return;
    if (n.tag) { problems.push({ line: lineOf(n), ...(file ? { file } : {}), why: 'functions given by a tag (!Ref, !If …)' }); return; }
    const s = n.t === 'str' && !n.tag ? n.v : null, ref = fileRef(s);
    if (ref && depth < 2) { const r = load(ref, lineOf(n), file); if (r) collect(r.n, r.file, depth + 1); return; }
    if (n.t === 'seq') { for (const x of n.v) collect(x, file, depth); return; }
    if (n.t === 'map') {
      for (const [name, f] of entries(n)) {
        if (name === '<<') continue;
        const fr = f && f.t === 'str' && !f.tag ? fileRef(f.v) : null;
        if (fr && depth < 2) { const r = load(fr, lineOf(f), file); if (r) fnList.push([name, r.n, r.file, lineOf(f)]); continue; }
        fnList.push([name, f, file, lineOf(f)]);
      }
      unfollowed(n, problems);
      return;
    }
    if (n.t === 'alias') { unfollowed(n, problems); return; }
    if (s !== null && s.trim()) problems.push({ line: lineOf(n), ...(file ? { file } : {}), why: /\$\{/.test(s) ? 'functions given by a variable' : 'functions that are not a map' });
  };
  collect(get(doc, 'functions'), null, 0);
  for (const [name, f, file, fline] of fnList) {
    if (!f || f.t !== 'map') { problems.push({ line: fline, ...(file ? { file } : {}), why: f && f.t === 'alias' ? 'an alias not followed' : 'a function that is not a map' }); continue; }
    unfollowed(f, problems);
    const handler = get(f, 'handler'), image = get(f, 'image');
    let img = null;
    if (image) {
      // `image: {name}` or the shorthand `image: name`, for an image under provider.ecr.images; else a URI
      const short = str(image), named = str(get(image, 'name')) || (short && get(images, short) ? short : null), uri = named ? str(get(image, 'uri')) : short || str(get(image, 'uri'));
      const local = named && get(images, named);
      img = { line: lineOf(image), uri: uri || (local ? str(get(local, 'uri')) : null), name: named, path: local ? str(get(local, 'path')) : null, file: local ? str(get(local, 'file')) : null };
    }
    out.functions.push({ name, line: file ? lineOf(f) : fline, ...(file ? { file } : {}), handler: handler ? { value: str(handler), line: lineOf(handler) } : null, image: img,
      runtime: str(get(f, 'runtime')) || out.runtime, environment: env(get(f, 'environment'), file), events: items(get(f, 'events')).map(eventOf).filter(Boolean) });
  }
  out.problems = once(problems);
  return out;
}
// one event of a function: { type, line, path, method, bucket, event, queue, rate, text }
function eventOf(e) {
  const [type, v] = entries(e)[0] || []; if (!type) return null;
  const line = lineOf(e.v[type]) || e.line, s = str(v);
  const ev = { type, line };
  if (type === 'http' || type === 'httpApi') {
    if (s !== null) { const m = s.trim().match(/^(\S+)\s+(\S+)$/); if (m) { ev.method = m[1].toUpperCase(); ev.path = m[2]; } else ev.path = s; }
    else { ev.path = str(get(v, 'path')); ev.method = (str(get(v, 'method')) || 'ANY').toUpperCase(); }
    if (ev.path && ev.path !== '*' && !ev.path.startsWith('/')) ev.path = '/' + ev.path;
    ev.text = `${type} ${ev.method || 'ANY'} ${ev.path || '*'}`;
  } else if (type === 's3') {
    ev.bucket = s !== null ? s : str(get(v, 'bucket')); ev.event = s !== null ? 's3:ObjectCreated:*' : str(get(v, 'event')) || 's3:ObjectCreated:*';
    ev.text = `s3 ${ev.bucket || '?'} ${ev.event}`;
  } else if (type === 'sqs') { ev.queue = s !== null ? s : str(get(v, 'arn')) || str(get(v, 'queueName')); ev.text = `sqs ${ev.queue || '?'}`; }
  else if (type === 'schedule') {
    const r = s !== null ? s : get(v, 'rate'); ev.rate = r && r.t === 'seq' ? r.v.map(str).join(', ') : str(r) || s;
    if (str(get(v, 'enabled')) === 'false') ev.disabled = true;
    ev.text = `schedule ${ev.rate || '?'}`;
  } else ev.text = `${type}${s ? ' ' + s : ''}`;
  return ev;
}

/* ---------- SAM template.yaml ---------- */

// the same shape as serverless.yml's, for AWS::Serverless::Function resources; the handler is relative to CodeUri
function readSam(text) {
  if (!/AWS::Serverless::Function|Transform:\s*['"]?AWS::Serverless/.test(text)) return null;
  const problems = [];
  const doc = parseYaml(text, problems); if (!doc || doc.t !== 'map') return unread(problems);
  const G = get(doc, 'Globals', 'Function');
  const env = n => Object.fromEntries(entries(get(n, 'Environment', 'Variables')).map(([k, v]) => [k, { value: str(v), line: lineOf(v) }]));
  const out = { service: null, runtime: str(get(G, 'Runtime')), environment: env(G), functions: [], problems };
  unfollowed(G, problems);
  for (const [name, r] of entries(get(doc, 'Resources'))) {
    if (str(get(r, 'Type')) !== 'AWS::Serverless::Function') continue;
    unfollowed(r, problems);
    // the handler is a module path under CodeUri: the folder and the module are kept apart (src/ + pkg.app.run);
    // a CodeUri that is no folder (an S3 location, !Ref …) leaves the handler's file unknown
    const P = get(r, 'Properties'), cu = get(P, 'CodeUri') || get(G, 'CodeUri'), code = cu ? str(cu) : '', h = get(P, 'Handler') || get(G, 'Handler');
    const image = str(get(P, 'PackageType')) === 'Image' ? { line: lineOf(get(P, 'PackageType')), uri: str(get(P, 'ImageUri')), name: null, path: str(get(r, 'Metadata', 'DockerContext')), file: str(get(r, 'Metadata', 'Dockerfile')) } : null;
    const events = entries(get(P, 'Events')).map(([, e]) => {
      const t = str(get(e, 'Type')), p = get(e, 'Properties'), line = lineOf(e);
      if (t === 'Api' || t === 'HttpApi') { const path = str(get(p, 'Path')) || '*', method = (str(get(p, 'Method')) || 'ANY').toUpperCase(); return { type: t === 'Api' ? 'http' : 'httpApi', line, path, method, text: `${t} ${method} ${path}` }; }
      if (t === 'S3') return { type: 's3', line, bucket: str(get(p, 'Bucket')), event: str(get(p, 'Events')) || 's3:ObjectCreated:*', text: `s3 ${str(get(p, 'Bucket')) || '?'}` };
      if (t === 'SQS') return { type: 'sqs', line, queue: str(get(p, 'Queue')), text: `sqs ${str(get(p, 'Queue')) || '?'}` };
      if (t === 'Schedule' || t === 'ScheduleV2') return { type: 'schedule', line, rate: str(get(p, 'Schedule')) || str(get(p, 'ScheduleExpression')), text: `schedule ${str(get(p, 'Schedule')) || str(get(p, 'ScheduleExpression')) || '?'}` };
      return t ? { type: t, line, text: t } : null;
    }).filter(Boolean);
    const hv = h && !image ? { value: str(h), line: lineOf(h), dir: code || '' } : null;
    if (hv && code === null) hv.why = 'code that is not in a folder of the repo (CodeUri)';
    if (hv && get(P, 'InlineCode')) hv.why = 'inline code';
    out.functions.push({ name, line: lineOf(r), handler: hv, image,
      runtime: str(get(P, 'Runtime')) || out.runtime, environment: { ...out.environment, ...env(P) }, events });
  }
  out.problems = once(problems);
  return out;
}

/* ---------- Dockerfile ---------- */

// the image's last CMD and its FROM lines; a CMD of one `module.function` word is a Lambda handler
function readDockerfile(text) {
  const lines = text.split(/\r?\n/), ins = [];
  for (let i = 0; i < lines.length; i++) {
    let s = lines[i]; const n = i + 1;
    if (/^\s*#/.test(s) || !s.trim()) continue;
    while (/\\\s*$/.test(s) && i + 1 < lines.length) s = s.replace(/\\\s*$/, ' ') + lines[++i];
    const m = s.trim().match(/^([A-Za-z]+)\s+(.*)$/); if (m) ins.push({ op: m[1].toUpperCase(), arg: m[2].trim(), line: n });
  }
  const from = ins.filter(x => x.op === 'FROM').map(x => x.arg), cmd = ins.filter(x => x.op === 'CMD').pop() || null;
  let words = null;
  if (cmd) { try { words = cmd.arg.startsWith('[') ? JSON.parse(cmd.arg) : cmd.arg.split(/\s+/); } catch { words = null; } }
  const handler = words && words.length === 1 && /^[\w./-]+\.[A-Za-z_]\w*$/.test(words[0]) && !/\.(js|py|sh)$/.test(words[0]) ? words[0] : null;
  return { from, cmd: cmd ? { words: words || [], line: cmd.line } : null, handler: handler ? { value: handler, line: cmd.line } : null, python: from.some(f => /python/i.test(f)) };
}

const MANIFEST = { serverless: /(^|\/)serverless(\.[\w-]+)?\.ya?ml$/, sam: /(^|\/)template\.ya?ml$/, docker: /(^|\/)(Dockerfile[\w.-]*|[\w.-]+\.[Dd]ockerfile)$/, python: /(^|\/)(pyproject\.toml|setup\.cfg|setup\.py)$/ };
const kindOf = p => Object.keys(MANIFEST).find(k => MANIFEST[k].test(p)) || null;

module.exports = { parseYaml, readServerless, readSam, readDockerfile, kindOf, MANIFEST };
