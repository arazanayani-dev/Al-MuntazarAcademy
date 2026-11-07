/* Values worked out from the records: attendance status, results, location metrics, weekly reading. */
import { S, TODAY, ME } from './state.js';
import { addDays, pd, ft, fd, fdl, weekStart, diffDays } from '/shared/dates.js';
import { chip } from './ui.js';
import { chapterList, subjectMark, markParts } from '/shared/grading.js';

export const BELIEF = ['Tauheed', 'Adl', 'Nabuwwat', 'Imamat', 'Maad'];
export const INTRO = ['What is Religion?', 'Misunderstandings about Religion', "Imam Ali's wager", 'Necessary Qualities of a Religion', 'Test and certificate'];
export const MTYPES = ['Syllabus', 'Book', 'Teacher guide', 'Slides', 'Worksheet', 'Reading', 'Video link', 'Other'];
export const ACCESS = { own: 'Own classes', course: 'Course type', all: 'All material' };
export const QTYPE = { single: 'Single choice', combo: 'Statements with combinations', fill: 'Fill in the blank', bank: 'Fill in the blanks from a word bank', match: 'Match the column', ayah: 'Arabic verse and translation' };

export const daysAgo = i => diffDays(i, TODAY);
export const course = c => S.courses.find(x => x.code === c) || { code: c, name: c, sems: 1, weeks: 1 };
export const cls = id => S.classes.find(c => c.id === id);
export const stu = id => S.students.find(s => s.id === id);
export const loc = code => S.locations.find(l => l.code === code);
export const subName = k => { const s = S.subjects.find(s => s.key === k); return s ? s.name : k; };
export const group = g => g === 'F' ? 'Sisters' : 'Brothers';
/* Every session a class has had, across semesters (for date-range reports). */
export const allSessions = cid => S.sessions.filter(x => x.classId === cid).sort((a, b) => a.date < b.date ? -1 : 1);
/* When the class (or its current semester) starts; classes made before start dates were recorded count from their first session. */
export const startOf = c => c.startOn || (allSessions(c.id).filter(x => (x.sem || c.sem) === c.sem)[0] || {}).date || '';
/* Sessions of the class's current semester. Sessions without a semester belong to the current one. */
export const classSessions = cid => { const c = cls(cid); return allSessions(cid).filter(x => !c || (x.sem || c.sem) === c.sem); };
/* A class that has completed its course or been closed takes no more students and drops out of the figures. */
export const ended = c => c.status === 'completed' || c.status === 'closed';
export const classStudents = cid => S.students.filter(s => s.classId === cid);
export const weeksDone = cid => classSessions(cid).filter(x => x.held).length;
/* Academic content is used once approved; records from before approvals have no status and count as approved. */
export const approved = x => !x.status || x.status === 'approved';
export const STATUS = { pending: ['gold', 'Waiting for approval'], rejected: ['warn', 'Sent back'] };
export const statusChip = x => x.status && STATUS[x.status] ? chip(STATUS[x.status][0], STATUS[x.status][1]) : '';
/* A class's exam window for its current semester: 'open', 'upcoming', 'over' or '' (none). */
export function examState(c) {
  const e = c && c.exam; if (!e || e.sem !== c.sem) return '';
  if (e.closed) return 'over';
  return TODAY < e.from ? 'upcoming' : TODAY > e.to ? 'over' : 'open';
}
export const examSubs = () => S.subjects.filter(s => s.exam);
/* approved questions for each examined subject of this course and semester */
export const paperCounts = (co, sem) => examSubs().map(s => ({ s, n: (S.qcount || {})[co + '-' + sem + '-' + s.key] || 0 }));
/* What still stands between a class and moving to its next semester. */
export function semReady(c) {
  const k = course(c.course); const held = weeksDone(c.id);
  return { held, weeks: k.weeks, pub: !!S.published[c.id + '|' + c.sem], last: c.sem >= k.sems, ready: c.status === 'active' && held >= k.weeks && !!S.published[c.id + '|' + c.sem] };
}
/* Course types are levels in list order. A teacher takes classes at their level and below; no level means no limit. */
export const levelRank = code => S.courses.findIndex(c => c.code === code);
/* only someone promoted to a teaching level can be assigned, at that level or below */
export const canTeach = (t, co) => !!t.level && levelRank(t.level) >= levelRank(co);
/* Semesters of a course a person has not yet passed (50% or more in each examined subject, best attempt,
   published results). Promotion to teach a course needs none missing. */
export function notYetPassed(sid, code) {
  const k = course(code); const subs = S.subjects.filter(s => s.exam);
  const res = S.results.filter(r => r.sid === sid && r.course === code && r.pct != null && S.published[r.cid + '|' + r.sem]);
  const out = []; for (let sem = 1; sem <= k.sems; sem++) if (!subs.every(s => res.some(r => r.sem === sem && r.sub === s.key && r.pct >= 50))) out.push(sem);
  return out;
}
/* who can be nominated to teach a level: a student of a higher level, or someone who has passed all of that level */
export function canNominate(s, code) {
  const c = s.classId && S.classes.find(x => x.id === s.classId);
  return (!!c && levelRank(c.course) > levelRank(code)) || !notYetPassed(s.id, code).length;
}
/* the teacher record promoted from a person, if any */
export const teacherOfPerson = sid => S.teachers.find(t => t.sid === sid);
export const levelLabel = t => t.level ? 'Up to ' + course(t.level).name : 'Level not set';
export const levelOpts = () => S.courses.map(c => [c.code, c.name]);
/* Teachers who can take a class of this group and course, closest level first. */
export const assignable = (g, co) => S.teachers.filter(t => t.sid && t.g === g && canTeach(t, co)).sort((a, b) => (a.level ? levelRank(a.level) : 99) - (b.level ? levelRank(b.level) : 99) || a.name.localeCompare(b.name));
export function teacherName(id) { const t = S.teachers.find(t => t.id === id); return t ? teacherTitle(t) : ''; }
export function nextDate(c) {
  const ss = classSessions(c.id); let d;
  if (ss.length) d = addDays(ss[ss.length - 1].date, 7);
  else { d = c.startOn && c.startOn > TODAY ? c.startOn : TODAY; while (pd(d).getDay() !== c.day) d = addDays(d, 1); }
  while (d < TODAY) d = addDays(d, 7);
  return d;
}
export function whenFor(c, dateIso, off) { const total = c.time + (off - 5.5) * 60; const shift = Math.floor(total / 1440); return { date: addDays(dateIso, shift), time: ft(total) }; }
export function topicOf(c) { return c.course === 'INR' ? 'The Need of Religion' : (BELIEF[c.sem - 1] || 'Semester ' + c.sem); }
export function courseLabel(c) { const k = course(c.course); return k.name + (k.sems > 1 ? ' · Sem ' + c.sem : ''); }
export function weekLabel(c, w) { const k = course(c.course); return (c.course === 'INR' ? 'Session ' : 'Week ') + w + ' of ' + k.weeks; }
export function verseRef(n) { if (n <= 0) return 'the beginning'; return n <= 7 ? 'Al-Fatiha 1:' + n : 'Al-Baqarah 2:' + (n - 7); }
export function versesBefore(c, week) { return ((c.sem - 1) * course(c.course).weeks + (week - 1)) * 3; }
/* This week's lesson. Topics come from the approved syllabus chart; weeks or subjects the chart does not
   have yet show a placeholder. */
export function lesson(c, week) {
  const key = c.course + '-' + c.sem; const data = (S.chartData || {})[key]; const loaded = S.charts[key] || data; const tag = c.course === 'INR' ? 'Session ' : 'Week ';
  const ph = t => loaded ? '[' + tag + week + ' ' + t + ' from the syllabus chart]' : '[Syllabus chart not loaded yet]';
  const from = sub => data ? (data[sub] && data[sub][week - 1]) || '[Not in the syllabus chart yet]' : null;
  const b = from('b') || (c.course === 'INR' ? (INTRO[week - 1] || 'Course complete') : topicOf(c) + ': ' + ph('sub-topic'));
  return { q: 'Resume from ' + verseRef(versesBefore(c, week) + 1) + ' (3 verses)', b, l: from('l') || ph('rulings'), e: from('e') || ph('topic') };
}
/* How a material is shown on the reading page: pdf, image, word, youtube, drive, link or none. */
import { teacherTitle } from '/shared/teachername.js';
export { teacherTitle };
export { readKind } from '/shared/readkind.js';
/* Choosing a location's responsible person or coordinator from the students. current is the student id, or a
   name from before this rule, which stays on offer until it is replaced. */
export function personOpts(current, blank) {
  const list = S.students.filter(s => !s.left).slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => [s.id, s.name + (s.classId ? ' · ' + s.classId : '')]);
  const known = !current || S.students.some(s => s.id === current);
  return [['', blank]].concat(known ? [] : [[current, current + ' (not in the student list)']]).concat(list);
}
export function personValue(l, key) {
  const sid = l[key + 'Sid']; if (sid && S.students.some(s => s.id === sid)) return sid;
  const name = l[key]; if (!name || name === 'None yet') return '';
  const same = S.students.filter(s => s.name === name && !s.left);
  return same.length === 1 ? same[0].id : name;
}
export function stuStats(s) {
  const ss = classSessions(s.classId).filter(x => x.held && x.logged && x.date >= s.joined);
  let present = 0; ss.forEach(x => { if ((x.att[s.id] || 'a') === 'p') present++; });
  let miss = 0; const missed = [];
  for (let i = ss.length - 1; i >= 0; i--) { const a = ss[i].att[s.id] || 'a'; if (a === 'e') continue; if (a === 'a') { miss++; missed.push(ss[i]); } else break; }
  const isNew = daysAgo(s.joined) <= 14;
  const status = miss >= 4 ? 'followup' : miss >= 2 ? 'risk' : isNew ? 'new' : 'active';
  return { pct: ss.length ? Math.round(present / ss.length * 100) : null, miss, missed, status, present, counted: ss.length };
}
export const STAT = { new: ['gold', 'New'], active: ['ok', 'Active'], risk: ['warn', 'At risk'], followup: ['warnfill', 'In follow-up'] };
export const statChip = k => chip(STAT[k][0], STAT[k][1]);
/* the semester exam of a subject has been taken (chapter papers are tracked separately) */
export function taken(sid, crs, sem, sub, cid) { return S.results.some(r => r.sid === sid && r.course === crs && r.sem === sem && r.sub === sub && !r.chapter && (!cid || r.cid === cid)); }
const resultsOf = (sid, crs, sem, sub) => S.results.filter(r => r.sid === sid && r.course === crs && r.sem === sem && r.sub === sub);
export const chaptersFor = (crs, sem, sub) => chapterList(S.chapterCount, crs, sem, sub);
/* the subject mark: the semester exam, combined with the chapter papers where the subject has them */
export function best(sid, crs, sem, sub) { return subjectMark(resultsOf(sid, crs, sem, sub), chaptersFor(crs, sem, sub)); }
export function markDetail(sid, crs, sem, sub) { return markParts(resultsOf(sid, crs, sem, sub), chaptersFor(crs, sem, sub)); }
export function semResult(sid, crs, sem) { const m = ['b', 'l', 'e'].map(k => best(sid, crs, sem, k)); if (m.some(x => x === null)) return m.every(x => x === null) ? 'none' : 'incomplete'; return m.every(x => x >= 50) ? 'pass' : 'fail'; }
export function classAtt(cid, since, until) { let p = 0, n = 0; (since || until ? allSessions(cid) : classSessions(cid)).filter(x => x.held && x.logged && (!since || x.date >= since) && (!until || x.date <= until)).forEach(x => Object.keys(x.att).forEach(k => { n++; if (x.att[k] === 'p') p++; })); return n ? Math.round(p / n * 100) : null; }
export const locCalls = code => S.calls.filter(c => c.loc === code).sort((a, b) => a.date < b.date ? -1 : 1);
export const locActions = code => S.actions.filter(a => a.loc === code);
export function locMetrics(code) {
  const cs = S.classes.filter(c => c.loc === code && !ended(c)); const ids = cs.map(c => c.id);
  const ss = S.sessions.filter(x => ids.includes(x.classId));
  const studs = S.students.filter(s => ids.includes(s.classId)); const st = studs.map(stuStats);
  const cut = addDays(TODAY, -28); let p = 0, n = 0;
  ss.filter(x => x.held && x.logged && x.date >= cut).forEach(x => Object.keys(x.att).forEach(k => { n++; if (x.att[k] === 'p') p++; }));
  let pass = 0, tot = 0;
  cs.forEach(c => { for (let sem = 1; sem <= c.sem; sem++) { if (!S.published[c.id + '|' + sem]) continue; classStudents(c.id).forEach(s => { const r = semResult(s.id, c.course, sem); if (r === 'pass' || r === 'fail') { tot++; if (r === 'pass') pass++; } }); } });
  const unlogged = ss.filter(x => x.held && !x.logged);
  return {
    classes: cs.length, students: studs.length, held: ss.filter(x => x.held).length, planned: ss.length, att: n ? Math.round(p / n * 100) : null,
    pass: tot ? Math.round(pass / tot * 100) : null, unlogged, old: unlogged.filter(x => daysAgo(x.date) > 7).length,
    risk: st.filter(x => x.status === 'risk').length, fu: st.filter(x => x.status === 'followup').length,
    awaiting: cs.filter(c => c.status === 'awaiting').length,
    calls: locCalls(code).slice(-4).filter(c => c.status === 'Held').length, callsN: Math.min(4, locCalls(code).length),
    actions: locActions(code).filter(a => !a.done).length
  };
}
export function pendingResults(code) {
  const out = []; S.classes.filter(c => c.loc === code).forEach(c => {
    for (let sem = 1; sem <= c.sem; sem++) {
      if (S.published[c.id + '|' + sem]) continue; const ids = classStudents(c.id).map(s => s.id);
      const n = ids.filter(id => semResult(id, c.course, sem) !== 'none').length;
      if (n) out.push({ c, sem, taken: n, total: ids.length });
    }
  });
  return out;
}
/* Classes a student can be moved to: same group, still running, closest match (course and semester, then location) first. */
export function moveTargets(s) {
  const from = cls(s.classId); const fit = c => (c.course === from.course ? 0 : 4) + (c.sem === from.sem ? 0 : 2) + (c.loc === from.loc ? 0 : 1);
  return S.classes.filter(c => c.g === s.g && !ended(c) && c.id !== from.id).sort((a, b) => fit(a) - fit(b) || (a.id < b.id ? -1 : 1));
}
export function allStats() { return S.students.map(s => ({ s, c: cls(s.classId), st: stuStats(s) })).filter(x => x.c && !ended(x.c)); }
export function attIn(s, from, to) {
  const ss = allSessions(s.classId).filter(x => x.held && x.logged && x.date >= s.joined && x.date >= from && x.date <= to);
  if (!ss.length) return null; return Math.round(ss.filter(x => (x.att[s.id] || 'a') === 'p').length / ss.length * 100);
}

/* materials and training */
export function scopes(tid) { return S.classes.filter(c => c.teacherId === tid).map(c => ({ course: c.course, sem: c.sem, cid: c.id })); }
export function canSee(t, m) { if (t.access === 'all' || m.course === 'ALL') return true; const sc = scopes(t.id); if (t.access === 'course') return sc.some(s => s.course === m.course); return sc.some(s => s.course === m.course && (!m.sem || s.sem === m.sem)); }
export function matScope(m) { return (m.course === 'ALL' ? 'All courses' : course(m.course).name + (m.sem ? ' · Semester ' + m.sem : '') + (m.sub !== 'all' ? ' · ' + subName(m.sub) : '') + (m.week ? ' · week ' + m.week : '')) + (m.pages ? ' · ' + m.pages + ' pages' : ''); }
export function sharesOf(mid) { return S.shares.filter(s => s.mid === mid); }
export function invited(tid, tr) { if (tr.course === 'ALL') return true; return scopes(tid).some(s => s.course === tr.course && (!tr.sem || s.sem === tr.sem || (tr.kind === 'Refresher' && s.sem === tr.sem - 1))); }
export function trWhen(tr) { return fdl(tr.date) + ' · ' + ft(tr.time) + ' India time'; }
export const matHref = m => m.fileId ? '/files/' + m.fileId : /^https?:\/\//.test(m.src || '') ? m.src : '';

/* weekly reading */
export const thisWeek = () => weekStart(TODAY);
export const lastWeek = () => addDays(weekStart(TODAY), -7);
export const wkLabel = w => fd(w) + ' to ' + fd(addDays(w, 6));
export const TG = () => ({ ayat: +S.targets.ayat || 0, pages: +S.targets.pages || 0 });
export const rd = (sid, w) => S.reading.find(r => r.sid === sid && r.week === w);
export const metBoth = e => { const t = TG(); return !!e && e.ayat >= t.ayat && e.pages >= t.pages; };
export const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
export function readAlert(s) { const c = cls(s.classId); if (!c || c.course === 'INR') return false; const w1 = lastWeek(), w2 = addDays(w1, -7); if (s.joined > w2) return false; const bad = w => !metBoth(rd(s.id, w)); return bad(w1) && bad(w2); }
export function classReading(c, w) {
  const studs = classStudents(c.id); const es = studs.map(s => rd(s.id, w)).filter(Boolean);
  return { n: studs.length, logged: es.length, met: es.filter(metBoth).length, ayat: avg(es.map(e => e.ayat)), pages: avg(es.map(e => e.pages)) };
}

export function nextCounter(locCode, co) { const nums = S.classes.filter(c => c.id.startsWith(locCode + '-' + co + '-')).map(c => +c.id.split('-')[2] || 0); return (nums.length ? Math.max.apply(null, nums) : 0) + 1; }
export const myTeacher = () => S.teachers.find(t => t.id === ME.teacherId);
export const myStudent = () => stu(ME.studentId);
/* the location being worked on: the person's own, or the one the super admin chose on the page */
export const activeLocs = () => S.locations.filter(l => !l.disabled);
export const myLoc = () => loc(ME.role === 'super' ? S.p.loc || (activeLocs()[0] || {}).code : ME.loc);
