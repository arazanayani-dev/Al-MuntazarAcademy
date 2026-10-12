/* Every change the app can make. Each action names the roles allowed to call it, checks the record
   belongs to the caller's location, class or teaching load, validates its input, then writes to the store. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, weekStart, isIsoDate, DOWL, pd } from '../shared/dates.js';
import { qScore } from '../shared/scoring.js';
import { canSeeMaterial, invited } from './access.js';
import { hashPassword, verifyPassword } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE_PAPER = JSON.parse(fs.readFileSync(path.join(here, 'data', 'sample-paper.json'), 'utf8'));

export class UserError extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const need = (cond, msg, status) => { if (!cond) throw new UserError(msg, status); };
const uid = p => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const str = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const MTYPES = ['Syllabus', 'Book', 'Teacher guide', 'Slides', 'Worksheet', 'Reading', 'Video link', 'Other'];
const QTYPES = ['single', 'combo', 'fill', 'match', 'ayah'];
const ACADEMIC = ['academic', 'super'];

/* ---------- lookups that enforce scope ---------- */
function classIn(ctx, cid) {
  const c = ctx.store.find('classes', cid);
  need(c, 'That class does not exist.', 404);
  const u = ctx.user;
  if (u.role === 'locadmin' || u.role === 'coord') need(c.loc === u.loc, 'That class is in another location.', 403);
  if (u.role === 'teacher') need(c.teacherId === u.teacherId, 'That class is not yours.', 403);
  return c;
}
const course = (ctx, code) => { const k = ctx.store.find('courses', code); need(k, 'Unknown course type.'); return k; };
const teacher = ctx => { const t = ctx.store.find('teachers', ctx.user.teacherId); need(t, 'Your account is not linked to a teacher record.', 403); return t; };
const student = ctx => { const s = ctx.store.find('students', ctx.user.studentId); need(s, 'Your account is not linked to a student record.', 403); return s; };
const teacherName = (ctx, id) => { const t = ctx.store.find('teachers', id); return t ? t.name : ''; };
const notify = (ctx, to, channel, text) => ctx.store.put('outbox', { id: uid('n'), to, channel, text, created: new Date().toISOString(), sent: false });

/* Re-numbers held sessions of a class 1, 2, 3 … in date order. */
export function renumber(store, cid) {
  let w = 0;
  store.all('sessions').filter(x => x.classId === cid).sort((a, b) => a.date < b.date ? -1 : 1).forEach(x => {
    const want = x.held ? ++w : null;
    if (x.week !== want) { x.week = want; store.put('sessions', x); }
  });
}

/* Creates a session record for every scheduled class date that has passed, so it can be logged. */
export function ensureSessions(store, today) {
  let made = 0;
  store.tx(() => {
    for (const c of store.all('classes')) {
      if (c.status !== 'active' || !c.teacherId) continue;
      const k = store.find('courses', c.course); if (!k) continue;
      const ss = store.all('sessions').filter(x => x.classId === c.id).sort((a, b) => a.date < b.date ? -1 : 1);
      let held = ss.filter(x => x.held).length;
      let d;
      if (ss.length) d = addDays(ss[ss.length - 1].date, 7);
      else { d = c.startOn || c.createdOn || today; while (pd(d).getDay() !== c.day) d = addDays(d, 1); }
      while (d < today && held < k.weeks) {
        store.put('sessions', { id: uid('x'), classId: c.id, date: d, held: true, logged: false, week: ++held, att: {}, reason: '', loggedBy: '' });
        made++;
        d = addDays(d, 7);
      }
    }
  });
  return made;
}

/* ---------- handlers ---------- */
export const ACTIONS = {
  /* location responsible and coordinator */
  publish: { roles: ['locadmin'], run(ctx, a) {
    const [cid, semS] = str(a.key).split('|'); const c = classIn(ctx, cid); const sem = int(semS, 1, 10, 0);
    need(sem >= 1 && sem <= c.sem, 'Unknown semester.');
    const pub = { ...ctx.store.get('published', {}) }; pub[c.id + '|' + sem] = true; ctx.store.set('published', pub);
    ctx.store.all('students').filter(s => s.classId === c.id).forEach(s => notify(ctx, s.id, 'student', 'Semester ' + sem + ' results for ' + c.id + ' are published.'));
    return { toast: 'Results published. Students can now see their marks and certificates.' };
  } },
  remind: { roles: ['locadmin'], run(ctx, a) {
    const x = ctx.store.find('sessions', str(a.id)); need(x, 'Session not found.', 404); const c = classIn(ctx, x.classId);
    notify(ctx, c.teacherId, 'teacher', 'Please log the ' + x.date + ' session of ' + c.id + '.');
    if (c.assistantId) notify(ctx, c.assistantId, 'student', 'Please log the ' + x.date + ' session of ' + c.id + '.');
    return { toast: 'Reminder queued for the teacher' + (c.assistantId ? ' and the class assistant' : '') + ' by email and WhatsApp.' };
  } },
  assignSave: { roles: ['locadmin'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); const t = ctx.store.find('teachers', str(a.teacher));
    need(t, 'Choose a teacher.'); need(t.g === c.g, 'The teacher must be the same gender as the class.');
    c.teacherId = t.id; c.status = 'active'; if (!c.startOn) c.startOn = ctx.today; ctx.store.put('classes', c);
    return { toast: t.name + ' assigned. ' + c.id + ' is now active.' };
  } },
  classSave: { roles: ['locadmin', 'coord'], run(ctx, a) {
    const loc = ctx.user.loc; const k = course(ctx, str(a.course)); const g = a.g === 'M' ? 'M' : 'F';
    const tm = /^(\d{1,2}):(\d{2})$/.exec(str(a.time) || '20:00'); need(tm, 'Enter the time as hours and minutes.');
    const nums = ctx.store.all('classes').filter(c => c.loc === loc && c.course === k.code).map(c => +c.id.split('-')[2] || 0);
    const id = loc + '-' + k.code + '-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
    let tid = null;
    if (ctx.user.role === 'locadmin' && a.teacher) { const t = ctx.store.find('teachers', str(a.teacher)); need(t && t.g === g, 'The teacher must be the same gender as the class.'); tid = t.id; }
    ctx.store.put('classes', { id, loc, course: k.code, sem: int(a.sem, 1, k.sems, 1), g, teacherId: tid, day: int(a.day, 0, 6, 1), time: int(tm[1], 0, 23, 20) * 60 + int(tm[2], 0, 59, 0), status: tid ? 'active' : 'awaiting', createdBy: ctx.user.name, createdOn: ctx.today, startOn: ctx.today, meet: str(a.meet, 500) });
    return { toast: id + ' created' + (tid ? ' with ' + teacherName(ctx, tid) : ' and saved as awaiting teacher'), result: { id } };
  } },
  allocSave: { roles: ['locadmin', 'coord'], run(ctx, a) {
    const r = ctx.store.find('regs', str(a.rid)); need(r && r.loc === ctx.user.loc, 'Registration not found.', 404);
    const c = ctx.store.find('classes', str(a.cid)); need(c, 'Choose a class.'); need(c.g === r.g, 'Choose a ' + (r.g === 'F' ? 'sisters' : 'brothers') + ' class.');
    ctx.store.put('students', { id: uid('s'), name: r.name, g: r.g, classId: c.id, joined: ctx.today, city: r.city, tzName: 'India', tzOff: 5.5, prefs: { email: true, wa: true, absence: true } });
    ctx.store.del('regs', r.id);
    return { toast: r.name + ' added to ' + c.id + ' with status New' };
  } },
  callSave: { roles: ['locadmin'], run(ctx, a) {
    const l = ctx.store.find('locations', ctx.user.loc); need(l, 'Location not found.');
    const status = ['Held', 'Missed', 'Rescheduled'].includes(a.status) ? a.status : 'Held';
    ctx.store.put('calls', { id: uid('c'), loc: l.code, date: l.nextCall, status });
    l.nextCall = addDays(l.nextCall, 7); ctx.store.put('locations', l);
    const text = str(a.text, 500);
    if (text) ctx.store.put('actions', { id: uid('a'), loc: l.code, text, owner: str(a.owner, 100) || ctx.user.name, due: isIsoDate(a.due) ? a.due : addDays(ctx.today, 7), done: false, rem: 0 });
    return { toast: 'Call recorded as ' + status.toLowerCase() + (text ? ' with one action item' : '') };
  } },
  actionAdd: { roles: ['locadmin'], run(ctx, a) {
    const text = str(a.text, 500); need(text, 'Say what needs doing.');
    ctx.store.put('actions', { id: uid('a'), loc: ctx.user.loc, text, owner: str(a.owner, 100) || ctx.user.name, due: isIsoDate(a.due) ? a.due : addDays(ctx.today, 7), done: false, rem: 0 });
    return { toast: 'Action item added' };
  } },
  closeAction: { roles: ['locadmin', 'coord'], run(ctx, a) {
    const x = ctx.store.find('actions', str(a.id)); need(x && x.loc === ctx.user.loc, 'Action item not found.', 404);
    x.done = true; x.doneOn = ctx.today; x.doneBy = ctx.user.name; ctx.store.put('actions', x);
    return { toast: 'Action item closed' };
  } },

  /* session log: teacher, location responsible, or class assistant */
  logSave: { roles: ['teacher', 'locadmin', 'student'], run(ctx, a) {
    const x = ctx.store.find('sessions', str(a.sid)); need(x, 'Session not found.', 404);
    let c;
    if (ctx.user.role === 'student') { const s = student(ctx); c = ctx.store.find('classes', x.classId); need(c && c.assistantId === s.id, 'Only the class assistant can log this session.', 403); }
    else c = classIn(ctx, x.classId);
    need(!x.logged, 'This session is already logged.');
    const studs = ctx.store.all('students').filter(s => s.classId === c.id && s.joined <= x.date);
    x.logged = true; x.held = !!a.held; x.reason = x.held ? '' : str(a.reason, 300); x.verse = str(a.verse, 200); x.note = str(a.note, 2000);
    x.covered = { b: !!(a.covered && a.covered.b), l: !!(a.covered && a.covered.l), e: !!(a.covered && a.covered.e) };
    x.loggedBy = ctx.user.name + (ctx.user.role === 'student' ? ' (assistant)' : ctx.user.role === 'locadmin' ? ' (for the teacher)' : '');
    x.loggedOn = ctx.today; x.att = {};
    let p = 0;
    if (x.held) studs.forEach(s => { const v = ['p', 'a', 'e'].includes(a.att && a.att[s.id]) ? a.att[s.id] : 'p'; x.att[s.id] = v; if (v === 'p') p++; });
    ctx.store.put('sessions', x);
    renumber(ctx.store, c.id);
    return { toast: x.held ? 'Saved. ' + p + ' of ' + studs.length + ' present.' : 'Saved as cancelled.' };
  } },

  /* teacher */
  shareSave: { roles: ['teacher'], run(ctx, a) {
    const t = teacher(ctx); const m = ctx.store.find('materials', str(a.mid)); need(m && canSeeMaterial(ctx.store, t, m), 'Material not found.', 404);
    need(m.share, 'This material is for teachers only.');
    const c = classIn(ctx, str(a.cid)); need(m.course === 'ALL' || (c.course === m.course && (!m.sem || c.sem === m.sem)), 'This material is not for that class.');
    need(!ctx.store.all('shares').some(s => s.mid === m.id && s.cid === c.id), 'This is already shared with ' + c.id + '.');
    ctx.store.put('shares', { id: uid('sh'), mid: m.id, cid: c.id, date: ctx.today, by: t.name });
    const n = ctx.store.all('students').filter(s => s.classId === c.id).length;
    return { toast: 'Shared with ' + c.id + '. ' + n + ' students can now see it.' };
  } },
  rsvp: { roles: ['teacher'], run(ctx, a) {
    const t = teacher(ctx); const tr = ctx.store.find('trainings', str(a.id)); need(tr && invited(ctx.store, t.id, tr), 'Training not found.', 404);
    const ans = a.answer === 'yes' ? 'yes' : 'no'; tr.rsvp = { ...tr.rsvp, [t.id]: ans }; ctx.store.put('trainings', tr);
    return { toast: ans === 'yes' ? 'Reply sent: attending. A reminder comes the day before.' : 'Reply sent: not attending.' };
  } },

  /* student */
  rdSave: { roles: ['student'], run(ctx, a) {
    const s = student(ctx); const tw = weekStart(ctx.today), lw = addDays(tw, -7);
    need(a.week === tw || a.week === lw, 'You can log this week or last week only.');
    const ayat = int(a.ayat, 0, 6236, null), pages = int(a.pages, 0, 2000, null); need(ayat !== null && pages !== null, 'Enter ayat and pages as numbers.');
    const id = s.id + '|' + a.week; const t = ctx.store.get('targets', { ayat: 0, pages: 0 });
    ctx.store.put('reading', { id, sid: s.id, week: a.week, ayat, pages, book: str(a.book, 50) });
    return { toast: 'Saved: ' + ayat + ' of ' + t.ayat + ' ayat, ' + pages + ' of ' + t.pages + ' pages.' };
  } },
  pref: { roles: ['student'], run(ctx, a) {
    const s = student(ctx); const key = str(a.key); need(['email', 'wa', 'absence'].includes(key), 'Unknown setting.');
    s.prefs = { email: true, wa: true, absence: true, ...s.prefs }; s.prefs[key] = !s.prefs[key]; ctx.store.put('students', s);
    return { toast: key === 'absence' && !s.prefs[key] ? 'Absence reminders are off. Your teacher is still told if you miss classes.' : 'Saved' };
  } },
  examStart: { roles: ['student'], run(ctx, a) {
    const s = student(ctx); const c = ctx.store.find('classes', s.classId); const e = ctx.store.find('exams', str(a.id));
    need(e && c && e.course === c.course && e.sem === c.sem, 'Exam not found.', 404); need(e.open, 'This exam window is not open.');
    need(!ctx.store.all('results').some(r => r.sid === s.id && r.course === e.course && r.sem === e.sem && r.sub === e.sub), 'You have already taken this exam.');
    const qs = ctx.store.all('questions').filter(q => !q.retired && q.course === e.course && q.sem === e.sem && q.sub === e.sub);
    need(qs.length, 'This exam has no questions yet.');
    const shuffle = n => { const x = Array.from({ length: n }, (_, i) => i); for (let t = 0; t < 5; t++) { for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]]; } if (n < 2 || x.some((v, i) => v !== i)) break; } return x; };
    const perms = qs.map(q => q.type === 'match' ? shuffle(q.right.length) : null);
    const att = { id: uid('at'), sid: s.id, examId: e.id, qids: qs.map(q => q.id), perms, started: new Date().toISOString(), done: false };
    ctx.store.put('attempts', att);
    const view = qs.map((q, i) => {
      const o = { type: q.type, text: q.text };
      if (q.type === 'match') { o.left = q.left; o.right = perms[i].map(k => q.right[k]); }
      else if (q.type !== 'fill') { o.options = q.options; o.stmts = q.stmts; o.ar = q.ar; }
      return o;
    });
    return { result: { attemptId: att.id, examId: e.id, qs: view } };
  } },
  examSubmit: { roles: ['student'], run(ctx, a) {
    const s = student(ctx); const att = ctx.store.find('attempts', str(a.attemptId));
    need(att && att.sid === s.id && !att.done, 'This exam attempt is not open.');
    const e = ctx.store.find('exams', att.examId); need(e && e.open, 'The exam window has closed.');
    need(!ctx.store.all('results').some(r => r.sid === s.id && r.course === e.course && r.sem === e.sem && r.sub === e.sub), 'You have already taken this exam.');
    const ans = Array.isArray(a.ans) ? a.ans : [];
    let right = 0;
    att.qids.forEach((qid, i) => {
      const q = ctx.store.find('questions', qid); if (!q) return;
      let v = ans[i];
      if (q.type === 'match') v = Array.isArray(v) ? v.map(x => x === '' || x == null ? '' : att.perms[i][+x]) : null;
      right += qScore(q, v);
    });
    att.done = true; att.ans = ans; att.finished = new Date().toISOString(); ctx.store.put('attempts', att);
    ctx.store.put('results', { id: uid('r'), sid: s.id, cid: s.classId, course: e.course, sem: e.sem, sub: e.sub, pct: Math.round(right / att.qids.length * 100), attempt: 1, date: ctx.today });
    return {};
  } },

  /* academic team */
  chartLoad: { roles: ACADEMIC, run(ctx, a) {
    const key = str(a.key, 20); const [co, sem] = key.split('-'); const k = course(ctx, co); need(int(sem, 1, k.sems, 0), 'Unknown semester.');
    ctx.store.set('charts', { ...ctx.store.get('charts', {}), [key]: true });
    return { toast: 'Chart loaded' };
  } },
  qAdd: { roles: ACADEMIC, run(ctx, a) {
    const ex = a.edit ? ctx.store.find('questions', str(a.edit)) : null;
    if (a.edit) need(ex, 'Question not found.', 404);
    const t = ex ? ex.type : (QTYPES.includes(a.type) ? a.type : 'single');
    const q = { text: str(a.text) }; need(q.text, 'Enter the question.');
    if (t === 'single' || t === 'ayah' || t === 'combo') {
      q.options = [a.o0, a.o1, a.o2, a.o3].map(x => str(x, 500)); need(q.options.every(Boolean), 'Fill in all four options.');
      q.correct = int(a.correct, 0, 3, 0);
      if (t === 'ayah') { q.ar = str(a.ar); need(q.ar, 'Enter the ayat in Arabic.'); }
    }
    if (t === 'fill') { q.answers = str(a.answers).split(',').map(x => x.trim()).filter(Boolean); need(q.answers.length, 'Give at least one accepted answer.'); }
    if (t === 'match') {
      q.left = []; q.right = [];
      for (let i = 0; i < 4; i++) { const l = str(a['l' + i], 300), r = str(a['r' + i], 300); if (l && r) { q.left.push(l); q.right.push(r); } }
      need(q.left.length >= 2, 'Enter at least two pairs.');
    }
    if (ex) { Object.assign(ex, q); ctx.store.put('questions', ex); return { toast: 'Question updated' }; }
    const k = course(ctx, str(a.course)); const sub = ctx.store.find('subjects', str(a.sub)); need(sub && sub.exam, 'Choose an examined subject.');
    ctx.store.put('questions', { id: uid('q'), course: k.code, sem: int(a.sem, 1, k.sems, 1), sub: sub.key, type: t, options: [], correct: 0, retired: false, ...q });
    return { toast: 'Question saved. Add the next one.' };
  } },
  qRetire: { roles: ACADEMIC, run(ctx, a) {
    const q = ctx.store.find('questions', str(a.id)); need(q, 'Question not found.', 404); q.retired = true; ctx.store.put('questions', q);
    return { toast: 'Question retired. It stays on past exams but is not used in new ones.' };
  } },
  importSave: { roles: ACADEMIC, run(ctx, a) {
    const k = course(ctx, str(a.course)); const sem = int(a.sem, 1, k.sems, 1); const sub = ctx.store.find('subjects', str(a.sub)); need(sub && sub.exam, 'Choose an examined subject.');
    const items = (Array.isArray(a.items) ? a.items : []).filter(x => x && x.include);
    need(items.length, 'Tick at least one question to save.');
    const picked = items.map(x => ({ q: SAMPLE_PAPER.questions[int(x.idx, 0, 9999, -1)], correct: x.correct }));
    need(picked.every(p => p.q && p.q.type !== 'bank'), 'Word-bank questions cannot be imported yet.');
    need(picked.every(p => p.correct !== '' && p.correct != null), 'A ticked question has no answer yet. Choose its answer or untick it.');
    picked.forEach(p => ctx.store.put('questions', { id: uid('q'), course: k.code, sem, sub: sub.key, type: p.q.type, text: p.q.text, options: p.q.options, stmts: p.q.stmts, correct: int(p.correct, 0, 3, 0), retired: false }));
    return { toast: picked.length + ' questions imported into the bank' };
  } },
  examToggle: { roles: ACADEMIC, run(ctx, a) {
    const e = ctx.store.find('exams', str(a.id)); need(e, 'Exam not found.', 404); const on = !e.open;
    ctx.store.all('exams').filter(x => x.course === e.course && x.sem === e.sem).forEach(x => { x.open = on; ctx.store.put('exams', x); });
    return { toast: on ? 'Window opened for all subjects of this semester.' : 'Window closed' };
  } },
  examAdd: { roles: ACADEMIC, run(ctx, a) {
    const k = course(ctx, str(a.course)); const sem = int(a.sem, 1, k.sems, 1);
    need(isIsoDate(a.from) && isIsoDate(a.to) && a.from <= a.to, 'Enter a valid window.');
    const subs = ctx.store.all('subjects').filter(s => s.exam); let n = 0;
    subs.forEach(s => { const id = k.code + '-' + sem + '-' + s.key; if (!ctx.store.find('exams', id)) { ctx.store.put('exams', { id, course: k.code, sem, sub: s.key, open: false, from: a.from, to: a.to }); n++; } else { const e = ctx.store.find('exams', id); e.from = a.from; e.to = a.to; ctx.store.put('exams', e); } });
    return { toast: n ? n + ' exams scheduled' : 'Exam window updated' };
  } },
  tradAdd: { roles: ACADEMIC, run(ctx, a) {
    const text = str(a.text, 4000), source = str(a.source, 500); need(text && source, 'Enter the text and its source.');
    ctx.store.put('traditions', { id: uid('h'), text, source }); return { toast: 'Added to the library' };
  } },
  matAdd: { roles: ACADEMIC, run(ctx, a) {
    const title = str(a.title, 300); need(title, 'Enter a title.');
    const co = a.course === 'ALL' ? 'ALL' : course(ctx, str(a.course)).code;
    let src = str(a.link, 1000), fileId = null;
    if (a.fileId) { const f = ctx.store.find('files', str(a.fileId)); need(f, 'The uploaded file was not found.'); fileId = f.id; src = f.name; }
    ctx.store.put('materials', { id: uid('m'), title, type: MTYPES.includes(a.type) ? a.type : 'Other', course: co, sem: co === 'ALL' ? 0 : int(a.sem, 0, 10, 0), sub: str(a.sub, 10) || 'all', week: a.week ? int(a.week, 1, 60, null) : null, pages: a.pages ? int(a.pages, 1, 100000, null) : null, share: a.share === true || a.share === 'true', src: src || 'No file attached', fileId, date: ctx.today });
    return { toast: 'Added to the library' };
  } },
  trainAdd: { roles: ACADEMIC, run(ctx, a) {
    const title = str(a.title, 300); need(title, 'Enter a title.'); need(isIsoDate(a.date), 'Enter a date.');
    const tm = /^(\d{1,2}):(\d{2})$/.exec(str(a.time) || '11:00'); need(tm, 'Enter a time.');
    const co = a.course === 'ALL' ? 'ALL' : course(ctx, str(a.course)).code;
    const tr = { id: uid('tr'), title, kind: a.kind === 'Refresher' ? 'Refresher' : 'Programme', course: co, sem: int(a.sem, 0, 10, 0), date: a.date, time: int(tm[1], 0, 23, 11) * 60 + int(tm[2], 0, 59, 0), mode: str(a.mode, 500) || 'Online on Google Meet', facilitator: str(a.facilitator, 100) || 'Academic team', req: !!a.req, rsvp: {}, attended: null };
    ctx.store.put('trainings', tr);
    const inv = ctx.store.all('teachers').filter(t => invited(ctx.store, t.id, tr));
    inv.forEach(t => notify(ctx, t.id, 'teacher', 'Training invitation: ' + title + ' on ' + tr.date));
    return { toast: 'Scheduled. ' + inv.length + ' teachers invited by email and WhatsApp.' };
  } },
  setTargets: { roles: ACADEMIC, run(ctx, a) {
    ctx.store.set('targets', { ayat: int(a.ayat, 0, 6236, 0), pages: int(a.pages, 0, 2000, 0) });
    return { toast: 'Weekly reading targets saved' };
  } },
  setAccess: { roles: ACADEMIC, run(ctx, a) {
    const t = ctx.store.find('teachers', str(a.tid)); need(t, 'Teacher not found.', 404); need(['own', 'course', 'all'].includes(a.access), 'Unknown access level.');
    t.access = a.access; ctx.store.put('teachers', t); return { toast: 'Access saved for ' + t.name };
  } },

  /* super admin */
  locAdd: { roles: ['super'], run(ctx, a) {
    const code = str(a.code, 3).toUpperCase(); need(/^[A-Z]{3}$/.test(code), 'The short code must be three letters.');
    need(!ctx.store.find('locations', code), 'The short code ' + code + ' is already used. Choose another.');
    const name = str(a.name, 100); need(name && str(a.primary) && str(a.secondary), 'Enter the name and both responsible persons.');
    const callDay = DOWL.includes(a.callDay) ? a.callDay : 'Monday';
    let next = ctx.today; while (DOWL[pd(next).getDay()] !== callDay) next = addDays(next, 1);
    ctx.store.put('locations', { id: code, code, name, primary: str(a.primary, 100), secondary: str(a.secondary, 100), coordinator: str(a.coordinator, 100) || 'None yet', callDay, callTime: str(a.callTime, 20) || '8:00 PM', meet: str(a.meet, 500), nextCall: next });
    return { toast: name + ' added with code ' + code };
  } },
  courseAdd: { roles: ['super'], run(ctx, a) {
    const code = str(a.code, 3).toUpperCase(); need(/^[A-Z]{3}$/.test(code), 'The code must be three letters.'); need(!ctx.store.find('courses', code), 'That code is already used.');
    const name = str(a.name, 100); need(name, 'Enter a name.');
    ctx.store.put('courses', { id: code, code, name, sems: int(a.sems, 1, 10, 1), weeks: int(a.weeks, 1, 60, 1) });
    return { toast: name + ' added' };
  } },
  subjectAdd: { roles: ['super'], run(ctx, a) {
    const name = str(a.name, 100); need(name, 'Enter a name.');
    const key = 'x' + ctx.store.all('subjects').length;
    ctx.store.put('subjects', { id: key, key, name, min: int(a.min, 1, 60, 10), exam: false });
    return { toast: name + ' added' };
  } },
  teacherAdd: { roles: ['super', 'locadmin'], run(ctx, a) {
    const name = str(a.name, 100); need(name, 'Enter a name.');
    const t = { id: uid('t'), name, g: a.g === 'M' ? 'M' : 'F', access: 'own', loc: ctx.user.role === 'locadmin' ? ctx.user.loc : (str(a.loc, 3) || null), tzName: 'India', tzOff: 5.5 };
    ctx.store.put('teachers', t); return { toast: name + ' added as a teacher', result: { id: t.id } };
  } },
  userAdd: { roles: ['super'], run(ctx, a) {
    const username = str(a.username, 40).toLowerCase(); need(/^[a-z0-9._-]{3,40}$/.test(username), 'Usernames use 3 to 40 letters, numbers, dots, dashes or underscores.');
    need(!ctx.store.all('users').some(u => u.username === username), 'That username is taken.');
    const role = str(a.role); need(['super', 'academic', 'locadmin', 'coord', 'teacher', 'student'].includes(role), 'Choose a role.');
    const pw = String(a.password || ''); need(pw.length >= 8, 'The password needs at least 8 characters.');
    const u = { id: uid('u-'), username, name: str(a.name, 100) || username, role, password: hashPassword(pw) };
    if (role === 'locadmin' || role === 'coord') { need(ctx.store.find('locations', str(a.loc)), 'Choose a location.'); u.loc = str(a.loc); }
    if (role === 'teacher') { need(ctx.store.find('teachers', str(a.teacherId)), 'Choose the teacher record.'); u.teacherId = str(a.teacherId); }
    if (role === 'student') { need(ctx.store.find('students', str(a.studentId)), 'Choose the student record.'); u.studentId = str(a.studentId); }
    ctx.store.put('users', u); return { toast: 'Account created for ' + u.name };
  } },
  userReset: { roles: ['super'], run(ctx, a) {
    const u = ctx.store.find('users', str(a.id)); need(u, 'User not found.', 404);
    const pw = String(a.password || ''); need(pw.length >= 8, 'The password needs at least 8 characters.');
    u.password = hashPassword(pw); ctx.store.put('users', u);
    ctx.store.all('authSessions').filter(s => s.userId === u.id).forEach(s => ctx.store.del('authSessions', s.id));
    return { toast: 'Password reset for ' + u.name };
  } },
  userToggle: { roles: ['super'], run(ctx, a) {
    const u = ctx.store.find('users', str(a.id)); need(u, 'User not found.', 404); need(u.id !== ctx.user.id, 'You cannot disable your own account.');
    u.disabled = !u.disabled; ctx.store.put('users', u);
    return { toast: u.name + (u.disabled ? ' can no longer sign in' : ' can sign in again') };
  } },

  /* everyone */
  changePassword: { roles: ['super', 'academic', 'locadmin', 'coord', 'teacher', 'student'], run(ctx, a) {
    need(verifyPassword(a.current, ctx.user.password), 'Your current password is not right.');
    const pw = String(a.next || ''); need(pw.length >= 8, 'The new password needs at least 8 characters.');
    ctx.user.password = hashPassword(pw); ctx.user.demo = false; ctx.store.put('users', ctx.user);
    return { toast: 'Password changed' };
  } }
};

export function runAction(store, user, today, name, args) {
  const def = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;
  need(def, 'Unknown action.', 404);
  need(def.roles.includes(user.role), 'You do not have permission to do that.', 403);
  return store.tx(() => def.run({ store, user, today }, args || {}) || {});
}
