/* Student (and class assistant): home, weekly reading, exams and certificates, materials, profile. */
import { S, ME, TODAY } from '../state.js';
import { fd, fdl } from '/shared/dates.js';
import { esc, chip, pct, opts, act, pageHead } from '../ui.js';
import {
  cls, course, courseLabel, topicOf, teacherName, weeksDone, stuStats, best, taken, semResult, subName, BELIEF,
  thisWeek, lastWeek, wkLabel, TG, rd, metBoth, myStudent, matHref, loc, examState, examSubs, chaptersFor
} from '../logic.js';
import { chapterWindow, chapterState, PASS } from '/shared/grading.js';
import { myCallsCard } from './shared.js';
import { addDays } from '/shared/dates.js';
import { nextCard, lessonCard } from './teacher.js';

function readingCard(s, c) {
  const lw = lastWeek(), tw = thisWeek(), t = TG();
  const f = S.form.rd || (S.form.rd = { week: rd(s.id, lw) ? tw : lw });
  const e = rd(s.id, f.week) || {};
  const books = S.shares.filter(x => x.cid === c.id).map(x => S.materials.find(m => m.id === x.mid)).filter(m => m && m.type === 'Book');
  const bar = (v, tt) => '<div class="meter" aria-hidden="true"><i style="width:' + (tt ? Math.min(100, Math.round((v || 0) / tt * 100)) : 100) + '%"></i></div>';
  const hist = [0, 1, 2, 3].map(i => addDays(lw, -7 * i)).map(w => {
    const x = rd(s.id, w);
    return '<div class="row"><div><div class="b">' + wkLabel(w) + '</div><div class="sub small">' + (x ? x.ayat + ' of ' + t.ayat + ' ayat · ' + x.pages + ' of ' + t.pages + ' pages' : 'Nothing logged') + '</div></div>' + (x ? (metBoth(x) ? chip('ok', 'Target met') : chip('gold', 'Below target')) : chip('mute', 'Not logged')) + '</div>';
  }).join('');
  return '<section class="card" id="reading"><div class="card-h"><div class="eyebrow">Weekly reading</div>' + chip('mute', 'Target: ' + t.ayat + ' ayat and ' + t.pages + ' pages a week') + '</div>' +
    '<div class="seg"><button type="button" class="pick' + (f.week === lw ? ' on' : '') + '" aria-pressed="' + (f.week === lw) + '" data-act="rdWeek" data-arg="' + lw + '">Last week</button><button type="button" class="pick' + (f.week === tw ? ' on' : '') + '" aria-pressed="' + (f.week === tw) + '" data-act="rdWeek" data-arg="' + tw + '">This week</button></div>' +
    '<div class="sub small">' + wkLabel(f.week) + (f.week === lw ? ' · you can add or change last week until the end of this week' : '') + '</div>' +
    '<form data-form="rdSave" style="display:flex;flex-direction:column;gap:12px"><div class="form">' +
      '<div class="field"><label for="rd-a">Ayat recited</label><input id="rd-a" name="ayat" type="number" inputmode="numeric" min="0" max="6236" value="' + (e.ayat == null ? '' : e.ayat) + '" required></div>' +
      '<div class="field"><label for="rd-p">Pages read</label><input id="rd-p" name="pages" type="number" inputmode="numeric" min="0" max="2000" value="' + (e.pages == null ? '' : e.pages) + '" required></div></div>' +
      '<div class="field"><label for="rd-b">Book</label><select id="rd-b" name="book">' + opts(books.map(m => [m.id, m.title]).concat([['', 'Another book']]), e.book == null ? (books[0] ? books[0].id : '') : e.book) + '</select></div>' +
      (e.ayat != null ? '<div class="small">Ayat: ' + e.ayat + ' of ' + t.ayat + '</div>' + bar(e.ayat, t.ayat) + '<div class="small">Pages: ' + e.pages + ' of ' + t.pages + '</div>' + bar(e.pages, t.pages) : '') +
      '<div class="btns"><button class="btn primary" type="submit">' + (e.ayat != null ? 'Update reading' : 'Save reading') + '</button></div></form>' +
    '<div><div class="eyebrow" style="margin-bottom:4px">Last 4 weeks</div><div class="rows">' + hist + '</div></div></section>';
}

/* One certificate per passed semester, and one per completed course. Results are looked up by the class the
   exam was taken in, so semesters passed before a student moved class still count. */
export function certsFor(s) {
  const c = cls(s.classId); const out = [];
  /* every level this student has studied, the current one first: moving up a level keeps earlier certificates */
  (s.completed || []).forEach(x => out.push({ key: x.course + '|done', title: course(x.course).name + ' · Course completed', line: 'has completed the ' + course(x.course).name + ' course', no: x.cid + '-C-' + s.id.toUpperCase() }));
  const levels = [...new Set([c.course, ...(s.completed || []).map(x => x.course)])];
  levels.forEach(co => {
    for (let sem = co === c.course ? c.sem : course(co).sems; sem >= 1; sem--) {
      const r = S.results.find(r => r.sid === s.id && r.course === co && r.sem === sem && S.published[r.cid + '|' + sem]);
      if (r && semResult(s.id, co, sem) === 'pass') out.push({ key: co + '|' + sem, title: course(co).name + ' · Semester ' + sem, line: 'has passed Semester ' + sem + (BELIEF[sem - 1] ? ' (' + BELIEF[sem - 1] + ')' : '') + ' of the ' + course(co).name + ' course', no: r.cid + '-S' + sem + '-' + s.id.toUpperCase() });
    }
  });
  /* a chapter completed: its chapter paper passed (best attempt) */
  const chapters = new Map();
  S.results.filter(r => r.sid === s.id && r.chapter && r.pct != null && r.pct >= PASS).forEach(r => { const k = [r.course, r.sem, r.sub, r.chapter].join('|'); if (!chapters.has(k) || chapters.get(k).pct < r.pct) chapters.set(k, r); });
  [...chapters.entries()].sort((a, b) => b[1].sem - a[1].sem || a[1].sub.localeCompare(b[1].sub) || b[1].chapter - a[1].chapter).forEach(([k, r]) => {
    const title = (S.chapterTitles || {})[[r.course, r.sem, r.sub, r.chapter].join('-')]; const subj = subName(r.sub);
    out.push({ key: k, title: subj + ' · Chapter ' + r.chapter + (title ? ': ' + title : '') + ' (' + course(r.course).name + ' Semester ' + r.sem + ')',
      line: 'has completed Chapter ' + r.chapter + (title ? ', ' + title + ',' : '') + ' of ' + subj + ' in Semester ' + r.sem + ' of the ' + course(r.course).name + ' course, scoring ' + r.pct + '% in the chapter paper',
      no: r.cid + '-S' + r.sem + '-' + r.sub.toUpperCase() + r.chapter + '-' + s.id.toUpperCase(), date: r.date });
  });
  return out;
}

const noClass = () => '<section class="card"><p class="empty">You are not in a class yet. Your coordinator will add you to one.</p></section>';

/* the tasks given to this person at a weekly coordination call, soonest first, until they mark them done */
function myTasksCard(s) {
  const list = S.actions.filter(a => a.ownerSid === s.id && !a.done).sort((a, b) => a.due < b.due ? -1 : 1); if (!list.length) return '';
  return '<section class="card"><div class="card-h"><div class="eyebrow">My tasks</div>' + chip(list.some(a => a.due < TODAY) ? 'warn' : 'gold', list.length + ' open') + '</div><div class="rows">' + list.map(a => {
    const late = a.due < TODAY; const l = loc(a.loc);
    return '<div class="row"><div><div class="b">' + esc(a.text) + '</div><div class="small ' + (late ? 'warn-t' : 'sub') + '">Due ' + fd(a.due) + (late ? ' · overdue' : '') + (l ? ' · ' + esc(l.name) : '') + '</div>' +
      (a.callDate ? '<div class="sub small">From the call of ' + fd(a.callDate) + (a.quote ? ': “' + esc(a.quote) + '”' : '') + '</div>' : '') + '</div>' + act('taskDone', a.id, 'Mark done') + '</div>';
  }).join('') + '</div></section>';
}

export function viewStudentHome() {
  const s = myStudent(); const c = s && cls(s.classId);
  if (!c) return '<div><div class="sub">Salaamun alaykum</div><h1>' + esc(ME.name) + '</h1></div>' + (s ? myTasksCard(s) + myCallsCard() : '') + noClass();
  const st = stuStats(s); const w = weeksDone(c.id); const k = course(c.course);
  const tolog = c.assistantId === s.id ? S.sessions.filter(x => x.classId === c.id && x.held && !x.logged) : [];
  const open = examState(c) === 'open' && examSubs().some(k => !taken(s.id, c.course, c.sem, k.key, c.id));
  if (c.status === 'completed') return '<div><div class="sub">Salaamun alaykum</div><h1>' + esc(s.name) + '</h1></div>' + myTasksCard(s) + myCallsCard() +
    '<section class="card"><div class="eyebrow">Course complete</div><p>' + ((s.completed || []).some(x => x.cid === c.id) ? 'You have completed the ' + esc(k.name) + ' course with ' + esc(c.id) + '. Your certificate is under Exams.' : esc(c.id) + ' has finished the ' + esc(k.name) + ' course. Your coordinator will be in touch about what comes next.') + '</p></section>';
  return '<div><div class="sub">Salaamun alaykum</div><h1>' + esc(s.name) + '</h1></div>' + myTasksCard(s) + myCallsCard() +
    (tolog.length ? '<section class="card" style="background:var(--gold-tint);border-color:var(--gold-ink)"><div class="eyebrow" style="color:var(--gold-ink)">To log · class assistant</div>' + tolog.map(x => '<div class="row" style="border-top:0;padding:0"><div><div class="b">' + fdl(x.date) + ' session</div><div class="small gold-t">Not logged yet</div></div>' + act('logOpen', x.id, 'Log now', 'btn primary') + '</div>').join('') + '</section>' : '') +
    (open ? '<section class="card"><div class="row" style="border-top:0;padding:0"><div><div class="b">Your Semester ' + c.sem + ' exams are open</div><div class="sub small">Take them from the Exams tab</div></div>' + act('nav', 'exams', 'Go to Exams', 'btn primary') + '</div></section>' : '') +
    (c.teacherId ? nextCard(c, s.tzOff ?? 5.5, s.tzName || 'India', '<div>' + esc(courseLabel(c)) + ' · ' + esc(topicOf(c)) + ' · with ' + esc(teacherName(c.teacherId)) + '</div>') : '<section class="card"><p>Your class is waiting for a teacher to be assigned.</p></section>') +
    lessonCard(c, w + 1, 'This week · ' + (w + 1 <= k.weeks ? 'week ' + (w + 1) : 'exam')) + (c.course !== 'INR' ? readingCard(s, c) : '') +
    '<section class="card"><div class="eyebrow">My progress</div><div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><div class="t-v">' + (w + 1 <= k.weeks ? 'Week ' + (w + 1) + ' of ' + k.weeks : 'Exam week') + '</div><div class="t-s">Semester ' + c.sem + ' of ' + k.sems + '</div></div><div><div class="t-v">' + pct(st.pct) + '</div><div class="t-s">Attendance this semester</div></div></div>' +
      '<div class="sems" style="grid-template-columns:repeat(' + Math.min(k.sems, 5) + ',minmax(0,1fr))">' + Array.from({ length: k.sems }, (_, i) => '<span class="' + (i + 1 < c.sem ? 'done' : i + 1 === c.sem ? 'now' : '') + '">' + (i + 1) + (i + 1 < c.sem ? ' · Passed' : i + 1 === c.sem ? ' · Now' : '') + '</span>').join('') + '</div></section>';
}

/* Chapter papers: one per chapter of each subject that has them. Your teacher (or the location responsible)
   opens each one for the class, usually once the chapter is finished; one that is not taken counts as 0. */
function chapterPapersCard(s, c) {
  const subs = S.subjects.filter(x => x.exam && chaptersFor(c.course, c.sem, x.key).length); if (!subs.length) return '';
  return '<section class="card"><div class="eyebrow">Chapter papers</div><div class="sub small">Each chapter of each subject has a paper of about 12 questions. Your teacher opens it for a few days once your class has finished the chapter. If you score below 50%, you can sit it again while it is open; your best mark counts. Chapter papers make up half of each subject\'s mark; a paper you miss counts as 0.</div>' +
    subs.map(x => '<div class="rows">' + chaptersFor(c.course, c.sem, x.key).map(n => {
      const key = c.course + '-' + c.sem + '-' + x.key + '-' + n; const title = (S.chapterTitles || {})[key];
      const w = chapterWindow(c, x.key, n); const st = chapterState(w, TODAY);
      /* the best attempt counts; below the pass mark the paper can be sat again while it is open */
      const tries = S.results.filter(r => r.sid === s.id && r.cid === c.id && r.course === c.course && r.sem === c.sem && r.sub === x.key && r.chapter === n);
      const done = tries.slice().sort((a, b) => (b.pct || 0) - (a.pct || 0))[0]; const passed = done && done.pct >= PASS;
      const right = done ? chip(passed ? 'ok' : 'warn', done.pct + '%' + (passed ? ' · passed' : ' · below 50%') + (tries.length > 1 ? ' (best of ' + tries.length + ')' : '')) +
          (passed ? act('cert', [c.course, c.sem, x.key, n].join('|'), 'Certificate') : st === 'open' ? act('examStart', 'CH-' + key, 'Retake paper', 'btn primary') : '')
        : st === 'open' ? act('examStart', 'CH-' + key, 'Start paper', 'btn primary') + '<div class="small gold-t">Open until ' + fd(w.to) + '</div>'
        : st === 'over' ? chip('warnfill', 'Missed · counts as 0')
        : chip('mute', st === 'upcoming' ? 'Opens ' + fd(w.from) : 'Not opened yet');
      return '<div class="row"><div><div class="b">' + esc(x.name) + ' · Chapter ' + n + (title ? ': ' + esc(title) : '') + '</div></div><div class="btns" style="align-items:center">' + right + '</div></div>';
    }).join('') + '</div>').join('') + '</section>';
}

export function viewStudentExams() {
  const s = myStudent(); const c = s && cls(s.classId); if (!c) return pageHead('Exams and certificates', '') + noClass();
  const st = examState(c); const subs = examSubs(); const pubNow = S.published[c.id + '|' + c.sem];
  const resRows = sem => '<div class="rows">' + S.subjects.filter(x => x.exam).map(x => x.key).map(kk => { const v = best(s.id, c.course, sem, kk); return '<div class="row"><div>' + esc(subName(kk)) + '</div><div class="b num">' + (v === null ? 'Not taken' : v + '%') + '</div>' + (v === null ? '' : v >= 50 ? chip('ok', 'Pass') : chip('warn', 'Fail')) + '</div>'; }).join('') + '</div>';
  /* a subject's semester exam: not taken, passed, or below the pass mark (which can be sat again while the window is open) */
  const examOf = k => { const rs = S.results.filter(r => r.sid === s.id && r.cid === c.id && r.course === c.course && r.sem === c.sem && r.sub === k && !r.chapter); return { n: rs.length, passed: rs.some(r => r.pct != null ? r.pct >= PASS : !r.below) }; };
  const openRows = () => '<div class="b">Semester ' + c.sem + ' exams are open until ' + fd(c.exam.to) + '</div><div class="sub small">If you score below 50% in a subject, you can sit its exam again while the window is open; your best mark counts.</div><div class="rows">' + subs.map(k => {
    const x = examOf(k.key); const start = 'Start exam'; const id = c.course + '-' + c.sem + '-' + k.key;
    return '<div class="row"><div>' + esc(k.name) + (k.key === 'b' ? ' · ' + topicOf(c) : '') + '</div><div class="btns" style="align-items:center">' +
      (!x.n ? act('examStart', id, start, 'btn primary') : x.passed ? chip(pubNow ? 'ok' : 'gold', pubNow ? 'Passed' : 'Submitted · result awaits publishing') : chip('warn', 'Below 50%' + (x.n > 1 ? ' after ' + x.n + ' attempts' : '')) + act('examStart', id, 'Retake exam', 'btn primary')) + '</div></div>';
  }).join('') + '</div>';
  let exam;
  if (st === 'open') exam = openRows() + (pubNow ? '<div class="b" style="margin-top:10px">Semester ' + c.sem + ' results</div>' + resRows(c.sem) : '');
  else if (pubNow) exam = '<div class="b">Semester ' + c.sem + ' results</div>' + resRows(c.sem);
  else exam = '<div><div class="b">Semester ' + c.sem + ' exams: ' + (st === 'upcoming' ? fd(c.exam.from) + ' to ' + fd(c.exam.to) : st === 'over' ? 'the window has closed' : 'dates to be announced by your teacher') + '</div><div class="sub small">' + esc(subs.map(k => k.name).join(', ')) + '. A Start exam button appears here when the window opens.</div></div>';
  const prev = c.sem > 1 && S.published[c.id + '|' + (c.sem - 1)] ? '<div class="b">Semester ' + (c.sem - 1) + ' results</div>' + resRows(c.sem - 1) : '';
  const certs = certsFor(s);
  return pageHead('Exams and certificates', esc(courseLabel(c))) +
    chapterPapersCard(s, c) +
    '<section class="card"><div class="eyebrow">Exams</div>' + exam + prev + '</section>' +
    '<section class="card"><div class="eyebrow">Certificates</div><div class="rows">' + (certs.map(x => '<div class="row"><div><div class="b">' + esc(x.title) + '</div></div>' + act('cert', x.key, 'View') + '</div>').join('') || '<p class="empty">Certificates appear here when results are published.</p>') + '</div></section>';
}

export function viewStudentMaterials() {
  const s = myStudent(); const c = s && cls(s.classId); if (!c) return pageHead('Materials', '') + noClass();
  const sh = S.shares.filter(x => x.cid === c.id && S.materials.some(m => m.id === x.mid)).sort((a, b) => a.date < b.date ? 1 : -1);
  const item = x => {
    const m = S.materials.find(y => y.id === x.mid); const book = m.type === 'Book'; const href = matHref(m);
    const read = book ? S.reading.filter(r => r.sid === s.id && r.book === m.id).reduce((t, r) => t + r.pages, 0) : 0;
    return '<div class="row"><div><div class="b">' + esc(m.title) + '</div><div class="sub small">' + esc(m.type) + (book && m.pages ? ' · ' + m.pages + ' pages' : '') + ' · shared by ' + esc(x.by) + ' on ' + fd(x.date) + '</div>' +
      (book && m.pages ? '<div class="small">You have logged ' + Math.min(read, m.pages) + ' of ' + m.pages + ' pages</div><div class="meter" aria-hidden="true"><i style="width:' + Math.min(100, Math.round(read / m.pages * 100)) + '%"></i></div>' : '') + '</div><div class="btns">' +
      (href ? act('readOpen', m.id, 'Read') : act('toast', 'Your teacher will share the file for this item soon.', 'Read')) + '</div></div>';
  };
  const isBook = x => S.materials.find(m => m.id === x.mid).type === 'Book';
  return pageHead('Materials', 'Shared by your teacher with ' + c.id) +
    '<section class="card"><div class="eyebrow">Books to read</div><div class="rows">' + (sh.filter(isBook).map(item).join('') || '<p class="empty">No books shared yet.</p>') + '</div></section>' +
    '<section class="card"><div class="eyebrow">Syllabus and materials</div><div class="rows">' + (sh.filter(x => !isBook(x)).map(item).join('') || '<p class="empty">Your teacher has not shared anything yet.</p>') + '</div></section>';
}

export function viewStudentProfile() {
  const s = myStudent(); const c = s && cls(s.classId); const prefs = (s && s.prefs) || {};
  const r = (l, v) => '<div class="row"><div class="sub">' + l + '</div><div class="b">' + v + '</div></div>';
  const sw = (key, label) => '<div class="row"><div id="sw-' + key + '" class="b">' + label + '</div><button type="button" role="switch" aria-checked="' + !!prefs[key] + '" aria-labelledby="sw-' + key + '" class="pick' + (prefs[key] ? ' on' : '') + '" style="width:88px" data-act="pref" data-arg="' + key + '">' + (prefs[key] ? 'On' : 'Off') + '</button></div>';
  const l = c && loc(c.loc);
  return pageHead(esc(ME.name), 'Student' + (c && c.assistantId === s.id ? ' · class assistant' : '') + (c ? ' · ' + c.id : '')) +
    (c ? '<section class="card"><div class="eyebrow">Details</div><div class="rows">' + r('Class', c.id) + r('Course', esc(courseLabel(c))) + r('Teacher', esc(teacherName(c.teacherId) || 'Awaiting teacher')) + r('Location', esc(l ? l.name : c.loc)) + r('Time zone', esc(s.tzName || 'India')) + '</div></section>' : '') +
    (s ? '<section class="card"><div class="eyebrow">Reminders</div><div class="rows">' + sw('email', 'Email reminders') + sw('wa', 'WhatsApp reminders') + sw('absence', 'Reminders when I miss a class') + '</div></section>' : '') +
    '<section class="card"><div class="eyebrow">Account</div><div class="btns">' + act('pwOpen', '', 'Change password') + '</div></section>';
}
