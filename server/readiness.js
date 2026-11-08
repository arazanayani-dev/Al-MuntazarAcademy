/* Syllabus readiness: before teaching a subject's syllabus, a teacher works through its training in the app —
   the syllabus itself, then every approved teacher's guide, book, video and other material tagged to that
   course, semester and subject — and passes a readiness quiz drafted from the syllabus and the teacher's guide.
   It is required of every teacher with an active class in the syllabus's course and semester, so a teacher given
   such a class later gets it too; a new file version is a new item to read.

   Progress is kept per teacher and item in 'readiness' (id teacher|file, or teacher|link:material for a video
   link). PDFs and Word files are tracked page by page (30 seconds a page); a video or picture counts once it has
   been open long enough. The quiz attempts are kept on the syllabus's record. Not being ready is flagged, never
   blocking. */
import { pdfPages } from './pdftext.js';
import { docxText } from './docx.js';
import { approved, canSeeMaterial } from './access.js';
import { fileBytes, loadFile } from './files.js';
import { readUnits } from '../public/shared/readunits.js';
import { readKind } from '../public/shared/readkind.js';
import { addDays } from '../public/shared/dates.js';
import { teacherTitle } from '../public/shared/teachername.js';

export const READ_SECS = 30;   /* seconds on a page (or a Word section or picture) for it to count as read */
export const VIEW_SECS = 120;  /* seconds a video (or Google Drive item) must be open for it to count as watched */
export const QUIZ_SIZE = 15;   /* questions drawn for each attempt */
export const QUIZ_MIN = 5;     /* approved questions needed before the quiz opens */
export const QUIZ_PASS = 80;
export const RETAKE_DAYS = 1;
/* kinds the in-app reader can show, and so track; outside links and unreadable files are left out */
const TRACKED = ['pdf', 'word', 'image', 'youtube', 'drive'];
const PAGED = ['pdf', 'word'];

const unitCache = new Map(); /* fileId -> number of pages (PDF) or sections (Word) */
export function configureReadiness() {}

/* pages of a PDF or sections of a Word file, from its contents (0 when they cannot be read) */
export function countUnits(buf, name) {
  try { return /\.pdf$/i.test(name) ? pdfPages(buf).length : /\.docx$/i.test(name) ? readUnits(docxText(buf)).length : 0; } catch { return 0; }
}
/* pages of a PDF, or sections of a Word file; 0 when the file cannot be read (the reader's count is used then).
   Counted when the file is uploaded (f.units); older files are counted from the data folder. */
export function unitsOf(store, fileId) {
  const f = store.find('files', fileId); if (!f) return 0;
  if (f.units) return f.units;
  if (unitCache.has(fileId)) return unitCache.get(fileId);
  let buf; try { buf = fileBytes(f); } catch { return 0; } /* in storage and not loaded yet: not remembered as 0 */
  const n = countUnits(buf, f.name); unitCache.set(fileId, n); return n;
}
/* the text of a PDF or Word file, for drafting questions from it ('' when it cannot be read) */
export async function fileText(store, fileId) {
  const f = store.find('files', fileId); if (!f) return '';
  try { const buf = await loadFile(f); return /\.pdf$/i.test(f.name) ? pdfPages(buf).join('\n') : /\.docx$/i.test(f.name) ? docxText(buf).map(p => p.text).join('\n') : ''; } catch { return ''; }
}

export const recordId = (tid, m) => tid + '|' + (m.fileId || 'link:' + m.id);
export const needFor = m => ['youtube', 'drive'].includes(readKind(m)) ? VIEW_SECS : READ_SECS;
export const unitsFor = (store, m, rec) => PAGED.includes(readKind(m)) ? (unitsOf(store, m.fileId) || (rec && rec.total) || 0) : 1;

const syllabi = store => store.all('materials').filter(m => m.type === 'Syllabus' && m.fileId && approved(m) && m.course !== 'ALL');
/* the approved materials tagged to a syllabus's course, semester and subject that the teacher can open */
export const supportOf = (store, syl, t) => store.all('materials').filter(m => m.id !== syl.id && m.type !== 'Syllabus' && approved(m) &&
  m.course === syl.course && m.sem === syl.sem && m.sub === syl.sub && TRACKED.includes(readKind(m)) && (!t || canSeeMaterial(store, t, m)));
/* teacher's guides with readable text, which the readiness quiz also draws on */
export const guidesOf = (store, syl) => store.all('materials').filter(m => m.type === 'Teacher guide' && approved(m) && m.fileId &&
  m.course === syl.course && m.sem === syl.sem && m.sub === syl.sub && PAGED.includes(readKind(m)));
export const quizQuestions = (store, mid) => store.all('questions').filter(q => q.aud === 'teacher' && q.source === mid && !q.retired && approved(q));

/* What each teacher of these classes must be ready for, with their progress. */
export function readinessRows(store, classes) {
  const req = new Map(); const ms = syllabi(store);
  for (const c of classes) {
    if (c.status !== 'active' || !c.teacherId) continue;
    for (const m of ms) {
      if (m.course !== c.course || (m.sem && m.sem !== c.sem)) continue;
      const id = recordId(c.teacherId, m);
      if (!req.has(id)) req.set(id, { id, tid: c.teacherId, mid: m.id, fileId: m.fileId, cids: [] });
      req.get(id).cids.push(c.id);
    }
  }
  return [...req.values()].map(r => progress(store, r));
}

/* one item of the training: pages read (or time watched) */
export function itemProgress(store, tid, m) {
  const rec = store.find('readiness', recordId(tid, m)) || {}; const pages = rec.pages || {};
  const units = unitsFor(store, m, rec); const need = needFor(m);
  const read = Object.entries(pages).filter(([n, s]) => +n <= units && s >= need).length;
  return { mid: m.id, title: m.title, type: m.type, kind: readKind(m), fileId: m.fileId || null, units, need, read, pages,
    secs: Object.values(pages).reduce((a, s) => a + s, 0), done: units > 0 && read >= units };
}

export function progress(store, r) {
  const m = store.find('materials', r.mid); const t = store.find('teachers', r.tid) || {}; const rec = store.find('readiness', r.id) || {};
  const items = [m, ...supportOf(store, m, t.id ? t : null)].map(x => itemProgress(store, r.tid, x));
  const tries = rec.quiz || []; const passed = tries.find(x => x.pct >= QUIZ_PASS); const last = tries[tries.length - 1];
  const readDone = items.every(i => i.done);
  return {
    ...r, teacher: t.name ? teacherTitle(t) : '', title: m.title, course: m.course, sem: m.sem, sub: m.sub,
    items, itemsDone: items.filter(i => i.done).length, readDone, mins: Math.round(items.reduce((a, i) => a + i.secs, 0) / 60),
    quizReady: quizQuestions(store, r.mid).length >= QUIZ_MIN, guide: guidesOf(store, m).length > 0,
    tries: tries.length, best: tries.length ? Math.max(...tries.map(x => x.pct)) : null, lastPct: last ? last.pct : null, lastOn: last ? last.on : null,
    passedOn: passed ? passed.on : null,
    nextTry: !passed && last ? addDays(last.on, RETAKE_DAYS) : null,
    ready: readDone && !!passed
  };
}
