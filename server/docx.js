/* Reads a question paper from a Word (.docx) file, without extra packages: a .docx is a zip archive holding
   word/document.xml. Each paragraph becomes a line with its text and whether part of it is marked as an
   answer (yellow highlight, or bold). The lines are then read as numbered questions with options a to d,
   optional statements i, ii, iii … (for "which of these" questions) and marks such as "(2 marks)". */
import zlib from 'node:zlib';

export class PaperError extends Error {}

/* the uncompressed contents of one file inside a zip archive */
function unzipEntry(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new PaperError('This is not a Word (.docx) file. Save the paper as a Word document and try again.');
  let p = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === want) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extra + comment;
  }
  throw new PaperError('The Word file has no document text. Is it a .docx file?');
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

/* paragraphs as { text, hi: highlighted text, bold: bold text, list: auto-numbered } */
function paragraphs(xml) {
  const out = [];
  for (const pm of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = pm[0]; let text = '', hi = '', bold = '';
    for (const rm of p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const r = rm[0]; const pr = (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
      const t = decode([...r.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\/>/g)].map(m => m[1] != null ? m[1] : ' ').join(''));
      if (!t) continue;
      text += t;
      if (/<w:highlight w:val="(yellow|green|cyan)"/.test(pr) || /<w:shd [^>]*w:fill="(FFFF00|FFFF66|FFF200)"/i.test(pr)) hi += t;
      if (/<w:b(?: w:val="(1|true|on)")?\/>/.test(pr)) bold += t;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, hi: hi.trim(), bold: bold.trim(), list: /<w:numPr>/.test(p) });
  }
  return out;
}

const Q_RE = /^(?:Q\.?\s*)?(\d{1,3})\s*[.)\]:-]\s*(.+)$/i;
const OPT_RE = /^\(?([a-dA-D])\s*[.)\]]\s*(.*)$/;
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const STMT_RE = /^\(?(x|ix|viii|vii|vi|v|iv|iii|ii|i)\s*[.)\]]\s+(.+)$/i;
const SECTION_RE = /^(section|part)\s+([A-Z0-9]+)\b/i;
const MARKS_RE = /[([]\s*(\d{1,2})\s*marks?\s*[)\]]|\b(\d{1,2})\s*marks?\b\s*$/i;
/* "a) one b) two c) three d) four" on a single line */
function inlineOptions(s) {
  const m = s.match(/(?:^|\s)\(?a\s*[.)]\s*(.+?)\s+\(?b\s*[.)]\s*(.+?)\s+\(?c\s*[.)]\s*(.+?)\s+\(?d\s*[.)]\s*(.+)$/i);
  return m ? m.slice(1, 5).map(x => x.trim()) : null;
}

/* the text of a Word file as paragraphs, for reading it inside the app */
export function docxText(buf) {
  return paragraphs(unzipEntry(buf, 'word/document.xml').toString('utf8')).map(p => ({ text: p.text, bold: !!p.bold && p.bold.length >= p.text.length * 0.8 }));
}

export function readPaper(buf, file) {
  const lines = paragraphs(unzipEntry(buf, 'word/document.xml').toString('utf8'));
  if (!lines.length) throw new PaperError('No text was found in the Word file.');
  const questions = []; let section = 1, sawSection = false, q = null;
  const finish = () => { if (q) questions.push(q); q = null; };
  for (const L of lines) {
    const sec = L.text.match(SECTION_RE);
    if (sec) { finish(); if (sawSection) section++; sawSection = true; continue; }
    const qm = L.text.match(Q_RE); const om = L.text.match(OPT_RE); const sm = L.text.match(STMT_RE);
    if (q && om && q.options.length < 6 && 'abcdef'.indexOf(om[1].toLowerCase()) === q.options.length) { q.options.push(om[2].trim()); q.marks_.push(L); continue; }
    if (q && sm && !q.options.length && ROMAN[q.stmts.length] === sm[1].toLowerCase()) { q.stmts.push(sm[2].trim()); continue; }
    if (q && L.list && !qm && q.options.length < 4 && (q.options.length || L.text.length < 160)) { q.options.push(L.text); q.marks_.push(L); continue; } /* auto-numbered options */
    if (qm) {
      finish();
      let text = qm[2]; const mk = text.match(MARKS_RE); const marks = mk ? +(mk[1] || mk[2]) : 1; if (mk) text = text.replace(MARKS_RE, '').trim();
      q = { s: section, n: +qm[1], text, options: [], stmts: [], marks, marks_: [] };
      const inl = inlineOptions(text); if (inl) { q.text = text.slice(0, text.search(/(?:^|\s)\(?a\s*[.)]/i)).trim(); q.options = inl; q.inlineHi = L.hi; q.inlineBold = L.bold; }
      continue;
    }
    if (q && !q.options.length && !q.stmts.length) q.text += ' ' + L.text; /* the question carries on to the next line */
  }
  finish();
  if (!questions.length) throw new PaperError('No numbered questions were found. Number each question (1. 2. 3.) and put its options on lines starting a) b) c) d).');
  return { file: file || 'question paper.docx', bank: [], questions: questions.map(shape) };
}

/* what the review screen needs: type, options, the marked answer if one was found, and how it was found */
function shape(q) {
  const base = { s: q.s, n: q.n, text: q.text, marks: q.marks };
  if (q.options.length !== 4) return { ...base, type: 'other', options: q.options, stmts: q.stmts, correct: '', how: q.options.length ? 'Has ' + q.options.length + ' options; only questions with four options (a to d) can be imported.' : 'No options a) to d) were found under this question, so it cannot be imported.' };
  let correct = '', how = 'No answer is marked in the file. Choose it here.';
  const pick = (test, label) => { const hits = q.options.map((o, i) => test(i) ? i : -1).filter(i => i >= 0); if (hits.length === 1) { correct = hits[0]; how = 'Answer found in the file: option ' + 'ABCD'[hits[0]] + ', in ' + label + '.'; return true; } return false; };
  if (q.inlineHi != null) {
    pick(i => q.inlineHi && q.options[i] && q.inlineHi.includes(q.options[i]), 'yellow highlight') || pick(i => q.inlineBold && q.options[i] && q.inlineBold.includes(q.options[i]), 'bold');
  } else {
    pick(i => q.marks_[i] && q.marks_[i].hi.length >= Math.min(3, q.options[i].length), 'yellow highlight') || pick(i => q.marks_[i] && q.marks_[i].bold.length >= Math.min(3, q.options[i].length), 'bold');
  }
  return { ...base, type: q.stmts.length ? 'combo' : 'single', options: q.options, stmts: q.stmts.length ? q.stmts : undefined, correct, how };
}
