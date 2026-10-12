/* Student (and class assistant): home, weekly reading, exams and certificates, materials, profile. */
import { S, ME, TODAY } from '../state.js';
import { fd, fdl } from '/shared/dates.js';
import { esc, chip, pct, opts, act, pageHead } from '../ui.js';
import {
  cls, course, courseLabel, topicOf, teacherName, weeksDone, stuStats, best, taken, semResult, subName, BELIEF,
  thisWeek, lastWeek, wkLabel, TG, rd, metBoth, myStudent, matHref, loc
} from '../logic.js';
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

export function certsFor(s) {
  const c = cls(s.classId); const out = [];
  for (let sem = c.sem; sem >= 1; sem--) if (S.published[c.id + '|' + sem] && semResult(s.id, c.course, sem) === 'pass') out.push({ key: c.course + '|' + sem, title: course(c.course).name + ' · Semester ' + sem, line: 'has passed Semester ' + sem + (BELIEF[sem - 1] ? ' (' + BELIEF[sem - 1] + ')' : '') + ' of the ' + course(c.course).name + ' course', no: c.id + '-S' + sem + '-' + s.id.toUpperCase() });
  return out;
}

const noClass = () => '<section class="card"><p class="empty">You are not in a class yet. Your coordinator will add you to one.</p></section>';

export function viewStudentHome() {
  const s = myStudent(); const c = s && cls(s.classId);
  if (!c) return '<div><div class="sub">Salaamun alaykum</div><h1>' + esc(ME.name) + '</h1></div>' + noClass();
  const st = stuStats(s); const w = weeksDone(c.id); const k = course(c.course);
  const tolog = c.assistantId === s.id ? S.sessions.filter(x => x.classId === c.id && x.held && !x.logged) : [];
  const open = S.exams.some(e => e.course === c.course && e.sem === c.sem && e.open && !taken(s.id, e.course, e.sem, e.sub));
  return '<div><div class="sub">Salaamun alaykum</div><h1>' + esc(s.name) + '</h1></div>' +
    (tolog.length ? '<section class="card" style="background:var(--gold-tint);border-color:var(--gold-ink)"><div class="eyebrow" style="color:var(--gold-ink)">To log · class assistant</div>' + tolog.map(x => '<div class="row" style="border-top:0;padding:0"><div><div class="b">' + fdl(x.date) + ' session</div><div class="small gold-t">Not logged yet</div></div>' + act('logOpen', x.id, 'Log now', 'btn primary') + '</div>').join('') + '</section>' : '') +
    (open ? '<section class="card"><div class="row" style="border-top:0;padding:0"><div><div class="b">Your Semester ' + c.sem + ' exams are open</div><div class="sub small">Take them from the Exams tab</div></div>' + act('nav', 'exams', 'Go to Exams', 'btn primary') + '</div></section>' : '') +
    (c.teacherId ? nextCard(c, s.tzOff ?? 5.5, s.tzName || 'India', '<div>' + esc(courseLabel(c)) + ' · ' + esc(topicOf(c)) + ' · with ' + esc(teacherName(c.teacherId)) + '</div>') : '<section class="card"><p>Your class is waiting for a teacher to be assigned.</p></section>') +
    lessonCard(c, w + 1, 'This week · ' + (w + 1 <= k.weeks ? 'week ' + (w + 1) : 'exam')) + (c.course !== 'INR' ? readingCard(s, c) : '') +
    '<section class="card"><div class="eyebrow">My progress</div><div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><div class="t-v">' + (w + 1 <= k.weeks ? 'Week ' + (w + 1) + ' of ' + k.weeks : 'Exam week') + '</div><div class="t-s">Semester ' + c.sem + ' of ' + k.sems + '</div></div><div><div class="t-v">' + pct(st.pct) + '</div><div class="t-s">Attendance this semester</div></div></div>' +
      '<div class="sems" style="grid-template-columns:repeat(' + Math.min(k.sems, 5) + ',minmax(0,1fr))">' + Array.from({ length: k.sems }, (_, i) => '<span class="' + (i + 1 < c.sem ? 'done' : i + 1 === c.sem ? 'now' : '') + '">' + (i + 1) + (i + 1 < c.sem ? ' · Passed' : i + 1 === c.sem ? ' · Now' : '') + '</span>').join('') + '</div></section>';
}

export function viewStudentExams() {
  const s = myStudent(); const c = s && cls(s.classId); if (!c) return pageHead('Exams and certificates', '') + noClass();
  const ex = S.exams.filter(e => e.course === c.course && e.sem === c.sem); const open = ex.some(e => e.open); const pubNow = S.published[c.id + '|' + c.sem];
  const resRows = sem => '<div class="rows">' + S.subjects.filter(x => x.exam).map(x => x.key).map(kk => { const v = best(s.id, c.course, sem, kk); return '<div class="row"><div>' + esc(subName(kk)) + '</div><div class="b num">' + (v === null ? 'Not taken' : v + '%') + '</div>' + (v === null ? '' : v >= 50 ? chip('ok', 'Pass') : chip('warn', 'Fail')) + '</div>'; }).join('') + '</div>';
  let exam;
  if (pubNow) exam = '<div class="b">Semester ' + c.sem + ' results</div>' + resRows(c.sem);
  else if (open) exam = '<div class="b">Semester ' + c.sem + ' exams are open until ' + fd(ex[0].to) + '</div><div class="rows">' + ex.map(e => { const done = taken(s.id, e.course, e.sem, e.sub); return '<div class="row"><div>' + esc(subName(e.sub)) + (e.sub === 'b' ? ' · ' + topicOf(c) : '') + '</div>' + (done ? chip('gold', 'Submitted · result awaits publishing') : e.open ? act('examStart', e.id, 'Start exam', 'btn primary') : chip('mute', 'Not open')) + '</div>'; }).join('') + '</div>';
  else exam = '<div><div class="b">Semester ' + c.sem + ' exams: ' + (ex.length ? fd(ex[0].from) + ' to ' + fd(ex[0].to) : 'dates to be announced') + '</div><div class="sub small">Belief, Islamic Laws and Ethics. A Start exam button appears here when the window opens.</div></div>';
  const prev = c.sem > 1 && S.published[c.id + '|' + (c.sem - 1)] ? '<div class="b">Semester ' + (c.sem - 1) + ' results</div>' + resRows(c.sem - 1) : '';
  const certs = certsFor(s);
  return pageHead('Exams and certificates', esc(courseLabel(c))) +
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
      (href ? '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(href) + '" target="_blank" rel="noopener">' + (book ? 'Read' : 'Open') + '</a>' : act('toast', 'Your teacher will share the file for this item soon.', book ? 'Read' : 'Open')) + '</div></div>';
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
