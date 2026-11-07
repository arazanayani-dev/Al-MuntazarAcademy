/* Chapter papers and the combined subject mark, shared by the server and the browser so both agree.

   Each subject (Belief, Islamic Laws, Ethics) whose syllabus was split into chapters has one paper per
   chapter. A class's teacher or location responsible opens each chapter paper for that class between two
   dates (c.chapterExams), usually once the class has finished the chapter; the syllabus chart says which week
   that is. The subject mark is then 50% the average of the chapter papers (a paper not taken counts as 0)
   and 50% the semester exam; without chapter papers it is the semester exam alone. Best attempt counts. */
export const CHAPTER_WEIGHT = 0.5;
export const CHAPTER_DAYS = 7; /* a chapter paper's window, unless its opener chooses other dates */
export const PASS = 50;

/* chapter numbers that have a paper for a course, semester and subject; counts is { 'BAS-2-b-3': 12, ... } */
export function chapterList(counts, course, sem, sub) {
  const pre = course + '-' + sem + '-' + sub + '-';
  return Object.keys(counts || {}).filter(k => k.startsWith(pre) && counts[k] > 0).map(k => +k.slice(pre.length)).sort((a, b) => a - b);
}

export const chapterKey = (sem, sub, n) => sem + '-' + sub + '-' + n;
/* the window class c's chapter paper is open in ({ from, to, closed, by }), or null while not opened */
export const chapterWindow = (c, sub, n) => (c.chapterExams || {})[chapterKey(c.sem, sub, n)] || null;
export const chapterState = (w, today) => !w ? 'none' : w.closed || today > w.to ? 'over' : today < w.from ? 'upcoming' : 'open';
/* when the class finishes chapter n of a subject, by the syllabus chart: { week } and, once that week's
   session is logged, { week, on }; null when the chart does not say */
export function chapterDue(c, sub, n, sessions, chartData) {
  const maps = ((chartData || {})[c.course + '-' + c.sem] || {}).maps; const map = maps && maps[sub];
  if (!Array.isArray(map)) return null;
  let last = -1; map.forEach((chs, i) => { if (Array.isArray(chs) && chs.includes(n)) last = i; });
  if (last < 0) return null;
  const week = last + 1;
  const x = (sessions || []).find(s => s.classId === c.id && (s.sem || c.sem) === c.sem && s.held && s.logged && s.week === week);
  return x ? { week, on: x.date } : { week };
}

/* the subject mark from one student's results for that course, semester and subject; null while the
   semester exam has not been taken (or has no published mark) */
export function subjectMark(results, chapters) {
  const marks = rs => rs.filter(r => r.pct != null).map(r => r.pct);
  const examMarks = marks(results.filter(r => !r.chapter)); const exam = examMarks.length ? Math.max(...examMarks) : null;
  if (!chapters || !chapters.length) return exam;
  if (exam == null) return null;
  const each = chapters.map(n => { const m = marks(results.filter(r => r.chapter === n)); return m.length ? Math.max(...m) : 0; });
  const avg = each.reduce((a, b) => a + b, 0) / each.length;
  return Math.round(CHAPTER_WEIGHT * avg + (1 - CHAPTER_WEIGHT) * exam);
}
/* the parts, for showing how a mark was made */
export function markParts(results, chapters) {
  const marks = rs => rs.filter(r => r.pct != null).map(r => r.pct);
  const examMarks = marks(results.filter(r => !r.chapter));
  const each = (chapters || []).map(n => { const m = marks(results.filter(r => r.chapter === n)); return m.length ? Math.max(...m) : null; });
  return { exam: examMarks.length ? Math.max(...examMarks) : null, chapters: each, average: each.length ? Math.round(each.reduce((a, b) => a + (b || 0), 0) / each.length) : null };
}
