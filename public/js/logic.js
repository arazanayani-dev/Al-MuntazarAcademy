/* Values worked out from the records: attendance status, results, location metrics, weekly reading. */
import { S, TODAY, ME } from './state.js';
import { addDays, pd, ft, fd, fdl, weekStart, diffDays } from '/shared/dates.js';
import { chip } from './ui.js';

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
export const classSessions = cid => S.sessions.filter(x => x.classId === cid).sort((a, b) => a.date < b.date ? -1 : 1);
export const classStudents = cid => S.students.filter(s => s.classId === cid);
export const weeksDone = cid => classSessions(cid).filter(x => x.held).length;
export function teacherName(id) { const t = S.teachers.find(t => t.id === id); return t ? t.name : ''; }
export function nextDate(c) {
  const ss = classSessions(c.id); let d;
  if (ss.length) d = addDays(ss[ss.length - 1].date, 7);
  else { d = TODAY; while (pd(d).getDay() !== c.day) d = addDays(d, 1); }
  while (d < TODAY) d = addDays(d, 7);
  return d;
}
export function whenFor(c, dateIso, off) { const total = c.time + (off - 5.5) * 60; const shift = Math.floor(total / 1440); return { date: addDays(dateIso, shift), time: ft(total) }; }
export function topicOf(c) { return c.course === 'INR' ? 'The Need of Religion' : (BELIEF[c.sem - 1] || 'Semester ' + c.sem); }
export function courseLabel(c) { const k = course(c.course); return k.name + (k.sems > 1 ? ' · Sem ' + c.sem : ''); }
export function weekLabel(c, w) { const k = course(c.course); return (c.course === 'INR' ? 'Session ' : 'Week ') + w + ' of ' + k.weeks; }
export function verseRef(n) { if (n <= 0) return 'the beginning'; return n <= 7 ? 'Al-Fatiha 1:' + n : 'Al-Baqarah 2:' + (n - 7); }
export function versesBefore(c, week) { return ((c.sem - 1) * course(c.course).weeks + (week - 1)) * 3; }
export function lesson(c, week) {
  const loaded = S.charts[c.course + '-' + c.sem]; const tag = c.course === 'INR' ? 'Session ' : 'Week ';
  const ph = t => loaded ? '[' + tag + week + ' ' + t + ' from the syllabus chart]' : '[Syllabus chart not loaded yet]';
  const b = c.course === 'INR' ? (INTRO[week - 1] || 'Course complete') : topicOf(c) + ': ' + ph('sub-topic');
  return { q: 'Resume from ' + verseRef(versesBefore(c, week) + 1) + ' (3 verses)', b, l: ph('rulings'), e: ph('topic') };
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
export function taken(sid, crs, sem, sub) { return S.results.some(r => r.sid === sid && r.course === crs && r.sem === sem && r.sub === sub); }
export function best(sid, crs, sem, sub) { const r = S.results.filter(r => r.sid === sid && r.course === crs && r.sem === sem && r.sub === sub && r.pct != null); return r.length ? Math.max.apply(null, r.map(x => x.pct)) : null; }
export function semResult(sid, crs, sem) { const m = ['b', 'l', 'e'].map(k => best(sid, crs, sem, k)); if (m.some(x => x === null)) return m.every(x => x === null) ? 'none' : 'incomplete'; return m.every(x => x >= 50) ? 'pass' : 'fail'; }
export function classAtt(cid, since, until) { let p = 0, n = 0; classSessions(cid).filter(x => x.held && x.logged && (!since || x.date >= since) && (!until || x.date <= until)).forEach(x => Object.keys(x.att).forEach(k => { n++; if (x.att[k] === 'p') p++; })); return n ? Math.round(p / n * 100) : null; }
export const locCalls = code => S.calls.filter(c => c.loc === code).sort((a, b) => a.date < b.date ? -1 : 1);
export const locActions = code => S.actions.filter(a => a.loc === code);
export function locMetrics(code) {
  const cs = S.classes.filter(c => c.loc === code); const ids = cs.map(c => c.id);
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
export function allStats() { return S.students.map(s => ({ s, c: cls(s.classId), st: stuStats(s) })).filter(x => x.c); }
export function attIn(s, from, to) {
  const ss = classSessions(s.classId).filter(x => x.held && x.logged && x.date >= s.joined && x.date >= from && x.date <= to);
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

export function nextCounter(locCode, co) { const nums = S.classes.filter(c => c.loc === locCode && c.course === co).map(c => +c.id.split('-')[2] || 0); return (nums.length ? Math.max.apply(null, nums) : 0) + 1; }
export const myTeacher = () => S.teachers.find(t => t.id === ME.teacherId);
export const myStudent = () => stu(ME.studentId);
export const myLoc = () => loc(ME.loc);
