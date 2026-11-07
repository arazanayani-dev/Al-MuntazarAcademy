/* Pulls the text out of a PDF, page by page, without extra packages. PDF pages hold compressed drawing
   instructions; text is shown with Tj/TJ in a font whose ToUnicode table maps the codes back to letters.
   Scanned pages (pictures of text) have no text and come back empty. */
import zlib from 'node:zlib';

const hex4 = h => { let o = ''; for (let i = 0; i < h.length; i += 4) o += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return o; };
function cmapOf(t) {
  const map = {}; if (!t) return map;
  for (const b of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const x of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map[parseInt(x[1], 16)] = hex4(x[2].padStart(4, '0'));
  for (const b of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const x of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) { const a = parseInt(x[1], 16), z = parseInt(x[2], 16), d = parseInt(x[3], 16); for (let c = a; c <= z && c - a < 65536; c++) map[c] = String.fromCharCode(d + c - a); }
  return map;
}
const unesc = s => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[e] ?? String.fromCharCode(parseInt(e, 8))));

export function pdfPages(buf) {
  const s = buf.toString('latin1'); const objs = {};
  for (const m of s.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
    const body = m[2]; const si = body.indexOf('stream'); let dict = si >= 0 ? body.slice(0, si) : body, stream = null;
    if (si >= 0) {
      let start = m.index + m[0].indexOf('stream') + 6; if (s[start] === '\r') start++; if (s[start] === '\n') start++;
      const end = s.indexOf('endstream', start); let data = buf.subarray(start, end);
      if (/FlateDecode/.test(dict)) { try { data = zlib.inflateSync(data); } catch { data = null; } }
      stream = data ? data.toString('latin1') : null;
    }
    objs[m[1]] = { dict, stream };
  }
  const fontMap = {};
  for (const [n, o] of Object.entries(objs)) if (/\/Type\s*\/Font/.test(o.dict)) { const tu = o.dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/); fontMap[n] = tu ? cmapOf(objs[tu[1]] && objs[tu[1]].stream) : null; }
  const fontsIn = d => { const out = {}; let fd = d.match(/\/Font\s*<<([\s\S]*?)>>/); if (!fd) { const r = d.match(/\/Font\s+(\d+)\s+0\s+R/); if (r && objs[r[1]]) fd = [0, objs[r[1]].dict]; } if (fd) for (const x of fd[1].matchAll(/\/([\w.+-]+)\s+(\d+)\s+0\s+R/g)) out[x[1]] = fontMap[x[2]]; return out; };
  /* pages in reading order, following the page tree */
  const order = []; const root = Object.values(objs).find(o => /\/Type\s*\/Pages/.test(o.dict) && !/\/Parent/.test(o.dict));
  const walk = (o, depth) => { const kids = depth < 50 && o.dict.match(/\/Kids\s*\[([^\]]*)\]/); if (!kids) return; for (const k of kids[1].matchAll(/(\d+)\s+0\s+R/g)) { const c = objs[k[1]]; if (!c) continue; if (/\/Type\s*\/Pages/.test(c.dict)) walk(c, depth + 1); else order.push(c); } };
  if (root) walk(root, 0);
  return order.map(pg => {
    const res = pg.dict.match(/\/Resources\s+(\d+)\s+0\s+R/); const fonts = fontsIn(res && objs[res[1]] ? objs[res[1]].dict : pg.dict);
    const cont = pg.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/); if (!cont) return '';
    const text = [...cont[1].matchAll(/(\d+)\s+0\s+R/g)].map(x => objs[x[1]] && objs[x[1]].stream || '').join('\n');
    let cm = null, line = ''; const lines = [];
    const dec = str => [...unesc(str)].map(ch => cm ? (cm[ch.charCodeAt(0)] ?? '') : ch).join('');
    for (const op of text.matchAll(/\/([\w.+-]+)\s+[\d.]+\s+Tf|\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|(T\*|ET)/g)) {
      if (op[1]) cm = fonts[op[1]] || null;
      else if (op[2] != null) { for (const p of op[2].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?[\d.]+)/g)) { if (p[1] != null) line += dec(p[1]); else if (+p[2] < -200) line += ' '; } }
      else if (op[3] != null) line += dec(op[3]);
      else if (op[4] != null) { if (Math.abs(+op[5]) > 1) { lines.push(line); line = ''; } }
      else if (op[6]) { lines.push(line); line = ''; }
    }
    lines.push(line);
    return lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  });
}
