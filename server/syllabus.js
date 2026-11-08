/* Turns an uploaded syllabus (PDF or Word) into a weekly plan for the Standard Syllabus Chart.
   1. Find the chapters: from the book's index ("Chapter 3 ........ 17" followed by the chapter's title), or
      failing that from "Chapter N" headings in the text, with the page each starts on.
   2. Spread them over the semester's sessions: with fewer chapters than sessions, the longest chapters are
      split into parts and the last session is revision; with more, neighbouring chapters share a session. */
import { pdfPages } from './pdftext.js';
import { docxText } from './docx.js';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const num = s => /^\d+$/.test(s) ? +s : WORDS.indexOf(String(s).toLowerCase());
/* drop Arabic glosses in brackets: PDFs often store them as letter shapes that come out jumbled */
const tidy = t => t.replace(/\s*\([^)]*[؀-ۿﭐ-﷿ﹰ-﻿][^)]*\)/g, '').replace(/[ﭐ-﷿ﹰ-﻿]+/g, '').replace(/\s*\(\s*$/, '').replace(/\s+/g, ' ').trim();

/* chapters from an index page: lines "Title ....... 12" */
function fromIndex(pages) {
  for (const page of pages) {
    const entries = page.split('\n').map(l => l.replace(/^index\s+/i, '').match(/^(.*?)\s*\.{4,}\s*(\d{1,4})\s*$/)).filter(Boolean).map(m => ({ label: m[1].trim(), page: +m[2] }));
    if (entries.length < 3) continue;
    const out = [];
    entries.forEach((e, i) => {
      const ch = e.label.match(/^chapter\s+(\w+)\s*[:.-]?\s*(.*)$/i); if (!ch) return;
      const next = entries[i + 1]; const title = ch[2] || (next && !/^chapter\b/i.test(next.label) ? next.label : '');
      out.push({ n: num(ch[1]) > 0 ? num(ch[1]) : out.length + 1, title: tidy(title) || 'Chapter ' + ch[1], from: e.page });
    });
    if (out.length >= 2) return out;
  }
  return [];
}
/* chapters from "Chapter N Title …" headings, using the page each appears on */
function fromHeadings(pages) {
  const out = []; const onePage = pages.length === 1; /* a Word file is one long page with every chapter in it */
  pages.forEach((page, i) => {
    const lines = page.split('\n');
    for (let j = 0; j < lines.length; j++) {
      const m = lines[j].match(/^chapter\s+(\d{1,2}|[a-z]+)\b[\s:.-]*(.*)$/i); if (!m || num(m[1]) <= 0) continue;
      if (out.some(c => c.n === num(m[1]))) continue;
      /* the title follows on the same line, or on the next line when "Chapter 1" stands alone */
      const rest = m[2] || (lines[j + 1] && lines[j + 1].length <= 80 && !/^chapter\s/i.test(lines[j + 1]) ? lines[j + 1] : '');
      const words = rest.split(/\s+/); let title = []; for (const w of words) { title.push(w); if (/[.?!:]$/.test(w) || title.length >= 8) break; }
      out.push({ n: num(m[1]), title: tidy(title.join(' ').replace(/[.?!:]$/, '')) || 'Chapter ' + m[1], from: i + 1 });
      if (!onePage) break;
    }
  });
  return out.sort((a, b) => a.n - b.n);
}

export function chaptersOf(buf, name) {
  let pages;
  if (/\.pdf$/i.test(name)) pages = pdfPages(buf);
  else if (/\.docx$/i.test(name)) pages = [docxText(buf).map(p => p.text).join('\n')];
  else return { chapters: [], reason: 'Only PDF and Word syllabus files can be read.' };
  if (!pages.some(p => p.trim())) return { chapters: [], reason: 'No text could be read from the file; it may be scanned pictures of pages.' };
  let chapters = fromIndex(pages); const byIndex = chapters.length > 0;
  if (!byIndex) chapters = fromHeadings(pages);
  if (!chapters.length) return { chapters: [], reason: 'No chapters were found. Chapters are found from an index ("Chapter 1 ..... 5") or from headings starting "Chapter 1".' };
  /* a Word file has no pages, so chapters found from its headings have no page numbers */
  if (!byIndex && pages.length === 1) chapters.forEach(c => { c.from = c.to = null; });
  else chapters.forEach((c, i) => { const next = chapters[i + 1]; c.to = next ? Math.max(c.from, next.from - 1) : Math.max(c.from, pages.length > 1 ? pages.length : c.from); });
  attachText(chapters, pages);
  return { chapters };
}

/* Each chapter's own text, for drafting questions from it. Chapters are found by their headings ("Chapter 5",
   "Chapter Two") anywhere in the text, and run to the next chapter's heading; index pages and running headers
   ("Adl ........ 11") are left out. This holds even when a PDF puts two book pages on each page, so printed
   page numbers are only a fall-back for a chapter whose heading cannot be found. */
function attachText(chapters, pages) {
  const leader = l => /\.{4,}\s*\d*\s*$/.test(l) || /\.{8,}/.test(l);
  const lines = [];
  pages.forEach(p => { const ls = p.split('\n'); if (ls.filter(leader).length >= 3) return; /* an index page */ ls.forEach(l => { if (!leader(l)) lines.push(l); }); });
  const head = c => lines.findIndex(l => new RegExp('^chapter\\s+(' + c.n + '|' + (WORDS[c.n] || '#') + ')\\b', 'i').test(l.trim()));
  const at = chapters.map(head);
  if (at.filter(i => i >= 0).length >= Math.ceil(chapters.length / 2)) {
    const found = at.filter(i => i >= 0).sort((a, b) => a - b);
    chapters.forEach((c, i) => { const a = at[i]; if (a < 0) return; const z = found.find(x => x > a); c.text = lines.slice(a, z === undefined ? lines.length : z).join('\n'); });
    if (chapters.every(c => c.text)) return;
  }
  /* fall-back by printed page numbers, for chapters whose heading was not found */
  if (pages.length > 1 && chapters[0].from != null) {
    const key = chapters[0].title.toLowerCase().slice(0, 18); let offset = 0;
    for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) { const p = pages[chapters[0].from - 1 + d]; if (p && !/\.{4,}/.test(p) && p.toLowerCase().includes(key) && /chapter/i.test(p)) { offset = d; break; } }
    chapters.forEach(c => { if (!c.text) c.text = pages.slice(Math.max(0, c.from - 1 + offset), Math.max(c.from, c.to + offset)).join('\n'); });
  }
  chapters.forEach(c => { if (!c.text) c.text = ''; });
}

const pp = (a, b) => a == null ? '' : a === b ? 'p. ' + a : 'pp. ' + a + '–' + b;
/* the weekly plan: one topic per session, with the chapters each session covers ({ text, chapters }) */
export function planDetailed(chapters, weeks) {
  const n = chapters.length; if (!n || weeks < 1) return [];
  const revision = n < weeks; const slots = revision ? weeks - 1 : weeks;
  let out = [];
  if (n >= slots) {
    /* more chapters than sessions: neighbouring chapters share a session */
    for (let s = 0; s < slots; s++) {
      const group = chapters.slice(Math.floor(s * n / slots), Math.floor((s + 1) * n / slots)); const a = group[0], z = group[group.length - 1];
      out.push({ text: group.map(c => c.title).join('; ') + ' (' + (group.length > 1 ? 'Chapters ' + a.n + '–' + z.n : 'Chapter ' + a.n) + (a.from != null ? ', ' + pp(a.from, z.to) : '') + ')', chapters: group.map(c => c.n) });
    }
  } else {
    /* fewer chapters than sessions: split the longest chapters into parts */
    const parts = chapters.map(() => 1); const len = c => c.from != null ? c.to - c.from + 1 : 1;
    for (let total = n; total < slots; total++) { let best = 0; chapters.forEach((c, i) => { if (len(c) / parts[i] > len(chapters[best]) / parts[best]) best = i; }); parts[best]++; }
    chapters.forEach((c, i) => {
      for (let j = 0; j < parts[i]; j++) {
        const a = c.from != null ? c.from + Math.floor(len(c) * j / parts[i]) : null; const z = c.from != null ? c.from + Math.floor(len(c) * (j + 1) / parts[i]) - 1 : null;
        out.push({ text: c.title + (parts[i] > 1 ? ' (' + (j + 1) + ')' : '') + ' (Chapter ' + c.n + (a != null ? ', ' + pp(a, Math.max(a, z)) : '') + ')', chapters: [c.n] });
      }
    });
  }
  if (revision) out.push({ text: 'Revision of chapters ' + chapters[0].n + ' to ' + chapters[n - 1].n + ' and the chapter exercises; preparation for the semester exam', chapters: [] });
  return out.slice(0, weeks);
}
export const planWeeks = (chapters, weeks) => planDetailed(chapters, weeks).map(w => w.text);
