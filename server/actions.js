/* Every change the app can make. Each action names the roles allowed to call it, checks the record
   belongs to the caller's location, class or teaching load, validates its input, then writes to the store. */
import crypto from 'node:crypto';
import { addDays, weekStart, isIsoDate, DOWL, pd, ft } from '../public/shared/dates.js';
import { qScore } from '../public/shared/scoring.js';
import { canSeeMaterial, invited, approved, rolesOf, teacherIdFor, ASSIGNABLE, meetingPeople, ownerSidFor } from './access.js';
import { hashPassword, verifyPassword } from './auth.js';
import { chaptersOf, planDetailed } from './syllabus.js';
import { chapterWindow, chapterState, chapterKey, subjectMark, PASS } from '../public/shared/grading.js';
import { callPeople, clashesOf } from '../public/shared/callpeople.js';
import { teacherTitle } from '../public/shared/teachername.js';
import { readinessRows, progress, itemProgress, recordId, unitsFor, quizQuestions, guidesOf, QUIZ_SIZE, QUIZ_MIN, QUIZ_PASS } from './readiness.js';
import { fileBytes } from './files.js';
import SAMPLE_PAPER from './sample-paper.js';
export { SAMPLE_PAPER };

/* kept for the server's start-up call; files are read through files.js */
export function configure() {}

/* A syllabus for one course, semester and subject, with a PDF or Word file, proposes that subject's weekly
   topics for the Standard Syllabus Chart; approving the syllabus puts them in the chart. */
/* questions are drafted when a syllabus gets a new file, or on any save while it has none drafted yet
   (the last drafting failed or never ran); a save that changes nothing else keeps drafts waiting for approval */
const wantsQuestions = (m, newFile) => !!m.chart && (newFile || !m.qgen || m.qgen.status === 'failed' || (m.qgen.status === 'done' && !m.qgen.made));
/* Approving a chapter's newly drafted AI questions retires that chapter's AI questions from an earlier
   drafting of the same syllabus, so a paper never mixes rounds and is never left empty meanwhile.
   Returns how many were retired. */
function supersede(ctx, q) {
  if (!q.ai || !q.source) return 0;
  const same = (o, p) => (o.chapter != null ? o.chapter === p.chapter : o.chapterTitle === p.chapterTitle);
  const old = ctx.store.all('questions').filter(o => o.ai && o.source === q.source && (o.aud || '') === (q.aud || '') && same(o, q) && o.round !== q.round && !o.retired && approved(o));
  old.forEach(o => ctx.store.put('questions', { ...o, retired: true, retiredBy: ctx.user.name, retiredOn: ctx.today, retiredWhy: 'Replaced by newly drafted questions' }));
  return old.length;
}
/* A teacher's guide, once approved (or replaced), is part of its subject's readiness quiz: the quiz of the
   matching syllabus is drafted again. Returns the syllabus to draft for, or null. */
function guideQuiz(ctx, g) {
  if (g.type !== 'Teacher guide' || !g.fileId || !approved(g)) return null;
  const syl = ctx.store.all('materials').find(m => m.type === 'Syllabus' && m.fileId && m.chart && approved(m) && m.course === g.course && m.sem === g.sem && m.sub === g.sub);
  if (!syl || !guidesOf(ctx.store, syl).some(x => x.id === g.id) || (syl.qgen && /queued|running/.test(syl.qgen.status))) return null;
  syl.qgen = { ...(syl.qgen || {}), status: 'queued', part: 'teacher' }; ctx.store.put('materials', syl);
  return syl.id;
}
function syllabusPlan(ctx, m) {
  delete m.chart; delete m.chartNote;
  if (m.type !== 'Syllabus' || m.course === 'ALL' || !m.sem || !m.sub || m.sub === 'all' || !m.fileId) return;
  const f = ctx.store.find('files', m.fileId); const k = ctx.store.find('courses', m.course); if (!f || !k) return;
  try {
    const { chapters, reason } = chaptersOf(fileBytes(f), f.name);
    if (!chapters.length) { m.chartNote = reason + ' Fill in the chart by hand with Edit this chart.'; return; }
    const plan = planDetailed(chapters, k.weeks);
    m.chart = { sub: m.sub, weeks: plan.map(w => w.text), map: plan.map(w => w.chapters), chapters: chapters.length };
  } catch { m.chartNote = 'The syllabus file could not be read for the chart. Fill in the chart by hand with Edit this chart.'; }
}

export class UserError extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const need = (cond, msg, status) => { if (!cond) throw new UserError(msg, status); };
const uid = p => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const str = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const MTYPES = ['Syllabus', 'Book', 'Teacher guide', 'Slides', 'Worksheet', 'Reading', 'Video link', 'Other'];
const QTYPES = ['single', 'combo', 'fill', 'match', 'ayah'];
/* Maker-checker for academic content: the content creator adds and edits; the approver (or super admin)
   approves or sends back. Anything added or edited waits for approval before teachers and students see it. */
const MAKER = ['acmaker'];
const CHECKER = ['academic', 'super'];
/* a subject's display name, e.g. b -> Belief */
const subName = (ctx, key) => { const x = ctx.store.find('subjects', key); return x ? x.name : key; };
const submitted = (ctx, x) => Object.assign(x, { status: 'pending', submittedBy: ctx.user.name, submittedById: ctx.user.id, submittedOn: ctx.today, reviewNote: '' });
const REVIEW = { q: 'questions', mat: 'materials', train: 'trainings', trad: 'traditions', promo: 'promotions' };
/* A student may be promoted to teach a course type only after passing every semester of it: 50% or more in
   each examined subject, best attempt, in published results. Returns the semesters still missing. */
export function notYetPassed(store, sid, code) {
  const k = store.find('courses', code); if (!k) return [];
  const pub = store.get('published', {}); const subs = store.all('subjects').filter(s => s.exam);
  const res = store.all('results').filter(r => r.sid === sid && r.course === code && r.pct != null && pub[r.cid + '|' + r.sem]);
  const live = store.all('questions').filter(q => q.chapter && !q.aud && q.course === code && !q.retired && approved(q));
  const papers = (sem, sub) => [...new Set(live.filter(q => q.sem === sem && q.sub === sub).map(q => q.chapter))];
  const missing = [];
  /* the subject mark counts chapter papers where the subject has them (see shared/grading.js) */
  for (let sem = 1; sem <= k.sems; sem++) if (!subs.every(s => { const m = subjectMark(res.filter(r => r.sem === sem && r.sub === s.key), papers(sem, s.key)); return m != null && m >= PASS; })) missing.push(sem);
  return missing;
}
/* A class's exam window, opened by its teacher or location responsible for its current semester. */
export const examOpenFor = (c, today) => !!(c && c.exam && c.exam.sem === c.sem && !c.exam.closed && c.exam.from <= today && today <= c.exam.to);

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
/* Course types are levels in the order they were added (Introductory, Basic, Intermediate, Advance …).
   A teacher takes classes at their level and below; only someone with a teaching level can be assigned. */
const rank = (ctx, code) => ctx.store.all('courses').findIndex(c => c.code === code);
const canTeach = (ctx, t, co) => !!t.level && rank(ctx, t.level) >= rank(ctx, co);
const levelOf = (ctx, v) => course(ctx, str(v)).code;
/* A person's details from a form: name and last name, date of birth, phone, email and location (city). A new
   registration needs them all (strict); records from before these details existed can be completed bit by bit. */
function person(ctx, a, strict) {
  const first = str(a.first, 60), last = str(a.last, 60), dob = str(a.dob, 10), phone = str(a.phone, 30), email = str(a.email, 120).toLowerCase(), city = str(a.city, 100);
  need(first, 'Enter the student\'s name.');
  if (strict) {
    need(last, 'Enter the student\'s last name.'); need(dob, 'Enter the date of birth.'); need(city, 'Enter the location.');
    need(phone, 'Enter the phone number.'); need(email, 'Enter the email address.');
  }
  if (dob) need(isIsoDate(dob) && dob >= '1900-01-01' && dob < ctx.today, 'Enter a valid date of birth.');
  const digits = phone.replace(/\D/g, '').length;
  if (phone) need(/^\+?[\d\s().-]+$/.test(phone) && digits >= 7 && digits <= 15, 'Enter a valid phone number, with the country code if outside India.');
  if (email) need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
  return { first, last, name: (first + ' ' + last).trim(), dob, phone, email, city };
}

/* Refuses details that belong to someone already registered, at any location: the same name and date of birth,
   the same phone and email together, or the same name with the same phone or email. A shared family phone or
   email alone is allowed. A student who left and has no class can register again. self is the person being edited. */
function notDuplicate(ctx, p, self = {}) {
  const low = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const tel = s => String(s || '').replace(/\D/g, '').slice(-10); /* with or without the country code */
  const same = o => {
    const name = low(o.name) === low(p.name); const phone = !!tel(p.phone) && tel(o.phone) === tel(p.phone); const email = !!p.email && low(o.email) === low(p.email);
    return (name && !!p.dob && o.dob === p.dob) || (phone && email) || (name && (phone || email));
  };
  const reg = ctx.store.all('regs').find(r => r.id !== self.rid && !(self.sid && r.sid === self.sid) && same(r));
  if (reg) { const l = ctx.store.find('locations', reg.loc); need(false, reg.name + ' is already registered and waiting for a class at ' + (l ? l.name : reg.loc) + '.'); }
  const st = ctx.store.all('students').find(s => s.classId && s.id !== self.sid && same(s));
  if (st) need(false, st.name + ' is already registered, in class ' + st.classId + '.');
}

/* A location's responsible persons and coordinator are chosen from the students (everyone is a student first).
   A name set before this rule, with no student record, can stay until it is replaced. */
function locPeople(ctx, a, l = {}) {
  const one = (key, label) => {
    const v = str(a[key], 100); if (!v) return { name: '' };
    const s = ctx.store.find('students', v); if (s && !s.left) return { name: s.name, sid: s.id };
    need(v === l[key], 'Choose the ' + label + ' from the student list.');
    return { name: l[key], sid: l[key + 'Sid'] };
  };
  const p = one('primary', 'primary responsible'), q = one('secondary', 'secondary responsible'), c = one('coordinator', 'coordinator');
  need(!p.name || !q.name || (p.sid || p.name) !== (q.sid || q.name), 'The primary and secondary responsible must be different people.');
  return { primary: p.name, primarySid: p.sid, secondary: q.name, secondarySid: q.sid, coordinator: c.name || 'None yet', coordinatorSid: c.sid };
}

/* who an action item belongs to; items from before owners were linked are matched by name at their location */
const ownerSidOf = (ctx, x) => x.ownerSid || ownerSidFor(ctx.store.find('locations', x.loc), x.owner);
/* A call's Meet link becomes a button people click, so only a real web address is accepted. Empty clears it. */
function meetLink(v) {
  const s = str(v, 500); if (!s) return '';
  let u = null; try { u = new URL(s); } catch { /* not an address */ }
  need(u && (u.protocol === 'https:' || u.protocol === 'http:'), 'Enter the full Meet link, starting with https://');
  return s;
}
/* A warning for the message after a change: who on this call (or just these people) is also on another call at that time. */
function clashNote(ctx, l, sids) {
  if (l.disabled) return '';
  const notes = callPeople(l).filter(p => !sids || sids.includes(p.sid)).map(p => ({ p, with: clashesOf(ctx.store.all('locations'), l, p.sid) })).filter(x => x.with.length);
  return notes.length ? ' Clash: ' + notes.map(x => x.p.name + ' is also on the ' + x.with.join(' and ') + ' call at this time').join('; ') + '.' : '';
}
/* the location a coordination action is for: their own, or the one the super admin chose */
function coordLoc(ctx, a) {
  const l = ctx.store.find('locations', ctx.user.role === 'super' ? str(a.loc, 10) : ctx.user.loc); need(l, 'Choose the location.');
  need(!l.disabled, l.name + ' is disabled.');
  return l;
}
/* a location that can take new work: new classes, registrations and staff */
const inUse = (ctx, code) => { const l = ctx.store.find('locations', code); return !!l && !l.disabled; };

/* Being named at a location gives the role: primary and secondary responsible are location responsibles, the
   coordinator a coordinator. The role goes with the post, so whoever is replaced loses it. */
const POSTS = [['primary', 'locadmin'], ['secondary', 'locadmin'], ['coordinator', 'coord']];
const LOC_ROLES = ['locadmin', 'coord'];
const assignedRoles = u => u.roles ? [...u.roles] : u.role && u.role !== 'teacher' && u.role !== 'student' ? [u.role] : [];
/* the posts a person (student id) holds, at any location */
const postsOf = (ctx, sid) => ctx.store.all('locations').filter(l => !l.disabled).flatMap(l => POSTS.filter(([k]) => l[k + 'Sid'] === sid).map(([k, role]) => ({ code: l.code, name: l.name, key: k, role })));
const setRoles = (ctx, u, roles) => {
  u.roles = roles; delete u.role;
  if (!roles.some(r => LOC_ROLES.includes(r))) delete u.loc;
  ctx.store.put('users', u);
};
/* applies a change of posts at one location and says what happened, for the message to the super admin */
function syncLocRoles(ctx, code, before, after) {
  const users = ctx.store.all('users'); const given = [], removed = [], noLogin = [];
  const who = (l, k) => l[k + 'Sid'] || (l[k] && l[k] !== 'None yet' ? l[k] : '');
  for (const [k, role] of POSTS) {
    const sid = after[k + 'Sid']; if (!sid) continue;
    /* one login works at one location */
    const other = postsOf(ctx, sid).find(p => p.code !== code);
    need(!other, after[k] + ' is already at ' + (other && other.name) + '. A person works at one location; replace them there first.');
    const u = users.find(x => x.studentId === sid);
    if (!u) { if (!noLogin.includes(after[k])) noLogin.push(after[k]); continue; }
    const roles = assignedRoles(u);
    need(!(u.loc && u.loc !== code && roles.some(r => LOC_ROLES.includes(r))), u.name + ' already has a location role elsewhere. A login holds one location; change that under People and logins first.');
    if (!roles.includes(role)) { roles.push(role); given.push(u.name); }
    u.loc = code; setRoles(ctx, u, roles);
  }
  for (const [k, role] of POSTS) {
    const prev = who(before, k); if (!prev) continue;
    /* still holds this role here (a name from before posts were chosen may now be the same person, chosen from the list) */
    if (POSTS.some(([k2, r2]) => r2 === role && (who(after, k2) === prev || (after[k2] && after[k2] === before[k])))) continue;
    /* a name from before posts were chosen from the students is matched to the login at this location */
    const u = before[k + 'Sid'] ? users.find(x => x.studentId === before[k + 'Sid']) : users.find(x => x.name === before[k] && x.loc === code);
    if (!u || !assignedRoles(u).includes(role)) continue;
    setRoles(ctx, u, assignedRoles(u).filter(r => r !== role)); removed.push(u.name);
  }
  return (given.length ? ' Role given to ' + given.join(', ') + '.' : '') + (removed.length ? ' Role removed from ' + removed.join(', ') + '.' : '') +
    (noLogin.length ? ' ' + noLogin.join(', ') + (noLogin.length === 1 ? ' has' : ' have') + ' no login yet: create one under People and logins and the role comes with it.' : '');
}

/* a returning student's details, carried on their registration while they wait for a class */
const details = s => ({ first: s.first, last: s.last, dob: s.dob, phone: s.phone, email: s.email });
/* closing a class: a student goes back to registrations at a location, and what is left of the class is ended */
function toRegistrations(ctx, s, c, loc) {
  s.classId = null; ctx.store.put('students', s);
  ctx.store.put('regs', { id: uid('r'), loc, name: s.name, ...details(s), g: s.g, course: c.course, sem: c.sem, city: s.city || '', sid: s.id, from: c.id, removed: true });
  notify(ctx, s.id, 'student', c.id + ' has closed. Your coordinator will place you in another class.');
}
function finishClose(ctx, c, reason, moved, back) {
  ctx.store.all('sessions').filter(x => x.classId === c.id && !x.logged).forEach(x => {
    Object.assign(x, { sem: x.sem || c.sem, held: false, logged: true, reason: 'Class closed', loggedBy: ctx.user.name, loggedOn: ctx.today });
    ctx.store.put('sessions', x);
  });
  renumber(ctx.store, c.id);
  c.status = 'closed'; c.assistantId = null; c.closed = { date: ctx.today, reason, by: ctx.user.name, moved, back };
  ctx.store.put('classes', c);
}

/* Each attempt at a paper is laid out afresh: the questions drawn and put in a new order, the options of each
   choice question and the right-hand column of each match question shuffled. The attempt keeps the layout
   (perms for match columns, operms for options) so the answers are marked against the original questions. */
export const CHAPTER_PAPER = 12; /* questions in a chapter paper, drawn from the chapter's larger pool */
const order = n => { const x = Array.from({ length: n }, (_, i) => i); for (let t = 0; t < 5; t++) { for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]]; } if (n < 2 || x.some((v, i) => v !== i)) break; } return x; };
const drawn = (list, n) => order(list.length).slice(0, n == null ? list.length : n).map(i => list[i]);
const choice = q => q.type !== 'fill' && q.type !== 'match' && Array.isArray(q.options) && q.options.length > 1;
function layout(qs) {
  const perms = qs.map(q => q.type === 'match' ? order(q.right.length) : null);
  const operms = qs.map(q => choice(q) ? order(q.options.length) : null);
  const view = qs.map((q, i) => {
    const o = { type: q.type, text: q.text };
    if (q.type === 'match') { o.left = q.left; o.right = perms[i].map(k => q.right[k]); }
    else if (q.type !== 'fill') { o.options = operms[i] ? operms[i].map(k => q.options[k]) : q.options; o.stmts = q.stmts; o.ar = q.ar; }
    return o;
  });
  return { perms, operms, view };
}
/* questions right in an attempt (match questions give part marks) */
function marked(ctx, att, ans) {
  let right = 0;
  att.qids.forEach((qid, i) => {
    const q = ctx.store.find('questions', qid); if (!q) return;
    let v = ans[i];
    if (q.type === 'match') v = Array.isArray(v) ? v.map(x => x === '' || x == null ? '' : att.perms[i][+x]) : null;
    else if (att.operms && att.operms[i] && v !== '' && v != null) v = att.operms[i][+v]; /* the option shown in place v */
    right += qScore(q, v);
  });
  return right;
}

/* Re-exams: a student who scored below the pass mark may sit a paper again, as often as needed, while it is
   open for their class; the best mark counts. Once passed, it cannot be sat again in that class. */
const passedPaper = (ctx, s, c, e) => ctx.store.all('results').some(r => r.sid === s.id && r.cid === c.id && r.course === e.course && r.sem === e.sem && r.sub === e.sub && (r.chapter || null) === (e.chapter || null) && r.pct >= PASS);
/* the signed-in teacher's readiness requirement for a syllabus, if they have one */
const myRows = ctx => readinessRows(ctx.store, ctx.store.all('classes').filter(c => c.teacherId === ctx.user.teacherId));
const myReadiness = (ctx, mid) => myRows(ctx).find(r => r.mid === mid) || null;
const teacherOf = (ctx, c) => ctx.store.find('teachers', c.teacherId) || {};
const teacherName = (ctx, id) => { const t = ctx.store.find('teachers', id); return t ? teacherTitle(t) : ''; };
const notify = (ctx, to, channel, text) => ctx.store.put('outbox', { id: uid('n'), to, channel, text, created: new Date().toISOString(), sent: false });

/* Sessions carry the semester they belong to. Older records without one belong to the class's current
   semester; moving a class on stamps them first. */
const inSem = (x, c) => (x.sem || c.sem) === c.sem;
/* A class that has completed its course or been closed takes no more students. */
const ended = c => c.status === 'completed' || c.status === 'closed';

/* Re-numbers held sessions of a class 1, 2, 3 … in date order, starting again each semester. */
export function renumber(store, cid) {
  const c = store.find('classes', cid); const w = {};
  store.all('sessions').filter(x => x.classId === cid).sort((a, b) => a.date < b.date ? -1 : 1).forEach(x => {
    const k = x.sem || (c && c.sem) || 0;
    const want = x.held ? (w[k] = (w[k] || 0) + 1) : null;
    if (x.week !== want) { x.week = want; store.put('sessions', x); }
  });
}

/* After the super admin moves a class's start date: drops the current semester's sessions that were never
   logged and lists them again weekly from the new date up to today. Logged sessions are kept as they are,
   dates that already have a session are skipped, and the semester's session count is not exceeded. */
function restartSessions(store, c, today) {
  const k = store.find('courses', c.course); if (!k) return;
  const cur = store.all('sessions').filter(x => x.classId === c.id && inSem(x, c));
  cur.filter(x => !x.logged).forEach(x => store.del('sessions', x.id));
  if (c.status !== 'active' || !c.teacherId) return;
  const kept = cur.filter(x => x.logged); const have = new Set(kept.map(x => x.date));
  let held = kept.filter(x => x.held).length; let d = c.startOn;
  while (pd(d).getDay() !== c.day) d = addDays(d, 1);
  for (; d < today && held < k.weeks; d = addDays(d, 7)) {
    if (have.has(d)) continue;
    store.put('sessions', { id: uid('x'), classId: c.id, sem: c.sem, date: d, held: true, logged: false, week: null, att: {}, reason: '', loggedBy: '' });
    held++;
  }
  renumber(store, c.id);
}

/* Creates a session record for every scheduled class date that has passed, so it can be logged. */
export async function ensureSessions(store, today) {
  let made = 0;
  await store.tx(() => {
    for (const c of store.all('classes')) {
      if (c.status !== 'active' || !c.teacherId) continue;
      const k = store.find('courses', c.course); if (!k) continue;
      const ss = store.all('sessions').filter(x => x.classId === c.id && inSem(x, c)).sort((a, b) => a.date < b.date ? -1 : 1);
      let held = ss.filter(x => x.held).length;
      let d;
      if (ss.length) d = addDays(ss[ss.length - 1].date, 7);
      else d = c.startOn || c.createdOn || today;
      while (pd(d).getDay() !== c.day) d = addDays(d, 1); /* also follows a change of class day */
      while (d < today && held < k.weeks) {
        store.put('sessions', { id: uid('x'), classId: c.id, sem: c.sem, date: d, held: true, logged: false, week: ++held, att: {}, reason: '', loggedBy: '' });
        made++;
        d = addDays(d, 7);
      }
    }
  });
  return made;
}

/* Applies an approved promotion: the person becomes a teacher at that level, or moves up to it. Their teacher
   record follows their person record for name and group. */
function applyTeachingLevel(ctx, p) {
  const s = ctx.store.find('students', p.sid); need(s, 'That person no longer exists.', 404);
  const k = course(ctx, p.level);
  let t = ctx.store.all('teachers').find(x => x.sid === s.id);
  if (t) { t.level = k.code; t.name = s.name; t.g = s.g; }
  else { const c = s.classId && ctx.store.find('classes', s.classId); t = { id: uid('t'), sid: s.id, name: s.name, g: s.g, level: k.code, access: 'own', loc: c ? c.loc : null, tzName: s.tzName || 'India', tzOff: s.tzOff ?? 5.5 }; }
  t.since = Object.assign({}, t.since, { [k.code]: ctx.today });
  /* a level given by exception stays on the teacher's record, with why and who approved it */
  if (p.exception) t.exception = { level: k.code, reason: p.reason, requestedBy: p.submittedBy, approvedBy: ctx.user.name, on: ctx.today }; else delete t.exception;
  ctx.store.put('teachers', t);
  notify(ctx, s.id, 'student', 'You have been approved to teach up to ' + k.name + '.');
  return s.name + ' can now teach up to ' + k.name + ' and appears in the teacher lists.';
}

/* Approves or sends back an update to an approved material. Until it is approved, the approved version stays
   in use; approving swaps in the new details and file, and a syllabus updates its chart column. */
function reviewUpdate(ctx, m, a) {
  const d = m.draft; need(d.submittedById !== ctx.user.id, 'Someone else must approve what you submitted.');
  if (a.decision !== 'approve') {
    const note = str(a.note, 500); need(note, 'Say what needs changing, so the creator can fix it.');
    m.draft = { ...d, status: 'rejected', reviewNote: note, reviewedBy: ctx.user.name, reviewedOn: ctx.today }; ctx.store.put('materials', m);
    return { toast: 'Update sent back to ' + (d.submittedBy || 'the creator') + '. The current version stays in use.' };
  }
  const { status, submittedBy, submittedById, submittedOn, reviewNote, ...fields } = d;
  const newFile = fields.fileId !== m.fileId;
  delete m.chart; delete m.chartNote; Object.assign(m, fields, { status: 'approved', reviewedBy: ctx.user.name, reviewedOn: ctx.today, updatedBy: submittedBy, submittedById, submittedBy, reviewNote: '' }); delete m.draft;
  const ask = wantsQuestions(m, newFile); if (ask) m.qgen = { status: 'queued' };
  ctx.store.put('materials', m);
  const chart = m.chart && m.type === 'Syllabus' ? ' ' + chartFromSyllabus(ctx, m) : '';
  const g = newFile ? guideQuiz(ctx, m) : null;
  return { toast: 'Update approved. Teachers and students see the new version on their next read.' + chart + (ask ? ' Questions are being drafted from the syllabus.' : '') + (g ? ' The teacher readiness quiz is being drafted again to include the new guide.' : ''), draft: ask ? m.id : g };
}

/* An approved syllabus fills its subject's column of the chart for its course and semester; the other
   subjects' columns are kept. */
function chartFromSyllabus(ctx, m) {
  const k = ctx.store.find('courses', m.course); const key = m.course + '-' + m.sem; const all = { ...ctx.store.get('chartData', {}) };
  const blank = () => Array.from({ length: k ? k.weeks : m.chart.weeks.length }, () => '');
  const cur = all[key] || { b: blank(), l: blank(), e: blank() };
  const next = { b: cur.b || blank(), l: cur.l || blank(), e: cur.e || blank(), sources: { ...(cur.sources || {}), [m.chart.sub]: { title: m.title, by: m.submittedBy, approvedBy: ctx.user.name, on: ctx.today } }, maps: { ...(cur.maps || {}), [m.chart.sub]: m.chart.map || [] }, on: ctx.today };
  next[m.chart.sub] = blank().map((_, i) => m.chart.weeks[i] || '');
  all[key] = next; ctx.store.set('chartData', all);
  ctx.store.set('charts', { ...ctx.store.get('charts', {}), [key]: true });
  const subj = ctx.store.find('subjects', m.chart.sub);
  return 'The ' + (subj ? subj.name : m.chart.sub) + ' column of the ' + (k ? k.name : m.course) + ' Semester ' + m.sem + ' syllabus chart now follows this syllabus.';
}

/* Approves or sends back a syllabus chart draft; approval makes it the live chart for that course-semester. */
function reviewChart(ctx, a) {
  const key = str(a.id, 20); const drafts = { ...ctx.store.get('chartDrafts', {}) }; const d = drafts[key];
  need(d && d.status === 'pending', 'This chart is not waiting for approval.');
  need(d.submittedById !== ctx.user.id, 'Someone else must approve what you submitted.');
  if (a.decision !== 'approve') {
    const note = str(a.note, 500); need(note, 'Say what needs changing, so the creator can fix it.');
    drafts[key] = { ...d, status: 'rejected', reviewNote: note, reviewedBy: ctx.user.name, reviewedOn: ctx.today }; ctx.store.set('chartDrafts', drafts);
    return { toast: 'Chart sent back to ' + (d.submittedBy || 'the creator') + ' with your note.' };
  }
  ctx.store.set('chartData', { ...ctx.store.get('chartData', {}), [key]: { b: d.b, l: d.l, e: d.e, by: d.submittedBy, approvedBy: ctx.user.name, on: ctx.today } });
  ctx.store.set('charts', { ...ctx.store.get('charts', {}), [key]: true });
  delete drafts[key]; ctx.store.set('chartDrafts', drafts);
  return { toast: 'Syllabus chart approved. Teachers now see these topics.' };
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
  assignSave: { roles: ['locadmin', 'super'], run(ctx, a) {
    const c = ctx.user.role === 'super' ? ctx.store.find('classes', str(a.cid)) : classIn(ctx, str(a.cid)); need(c, 'That class does not exist.', 404);
    const t = ctx.store.find('teachers', str(a.teacher));
    need(t, 'Choose a teacher.'); need(t.sid, teacherTitle(t) + ' is not linked to a student yet. The super admin links them under Master lists.'); need(t.g === c.g, 'The teacher must be the same gender as the class.');
    need(canTeach(ctx, t, c.course), t.level ? teacherTitle(t) + ' teaches up to ' + course(ctx, t.level).name + ' and cannot take ' + course(ctx, c.course).name + ' classes.' : teacherTitle(t) + ' has no teaching level yet.');
    c.teacherId = t.id; c.status = 'active'; if (!c.startOn) c.startOn = ctx.today; ctx.store.put('classes', c);
    return { toast: teacherTitle(t) + ' assigned. ' + c.id + ' is now active.' };
  } },
  /* location staff create classes at their own location; the super admin chooses the location */
  classSave: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const loc = ctx.user.role === 'super' ? str(a.loc, 10) : ctx.user.loc; need(inUse(ctx, loc), 'Choose the location.');
    const k = course(ctx, str(a.course)); const g = a.g === 'M' ? 'M' : 'F';
    const tm = /^(\d{1,2}):(\d{2})$/.exec(str(a.time) || '20:00'); need(tm, 'Enter the time as hours and minutes.');
    /* by number, not current location: a class moved to another location keeps its number */
    const nums = ctx.store.all('classes').filter(c => c.id.startsWith(loc + '-' + k.code + '-')).map(c => +c.id.split('-')[2] || 0);
    const id = loc + '-' + k.code + '-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
    let tid = null;
    if (ctx.user.role !== 'coord' && a.teacher) { const t = ctx.store.find('teachers', str(a.teacher)); need(t && t.g === g, 'The teacher must be the same gender as the class.'); need(t.sid, teacherTitle(t) + ' is not linked to a student yet. The super admin links them under Master lists.'); need(canTeach(ctx, t, k.code), t.level ? teacherTitle(t) + ' teaches up to ' + course(ctx, t.level).name + ' and cannot take ' + k.name + ' classes.' : teacherTitle(t) + ' has no teaching level yet.'); tid = t.id; }
    ctx.store.put('classes', { id, loc, course: k.code, sem: int(a.sem, 1, k.sems, 1), g, teacherId: tid, day: int(a.day, 0, 6, 1), time: int(tm[1], 0, 23, 20) * 60 + int(tm[2], 0, 59, 0), status: tid ? 'active' : 'awaiting', createdBy: ctx.user.name, createdOn: ctx.today, startOn: isIsoDate(a.start) ? a.start : ctx.today, meet: meetLink(a.meet) });
    return { toast: id + ' created' + (tid ? ' with ' + teacherName(ctx, tid) : ' and saved as awaiting teacher'), result: { id } };
  } },
  /* location staff register students at their own location; the super admin chooses the location */
  regAdd: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const p = person(ctx, a, true); need(a.g === 'M' || a.g === 'F', 'Choose the student\'s gender.');
    const k = course(ctx, str(a.course));
    const loc = ctx.user.role === 'super' ? str(a.loc, 10) : ctx.user.loc;
    need(inUse(ctx, loc), 'Choose the academy location.');
    notDuplicate(ctx, p);
    ctx.store.put('regs', { id: uid('r'), loc, ...p, g: a.g, course: k.code });
    return { toast: p.name + ' registered and waiting for a class' };
  } },
  /* A registration made by mistake or twice is removed. A returning student waiting here is not: they have a
     record and marks, and leave through their class history instead. */
  regRemove: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const r = ctx.store.find('regs', str(a.id)); need(r && (ctx.user.role === 'super' || r.loc === ctx.user.loc), 'Registration not found.', 404);
    need(!r.sid, r.name + ' is a returning student and cannot be removed here. Allocate a class instead.');
    ctx.store.del('regs', r.id);
    return { toast: r.name + '\'s registration removed' };
  } },
  allocSave: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const r = ctx.store.find('regs', str(a.rid)); need(r && (ctx.user.role === 'super' || r.loc === ctx.user.loc), 'Registration not found.', 404);
    const c = ctx.store.find('classes', str(a.cid)); need(c && !ended(c), 'Choose a class.'); need(c.g === r.g, 'Choose a ' + (r.g === 'F' ? 'sisters' : 'brothers') + ' class.');
    const s = r.sid && ctx.store.find('students', r.sid);
    if (s) { s.classId = c.id; s.joined = ctx.today; s.allocatedBy = ctx.user.name; ctx.store.put('students', s); }
    else ctx.store.put('students', { id: uid('s'), name: r.name, first: r.first, last: r.last, g: r.g, dob: r.dob, phone: r.phone, email: r.email, classId: c.id, joined: ctx.today, allocatedBy: ctx.user.name, registered: r.date || null, city: r.city, tzName: 'India', tzOff: 5.5, prefs: { email: true, wa: true, absence: true } });
    ctx.store.del('regs', r.id);
    return { toast: r.name + ' added to ' + c.id + ' with status New' };
  } },
  /* Gives a student in one of the caller's classes their own login (it opens only that student's class). */
  studentLogin: { roles: ['locadmin', 'coord'], run(ctx, a) {
    const s = ctx.store.find('students', str(a.sid)); need(s && s.classId, 'Student not found.', 404); classIn(ctx, s.classId);
    need(!ctx.store.all('users').some(u => u.studentId === s.id), s.name + ' already has a login.');
    const username = str(a.username, 40).toLowerCase(); need(/^[a-z0-9._-]{3,40}$/.test(username), 'Usernames use 3 to 40 letters, numbers, dots, dashes or underscores.');
    need(!ctx.store.all('users').some(u => u.username === username), 'That username is taken.');
    const pw = String(a.password || ''); need(pw.length >= 8, 'The password needs at least 8 characters.');
    ctx.store.put('users', { id: uid('u-'), username, name: s.name, roles: [], studentId: s.id, password: hashPassword(pw) });
    return { toast: 'Login created for ' + s.name + '. They sign in as ' + username + '.' };
  } },
  moveStudent: { roles: ['locadmin', 'coord'], run(ctx, a) {
    const s = ctx.store.find('students', str(a.sid)); need(s && s.classId, 'Student not found.', 404);
    const from = classIn(ctx, s.classId);
    const to = ctx.store.find('classes', str(a.cid)); need(to && !ended(to), 'Choose a class.');
    need(to.id !== from.id, 'The student is already in ' + from.id + '.');
    need(to.g === s.g, 'Choose a ' + (s.g === 'F' ? 'sisters' : 'brothers') + ' class.');
    s.classId = to.id; s.joined = ctx.today; ctx.store.put('students', s);
    if (from.assistantId === s.id) { from.assistantId = null; ctx.store.put('classes', from); }
    notify(ctx, s.id, 'student', 'You have moved from ' + from.id + ' to ' + to.id + '.');
    return { toast: s.name + ' moved from ' + from.id + ' to ' + to.id };
  } },
  /* Takes a student out of their class. Nothing is deleted: either they wait in registrations for another
     class, or they are recorded as having left the academy. */
  removeStudent: { roles: ['locadmin', 'coord'], run(ctx, a) {
    const s = ctx.store.find('students', str(a.sid)); need(s && s.classId, 'Student not found.', 404);
    const from = classIn(ctx, s.classId); const left = a.mode === 'left'; const reason = str(a.reason, 300);
    s.classId = null;
    if (left) s.left = { date: ctx.today, from: from.id, reason, by: ctx.user.name };
    else ctx.store.put('regs', { id: uid('r'), loc: from.loc, name: s.name, ...details(s), g: s.g, course: from.course, sem: from.sem, city: s.city || '', sid: s.id, from: from.id, removed: true });
    ctx.store.put('students', s);
    if (from.assistantId === s.id) { from.assistantId = null; ctx.store.put('classes', from); }
    return { toast: left ? s.name + ' removed from ' + from.id + ' and recorded as having left' : s.name + ' removed from ' + from.id + ' and waiting for another class' };
  } },
  /* Closes a class for good. Every student either moves to another class or goes back to registrations
     (dest maps student id to a class id, or 'reg'). Sessions never logged are recorded as cancelled. */
  closeClass: { roles: ['locadmin', 'coord'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); need(!ended(c), 'This class has already ' + (c.status === 'closed' ? 'been closed.' : 'completed its course.'));
    const reason = str(a.reason, 300); need(reason, 'Give a reason for closing the class.');
    const dest = a.dest && typeof a.dest === 'object' ? a.dest : {};
    const studs = ctx.store.all('students').filter(s => s.classId === c.id);
    const plan = studs.map(s => {
      const want = str(dest[s.id], 64);
      if (!want || want === 'reg') return { s, to: null };
      const to = ctx.store.find('classes', want);
      need(to && !ended(to) && to.id !== c.id, 'Choose a running class for ' + s.name + '.');
      need(to.g === s.g, s.name + ' can only move to a ' + (s.g === 'F' ? 'sisters' : 'brothers') + ' class.');
      return { s, to };
    });
    let moved = 0, back = 0;
    plan.forEach(({ s, to }) => {
      if (to) { moved++; s.classId = to.id; s.joined = ctx.today; notify(ctx, s.id, 'student', c.id + ' has closed. You have moved to ' + to.id + '.'); ctx.store.put('students', s); }
      else { back++; toRegistrations(ctx, s, c, c.loc); }
    });
    finishClose(ctx, c, reason, moved, back);
    return { toast: c.id + ' closed. ' + [moved ? moved + ' moved to other classes' : '', back ? back + ' back in registrations' : ''].filter(Boolean).join(', ') + (moved || back ? '.' : '') };
  } },
  /* Ends the class's current semester. Ticked students move on with the class (or finish the course after
     the last semester); the rest go back to registrations to repeat the semester in another class. */
  /* A class that has finished its course goes up a level: a new class at the next course type, Semester 1, with the
     chosen students. The finished class stays as it is, since its marks and sessions belong to its number. */
  classNextLevel: { roles: ['locadmin', 'super'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); need(c.status === 'completed', c.id + ' has not completed its course yet.');
    need(!c.promotedTo, c.id + ' has already moved up, as ' + c.promotedTo + '.');
    const levels = ctx.store.all('courses'); const k = levels[rank(ctx, c.course) + 1]; need(k, course(ctx, c.course).name + ' is the highest level.');
    need(inUse(ctx, c.loc), 'This class\'s location is disabled.');
    need(isIsoDate(a.start) && a.start >= ctx.today, 'Choose the start date, today or later.');
    const up = new Set(Array.isArray(a.up) ? a.up.map(x => str(x, 64)) : []);
    const studs = ctx.store.all('students').filter(s => s.classId === c.id && up.has(s.id)); need(studs.length, 'Tick at least one student to move up.');
    let tid = null;
    if (a.teacher) {
      const t = ctx.store.find('teachers', str(a.teacher)); need(t && t.g === c.g, 'The teacher must be the same gender as the class.');
      need(t.sid, teacherTitle(t) + ' is not linked to a student yet. The super admin links them under Master lists.');
      need(canTeach(ctx, t, k.code), t.level ? teacherTitle(t) + ' teaches up to ' + course(ctx, t.level).name + ' and cannot take ' + k.name + ' classes.' : teacherTitle(t) + ' has no teaching level yet.'); tid = t.id;
    }
    const nums = ctx.store.all('classes').filter(x => x.id.startsWith(c.loc + '-' + k.code + '-')).map(x => +x.id.split('-')[2] || 0);
    const id = c.loc + '-' + k.code + '-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
    ctx.store.put('classes', { id, loc: c.loc, course: k.code, sem: 1, g: c.g, teacherId: tid, day: c.day, time: c.time, status: tid ? 'active' : 'awaiting', createdBy: ctx.user.name, createdOn: ctx.today, startOn: a.start, meet: c.meet || '', promotedFrom: c.id, assistantId: studs.some(s => s.id === c.assistantId) ? c.assistantId : null });
    studs.forEach(s => { s.classId = id; s.joined = a.start; ctx.store.put('students', s); notify(ctx, s.id, 'student', 'You have moved up to ' + k.name + ' with your class, now ' + id + ', starting ' + a.start + '.'); });
    if (tid) notify(ctx, tid, 'teacher', 'You have been assigned ' + id + ', ' + k.name + ' Semester 1, starting ' + a.start + '.');
    c.promotedTo = id; c.promotedOn = ctx.today; c.promotedBy = ctx.user.name; c.assistantId = null; ctx.store.put('classes', c);
    return { toast: studs.length + (studs.length === 1 ? ' student' : ' students') + ' moved up to ' + k.name + ' as ' + id + (tid ? ' with ' + teacherName(ctx, tid) : ', awaiting a teacher') + '.', result: { id } };
  } },
  promote: { roles: ['locadmin', 'super'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); need(c.status === 'active', 'Only a class that is running can move on.');
    const k = course(ctx, c.course); const sem = c.sem; const last = sem >= k.sems;
    const up = new Set(Array.isArray(a.up) ? a.up.map(x => str(x, 64)) : []);
    ctx.store.all('sessions').filter(x => x.classId === c.id && !x.sem).forEach(x => { x.sem = sem; ctx.store.put('sessions', x); });
    let moved = 0, back = 0;
    ctx.store.all('students').filter(s => s.classId === c.id).forEach(s => {
      if (up.has(s.id)) {
        moved++;
        if (last) { s.completed = (s.completed || []).concat({ course: c.course, cid: c.id, date: ctx.today }); ctx.store.put('students', s); }
        notify(ctx, s.id, 'student', last ? 'You have completed the ' + k.name + ' course.' : 'You have moved up to Semester ' + (sem + 1) + ' of ' + k.name + '.');
        return;
      }
      back++;
      s.classId = null; ctx.store.put('students', s);
      ctx.store.put('regs', { id: uid('r'), loc: c.loc, name: s.name, ...details(s), g: s.g, course: c.course, sem, city: s.city || '', sid: s.id, from: c.id });
      if (c.assistantId === s.id) c.assistantId = null;
    });
    c.history = (c.history || []).concat({ sem, date: ctx.today, moved, back });
    if (last) c.status = 'completed';
    else { c.sem = sem + 1; c.startOn = isIsoDate(a.start) && a.start >= ctx.today ? a.start : ctx.today; }
    ctx.store.put('classes', c);
    const rest = back ? ' ' + back + (back === 1 ? ' student goes' : ' students go') + ' back to registrations to repeat Semester ' + sem + '.' : '';
    return { toast: (last ? c.id + ' has completed the course with ' + moved + (moved === 1 ? ' student.' : ' students.') : c.id + ' is now in Semester ' + c.sem + ' with ' + moved + (moved === 1 ? ' student.' : ' students.')) + rest };
  } },
  /* the weekly coordination of a location: its location responsible, or the super admin for any location */
  /* A meeting is logged on or after the day it took place, never before; earlier ones can be logged late. id edits one. */
  callSave: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const l = coordLoc(ctx, a); const was = a.id ? ctx.store.find('calls', str(a.id)) : null;
    if (a.id) need(was && was.loc === l.code, 'Meeting not found.', 404);
    const status = ['Held', 'Missed', 'Rescheduled'].includes(a.status) ? a.status : 'Held';
    const date = str(a.date, 10); need(isIsoDate(date), 'Choose the date of the meeting.');
    need(date <= ctx.today, 'This meeting has not taken place yet. Log it on or after ' + date + '.');
    need(!ctx.store.all('calls').some(c => c.loc === l.code && c.date === date && c.id !== (was && was.id)), 'A meeting on ' + date + ' is already logged. Edit that one instead.');
    /* attendance of the participants, for a meeting that was held; anyone since removed stays on its record */
    const given = a.att && typeof a.att === 'object' ? a.att : {};
    const now = callPeople(l); const people = [...now, ...((was && was.att) || []).filter(x => !now.some(p => p.sid === x.sid))];
    const att = status === 'Held' ? people.map(p => ({ sid: p.sid, name: p.name, present: given[p.sid] !== false })) : [];
    ctx.store.put('calls', { ...(was || { id: uid('c'), loc: l.code }), date, status, att });
    if (was) return { toast: 'Meeting of ' + date + ' saved' };
    if (date >= l.nextCall) { let next = addDays(date, 1); while (DOWL[pd(next).getDay()] !== l.callDay) next = addDays(next, 1); l.nextCall = next; ctx.store.put('locations', l); }
    const text = str(a.text, 500);
    if (text) { const owner = str(a.owner, 100) || ctx.user.name; ctx.store.put('actions', { id: uid('a'), loc: l.code, text, owner, ownerSid: ownerSidFor(l, owner), due: isIsoDate(a.due) ? a.due : addDays(ctx.today, 7), done: false, rem: 0 }); }
    return { toast: 'Call recorded as ' + status.toLowerCase() + (text ? ' with one action item' : '') };
  } },
  /* A location responsible sets the day and time of their own location's weekly call; everyone on it is told. */
  callSchedule: { roles: ['locadmin', 'super'], run(ctx, a) {
    const l = coordLoc(ctx, a); need(DOWL.includes(a.callDay), 'Choose the day of the call.');
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(str(a.time, 5)); need(m, 'Choose the time of the call.');
    const callTime = ft(+m[1] * 60 + +m[2]); const meet = a.meet === undefined ? l.meet || '' : meetLink(a.meet);
    const moved = a.callDay !== l.callDay || callTime !== l.callTime; const linked = meet !== (l.meet || '');
    if (!moved && !linked) return { toast: 'Nothing has changed.' };
    if (a.callDay !== l.callDay) { let next = ctx.today; while (DOWL[pd(next).getDay()] !== a.callDay) next = addDays(next, 1); l.nextCall = next; }
    Object.assign(l, { callDay: a.callDay, callTime, meet }); ctx.store.put('locations', l);
    const me = ctx.account.studentId;
    const news = (moved ? 'is now every ' + a.callDay + ' at ' + callTime : '') + (moved && linked ? ', and its ' : linked ? 'has a new ' : '') + (linked ? (moved ? 'Meet link has changed' : 'Meet link') : '');
    callPeople(l).filter(p => p.sid !== me).forEach(p => notify(ctx, p.sid, 'student', 'The weekly coordination call of ' + l.name + ' ' + news + '.'));
    return { toast: 'The ' + l.name + ' call ' + news + '.' + (moved ? clashNote(ctx, l) : '') };
  } },
  /* A meeting logged by mistake. If it was today or later, that date is the next call again. */
  callRemove: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const x = ctx.store.find('calls', str(a.id)); need(x && (ctx.user.role === 'super' || x.loc === ctx.user.loc), 'Meeting not found.', 404);
    const l = ctx.store.find('locations', x.loc);
    if (l && x.date >= ctx.today && x.date < l.nextCall) { l.nextCall = x.date; ctx.store.put('locations', l); }
    ctx.store.del('calls', x.id);
    return { toast: 'Meeting of ' + x.date + ' removed' };
  } },
  /* participants of a location's weekly call, chosen from all the students, of any location */
  participantAdd: { roles: ['locadmin', 'super'], run(ctx, a) {
    const l = coordLoc(ctx, a); const s = ctx.store.find('students', str(a.sid)); need(s && !s.left, 'Choose a student from the list.');
    const on = callPeople(l).find(p => p.sid === s.id);
    need(!on, s.name + (on && on.post ? ' is on this call already, as ' + on.post.toLowerCase() + '.' : ' is already a participant.'));
    l.participants = [...(l.participants || []), { sid: s.id, name: s.name }]; ctx.store.put('locations', l);
    notify(ctx, s.id, 'student', 'You have been added to the weekly coordination call of ' + l.name + ', every ' + l.callDay + ' at ' + l.callTime + '.');
    return { toast: s.name + ' added to the weekly call and notified.' + clashNote(ctx, l, [s.id]) };
  } },
  participantRemove: { roles: ['locadmin', 'super'], run(ctx, a) {
    const l = coordLoc(ctx, a); const sid = str(a.sid); const p = (l.participants || []).find(x => x.sid === sid); need(p, 'This person is not a participant.', 404);
    l.participants = l.participants.filter(x => x.sid !== sid); ctx.store.put('locations', l);
    return { toast: p.name + ' removed from the weekly call' };
  } },
  /* The tasks a person kept after reviewing what was suggested from a meeting's transcript (see tasks.js). Each
     has an owner from the location's people, and is told if they can be reached. */
  actionsFromMeeting: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const c = ctx.store.find('calls', str(a.callId)); need(c && (ctx.user.role === 'super' || c.loc === ctx.user.loc), 'Meeting not found.', 404);
    const l = ctx.store.find('locations', c.loc); const people = [...meetingPeople(l), ctx.user.name];
    const items = (Array.isArray(a.items) ? a.items : []).slice(0, 50); need(items.length, 'Choose at least one task to save.');
    for (const t of items) {
      const text = str(t && t.text, 500), owner = str(t && t.owner, 100); need(text, 'A task has no description.');
      need(owner, 'Choose who is responsible for: ' + text); need(people.includes(owner), owner + ' is not one of the people at this location\'s call.');
      const due = isIsoDate(t.due) ? t.due : addDays(ctx.today, 7);
      const sid = ownerSidFor(l, owner);
      ctx.store.put('actions', { id: uid('a'), loc: l.code, text, owner, ownerSid: sid, due, done: false, rem: 0, callId: c.id, callDate: c.date, quote: str(t.quote, 400) });
      if (sid) notify(ctx, sid, 'student', 'You have a new task from the ' + l.name + ' coordination call of ' + c.date + ': ' + text + ' (due ' + due + ').');
    }
    return { toast: items.length + (items.length === 1 ? ' task' : ' tasks') + ' added to the action items' };
  } },
  actionAdd: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const text = str(a.text, 500); need(text, 'Say what needs doing.');
    const l = coordLoc(ctx, a); const owner = str(a.owner, 100) || ctx.user.name;
    ctx.store.put('actions', { id: uid('a'), loc: l.code, text, owner, ownerSid: ownerSidFor(l, owner), due: isIsoDate(a.due) ? a.due : addDays(ctx.today, 7), done: false, rem: 0 });
    return { toast: 'Action item added' };
  } },
  /* closed by the location's staff or the super admin, or by the person it was given to */
  closeAction: { roles: ['locadmin', 'coord', 'super', 'student'], run(ctx, a) {
    const x = ctx.store.find('actions', str(a.id));
    const own = u => u.role === 'student' ? !!x && ownerSidOf(ctx, x) === u.studentId : u.role === 'super' || (!!x && x.loc === u.loc);
    need(x && own(ctx.user), 'Action item not found.', 404); need(!x.done, 'This task is already done.');
    x.done = true; x.doneOn = ctx.today; x.doneBy = ctx.user.name; ctx.store.put('actions', x);
    return { toast: 'Action item closed' };
  } },

  /* The class's teacher or the location responsible picks one student of the class as class assistant, who can
     then log sessions. An empty sid removes the assistant. */
  setAssistant: { roles: ['teacher', 'locadmin'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); need(!ended(c), 'This class has ' + (c.status === 'closed' ? 'been closed.' : 'completed its course.'));
    const sid = str(a.sid, 64);
    if (!sid) { c.assistantId = null; ctx.store.put('classes', c); return { toast: c.id + ' has no class assistant now' }; }
    const s = ctx.store.find('students', sid); need(s && s.classId === c.id, 'Choose a student of ' + c.id + '.');
    c.assistantId = s.id; ctx.store.put('classes', c);
    notify(ctx, s.id, 'student', 'You are now the class assistant of ' + c.id + ' and can log its sessions.');
    return { toast: s.name + ' is now the class assistant of ' + c.id };
  } },

  /* session log: teacher, location responsible, or class assistant */
  logSave: { roles: ['teacher', 'locadmin', 'student'], run(ctx, a) {
    const x = ctx.store.find('sessions', str(a.sid)); need(x, 'Session not found.', 404);
    let c;
    if (ctx.user.role === 'student') { const s = student(ctx); c = ctx.store.find('classes', x.classId); need(c && c.assistantId === s.id, 'Only the class assistant can log this session.', 403); }
    else c = classIn(ctx, x.classId);
    const editing = x.logged; need(!editing || a.edit, 'This session is already logged.');
    /* Students in the class on the session date count as present unless marked otherwise. Students recorded as
       joining later (often entered after the class had begun) are only counted when marked, and marking them
       moves their joining date back to this session. */
    const att = a.att && typeof a.att === 'object' ? a.att : {};
    const studs = ctx.store.all('students').filter(s => s.classId === c.id && (s.joined <= x.date || (a.held && ['p', 'a', 'e'].includes(att[s.id]))));
    x.logged = true; x.held = !!a.held; x.reason = x.held ? '' : str(a.reason, 300); x.verse = str(a.verse, 200); x.note = str(a.note, 2000);
    x.covered = { b: !!(a.covered && a.covered.b), l: !!(a.covered && a.covered.l), e: !!(a.covered && a.covered.e) };
    if (editing) { x.editedBy = ctx.user.name; x.editedOn = ctx.today; }
    else { x.loggedBy = ctx.user.name + (ctx.user.role === 'student' ? ' (assistant)' : ctx.user.role === 'locadmin' ? ' (for the teacher)' : ''); x.loggedOn = ctx.today; }
    x.att = {};
    let p = 0;
    if (x.held) studs.forEach(s => {
      const v = ['p', 'a', 'e'].includes(att[s.id]) ? att[s.id] : 'p'; x.att[s.id] = v; if (v === 'p') p++;
      if (s.joined > x.date) { s.joined = x.date; ctx.store.put('students', s); }
    });
    ctx.store.put('sessions', x);
    renumber(ctx.store, c.id);
    return { toast: (editing ? 'Changes saved. ' : 'Saved. ') + (x.held ? p + ' of ' + studs.length + ' present.' : 'Recorded as cancelled.') };
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
    /* A semester exam is one examined subject of the class's current semester, named course-sem-subject.
       A chapter paper is named CH-course-sem-subject-chapter and is open while its chapter window is. */
    const s = student(ctx); const c = ctx.store.find('classes', s.classId); need(c, 'You are not in a class.', 404);
    const parts = str(a.id, 40).split('-'); const ch = parts[0] === 'CH'; const [co, semS, sub, nS] = ch ? parts.slice(1) : parts;
    need(co === c.course && +semS === c.sem && ctx.store.all('subjects').some(x => x.exam && x.key === sub), 'Exam not found.', 404);
    const chapter = ch ? int(nS, 1, 999, 0) : null;
    const e = { id: (ch ? 'CH-' : '') + c.course + '-' + c.sem + '-' + sub + (ch ? '-' + chapter : ''), course: c.course, sem: c.sem, sub, chapter };
    const live = ctx.store.all('questions').filter(q => !q.retired && !q.aud && approved(q) && q.course === e.course && q.sem === e.sem && q.sub === e.sub);
    let qs;
    if (ch) {
      /* a chapter paper draws CHAPTER_PAPER questions from the chapter's pool, afresh for each attempt */
      const pool = live.filter(q => q.chapter === chapter); need(pool.length, 'Exam not found.', 404);
      need(chapterState(chapterWindow(c, sub, chapter), ctx.today) === 'open', 'This chapter paper is not open for your class.');
      need(!passedPaper(ctx, s, c, e), 'You have already passed this chapter paper.');
      qs = drawn(pool, CHAPTER_PAPER);
    } else {
      need(examOpenFor(c, ctx.today), 'The exam window for your class is not open.');
      need(!passedPaper(ctx, s, c, e), 'You have already passed this exam.');
      /* the semester exam uses the bank's own questions; when a subject only has chapter questions, it draws 30 of them */
      const own = live.filter(q => !q.chapter);
      qs = own.length ? drawn(own) : drawn(live, 30);
    }
    need(qs.length, 'This exam has no questions yet.');
    const l = layout(qs);
    const att = { id: uid('at'), sid: s.id, examId: e.id, course: e.course, sem: e.sem, sub: e.sub, chapter: e.chapter, qids: qs.map(q => q.id), perms: l.perms, operms: l.operms, started: new Date().toISOString(), done: false };
    ctx.store.put('attempts', att);
    return { result: { attemptId: att.id, examId: e.id, qs: l.view } };
  } },
  examSubmit: { roles: ['student'], run(ctx, a) {
    const s = student(ctx); const att = ctx.store.find('attempts', str(a.attemptId));
    need(att && att.sid === s.id && !att.done, 'This exam attempt is not open.');
    const e = att.course ? { course: att.course, sem: att.sem, sub: att.sub, chapter: att.chapter || null } : ctx.store.find('exams', att.examId); need(e, 'Exam not found.', 404);
    const c = ctx.store.find('classes', s.classId);
    if (e.chapter) need(chapterState(chapterWindow(c, e.sub, e.chapter), ctx.today) === 'open', 'This chapter paper has closed.');
    else need(examOpenFor(c, ctx.today), 'The exam window for your class has closed.');
    const prior = ctx.store.all('results').filter(r => r.sid === s.id && r.course === e.course && r.sem === e.sem && r.sub === e.sub && (r.chapter || null) === (e.chapter || null));
    need(!passedPaper(ctx, s, c, e), 'You have already passed this ' + (e.chapter ? 'chapter paper.' : 'exam.'));
    const ans = Array.isArray(a.ans) ? a.ans : [];
    const right = marked(ctx, att, ans);
    att.done = true; att.ans = ans; att.finished = new Date().toISOString(); ctx.store.put('attempts', att);
    const pct = Math.round(right / att.qids.length * 100);
    ctx.store.put('results', { id: uid('r'), sid: s.id, cid: s.classId, course: e.course, sem: e.sem, sub: e.sub, ...(e.chapter ? { chapter: e.chapter } : {}), pct, attempt: prior.length + 1, date: ctx.today });
    /* a chapter paper's mark is shown straight away (a semester exam's waits for the results to be published) */
    return e.chapter ? { result: { pct, passed: pct >= PASS, key: e.course + '|' + e.sem + '|' + e.sub + '|' + e.chapter } } : {};
  } },

  /* syllabus readiness (see readiness.js): the reader reports the seconds spent on each page every few seconds */
  readTrack: { roles: ['teacher'], run(ctx, a) {
    /* the item may be the syllabus or any material of its training */
    const mid = str(a.mid); const r = myRows(ctx).find(x => x.items.some(i => i.mid === mid)); if (!r) return { quiet: true };
    const m = ctx.store.find('materials', mid); const id = recordId(r.tid, m);
    const rec = ctx.store.find('readiness', id) || { id, tid: r.tid, mid, fileId: m.fileId || null, pages: {} };
    const units = unitsFor(ctx.store, m, null) || int(a.total, 1, 2000, 0); rec.total = units;
    for (const [k, v] of Object.entries(a.units && typeof a.units === 'object' ? a.units : {}).slice(0, 2000)) {
      const n = int(k, 1, units, 0); const s = int(v, 0, 60, 0); if (n && s) rec.pages[n] = Math.min((rec.pages[n] || 0) + s, 36000);
    }
    ctx.store.put('readiness', rec);
    const it = itemProgress(ctx.store, r.tid, m); const p = progress(ctx.store, r);
    if (it.done && !rec.readOn) { rec.readOn = ctx.today; ctx.store.put('readiness', rec); }
    return { quiet: true, result: { read: it.read, units: it.units, need: it.need, secs: it.secs, mins: Math.round(it.secs / 60), done: it.done, pages: it.pages, allDone: p.readDone, left: p.items.length - p.itemsDone } };
  } },
  tquizStart: { roles: ['teacher'], run(ctx, a) {
    const r = myReadiness(ctx, str(a.mid)); need(r, 'This syllabus is not one you need to be ready for.', 404);
    const p = progress(ctx.store, r);
    need(p.readDone, 'Go through the whole training in the app first: ' + p.itemsDone + ' of ' + p.items.length + ' items done so far (' + p.items.filter(i => !i.done).map(i => i.title).join(', ') + ' still to finish).');
    need(!p.passedOn, 'You have already passed this quiz.');
    need(!p.nextTry || ctx.today >= p.nextTry, 'You can take the quiz again from ' + p.nextTry + '. Read the syllabus again meanwhile.');
    const pool = quizQuestions(ctx.store, r.mid); need(pool.length >= QUIZ_MIN, 'The readiness quiz for this syllabus is still being prepared by the academic team.');
    const qs = drawn(pool, QUIZ_SIZE); const l = layout(qs);
    const att = { id: uid('at'), tid: r.tid, kind: 'tquiz', rid: r.id, mid: r.mid, qids: qs.map(q => q.id), perms: l.perms, operms: l.operms, started: new Date().toISOString(), done: false };
    ctx.store.put('attempts', att);
    return { result: { attemptId: att.id, examId: 'TQ-' + r.mid, label: { eyebrow: 'Teacher readiness quiz · pass mark ' + QUIZ_PASS + '%', title: p.title }, qs: l.view } };
  } },
  tquizSubmit: { roles: ['teacher'], run(ctx, a) {
    const att = ctx.store.find('attempts', str(a.attemptId));
    need(att && att.kind === 'tquiz' && att.tid === ctx.user.teacherId && !att.done, 'This quiz attempt is not open.');
    const ans = Array.isArray(a.ans) ? a.ans : []; const right = marked(ctx, att, ans);
    const pct = Math.round(right / att.qids.length * 100);
    att.done = true; att.ans = ans; att.finished = new Date().toISOString(); att.pct = pct; ctx.store.put('attempts', att);
    const rec = ctx.store.find('readiness', att.rid); rec.quiz = (rec.quiz || []).concat({ on: ctx.today, pct }); ctx.store.put('readiness', rec);
    const ok = pct >= QUIZ_PASS;
    return { result: { pct, passed: ok }, toast: ok ? 'You scored ' + pct + '%. You are ready to teach this syllabus.' : 'You scored ' + pct + '%; the pass mark is ' + QUIZ_PASS + '%. Read the syllabus again; you can retake the quiz from tomorrow.' };
  } },

  /* a chapter paper (any subject with chapter papers) opened for one class between two dates, usually once
     the class has finished the chapter; opening it again changes the dates */
  chapterOpen: { roles: ['teacher', 'locadmin'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); need(c.status === 'active', 'Only a running class can sit papers.');
    const sub = str(a.sub, 10); const n = int(a.n, 1, 999, 0); const subj = ctx.store.find('subjects', sub);
    need(subj && n && ctx.store.all('questions').some(q => !q.retired && !q.aud && approved(q) && q.course === c.course && q.sem === c.sem && q.sub === sub && q.chapter === n), 'This chapter paper has no approved questions yet. Ask the academic team.');
    need(isIsoDate(a.from) && isIsoDate(a.to) && a.from <= a.to, 'Enter the dates the paper opens and closes.');
    need(a.to >= ctx.today, 'The paper must close today or later.');
    c.chapterExams = { ...(c.chapterExams || {}), [chapterKey(c.sem, sub, n)]: { from: a.from, to: a.to, closed: false, by: ctx.user.name, on: ctx.today } }; ctx.store.put('classes', c);
    const name = (subj.name || sub) + ' chapter ' + n + ' paper';
    ctx.store.all('students').filter(s => s.classId === c.id).forEach(s => notify(ctx, s.id, 'student', 'Your ' + name + ' is open from ' + a.from + ' to ' + a.to + '.'));
    return { toast: name.charAt(0).toUpperCase() + name.slice(1) + ' for ' + c.id + ' opens ' + a.from + ' and closes ' + a.to + '.' };
  } },
  chapterClose: { roles: ['teacher', 'locadmin'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); const key = chapterKey(c.sem, str(a.sub, 10), int(a.n, 1, 999, 0)); const w = (c.chapterExams || {})[key];
    need(w && !w.closed, 'This chapter paper is not open.');
    c.chapterExams = { ...c.chapterExams, [key]: { ...w, closed: true, closedBy: ctx.user.name, closedOn: ctx.today } }; ctx.store.put('classes', c);
    return { toast: 'Chapter paper closed for ' + c.id + '.' };
  } },

  /* exam windows: a class's teacher or location responsible opens its exams for a period */
  examOpen: { roles: ['teacher', 'locadmin'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); need(c.status === 'active', 'Only a running class can sit exams.');
    need(isIsoDate(a.from) && isIsoDate(a.to) && a.from <= a.to, 'Enter the dates the window opens and closes.');
    need(a.to >= ctx.today, 'The window must close today or later.');
    const subs = ctx.store.all('subjects').filter(s => s.exam);
    const empty = subs.filter(s => !ctx.store.all('questions').some(q => !q.retired && !q.aud && approved(q) && q.course === c.course && q.sem === c.sem && q.sub === s.key));
    need(!empty.length, 'Semester ' + c.sem + ' has no approved questions yet for ' + empty.map(s => s.name).join(', ') + '. Ask the academic team.');
    c.exam = { sem: c.sem, from: a.from, to: a.to, closed: false, by: ctx.user.name, on: ctx.today }; ctx.store.put('classes', c);
    ctx.store.all('students').filter(s => s.classId === c.id).forEach(s => notify(ctx, s.id, 'student', 'Your Semester ' + c.sem + ' exams are open from ' + a.from + ' to ' + a.to + '.'));
    return { toast: 'Semester ' + c.sem + ' exams for ' + c.id + ' open from ' + a.from + ' to ' + a.to };
  } },
  examClose: { roles: ['teacher', 'locadmin'], run(ctx, a) {
    const c = classIn(ctx, str(a.cid)); need(c.exam && c.exam.sem === c.sem && !c.exam.closed, 'No exam window is open for ' + c.id + '.');
    c.exam.closed = true; c.exam.closedBy = ctx.user.name; c.exam.closedOn = ctx.today; ctx.store.put('classes', c);
    return { toast: 'Exam window for ' + c.id + ' closed' };
  } },

  /* academic content: the content creator adds and edits; every change waits for the approver */
  /* approves or sends back several questions at once, such as a whole chapter paper */
  reviewMany: { roles: CHECKER, run(ctx, a) {
    const ids = (Array.isArray(a.ids) ? a.ids : []).slice(0, 300).map(x => str(x, 64)); need(ids.length, 'Choose the questions.');
    const ok = a.decision === 'approve'; const note = str(a.note, 500); if (!ok) need(note, 'Say what needs changing, so the creator can fix it.');
    let n = 0;
    ids.forEach(id => {
      const q = ctx.store.find('questions', id); if (!q || q.status !== 'pending') return;
      need(q.submittedById !== ctx.user.id, 'Someone else must approve what you submitted.');
      Object.assign(q, { status: ok ? 'approved' : 'rejected', reviewedBy: ctx.user.name, reviewedOn: ctx.today, reviewNote: ok ? '' : note }); ctx.store.put('questions', q); n++;
    });
    need(n, 'None of these questions is waiting for approval.');
    const old = ok ? ids.reduce((t, id) => { const q = ctx.store.find('questions', id); return t + (q && q.status === 'approved' ? supersede(ctx, q) : 0); }, 0) : 0;
    return { toast: n + (n === 1 ? ' question ' : ' questions ') + (ok ? 'approved.' : 'sent back with your note.') + (old ? ' ' + old + ' questions from the earlier drafting of these chapters were retired.' : '') };
  } },
  /* The content creator writes a syllabus chart's weekly topics (Belief, Islamic Laws, Ethics); it goes live
     once approved. key is course-semester, e.g. INT-1. */
  chartSave: { roles: MAKER, run(ctx, a) {
    const key = str(a.key, 20); const [co, semS] = key.split('-'); const k = course(ctx, co); need(int(semS, 1, k.sems, 0), 'Unknown semester.');
    const col = v => Array.from({ length: k.weeks }, (_, i) => str(Array.isArray(v) ? v[i] : '', 300));
    const draft = submitted(ctx, { b: col(a.b), l: col(a.l), e: col(a.e) });
    need([draft.b, draft.l, draft.e].some(c => c.some(Boolean)), 'Enter at least one week\'s topic.');
    ctx.store.set('chartDrafts', { ...ctx.store.get('chartDrafts', {}), [k.code + '-' + int(semS, 1, k.sems, 1)]: draft });
    return { toast: 'Syllabus chart sent for approval. Teachers see it once it is approved.' };
  } },
  review: { roles: CHECKER, run(ctx, a) {
    if (a.kind === 'chart') return reviewChart(ctx, a);
    const coll = REVIEW[str(a.kind)]; need(coll, 'Unknown item.'); const x = ctx.store.find(coll, str(a.id)); need(x, 'Item not found.', 404);
    if (coll === 'materials' && x.draft && x.draft.status === 'pending') return reviewUpdate(ctx, x, a);
    need(x.status === 'pending', 'This item is not waiting for approval.');
    need(x.submittedById !== ctx.user.id, 'Someone else must approve what you submitted.');
    const ok = a.decision === 'approve'; const note = str(a.note, 500);
    if (!ok) need(note, 'Say what needs changing, so the creator can fix it.');
    Object.assign(x, { status: ok ? 'approved' : 'rejected', reviewedBy: ctx.user.name, reviewedOn: ctx.today, reviewNote: ok ? '' : note });
    ctx.store.put(coll, x);
    if (ok && coll === 'questions') supersede(ctx, x);
    if (ok && coll === 'promotions') return { toast: applyTeachingLevel(ctx, x) };
    if (ok && coll === 'materials' && x.chart && x.type === 'Syllabus') return { toast: 'Approved. ' + chartFromSyllabus(ctx, x) };
    if (ok && coll === 'materials' && x.type === 'Teacher guide') { const d = guideQuiz(ctx, x); return { toast: 'Approved.' + (d ? ' The teacher readiness quiz for this subject is being drafted again to include this guide.' : ''), draft: d }; }
    if (ok && coll === 'trainings') {
      const inv = ctx.store.all('teachers').filter(t => invited(ctx.store, t.id, x));
      inv.forEach(t => notify(ctx, t.id, 'teacher', (x.announced ? 'Training updated: ' : 'Training invitation: ') + x.title + ' on ' + x.date));
      x.announced = true; ctx.store.put(coll, x);
      return { toast: 'Approved. ' + inv.length + ' teachers invited by email and WhatsApp.' };
    }
    return { toast: ok ? 'Approved. It is now in use.' : 'Sent back to ' + (x.submittedBy || 'the creator') + ' with your note.' };
  } },
  /* the content creator nominates a student to teach a level; the approver approves it under Approvals */
  levelNominate: { roles: MAKER, run(ctx, a) {
    const s = ctx.store.find('students', str(a.sid)); need(s, 'Choose a student.', 404);
    const k = course(ctx, str(a.level));
    const t = ctx.store.all('teachers').find(x => x.sid === s.id && x.level);
    if (t) need(rank(ctx, k.code) > rank(ctx, t.level), s.name + ' already teaches up to ' + course(ctx, t.level).name + '. Choose a higher level.');
    need(!ctx.store.all('promotions').some(p => p.sid === s.id && p.status === 'pending'), s.name + ' already has a nomination waiting for approval.');
    /* eligible by being a student of a higher level; or, for the level they are at, by having passed all of it;
       or as an exception, with a reason for the approver */
    const exception = a.exception === true; const reason = str(a.reason, 500);
    if (exception) need(reason, 'Give the reason for this exception, for the approver.');
    else {
      const c = s.classId && ctx.store.find('classes', s.classId);
      if (!c || rank(ctx, c.course) <= rank(ctx, k.code)) {
        const missing = notYetPassed(ctx.store, s.id, k.code);
        need(!missing.length, s.name + ' cannot teach ' + k.name + ' yet: they must be a student of a higher level, or have passed every semester of ' + k.name + ' (not yet passed Semester ' + missing.join(', ') + ').');
      }
    }
    ctx.store.put('promotions', submitted(ctx, { id: uid('p'), sid: s.id, name: s.name, level: k.code, from: t ? t.level : null, ...(exception ? { exception: true, reason } : {}) }));
    return { toast: (exception ? 'Exception requested for ' + s.name + ' to teach ' : s.name + ' nominated to teach ') + k.name + '. It takes effect once approved.' };
  } },
  chartLoad: { roles: MAKER, run(ctx, a) {
    const key = str(a.key, 20); const [co, sem] = key.split('-'); const k = course(ctx, co); need(int(sem, 1, k.sems, 0), 'Unknown semester.');
    ctx.store.set('charts', { ...ctx.store.get('charts', {}), [key]: true });
    return { toast: 'Chart loaded' };
  } },
  qAdd: { roles: MAKER, run(ctx, a) {
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
    if (ex) { Object.assign(ex, q); submitted(ctx, ex); ctx.store.put('questions', ex); return { toast: 'Question updated and sent for approval. It is not used in exams until approved.' }; }
    const k = course(ctx, str(a.course)); const sub = ctx.store.find('subjects', str(a.sub)); need(sub && sub.exam, 'Choose an examined subject.');
    ctx.store.put('questions', submitted(ctx, { id: uid('q'), course: k.code, sem: int(a.sem, 1, k.sems, 1), sub: sub.key, type: t, options: [], correct: 0, retired: false, ...q }));
    return { toast: 'Question saved and sent for approval. Add the next one.' };
  } },
  qRetire: { roles: MAKER, run(ctx, a) {
    const q = ctx.store.find('questions', str(a.id)); need(q, 'Question not found.', 404); q.retired = true; ctx.store.put('questions', q);
    return { toast: 'Question retired. It stays on past exams but is not used in new ones.' };
  } },
  importSave: { roles: MAKER, run(ctx, a) {
    const k = course(ctx, str(a.course)); const sem = int(a.sem, 1, k.sems, 1); const sub = ctx.store.find('subjects', str(a.sub)); need(sub && sub.exam, 'Choose an examined subject.');
    const items = (Array.isArray(a.items) ? a.items : []).filter(x => x && x.include);
    need(items.length, 'Tick at least one question to save.');
    /* questions read from an uploaded paper come with the item; the sample paper is looked up by position */
    const clean = q => q && typeof q === 'object' ? { type: q.type === 'combo' ? 'combo' : 'single', text: str(q.text, 2000), options: (Array.isArray(q.options) ? q.options : []).map(o => str(o, 500)), stmts: Array.isArray(q.stmts) ? q.stmts.map(o => str(o, 500)).filter(Boolean) : undefined } : null;
    const picked = items.map(x => ({ q: x.q ? clean(x.q) : SAMPLE_PAPER.questions[int(x.idx, 0, 9999, -1)], correct: x.correct }));
    need(picked.every(p => !p.q || p.q.type === 'bank' || (p.q.text && p.q.options.length === 4 && p.q.options.every(Boolean))), 'Every ticked question needs its text and four options.');
    need(picked.every(p => p.q && p.q.type !== 'bank'), 'Word-bank questions cannot be imported yet.');
    need(picked.every(p => p.correct !== '' && p.correct != null), 'A ticked question has no answer yet. Choose its answer or untick it.');
    picked.forEach(p => ctx.store.put('questions', submitted(ctx, { id: uid('q'), course: k.code, sem, sub: sub.key, type: p.q.type, text: p.q.text, options: p.q.options, stmts: p.q.stmts, correct: int(p.correct, 0, 3, 0), retired: false })));
    return { toast: picked.length + ' questions imported and sent for approval' };
  } },
  /* A Standard Syllabus Chart from an Excel file: the subjects in the file replace those subjects' topics;
     the others keep what they have. Where a subject already has a chart (approved or awaiting approval),
     the creator must confirm they want a new one. It goes live once the approver approves it. */
  chartImport: { roles: MAKER, run(ctx, a) {
    const key = str(a.key, 20); const [co, semS] = key.split('-'); const k = course(ctx, co); const sem = int(semS, 1, k.sems, 0); need(sem, 'Unknown semester.');
    const col = v => Array.from({ length: k.weeks }, (_, i) => str(Array.isArray(v) ? v[i] : '', 300));
    const incoming = ['b', 'l', 'e'].filter(s => Array.isArray(a[s]) && a[s].some(x => str(x)));
    need(incoming.length, 'The file has no topics to import.');
    const live = ctx.store.get('chartData', {})[k.code + '-' + sem]; const drafts = { ...ctx.store.get('chartDrafts', {}) }; const d = drafts[k.code + '-' + sem];
    const has = (x, s) => x && Array.isArray(x[s]) && x[s].some(Boolean);
    const clash = incoming.filter(s => has(live, s) || (d && d.status === 'pending' && has(d, s)));
    need(!clash.length || a.confirmNew === true, 'A syllabus chart already exists for ' + clash.map(s => subName(ctx, s)).join(', ') + ' in ' + k.name + ' Semester ' + sem + '. Confirm you want to create a new one.', 409);
    /* start from the draft awaiting approval if there is one (so earlier edits are kept), else the live chart */
    const base = d && d.status === 'pending' ? d : live || {};
    const next = { b: col(base.b), l: col(base.l), e: col(base.e) };
    incoming.forEach(s => { next[s] = col(a[s]); });
    drafts[k.code + '-' + sem] = submitted(ctx, { ...next, source: { kind: 'excel', file: str(a.file, 200), subjects: incoming } });
    ctx.store.set('chartDrafts', drafts);
    return { toast: (clash.length ? 'New syllabus chart' : 'Syllabus chart') + ' for ' + incoming.map(s => subName(ctx, s)).join(', ') + ' in ' + k.name + ' Semester ' + sem + ' sent for approval. Teachers see it once it is approved.' };
  } },
  /* Multiple-choice questions from an Excel file: each row checked again here; questions already in the bank skipped. */
  qImportRows: { roles: MAKER, run(ctx, a) {
    const items = (Array.isArray(a.items) ? a.items : []).slice(0, 2000); need(items.length, 'No questions to import.');
    const key = q => [q.course, q.sem, q.sub, String(q.text).toLowerCase().replace(/\s+/g, ' ').trim()].join('|');
    const seen = new Set(ctx.store.all('questions').filter(q => !q.retired && q.text).map(key));
    let added = 0, skipped = 0;
    items.forEach((x, i) => {
      const k = ctx.store.find('courses', str(x && x.course)); need(k, 'Row ' + (i + 1) + ': unknown course.');
      const sem = int(x.sem, 1, k.sems, 0); need(sem, 'Row ' + (i + 1) + ': unknown semester.');
      const sub = ctx.store.find('subjects', str(x.sub)); need(sub && sub.exam, 'Row ' + (i + 1) + ': choose an examined subject.');
      const q = { course: k.code, sem, sub: sub.key, text: str(x.text, 2000), options: (Array.isArray(x.options) ? x.options : []).slice(0, 4).map(o => str(o, 500)), correct: int(x.correct, 0, 3, -1) };
      need(q.text && q.options.length === 4 && q.options.every(Boolean) && q.correct >= 0, 'Row ' + (i + 1) + ' needs its question, four options and the correct answer.');
      if (seen.has(key(q))) { skipped++; return; }
      seen.add(key(q));
      const chapter = x.chapter ? int(x.chapter, 1, 60, 0) : 0;
      ctx.store.put('questions', submitted(ctx, { id: uid('q'), ...q, type: 'single', retired: false, ...(chapter ? { chapter } : {}), source: 'excel' }));
      added++;
    });
    need(added, skipped ? 'Every question in the file is already in the bank.' : 'No questions to import.');
    return { toast: added + (added === 1 ? ' question' : ' questions') + ' imported and sent for approval.' + (skipped ? ' ' + skipped + ' already in the bank ' + (skipped === 1 ? 'was' : 'were') + ' skipped.' : '') };
  } },
  tradAdd: { roles: MAKER, run(ctx, a) {
    const text = str(a.text, 4000), source = str(a.source, 500); need(text && source, 'Enter the text and its source.');
    ctx.store.put('traditions', submitted(ctx, { id: uid('h'), text, source })); return { toast: 'Added and sent for approval' };
  } },
  matAdd: { roles: MAKER, run(ctx, a) {
    const title = str(a.title, 300); need(title, 'Enter a title.');
    const co = a.course === 'ALL' ? 'ALL' : course(ctx, str(a.course)).code;
    let src = str(a.link, 1000), fileId = null;
    if (a.fileId) { const f = ctx.store.find('files', str(a.fileId)); need(f, 'The uploaded file was not found.'); fileId = f.id; src = f.name; }
    const m = submitted(ctx, { id: uid('m'), title, type: MTYPES.includes(a.type) ? a.type : 'Other', course: co, sem: co === 'ALL' ? 0 : int(a.sem, 0, 10, 0), sub: str(a.sub, 10) || 'all', week: a.week ? int(a.week, 1, 60, null) : null, pages: a.pages ? int(a.pages, 1, 100000, null) : null, share: a.share === true || a.share === 'true', src: src || 'No file attached', fileId, date: ctx.today });
    syllabusPlan(ctx, m); if (m.chart) m.qgen = { status: 'queued' }; ctx.store.put('materials', m);
    return { toast: 'Added and sent for approval. Teachers see it once it is approved.' + (m.chart ? ' ' + m.chart.chapters + ' chapters were read for the syllabus chart; they go into the chart when the syllabus is approved. Questions are being drafted for each chapter.' : m.chartNote ? ' ' + m.chartNote : ''), draft: m.chart ? m.id : null };
  } },
  trainAdd: { roles: MAKER, run(ctx, a) {
    const title = str(a.title, 300); need(title, 'Enter a title.'); need(isIsoDate(a.date), 'Enter a date.');
    const tm = /^(\d{1,2}):(\d{2})$/.exec(str(a.time) || '11:00'); need(tm, 'Enter a time.');
    const co = a.course === 'ALL' ? 'ALL' : course(ctx, str(a.course)).code;
    const tr = { id: uid('tr'), title, kind: a.kind === 'Refresher' ? 'Refresher' : 'Programme', course: co, sem: int(a.sem, 0, 10, 0), date: a.date, time: int(tm[1], 0, 23, 11) * 60 + int(tm[2], 0, 59, 0), mode: str(a.mode, 500) || 'Online on Google Meet', facilitator: str(a.facilitator, 100) || 'Academic team', req: !!a.req, rsvp: {}, attended: null };
    ctx.store.put('trainings', submitted(ctx, tr));
    return { toast: 'Scheduled and sent for approval. Teachers are invited once it is approved.' };
  } },
  setTargets: { roles: CHECKER, run(ctx, a) {
    ctx.store.set('targets', { ayat: int(a.ayat, 0, 6236, 0), pages: int(a.pages, 0, 2000, 0) });
    return { toast: 'Weekly reading targets saved' };
  } },
  setAccess: { roles: CHECKER, run(ctx, a) {
    const t = ctx.store.find('teachers', str(a.tid)); need(t, 'Teacher not found.', 404); need(['own', 'course', 'all'].includes(a.access), 'Unknown access level.');
    t.access = a.access; ctx.store.put('teachers', t); return { toast: 'Access saved for ' + teacherTitle(t) };
  } },

  /* super admin */
  locAdd: { roles: ['super'], run(ctx, a) {
    const code = str(a.code, 3).toUpperCase(); need(/^[A-Z]{3}$/.test(code), 'The short code must be three letters.');
    need(!ctx.store.find('locations', code), 'The short code ' + code + ' is already used. Choose another.');
    const name = str(a.name, 100); need(name, 'Enter the name of the location.');
    const who = locPeople(ctx, a); need(who.primary, 'Choose the primary responsible from the student list.');
    const callDay = DOWL.includes(a.callDay) ? a.callDay : 'Monday';
    let next = ctx.today; while (DOWL[pd(next).getDay()] !== callDay) next = addDays(next, 1);
    ctx.store.put('locations', { id: code, code, name, ...who, callDay, callTime: str(a.callTime, 20) || '8:00 PM', meet: meetLink(a.meet), nextCall: next });
    return { toast: name + ' added with code ' + code + '.' + syncLocRoles(ctx, code, {}, who) + clashNote(ctx, ctx.store.find('locations', code)) };
  } },
  /* Only the super admin changes a class's start date after it is created. Logged sessions stay; the rest
     are listed again from the new date. */
  classStart: { roles: ['super'], run(ctx, a) {
    const c = ctx.store.find('classes', str(a.cid)); need(c, 'That class does not exist.', 404);
    need(!ended(c), 'This class has ' + (c.status === 'closed' ? 'been closed.' : 'completed its course.'));
    need(isIsoDate(a.start), 'Choose the start date.');
    c.startOn = a.start; ctx.store.put('classes', c);
    restartSessions(ctx.store, c, ctx.today);
    return { toast: c.id + ' now starts on ' + a.start };
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
  /* A teacher is always a student first. A teacher from before this rule has no person record: the super admin
     links them to their student record. They keep their level; their name and group now follow the person. */
  teacherLink: { roles: ['super'], run(ctx, a) {
    const t = ctx.store.find('teachers', str(a.tid)); need(t, 'Teacher not found.', 404); need(!t.sid, t.name + ' is already linked to a student.');
    const s = ctx.store.find('students', str(a.sid)); need(s && !s.left, 'Choose a student from the list.');
    need(s.g === t.g, 'The student must be in the same group as the teacher.');
    need(!ctx.store.all('teachers').some(x => x.sid === s.id), s.name + ' is already a teacher.');
    const from = t.name; Object.assign(t, { sid: s.id, name: s.name, g: s.g }); ctx.store.put('teachers', t);
    /* the teacher's own login becomes this person's, unless they already have one */
    const login = ctx.store.all('users').find(u => u.teacherId === t.id);
    const has = ctx.store.all('users').find(u => u.studentId === s.id);
    if (login && !has) { login.studentId = s.id; login.name = s.name; ctx.store.put('users', login); }
    return { toast: from + ' is now linked to ' + s.name + '.' + (login && has ? ' They have two logins (' + login.username + ' and ' + has.username + '); disable the one not needed.' : '') };
  } },
  /* Every login belongs to a person (a student record). Roles are assigned here; teacher comes from promotion
     and student from the person, so neither is assigned. A login for an older teacher without a person record
     can still be made with teacherId. */
  userAdd: { roles: ['super'], run(ctx, a) {
    const username = str(a.username, 40).toLowerCase(); need(/^[a-z0-9._-]{3,40}$/.test(username), 'Usernames use 3 to 40 letters, numbers, dots, dashes or underscores.');
    need(!ctx.store.all('users').some(u => u.username === username), 'That username is taken.');
    const pw = String(a.password || ''); need(pw.length >= 8, 'The password needs at least 8 characters.');
    const linked = (key, id) => ctx.store.all('users').some(x => x[key] === id);
    const roles = (Array.isArray(a.roles) ? a.roles : []).map(r => str(r, 20)).filter(r => ASSIGNABLE.includes(r));
    const u = { id: uid('u-'), username, roles, password: hashPassword(pw) };
    if (a.teacherId) {
      const t = ctx.store.find('teachers', str(a.teacherId)); need(t && !t.sid, 'Teacher not found.', 404);
      need(!linked('teacherId', t.id), t.name + ' already has a login.'); u.teacherId = t.id; u.name = t.name;
    } else {
      const s = ctx.store.find('students', str(a.studentId)); need(s, 'Choose the person this login is for. Everyone is registered as a student first.');
      need(!linked('studentId', s.id), s.name + ' already has a login. Add roles to it instead.'); u.studentId = s.id; u.name = s.name;
    }
    /* someone already named at a location gets its role with their login */
    const posts = u.studentId ? postsOf(ctx, u.studentId) : [];
    if (posts.length) {
      need(!(roles.some(r => LOC_ROLES.includes(r)) && str(a.loc) && str(a.loc) !== posts[0].code), u.name + ' is named at ' + posts[0].name + ', so the location role must be there.');
      posts.forEach(p => { if (!roles.includes(p.role)) roles.push(p.role); }); u.loc = posts[0].code;
    } else if (roles.includes('locadmin') || roles.includes('coord')) { need(inUse(ctx, str(a.loc)), 'Choose the location for the location role.'); u.loc = str(a.loc); }
    ctx.store.put('users', u); return { toast: 'Login created for ' + u.name + (posts.length ? ', with the role at ' + posts[0].name : '') };
  } },
  userReset: { roles: ['super'], run(ctx, a) {
    const u = ctx.store.find('users', str(a.id)); need(u, 'User not found.', 404);
    const pw = String(a.password || ''); need(pw.length >= 8, 'The password needs at least 8 characters.');
    u.password = hashPassword(pw); u.demo = false; ctx.store.put('users', u);
    ctx.store.all('authSessions').filter(s => s.userId === u.id).forEach(s => ctx.store.del('authSessions', s.id));
    return { toast: 'Password reset for ' + u.name };
  } },
  userToggle: { roles: ['super'], run(ctx, a) {
    const u = ctx.store.find('users', str(a.id)); need(u, 'User not found.', 404); need(u.id !== ctx.user.id, 'You cannot disable your own account.');
    u.disabled = !u.disabled;
    if (u.disabled) Object.assign(u, { disabledOn: ctx.today, disabledBy: ctx.user.name }); else { delete u.disabledOn; delete u.disabledBy; }
    ctx.store.put('users', u);
    return { toast: u.name + (u.disabled ? ' can no longer sign in' : ' can sign in again') };
  } },

  /* everyone */
  /* ---------- editing: whoever can create a record can edit it ---------- */
  /* A location no longer in use is disabled, with a reason; its record and past marks stay. Its running classes and
     waiting students must go somewhere: moved to another location (a class keeps its number), or the classes closed
     with their students waiting at a chosen location or recorded as having left. Its staff lose their location role;
     the people named there get it back if it is enabled. */
  locDisable: { roles: ['super'], run(ctx, a) {
    const l = ctx.store.find('locations', str(a.id)); need(l, 'Location not found.', 404); need(!l.disabled, l.name + ' is already disabled.');
    const reason = str(a.reason, 500); need(reason, 'Give the reason for disabling this location.');
    const classes = ctx.store.all('classes').filter(c => c.loc === l.code && !ended(c)); const regs = ctx.store.all('regs').filter(r => r.loc === l.code);
    let what = '';
    if (classes.length || regs.length) {
      need(['move', 'close'].includes(a.mode), 'Choose what happens to the classes and students of this location.');
      const elsewhere = code => code !== l.code && inUse(ctx, code);
      if (a.mode === 'move') {
        const to = str(a.target, 10); need(elsewhere(to), 'Choose the location to move them to.'); const dest = ctx.store.find('locations', to);
        classes.forEach(c => {
          c.loc = to; ctx.store.put('classes', c);
          const note = c.id + ' now belongs to ' + dest.name + '.';
          if (c.teacherId) notify(ctx, c.teacherId, 'teacher', note);
          ctx.store.all('students').filter(s => s.classId === c.id).forEach(s => notify(ctx, s.id, 'student', note));
        });
        regs.forEach(r => { r.loc = to; ctx.store.put('regs', r); });
        what = [classes.length ? classes.length + (classes.length === 1 ? ' class' : ' classes') : '', regs.length ? regs.length + ' waiting' : ''].filter(Boolean).join(' and ') + ' moved to ' + dest.name + '.';
      } else {
        const to = str(a.dest, 10); need(to === 'left' || elsewhere(to), 'Choose where the students go.');
        const left = (s, from) => { s.classId = null; s.left = { date: ctx.today, from, reason, by: ctx.user.name }; ctx.store.put('students', s); notify(ctx, s.id, 'student', from + ' has closed: ' + reason); };
        let count = 0;
        classes.forEach(c => {
          const studs = ctx.store.all('students').filter(s => s.classId === c.id); count += studs.length;
          studs.forEach(s => to === 'left' ? left(s, c.id) : toRegistrations(ctx, s, c, to));
          finishClose(ctx, c, 'Location disabled: ' + reason, 0, to === 'left' ? 0 : studs.length);
        });
        regs.forEach(r => {
          if (to !== 'left') { r.loc = to; ctx.store.put('regs', r); return; }
          const s = r.sid && ctx.store.find('students', r.sid); if (s) left(s, r.from || l.code);
          ctx.store.del('regs', r.id);
        });
        what = (classes.length ? classes.length + (classes.length === 1 ? ' class' : ' classes') + ' closed. ' : '') + (count + regs.length) + (count + regs.length === 1 ? ' student ' : ' students ') + (to === 'left' ? 'recorded as having left.' : 'waiting for a class at ' + ctx.store.find('locations', to).name + '.');
      }
    }
    Object.assign(l, { disabled: true, disabledOn: ctx.today, disabledBy: ctx.user.name, disabledReason: reason }); ctx.store.put('locations', l);
    const staff = ctx.store.all('users').filter(u => u.loc === l.code && assignedRoles(u).some(r => LOC_ROLES.includes(r)));
    staff.forEach(u => setRoles(ctx, u, assignedRoles(u).filter(r => !LOC_ROLES.includes(r))));
    const open = ctx.store.all('actions').filter(x => x.loc === l.code && !x.done).length;
    return { toast: l.name + ' disabled.' + (what ? ' ' + what : '') + (staff.length ? ' Location role removed from ' + staff.map(u => u.name).join(', ') + '.' : '') + (open ? ' ' + open + ' open action ' + (open === 1 ? 'item stays' : 'items stay') + ' with their owners.' : '') };
  } },
  locEnable: { roles: ['super'], run(ctx, a) {
    const l = ctx.store.find('locations', str(a.id)); need(l, 'Location not found.', 404); need(l.disabled, l.name + ' is not disabled.');
    delete l.disabled; delete l.disabledOn; delete l.disabledBy; delete l.disabledReason; ctx.store.put('locations', l);
    return { toast: l.name + ' is in use again.' + syncLocRoles(ctx, l.code, {}, l) };
  } },
  locEdit: { roles: ['super'], run(ctx, a) {
    const l = ctx.store.find('locations', str(a.id)); need(l, 'Location not found.', 404);
    const name = str(a.name, 100); need(name, 'Enter the name of the location.');
    const who = locPeople(ctx, a, l);
    /* the secondary is optional; a location with no primary yet can still be edited, but cannot lose the one it has */
    need(who.primary || !l.primary, 'Choose the primary responsible.');
    const callDay = DOWL.includes(a.callDay) ? a.callDay : l.callDay;
    if (callDay !== l.callDay) { let next = ctx.today; while (DOWL[pd(next).getDay()] !== callDay) next = addDays(next, 1); l.nextCall = next; }
    const before = { ...l };
    Object.assign(l, { name, ...who, callDay, callTime: str(a.callTime, 20) || l.callTime, meet: meetLink(a.meet) });
    /* a disabled location gives no roles; the people named get them when it is enabled */
    ctx.store.put('locations', l); return { toast: name + ' saved.' + (l.disabled ? '' : syncLocRoles(ctx, l.code, before, who)) + clashNote(ctx, l) };
  } },
  courseEdit: { roles: ['super'], run(ctx, a) {
    const k = ctx.store.find('courses', str(a.id)); need(k, 'Course type not found.', 404);
    const name = str(a.name, 100); need(name, 'Enter a name.');
    const sems = int(a.sems, 1, 10, k.sems); const used = Math.max(0, ...ctx.store.all('classes').filter(c => c.course === k.code).map(c => c.sem));
    need(sems >= used, 'A class is already in Semester ' + used + ', so ' + name + ' needs at least ' + used + ' semesters.');
    Object.assign(k, { name, sems, weeks: int(a.weeks, 1, 60, k.weeks) }); ctx.store.put('courses', k); return { toast: name + ' saved' };
  } },
  subjectEdit: { roles: ['super'], run(ctx, a) {
    const s = ctx.store.find('subjects', str(a.id)); need(s, 'Subject not found.', 404);
    const name = str(a.name, 100); need(name, 'Enter a name.');
    Object.assign(s, { name, min: int(a.min, 1, 60, s.min) }); ctx.store.put('subjects', s); return { toast: name + ' saved' };
  } },
  teacherEdit: { roles: ['super'], run(ctx, a) {
    const t = ctx.store.find('teachers', str(a.id)); need(t, 'Teacher not found.', 404);
    need(!t.sid, t.name + ' was promoted from a person record. Edit the person instead; their level comes from academic promotion.');
    const name = str(a.name, 100); need(name, 'Enter a name.');
    const g = a.g === 'M' ? 'M' : 'F';
    if (g !== t.g) need(!ctx.store.all('classes').some(c => c.teacherId === t.id && !ended(c)), teacherTitle(t) + ' teaches running classes, so the group cannot change.');
    const level = str(a.level) ? levelOf(ctx, a.level) : t.level;
    const short = ctx.store.all('classes').find(c => c.teacherId === t.id && !ended(c) && level && rank(ctx, c.course) > rank(ctx, level));
    need(!short, teacherTitle(t) + ' teaches ' + (short && short.id) + ', which is above that level.');
    Object.assign(t, { name, g, level }); ctx.store.put('teachers', t);
    ctx.store.all('users').filter(u => u.teacherId === t.id).forEach(u => { u.name = name; ctx.store.put('users', u); });
    return { toast: name + ' saved' };
  } },
  userEdit: { roles: ['super'], run(ctx, a) {
    const u = ctx.store.find('users', str(a.id)); need(u, 'User not found.', 404);
    const username = str(a.username, 40).toLowerCase(); need(/^[a-z0-9._-]{3,40}$/.test(username), 'Usernames use 3 to 40 letters, numbers, dots, dashes or underscores.');
    need(!ctx.store.all('users').some(x => x.username === username && x.id !== u.id), 'That username is taken.');
    u.username = username;
    if (!u.studentId && !u.teacherId) u.name = str(a.name, 100) || username; /* otherwise the name follows the person */
    if (Array.isArray(a.roles)) {
      const roles = a.roles.map(r => str(r, 20)).filter(r => ASSIGNABLE.includes(r));
      need(u.id !== ctx.account.id || roles.includes('super'), 'You cannot remove your own super admin role.');
      u.roles = roles; delete u.role;
    }
    const roles = rolesOf(ctx.store, u);
    if (roles.includes('locadmin') || roles.includes('coord')) { need(inUse(ctx, str(a.loc)), 'Choose the location for the location role.'); u.loc = str(a.loc); }
    /* the role goes with the post, so the list of who is responsible and who has access stay the same */
    for (const p of u.studentId ? postsOf(ctx, u.studentId) : []) need(roles.includes(p.role) && u.loc === p.code, u.name + ' is the ' + p.key + (p.key === 'coordinator' ? '' : ' responsible') + ' at ' + p.name + '. Change that under Locations first.');
    ctx.store.put('users', u); return { toast: u.name + ' saved' };
  } },
  /* Day, time and Meet link can always change; the semester only before a session of it is logged; the group
     only while the class has no students; the start date only by the super admin. A change of day, semester
     or start date lists the not-yet-logged sessions again; logged sessions are never touched. */
  classEdit: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const c = ctx.user.role === 'super' ? ctx.store.find('classes', str(a.id)) : classIn(ctx, str(a.id)); need(c, 'That class does not exist.', 404);
    need(!ended(c), 'This class has ' + (c.status === 'closed' ? 'been closed.' : 'completed its course.'));
    const k = course(ctx, c.course);
    const tm = /^(\d{1,2}):(\d{2})$/.exec(str(a.time)); need(tm, 'Enter the time as hours and minutes.');
    const cur = ctx.store.all('sessions').filter(x => x.classId === c.id && inSem(x, c)); const logged = cur.some(x => x.logged);
    const day = int(a.day, 0, 6, c.day), sem = int(a.sem, 1, k.sems, c.sem), g = a.g === 'M' ? 'M' : a.g === 'F' ? 'F' : c.g;
    /* classes made before start dates were recorded count from their first session */
    const was = c.startOn || (cur.slice().sort((x, y) => x.date < y.date ? -1 : 1)[0] || {}).date;
    const start = ctx.user.role === 'super' && isIsoDate(a.start) ? a.start : was;
    if (sem !== c.sem) need(!logged, 'A session of Semester ' + c.sem + ' is already logged, so the semester cannot change.');
    if (g !== c.g) {
      need(!ctx.store.all('students').some(s => s.classId === c.id), 'The class has students, so the group cannot change.');
      need(!c.teacherId || teacherOf(ctx, c).g === g, 'The assigned teacher teaches ' + (g === 'F' ? 'brothers' : 'sisters') + '. Assign another teacher first.');
    }
    const moved = start !== was; const relist = !moved && (day !== c.day || sem !== c.sem);
    if (relist || moved) cur.filter(x => !x.logged).forEach(x => ctx.store.del('sessions', x.id));
    Object.assign(c, { day, sem, g, startOn: start, time: int(tm[1], 0, 23, 20) * 60 + int(tm[2], 0, 59, 0), meet: meetLink(a.meet) });
    ctx.store.put('classes', c);
    if (moved) restartSessions(ctx.store, c, ctx.today);
    else if (relist) { renumber(ctx.store, c.id); ensureSessions(ctx.store, ctx.today); }
    return { toast: c.id + ' saved' };
  } },
  regEdit: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const r = ctx.store.find('regs', str(a.id)); need(r && (ctx.user.role === 'super' || r.loc === ctx.user.loc), 'Registration not found.', 404);
    /* a full registration stays full; older records and returning students can be completed bit by bit */
    const p = person(ctx, a, !!r.first && !r.sid); notDuplicate(ctx, p, { rid: r.id, sid: r.sid });
    Object.assign(r, p, { g: r.sid ? r.g : a.g === 'M' ? 'M' : 'F', course: course(ctx, str(a.course)).code });
    if (r.sid) { const s = ctx.store.find('students', r.sid); if (s) { Object.assign(s, p); ctx.store.put('students', s); } }
    ctx.store.put('regs', r); return { toast: p.name + ' saved' };
  } },
  /* location staff edit the students of their classes; the super admin edits any person */
  studentEdit: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const s = ctx.store.find('students', str(a.id));
    if (ctx.user.role === 'super') need(s, 'Person not found.', 404);
    else { need(s && s.classId, 'Student not found.', 404); classIn(ctx, s.classId); }
    const p = person(ctx, a, false); const name = p.name; notDuplicate(ctx, p, { sid: s.id });
    Object.assign(s, p); ctx.store.put('students', s);
    ctx.store.all('locations').forEach(l => {
      let on = false; for (const k of ['primary', 'secondary', 'coordinator']) if (l[k + 'Sid'] === s.id) { l[k] = name; on = true; }
      for (const p of l.participants || []) if (p.sid === s.id) { p.name = name; on = true; }
      if (on) ctx.store.put('locations', l);
    });
    ctx.store.all('actions').filter(x => x.ownerSid === s.id).forEach(x => { x.owner = name; ctx.store.put('actions', x); });
    ctx.store.all('users').filter(u => u.studentId === s.id).forEach(u => { u.name = name; ctx.store.put('users', u); });
    ctx.store.all('teachers').filter(t => t.sid === s.id).forEach(t => { t.name = name; ctx.store.put('teachers', t); });
    return { toast: name + ' saved' };
  } },
  actionEdit: { roles: ['locadmin', 'coord', 'super'], run(ctx, a) {
    const x = ctx.store.find('actions', str(a.id)); need(x && (ctx.user.role === 'super' || x.loc === ctx.user.loc), 'Action item not found.', 404);
    const text = str(a.text, 500); need(text, 'Say what needs doing.');
    const owner = str(a.owner, 100) || x.owner;
    Object.assign(x, { text, owner, ownerSid: ownerSidFor(ctx.store.find('locations', x.loc), owner), due: isIsoDate(a.due) ? a.due : x.due }); ctx.store.put('actions', x);
    return { toast: 'Action item saved' };
  } },
  tradEdit: { roles: MAKER, run(ctx, a) {
    const t = ctx.store.find('traditions', str(a.id)); need(t, 'Tradition not found.', 404);
    const text = str(a.text, 4000), source = str(a.source, 500); need(text && source, 'Enter the text and its source.');
    Object.assign(t, { text, source }); submitted(ctx, t); ctx.store.put('traditions', t); return { toast: 'Saved and sent for approval' };
  } },
  /* Edits a material, optionally replacing its file. Shares point at the material, so classes it is shared
     with see the new version on their next read.
     - The creator's change to an approved material waits as an update (m.draft); the approved version stays
       visible until the approver approves the update.
     - A material never approved yet is simply changed and waits for approval as before.
     - The approver's (or super admin's) edit takes effect at once. */
  matEdit: { roles: [...MAKER, ...CHECKER], run(ctx, a) {
    const m = ctx.store.find('materials', str(a.id)); need(m, 'Material not found.', 404);
    const title = str(a.title, 300); need(title, 'Enter a title.');
    const co = a.course === 'ALL' ? 'ALL' : course(ctx, str(a.course)).code;
    const next = { title, type: MTYPES.includes(a.type) ? a.type : m.type, course: co, sem: co === 'ALL' ? 0 : int(a.sem, 0, 10, 0), sub: str(a.sub, 10) || 'all', week: a.week ? int(a.week, 1, 60, null) : null, pages: a.pages ? int(a.pages, 1, 100000, null) : null, share: a.share === true || a.share === 'true', fileId: m.fileId || null, src: m.src };
    if (a.fileId) { const f = ctx.store.find('files', str(a.fileId)); need(f, 'The uploaded file was not found.'); next.fileId = f.id; next.src = f.name; }
    else if (!m.fileId && a.link !== undefined) next.src = str(a.link, 1000) || 'No file attached';
    const replaced = next.fileId !== m.fileId;
    const checker = CHECKER.includes(ctx.user.role);
    if (checker) {
      Object.assign(m, next); delete m.draft; syllabusPlan(ctx, m);
      Object.assign(m, { status: 'approved', editedBy: ctx.user.name, editedOn: ctx.today, reviewNote: '' }); if (replaced) m.date = ctx.today;
      const ask = wantsQuestions(m, replaced); if (ask) m.qgen = { status: 'queued' };
      ctx.store.put('materials', m);
      const chart = m.chart && m.type === 'Syllabus' ? ' ' + chartFromSyllabus(ctx, m) : '';
      const g = replaced ? guideQuiz(ctx, m) : null;
      return { toast: title + ' saved. Teachers and students see it on their next read.' + chart + (ask ? ' Questions are being drafted from the syllabus.' : '') + (g ? ' The teacher readiness quiz is being drafted again to include the new guide.' : ''), draft: ask ? m.id : g };
    }
    if (approved(m)) {
      const d = submitted(ctx, { ...next, date: replaced ? ctx.today : m.date }); syllabusPlan(ctx, d);
      m.draft = d; ctx.store.put('materials', m);
      return { toast: 'Update sent for approval. Everyone keeps seeing the current version until it is approved.' + (d.chart ? ' ' + d.chart.chapters + ' chapters were read for the syllabus chart.' : d.chartNote ? ' ' + d.chartNote : '') + (wantsQuestions({ ...m, chart: d.chart }, replaced) ? ' Questions are drafted once the update is approved.' : '') };
    }
    Object.assign(m, next); if (replaced) m.date = ctx.today; syllabusPlan(ctx, m); const ask = wantsQuestions(m, replaced); if (ask) m.qgen = { status: 'queued' }; submitted(ctx, m); ctx.store.put('materials', m);
    return { toast: title + ' saved and sent for approval. Teachers see it once it is approved.' + (ask ? ' Questions are being drafted from the syllabus.' : ''), draft: ask ? m.id : null };
  } },
  /* drafts the syllabus's questions again (after adding an API key, or to replace drafts nobody approved) */
  qgenRetry: { roles: [...MAKER, ...CHECKER], run(ctx, a) {
    const m = ctx.store.find('materials', str(a.id)); need(m, 'Material not found.', 404);
    need(m.type === 'Syllabus' && m.fileId, 'Questions are drafted from syllabus files only.');
    /* part: 'teacher' (only the teacher quiz) or 'more' (top up each chapter's pool to 24, keeping its questions) */
    const part = ['teacher', 'more'].includes(a.part) ? a.part : undefined;
    m.qgen = { status: 'queued', part }; ctx.store.put('materials', m);
    return { toast: (part === 'teacher' ? 'Drafting the teacher readiness quiz for ' + m.title + '. Drafts nobody approved are replaced; approved questions are kept.'
      : part === 'more' ? 'Drafting more questions for each chapter of ' + m.title + '. The chapter papers keep their questions; the new ones join them once approved.'
      : 'Drafting questions for ' + m.title + '. Drafts nobody approved are replaced; approved questions are kept.'), draft: m.id };
  } },
  trainEdit: { roles: MAKER, run(ctx, a) {
    const tr = ctx.store.find('trainings', str(a.id)); need(tr, 'Training not found.', 404);
    const title = str(a.title, 300); need(title, 'Enter a title.'); need(isIsoDate(a.date), 'Enter a date.');
    const tm = /^(\d{1,2}):(\d{2})$/.exec(str(a.time)); need(tm, 'Enter a time.');
    const co = a.course === 'ALL' ? 'ALL' : course(ctx, str(a.course)).code;
    if (approved(tr)) tr.announced = true; /* invited teachers hear about the change once it is approved again */
    Object.assign(tr, { title, kind: a.kind === 'Refresher' ? 'Refresher' : 'Programme', course: co, sem: int(a.sem, 0, 10, 0), date: a.date, time: int(tm[1], 0, 23, 11) * 60 + int(tm[2], 0, 59, 0), mode: str(a.mode, 500) || tr.mode, facilitator: str(a.facilitator, 100) || tr.facilitator, req: a.req === true || a.req === 'true' });
    submitted(ctx, tr); ctx.store.put('trainings', tr);
    return { toast: title + ' saved and sent for approval. Invited teachers are told once it is approved.' };
  } },
  changePassword: { roles: ['super', 'acmaker', 'academic', 'locadmin', 'coord', 'trainer', 'social', 'support', 'teacher', 'student'], run(ctx, a) {
    need(verifyPassword(a.current, ctx.account.password), 'Your current password is not right.');
    const pw = String(a.next || ''); need(pw.length >= 8, 'The new password needs at least 8 characters.');
    ctx.account.password = hashPassword(pw); ctx.account.demo = false; ctx.store.put('users', ctx.account);
    return { toast: 'Password changed' };
  } }
};

/* A person can hold several roles. An action runs as the role of the screen it came from (args.as) when that
   role may do it, otherwise as the most senior of the person's roles that may. ctx.user is that role's view of
   the person; ctx.account is the stored login. */
export async function runAction(store, user, today, name, args) {
  const def = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;
  need(def, 'Unknown action.', 404);
  const mine = rolesOf(store, user).filter(r => def.roles.includes(r));
  need(mine.length, 'You do not have permission to do that.', 403);
  const role = args && mine.includes(args.as) ? args.as : mine[0];
  const view = Object.assign({}, user, { role, teacherId: teacherIdFor(store, user) });
  return store.tx(() => def.run({ store, user: view, account: user, today }, args || {}) || {});
}
