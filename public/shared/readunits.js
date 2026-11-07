/* A Word file has no pages, so for tracking reading its paragraphs are grouped into sections of about a page
   (some 250 words), the same way on the server and in the reader. A heading starts a new section. */
export function readUnits(paras, words = 250) {
  const out = []; let cur = [], n = 0;
  for (const p of paras || []) {
    if (cur.length && (n >= words || (p.bold && n >= words / 3))) { out.push(cur); cur = []; n = 0; }
    cur.push(p); n += String(p.text || '').split(/\s+/).filter(Boolean).length;
  }
  if (cur.length) out.push(cur);
  return out;
}
