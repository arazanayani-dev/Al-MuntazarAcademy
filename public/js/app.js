/* App shell: sign-in, navigation, rendering, and the wiring from buttons and forms to the server. */
import { S, ME, TODAY, setSession, clearSession, useRole } from './state.js';
import { addDays, pd, DOWL } from '/shared/dates.js';
import { esc, act, icon } from './ui.js';
import { cls, verseRef, versesBefore, classStudents, semResult, moveTargets, ended, assignable, readKind, myLoc, levelRank } from './logic.js';
import { viewSuperHome, viewLocations, viewAllClasses, viewMasters, viewUsers, viewReports } from './views/admin.js';
import { viewChart, viewBank, viewExams, viewTraditions, viewMaterials, viewTraining, viewReview, viewTeachingLevels } from './views/academic.js';
import { viewLocHome, viewRegistrations, viewClasses, viewStudents, viewCoord, viewCoordHome } from './views/location.js';
import { viewTeacherHome, viewTeacherClasses, viewTeacherMaterials, viewTeacherTraining, viewTeacherProfile } from './views/teacher.js';
import { viewStudentHome, viewStudentExams, viewStudentMaterials, viewStudentProfile } from './views/student.js';
import { viewClass, viewMarks, viewLog, viewExamTake, examCount, viewRead } from './views/shared.js';
import { modalHtml } from './views/modals.js';
import { EDIT } from './views/edit.js';
import { showPdf } from './pdfview.js';
import { trackReading, stopReading } from './readtrack.js';
import { chapterWindow, CHAPTER_DAYS } from '/shared/grading.js';
import { callPeople, callMinutes } from '/shared/callpeople.js';

const TABS = {
  super: [['home', 'Overview'], ['regs', 'Registrations'], ['coord', 'Coordination'], ['locations', 'Locations'], ['classes', 'Classes'], ['masters', 'Master lists', 'Masters'], ['users', 'People and logins', 'People'], ['reports', 'Reports']],
  acmaker: [['teachers', 'Teaching levels', 'Teachers'], ['chart', 'Syllabus chart', 'Chart'], ['bank', 'Question bank', 'Questions'], ['exams', 'Exam papers', 'Papers'], ['materials', 'Materials'], ['training', 'Training'], ['traditions', 'Traditions']],
  academic: [['review', 'Approvals'], ['teachers', 'Teaching levels', 'Teachers'], ['bank', 'Question bank', 'Questions'], ['exams', 'Exam papers', 'Papers'], ['materials', 'Materials'], ['training', 'Training'], ['traditions', 'Traditions'], ['chart', 'Syllabus chart', 'Chart']],
  locadmin: [['home', 'Overview'], ['regs', 'Registrations'], ['classes', 'Classes'], ['students', 'Students'], ['coord', 'Coordination']],
  coord: [['home', 'Overview'], ['regs', 'Registrations'], ['classes', 'Classes'], ['students', 'Students'], ['coord', 'Coordination']],
  teacher: [['home', 'Home'], ['classes', 'Classes'], ['materials', 'Materials'], ['training', 'Training'], ['profile', 'Profile']],
  student: [['home', 'Home'], ['exams', 'Exams'], ['materials', 'Materials'], ['profile', 'Profile']]
};
const VIEWS = {
  'super.home': viewSuperHome, 'super.regs': viewRegistrations, 'super.coord': viewCoord, 'super.locations': viewLocations, 'super.classes': viewAllClasses, 'super.masters': viewMasters, 'super.users': viewUsers, 'super.reports': viewReports,
  'academic.review': viewReview, 'academic.teachers': viewTeachingLevels, 'acmaker.teachers': viewTeachingLevels, 'academic.chart': viewChart, 'academic.bank': viewBank, 'academic.exams': viewExams, 'academic.traditions': viewTraditions, 'academic.materials': viewMaterials, 'academic.training': viewTraining,
  'acmaker.chart': viewChart, 'acmaker.bank': viewBank, 'acmaker.exams': viewExams, 'acmaker.traditions': viewTraditions, 'acmaker.materials': viewMaterials, 'acmaker.training': viewTraining,
  'locadmin.home': viewLocHome, 'locadmin.regs': viewRegistrations, 'locadmin.classes': viewClasses, 'locadmin.students': viewStudents, 'locadmin.coord': viewCoord,
  'coord.home': viewCoordHome, 'coord.regs': viewRegistrations, 'coord.classes': viewClasses, 'coord.students': viewStudents, 'coord.coord': viewCoord,
  'teacher.home': viewTeacherHome, 'teacher.classes': viewTeacherClasses, 'teacher.materials': viewTeacherMaterials, 'teacher.training': viewTeacherTraining, 'teacher.profile': viewTeacherProfile,
  'student.home': viewStudentHome, 'student.exams': viewStudentExams, 'student.materials': viewStudentMaterials, 'student.profile': viewStudentProfile
};
const SHARED = { class: viewClass, marks: viewMarks, log: viewLog, exam: viewExamTake, read: viewRead };
let META = {};
let busy = false;

/* ---------- server ---------- */
class ApiError extends Error {}
async function api(method, url, body) {
  /* Give up after 30 seconds rather than leaving the page waiting forever */
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000);
  let r;
  try { r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal }); }
  catch (e) { throw new ApiError(e.name === 'AbortError' ? 'The server took too long to answer.' : 'Could not reach the server. Check your internet connection.'); }
  finally { clearTimeout(timer); }
  const text = await r.text().catch(() => '');
  let j = {}; try { j = JSON.parse(text); } catch { /* not JSON, for example a hosting error page */ }
  if (r.status === 401 && url !== '/api/login') { clearSession(); render(); throw new ApiError('Please sign in again.'); }
  if (!r.ok) throw new ApiError(j.error || ('The server answered ' + r.status + (text ? ': ' + text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '') + '. Please try again.'));
  return j;
}
async function call(name, args) {
  /* the server runs the action as the role of the page it came from */
  const j = await api('POST', '/api/action/' + name, Object.assign({}, args || {}, { as: ME && ME.role }));
  setSession(j.me, j.today, j.data);
  if (j.toast) toast(j.toast);
  return j.result;
}
async function loadData() {
  const j = await api('GET', '/api/data');
  setSession(j.me, j.today, j.data);
}

/* ---------- light and dark ---------- */
const themeNow = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
function themeBtn(cl) {
  const next = themeNow() === 'dark' ? 'light' : 'dark';
  return '<button type="button" class="' + cl + '" data-act="theme" aria-label="Switch to ' + next + ' mode" title="Switch to ' + next + ' mode">' + icon(next === 'dark' ? 'moon' : 'sun') + '<span>' + (next === 'dark' ? 'Dark' : 'Light') + '</span></button>';
}
function setTheme(t, save) {
  document.documentElement.setAttribute('data-theme', t);
  if (save) { try { localStorage.setItem('am-theme', t); } catch { /* private mode: choice lasts this visit */ } }
}
/* Until someone picks, follow the computer's own setting as it changes */
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  let saved = null; try { saved = localStorage.getItem('am-theme'); } catch { /* ignore */ }
  if (!saved) { setTheme(e.matches ? 'dark' : 'light', false); render(); }
});

/* ---------- rendering ---------- */
/* Every page of every role the person holds, as role:tab, in role order (most senior first). */
const ROLE_NAMES = { super: 'Super admin', acmaker: 'Academic content creator', academic: 'Academic content approver', locadmin: 'Location responsible', coord: 'Coordinator', trainer: 'Teacher training faculty', social: 'Social media content creator', support: 'Systems support', teacher: 'Teacher', student: 'Student' };
const myTabs = () => (ME.roles || [ME.role]).filter(r => TABS[r]).flatMap(r => TABS[r].map(t => ({ role: r, key: r + ':' + t[0], tab: t[0], label: t[1], short: t[2] || t[1] })));
const firstTab = () => myTabs()[0] || { role: ME.role, tab: 'home' };
/* the role whose pages are showing; it decides what the screens and actions do */
function activeRole() { if (!S.role || !(ME.roles || []).includes(S.role) || !TABS[S.role]) S.role = firstTab().role; useRole(S.role); return S.role; }

function navHtml() {
  const tabs = myTabs(); const cur = S.tab || (tabs[0] && tabs[0].key); const groups = [...new Set(tabs.map(t => t.role))];
  const b = (t, cl) => '<button type="button" class="' + cl + '" data-act="nav" data-arg="' + t.key + '"' + (cur === t.key ? ' aria-current="page"' : '') + '>' + icon(t.tab) + '<span>' + (cl === 'bt' ? t.short : t.label) + '</span></button>';
  const side = '<nav class="side" aria-label="Menu"><div class="side-who"><div class="b">' + esc(ME.name) + '</div><div class="sub small">' + esc(ME.label) + '</div></div>' +
    groups.map(g => (groups.length > 1 ? '<div class="eyebrow navg">' + esc((ME.labels && ME.labels[g]) || ROLE_NAMES[g]) + '</div>' : '') + tabs.filter(t => t.role === g).map(t => b(t, 'navi')).join('')).join('') + '</nav>';
  const many = tabs.length > 5; const shown = many ? tabs.slice(0, 4) : tabs; const rest = many ? tabs.slice(4) : []; const inRest = rest.some(t => t.key === cur);
  const bar = '<nav class="tabbar" aria-label="Menu">' + shown.map(t => b(t, 'bt')).join('') +
    (many ? '<button type="button" class="bt" data-act="more" aria-expanded="' + !!S.more + '"' + (inRest ? ' aria-current="page"' : '') + '>' + icon('more') + '<span>More</span></button>' : '') + '</nav>' +
    (many && S.more ? '<div class="more-sheet">' + rest.map(t => b(t, 'navi')).join('') + '</div>' : '');
  return { side, bar };
}

function loginHtml() {
  const f = S.login || (S.login = { username: '', err: '' });
  return '<main class="login">' + themeBtn('theme-btn on-login') + '<section class="card">' + '<img class="brandlogo logo-light" src="/img/logo.svg" alt="Almuntazar Canada" width="190" height="167"><img class="brandlogo logo-dark" src="/img/logo-reverse.svg" alt="Almuntazar Canada" width="190" height="167">' + '<h1 style="text-align:center;font-size:20px">Sign in</h1>' +
    '<form data-form="login" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="li-u">Username</label><input id="li-u" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" value="' + esc(f.username) + '" required></div>' +
      '<div class="field"><label for="li-p">Password</label><input id="li-p" name="password" type="password" autocomplete="current-password" required></div>' +
      (f.err ? '<p class="err" role="alert">' + esc(f.err) + '</p>' : '') +
      '<button class="btn primary wide" type="submit">Sign in</button></form>' +
    '<p class="sub small" style="text-align:center">Forgotten your password? Ask your academy administrator to reset it.</p>' +
    (META.setupMessage ? '<p class="err" role="alert">' + esc(META.setupMessage) + '</p>' : '') +
    '</section></main>';
}

function render() {
  const app = document.getElementById('app');
  if (!ME) { app.innerHTML = loginHtml(); document.getElementById('modal-root').innerHTML = ''; return; }
  const role = activeRole();
  const fn = SHARED[S.view] || VIEWS[role + '.' + S.view] || VIEWS[firstTab().role + '.' + firstTab().tab] || (() => '<section class="card"><p class="empty">There are no pages for your roles yet.</p></section>');
  const narrow = ME.role === 'teacher' || ME.role === 'student' || S.view === 'log' || S.view === 'exam';
  const showNav = S.view !== 'exam'; const n = navHtml();
  let body;
  try { body = fn(); } catch (e) { console.error(e); body = '<section class="card"><p class="err">This page could not be shown.</p>' + act('nav', firstTab().role + ':' + firstTab().tab, 'Go to the first page') + '</section>'; }
  app.innerHTML =
    '<header class="bar"><div class="bar-in"><div class="brand"><img src="/img/mark-reverse.svg" alt="" width="45" height="40"><span class="bw"><span class="b1">ALMUNTAZAR</span><span class="b2">CANADA</span></span></div>' +
    '<div class="acct"><span><span class="nm">' + esc(ME.name) + '</span><span class="role"> · ' + esc(ME.label) + '</span></span>' + themeBtn('theme-btn') + act('pwOpen', '', 'Password', '') + act('logout', '', 'Sign out', '') + '</div></div></header>' +
    (META.temporary ? '<div class="note warn-note"><div>No permanent database is connected, so changes here can be lost at any time. Connect Neon Postgres in Vercel to keep them.</div></div>' : '') +
    '<div class="shell' + (showNav ? ' has-nav' : '') + '">' + (showNav ? n.side : '') +
    '<main class="wrap' + (narrow ? ' narrow' : '') + '">' + body + '</main></div>' + (showNav ? n.bar : '');
  document.getElementById('modal-root').innerHTML = modalHtml();
  document.querySelectorAll('[data-pdf]').forEach(showPdf); /* reading page: draw the PDF inside the app */
  document.querySelectorAll('[data-track]').forEach(trackReading); /* and keep a teacher's reading record */
  /* while questions are being drafted in the background, refresh every few seconds to show progress */
  if (!refreshTimer && (S.materials || []).some(m => m.qgen && /queued|running/.test(m.qgen.status))) {
    refreshTimer = setTimeout(async () => { refreshTimer = null; if (!ME || S.modal || S.draft || S.exam) return; try { await loadData(); render(); } catch { /* signed out or offline */ } }, 5000);
  }
}
let refreshTimer = null;
/* after the reading page: save the last seconds of the reading record, then fetch the updated progress */
async function leftReader() { try { await stopReading(); await loadData(); } catch { /* offline */ } }

let toastTimer;
function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, Math.max(4000, t.length * 70)); /* long enough to read */ }
/* go('classes') stays in the current role; go('teacher:classes') switches to that role's page */
function go(view, p) {
  let role = S.role || firstTab().role;
  if (view.includes(':')) { [role, view] = view.split(':'); }
  S.role = role; useRole(role); S.view = view; S.p = p || {}; S.more = false;
  if ((TABS[role] || []).some(t => t[0] === view)) S.tab = role + ':' + view;
  window.scrollTo(0, 0);
}
const goFirst = () => go(firstTab().role + ':' + firstTab().tab);
function setPath(path, val) { const k = path.split('.'); let o = S; for (let i = 0; i < k.length - 1; i++) { if (o[k[i]] == null) o[k[i]] = {}; o = o[k[i]]; } o[k[k.length - 1]] = val; }
function resetUi() { Object.assign(S, { view: 'home', p: {}, modal: null, draft: null, exam: null, form: {}, back: null, tab: null, role: null, more: false }); }

/* ---------- button actions ---------- */
const A = {
  async nav(v) { const left = S.view === 'read'; S.back = null; go(v); if (left) await leftReader(); },
  more() { S.more = !S.more; },
  theme() { setTheme(themeNow() === 'dark' ? 'light' : 'dark', true); },
  async logout() { await api('POST', '/api/logout'); clearSession(); resetUi(); },
  rdWeek(w) { S.form.rd.week = w; },
  toast(t) { toast(t); },
  async back() { const left = S.view === 'read'; const b = S.back; S.back = null; if (b) go(b.view, b.p); else goFirst(); if (left) await leftReader(); },
  report(code) { go('reports', { report: 'location', loc: code }); },
  openClass(cid) { S.back = { view: S.view, p: S.p }; go('class', { cid }); },
  marks(arg) { const a = arg.split('|'); S.back = { view: S.view, p: S.p }; go('marks', { cid: a[0], sem: +a[1] }); },
  regTab(t) { S.p.rtab = t; S.p.rcls = ''; delete S.p.pg_regs; delete S.p.pg_rclasses; delete S.p.pg_ralloc; },
  regClass(cid) { S.p.rcls = cid; S.p.raq = ''; delete S.p.pg_ralloc; window.scrollTo(0, 0); },
  page(arg) {
    const i = arg.lastIndexOf('|'); const key = arg.slice(0, i); S.p['pg_' + key] = +arg.slice(i + 1);
    setTimeout(() => { const el = document.getElementById('pg-' + key); const card = el && el.closest('.card'); if (card) card.scrollIntoView({ block: 'start' }); }, 0);
  },
  range(arg) { S.p.to = TODAY; S.p.from = addDays(TODAY, -(+arg)); },
  csv() {
    const rows = S.form.crCsv || []; const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const blob = new Blob([rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'almuntazar-report-' + TODAY + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  print() { window.print(); },
  pwOpen() { S.modal = { t: 'pw' }; },
  userResetOpen(id) { S.modal = { t: 'userReset', id }; },
  qEdit(id) { S.form.qb.edit = id; setTimeout(() => { const el = document.getElementById('q-form'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }, 0); },
  qEditCancel() { S.form.qb.edit = null; },
  importOpen() { S.paper = null; S.modal = { t: 'import', step: 0 }; },
  /* the questions read from the paper, ticked when they can be imported and their answer was found */
  importReview(paper) {
    S.paper = paper;
    S.form.imp = paper.questions.map(q => Object.assign({}, q, { include: q.type !== 'bank' && q.type !== 'other' && q.correct !== '' }));
    S.modal = { t: 'import', step: 1 };
  },
  async importRun() { const p = await api('GET', '/api/sample-paper'); A.importReview(Object.assign({}, p, { sample: true })); },
  async importUpload() {
    const el = document.getElementById('im-f'); const file = el && el.files && el.files[0];
    if (!file) throw new ApiError('Choose the Word file first.');
    const r = await fetch('/api/paper', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(j.error || 'The paper could not be read.');
    A.importReview(j);
  },
  async importSave() {
    const f = S.form.qb; const sample = S.paper && S.paper.sample;
    await call('importSave', { course: f.course, sem: f.sem, sub: f.sub, items: S.form.imp.map((q, idx) => sample ? { idx, include: q.include, correct: q.correct } : { include: q.include, correct: q.correct, q: { type: q.type, text: q.text, options: q.options, stmts: q.stmts } }) });
    S.modal = null;
  },
  shareOpen(mid) { const mt = S.materials.find(x => x.id === mid); const mine = S.classes.filter(c => c.teacherId === ME.teacherId && (mt.course === 'ALL' || (c.course === mt.course && (!mt.sem || c.sem === mt.sem)))); S.form = { cid: mine.length ? mine[0].id : '' }; S.modal = { t: 'share', mid }; },
  async shareSave(mid) { await call('shareSave', { mid, cid: S.form.cid }); S.modal = null; },
  async rsvp(arg) { const a = arg.split('|'); await call('rsvp', { id: a[0], answer: a[1] }); },
  async publish(key) { await call('publish', { key }); },
  async remind(id) { await call('remind', { id }); },
  async chartLoad(key) { await call('chartLoad', { key }); },
  /* the dialog on screen changes before the action runs, so that if the action is refused the message shows on
     what is really open and nothing is left stuck */
  async confirmYes() { const m = S.modal; S.modal = m.back || null; document.getElementById('modal-root').innerHTML = modalHtml(); await A[m.act](m.arg, null, null, true); },
  confirmNo() { S.modal = S.modal && S.modal.back || null; },
  async qRetire(id, _el, _ev, yes) { if (!yes) return sure('Retire this question? It will not be used in new exams.', 'Retire', 'qRetire', id); await call('qRetire', { id }); },
  examWinOpen(cid) { const c = cls(cid); const e = c.exam && c.exam.sem === c.sem && !c.exam.closed ? c.exam : null; S.form = { from: e ? e.from : TODAY, to: e ? e.to : addDays(TODAY, 6) }; S.modal = { t: 'examWin', cid }; },
  async examWinSave(cid) { await call('examOpen', { cid, from: S.form.from, to: S.form.to }); S.modal = null; },
  /* a chapter paper's window for one class: arg is class|subject|chapter */
  chWinOpen(arg) {
    const [cid, sub, n] = arg.split('|'); const c = cls(cid); const w = chapterWindow(c, sub, +n); const live = w && !w.closed && w.to >= TODAY;
    S.form = { from: live ? w.from : TODAY, to: live ? w.to : addDays(TODAY, CHAPTER_DAYS - 1) }; S.modal = { t: 'chWin', cid, sub, n: +n };
  },
  async chWinSave() { const m = S.modal; await call('chapterOpen', { cid: m.cid, sub: m.sub, n: m.n, from: S.form.from, to: S.form.to }); S.modal = null; },
  async chCloseNow(arg, _el, _ev, yes) {
    const [cid, sub, n] = arg.split('|');
    if (!yes) return sure('Close this chapter paper for ' + cid + ' now? Students who have not taken it will not be able to, and it counts as 0 for them.', 'Close paper', 'chCloseNow', arg);
    await call('chapterClose', { cid, sub, n: +n });
  },
  async examCloseNow(cid, _el, _ev, yes) { if (!yes) return sure('Close the exam window for ' + cid + ' now? Students who have not taken an exam will not be able to.', 'Close window', 'examCloseNow', cid); await call('examClose', { cid }); },
  chartEdit(key) {
    const [co, sem] = key.split('-'); const k = S.courses.find(c => c.code === co) || { weeks: 1 };
    const base = (S.chartDrafts || {})[key] || (S.chartData || {})[key] || {}; const col = sub => Array.from({ length: k.weeks }, (_, i) => (base[sub] || [])[i] || '');
    S.form.ch = { b: col('b'), l: col('l'), e: col('e') }; S.p = Object.assign({}, S.p, { course: co, sem: +sem, edit: true });
  },
  chartEditCancel() { S.p.edit = false; },
  async chartSaveNow(key) { await call('chartSave', Object.assign({ key }, S.form.ch)); S.p.edit = false; },
  /* open a material on the in-app reading page; a Word file's text is fetched first */
  async readOpen(arg) {
    const [mid, which] = arg.split('|'); const base = S.materials.find(x => x.id === mid); if (!base) return;
    const draft = which === 'draft' && base.draft; const m = draft ? Object.assign({}, base, base.draft) : base; /* the approver reads an update before approving it */
    S.reader = { mid };
    if (readKind(m) === 'word') { try { S.reader.paras = (await api('GET', '/files/' + m.fileId + '/text')).paragraphs; } catch (e) { S.reader.err = e.message; } }
    S.back = { view: S.view, p: S.p }; go('read', { mid, draft: !!draft });
  },
  async nominate(arg) { const p = arg.split('|'); await call('levelNominate', { sid: p[0], level: p[1] }); },
  excOpen(sid) { S.form = Object.assign({}, S.form, { sid: '', level: '', reason: '' }); S.modal = { t: 'levelExc', sid: sid || '' }; },
  async excSave() {
    const sid = S.modal.sid || S.form.sid; if (!sid) throw new ApiError('Choose the student.'); if (!S.form.level) throw new ApiError('Choose the level.');
    await call('levelNominate', { sid, level: S.form.level, exception: true, reason: S.form.reason }); S.modal = null;
  },
  async nominateTeacher(tid) { const t = S.teachers.find(x => x.id === tid); await call('levelNominate', { sid: t.sid, level: S.form.tl.to[tid] }); },
  async approve(arg) { const i = arg.indexOf('|'); await call('review', { kind: arg.slice(0, i), id: arg.slice(i + 1), decision: 'approve' }); },
  async approveMany(ids) { await call('reviewMany', { ids: ids.split(','), decision: 'approve' }); },
  sendBackManyOpen(ids) { S.form = { note: '' }; S.modal = { t: 'sendBack', many: ids.split(','), who: 'The content creator' }; },
  sendBackOpen(arg) { const p = arg.split('|'); S.form = { note: '' }; S.modal = { t: 'sendBack', kind: p[0], id: p[1], who: p[2] }; },
  async sendBackSave() { const m = S.modal; if (m.many) await call('reviewMany', { ids: m.many, decision: 'reject', note: S.form.note }); else await call('review', { kind: m.kind, id: m.id, decision: 'reject', note: S.form.note }); S.modal = null; },
  async qgenRetry(arg) { const [id, part] = arg.split('|'); await call('qgenRetry', { id, part }); },
  async closeAction(id) { await call('closeAction', { id }); },
  async userToggle(id) { await call('userToggle', { id }); },
  usersTab(tab) { S.p = Object.assign({}, S.p, { users: tab }); },
  locsTab(tab) { S.p = Object.assign({}, S.p, { locs: tab }); },
  locOffOpen(code) { S.form = { reason: '', mode: '', target: '', dest: '' }; S.modal = { t: 'locOff', code }; },
  async locOffSave() {
    const f = S.form; const code = S.modal.code;
    await call('locDisable', { id: code, reason: f.reason, mode: f.mode, target: f.target, dest: f.dest }); S.modal = null;
  },
  async locEnable(code) { await call('locEnable', { id: code }); },
  teacherLinkOpen(tid) { S.form = { sid: '' }; S.modal = { t: 'teacherLink', tid }; },
  async teacherLinkSave() { await call('teacherLink', { tid: S.modal.tid, sid: S.form.sid }); S.modal = null; },
  assignOpen(cid) { const c = cls(cid); const l = assignable(c.g, c.course); S.form = { teacher: l[0] ? l[0].id : '' }; S.modal = { t: 'assign', cid }; },
  async assignSave(cid) { await call('assignSave', { cid, teacher: S.form.teacher }); S.modal = null; },
  classNew() { S.form = { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00', start: TODAY, teacher: '', meet: '', loc: S.p.loc || '' }; S.modal = { t: 'class' }; },
  async classSave() { if (!S.form.start) throw new ApiError('Choose the start date.'); if (ME.role === 'super' && !S.form.loc) throw new ApiError('Choose the location.'); await call('classSave', S.form); S.modal = null; },
  allocOpen(rid) { const r = S.regs.find(x => x.id === rid); const fit = c => (c.loc === r.loc ? 0 : 4) + (c.course === r.course ? 0 : 2) + (!r.sem || c.sem === r.sem ? 0 : 1); const l = S.classes.filter(c => c.g === r.g && !ended(c) && c.id !== r.from).sort((a, b) => fit(a) - fit(b)); S.form = { cid: l[0] ? l[0].id : '' }; S.modal = { t: 'alloc', rid }; },
  moveOpen(sid) { const l = moveTargets(S.students.find(s => s.id === sid)); S.form = { cid: l[0] ? l[0].id : '' }; S.modal = { t: 'move', sid }; },
  async moveSave(sid) { await call('moveStudent', { sid, cid: S.form.cid }); S.modal = null; },
  addStuOpen(cid) { S.modal = { t: 'addStu', cid }; },
  async regRemove(id, _el, _ev, yes) {
    if (!yes) return sure('Remove the registration of ' + S.regs.find(r => r.id === id).name + '? This cannot be undone.', 'Remove', 'regRemove', id);
    await call('regRemove', { id });
  },
  regsFromClass() { S.modal = null; S.back = null; go('regs'); },
  async addReg(arg) { const a = arg.split('|'); await call('allocSave', { rid: a[0], cid: a[1] }); if (S.modal) S.modal.err = ''; },
  closeOpen(cid) { S.form = { reason: '', all: 'reg', dest: {} }; S.modal = { t: 'close', cid }; },
  async closeSave(cid, _el, _ev, yes) {
    const f = S.form; if (!f.reason.trim()) throw new ApiError('Give a reason for closing the class.');
    const dest = {}; classStudents(cid).forEach(s => { dest[s.id] = f.all === 'each' ? (f.dest[s.id] || 'reg') : f.all; });
    if (!yes) return sure('Close ' + cid + '? This cannot be undone.', 'Close class', 'closeSave', cid);
    await call('closeClass', { cid, reason: f.reason, dest }); S.modal = null;
  },
  editOpen(arg) { const i = arg.indexOf('|'); const kind = arg.slice(0, i), id = arg.slice(i + 1); const r = EDIT[kind].find(id); if (!r) return; S.form = EDIT[kind].values(r); S.modal = { t: 'edit', kind, id }; },
  async editSave() {
    const m = S.modal; const sp = EDIT[m.kind]; const payload = Object.assign({}, sp.out ? sp.out(S.form) : S.form, { id: m.id });
    const el = sp.file && document.getElementById('ed-file'); const file = el && el.files && el.files[0];
    if (file) payload.fileId = await upload(file); /* a replacement file is uploaded first */
    await call(sp.action, payload); S.modal = null;
  },
  logEdit(sid) {
    const x = S.sessions.find(s => s.id === sid); S.back = { view: S.view, p: S.p };
    S.draft = { sid, edit: true, held: x.held, reason: x.reason || '', verse: x.verse || '', covered: Object.assign({ b: false, l: false, e: false }, x.covered), att: Object.assign({}, x.att), note: x.note || '' }; go('log');
  },
  assistOpen(cid) { S.form = { sid: cls(cid).assistantId || '' }; S.modal = { t: 'assist', cid }; },
  async assistSave(cid) { await call('setAssistant', { cid, sid: S.form.sid }); S.modal = null; },
  loginOpen(tid) { S.modal = { t: 'login', tid }; },
  stuLoginOpen(sid) { S.modal = { t: 'stuLogin', sid }; },
  removeOpen(sid) { S.form = { mode: 'wait', reason: '' }; S.modal = { t: 'remove', sid }; },
  async removeSave(sid) { await call('removeStudent', { sid, mode: S.form.mode, reason: S.form.reason }); S.modal = null; },
  promoteOpen(cid) { const c = cls(cid); S.form = { up: {}, start: TODAY }; classStudents(cid).forEach(s => { S.form.up[s.id] = semResult(s.id, c.course, c.sem) === 'pass'; }); S.modal = { t: 'promote', cid }; },
  async promoteSave(cid, _el, _ev, yes) {
    const up = Object.keys(S.form.up).filter(k => S.form.up[k]); const n = Object.keys(S.form.up).length - up.length;
    if (!yes) return sure(up.length + ' student' + (up.length === 1 ? '' : 's') + ' move on' + (n ? ' and ' + n + ' go back to registrations' : '') + '. Continue?', 'Continue', 'promoteSave', cid);
    await call('promote', { cid, up, start: S.form.start }); S.modal = null;
    /* a course just completed: offer the next level straight away */
    const c = cls(cid); if (c.status === 'completed' && S.courses[levelRank(c.course) + 1] && classStudents(cid).length) A.nextOpen(cid);
  },
  /* a class that finished its course moves up a level; its teacher stays if they can teach the next one */
  nextOpen(cid) {
    const c = cls(cid); const k = S.courses[levelRank(c.course) + 1]; const up = {}; classStudents(cid).forEach(s => { up[s.id] = true; });
    S.form = { up, start: TODAY, teacher: assignable(c.g, k.code).some(t => t.id === c.teacherId) ? c.teacherId : '' }; S.modal = { t: 'nextLevel', cid };
  },
  async nextSave(cid) { await call('classNextLevel', { cid, up: Object.keys(S.form.up).filter(k => S.form.up[k]), start: S.form.start, teacher: S.form.teacher }); S.modal = null; },
  async allocSave(rid) { await call('allocSave', { rid, cid: S.form.cid }); S.modal = null; },
  /* log a meeting (the latest scheduled one that has taken place, by default), or edit a logged one */
  callOpen(id) {
    const l = myLoc(); const was = id ? S.calls.find(c => c.id === id) : null; const att = {};
    (was && was.att || []).forEach(x => { att[x.sid] = x.present; });
    callPeople(l).forEach(p => { if (!(p.sid in att)) att[p.sid] = true; });
    let date = l.nextCall <= TODAY ? l.nextCall : TODAY;
    if (l.nextCall > TODAY) while (DOWL[pd(date).getDay()] !== l.callDay) date = addDays(date, -1);
    S.form = { id: was ? was.id : '', date: was ? was.date : date, status: was ? was.status : 'Held', att, text: '', owner: ME.name, due: addDays(TODAY, 7), loc: l.code }; S.modal = { t: 'call', edit: !!was };
  },
  async taskDone(id, _el, _ev, yes) {
    if (!yes) return sure('Mark this task as done? It leaves your list and the action items.', 'Mark done', 'taskDone', id);
    await call('closeAction', { id });
  },
  schedOpen(code) {
    const l = S.locations.find(x => x.code === code); const m = callMinutes(l.callTime);
    S.form = { callDay: l.callDay, time: m == null ? '' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'), meet: l.meet || '' }; S.modal = { t: 'callSched', code };
  },
  async schedSave() { await call('callSchedule', { loc: S.modal.code, callDay: S.form.callDay, time: S.form.time, meet: S.form.meet }); S.modal = null; },
  taskOpen(id) { S.form = { transcript: '' }; S.modal = { t: 'tasks', step: 'paste', callId: id }; },
  async taskAnalyse() {
    const m = S.modal; if (!(S.form.transcript || '').trim()) throw new ApiError('Paste the transcript of the call first.');
    m.busy = true; m.err = ''; render();
    try {
      const r = await api('POST', '/api/transcript', { callId: m.callId, transcript: S.form.transcript });
      S.form = { tasks: r.tasks.map(t => Object.assign({}, t, { include: true, due: t.due || addDays(TODAY, 7) })) };
      S.modal = { t: 'tasks', step: 'review', callId: m.callId, dropped: r.dropped };
    } catch (e) { m.busy = false; throw e; }
  },
  async taskSave() {
    const items = S.form.tasks.filter(t => t.include); if (!items.length) throw new ApiError('Tick at least one task to save.');
    await call('actionsFromMeeting', { callId: S.modal.callId, items }); S.modal = null;
  },
  async callRemove(id, _el, _ev, yes) {
    if (!yes) return sure('Remove the meeting of ' + S.calls.find(c => c.id === id).date + '? Its attendance is removed with it; action items stay.', 'Remove', 'callRemove', id);
    await call('callRemove', { id });
  },
  async partAdd(code) { if (!S.form.part) throw new ApiError('Choose a student.'); await call('participantAdd', { loc: code, sid: S.form.part }); S.form.part = ''; },
  async partRemove(arg, _el, _ev, yes) {
    const [code, sid] = arg.split('|');
    if (!yes) return sure('Remove this participant from the weekly call?', 'Remove', 'partRemove', arg);
    await call('participantRemove', { loc: code, sid });
  },
  async callSave() { await call('callSave', S.form); S.modal = null; },
  reminder(sid) { S.modal = { t: 'reminder', sid }; },
  cert(key) { S.modal = { t: 'cert', key }; },
  async sscImportSave(arg) { const m = S.modal; const p = m.p; await call('chartImport', { key: p.key, b: p.b, l: p.l, e: p.e, confirmNew: arg === 'new', file: m.file }); S.modal = null; },
  async mcqImportSave() { const items = S.modal.items.filter(x => !x.errors.length && !x.dupe).map(x => x.q); await call('qImportRows', { items }); S.modal = null; },
  certsOpen(cid) { S.modal = { t: 'certs', cid }; },
  certFor(arg) { const [sid, key, cid] = arg.split('::'); S.modal = { t: 'cert', sid, key, cid }; },
  modalClose() { S.modal = null; },
  async pref(key) { await call('pref', { key }); },
  logOpen(sid) { const x = S.sessions.find(s => s.id === sid); const c = cls(x.classId); S.back = { view: S.view, p: S.p }; S.draft = { sid, held: true, reason: '', verse: verseRef(versesBefore(c, x.week) + 3), covered: { b: true, l: true, e: true }, att: {}, note: '' }; go('log'); },
  logHeld(v) { S.draft.held = v === '1'; },
  logAtt(arg) { const a = arg.split('|'); S.draft.att[a[0]] = a[1]; },
  logAllIn(ids) { ids.split(',').forEach(id => { S.draft.att[id] = 'p'; }); },
  async logSave() { await call('logSave', S.draft); S.draft = null; A.back(); },
  async examStart(id, _el, _ev, yes) {
    /* a re-exam (after a mark below 50%) is said so; the best attempt counts */
    const p = id.split('-'); const ch = p[0] === 'CH'; const [co, sem, sub, n] = ch ? p.slice(1) : p;
    const again = S.results.some(r => r.sid === ME.studentId && r.course === co && r.sem === +sem && r.sub === sub && (r.chapter || null) === (ch ? +n : null));
    if (!yes) return sure(again ? 'Sit this ' + (ch ? 'chapter paper' : 'exam') + ' again? Your best mark counts.' : 'Start the ' + (ch ? 'chapter paper' : 'exam') + ' now? Answer every question, then submit. If you score below 50%, you can sit it again while it is open.', 'Start now', 'examStart', id);
    const r = await call('examStart', { id });
    S.exam = { attemptId: r.attemptId, examId: r.examId, qs: r.qs, i: 0, ans: r.qs.map(q => q.type === 'match' ? q.left.map(() => '') : undefined) };
    go('exam');
  },
  examPick(j) { S.exam.ans[S.exam.i] = +j; },
  examGo(n) { S.exam.i = Math.max(0, Math.min(S.exam.qs.length - 1, S.exam.i + +n)); window.scrollTo(0, 0); },
  async examSubmit() {
    if (S.exam.label) { await call('tquizSubmit', { attemptId: S.exam.attemptId, ans: S.exam.ans }); S.exam = null; go('teacher:training'); return; }
    const r = await call('examSubmit', { attemptId: S.exam.attemptId, ans: S.exam.ans }); S.exam = null; go('exams');
    S.modal = r && r.key ? { t: 'chDone', pct: r.pct, passed: r.passed, key: r.key } : { t: 'done' }; /* a chapter paper shows its mark at once */
  },
  /* the teacher readiness quiz for a syllabus (see server/readiness.js) */
  async tquizStart(mid, _el, _ev, yes) {
    if (!yes) return sure('Start the readiness quiz now? Answer every question, then submit. If you do not pass, you can take it again from tomorrow.', 'Start now', 'tquizStart', mid);
    const r = await call('tquizStart', { mid });
    S.exam = { attemptId: r.attemptId, examId: r.examId, label: r.label, qs: r.qs, i: 0, ans: r.qs.map(q => q.type === 'match' ? q.left.map(() => '') : undefined) };
    go('exam');
  },
  overlay(_, el, ev) { if (ev.target === el) S.modal = null; }
};

/* ---------- form submissions ---------- */
async function upload(file) {
  if (META.maxUpload && file.size > META.maxUpload) throw new ApiError('That file is larger than ' + Math.round(META.maxUpload / 1048576) + ' MB. Upload it to Google Drive and paste the link instead.');
  const r = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || 'The file could not be uploaded.');
  return j.id;
}
const F = {
  async login(d) {
    S.login = { username: d.username, err: '' };
    try { await api('POST', '/api/login', { username: d.username, password: d.password }); }
    catch (e) { S.login.err = e.message; return; }
    resetUi(); await loadData(); goFirst();
  },
  async qAdd(d) { const f = S.form.qb; await call('qAdd', Object.assign({}, d, { course: f.course, sem: f.sem, sub: f.sub, type: f.type, edit: f.edit })); f.edit = null; },
  async rdSave(d) { await call('rdSave', Object.assign({}, d, { week: S.form.rd.week })); },
  async matAdd(d) {
    const file = d.file && d.file.name ? d.file : null; delete d.file;
    if (file) d.fileId = await upload(file);
    await call('matAdd', d);
  },
  async trainAdd(d) { d.req = !!d.req; await call('trainAdd', d); },
  async changePassword(d) { await call('changePassword', d); S.modal = null; },
  async userReset(d) { await call('userReset', d); S.modal = null; },
  async studentLogin(d) { await call('studentLogin', d); S.modal = null; },
  async teacherLogin(d) { await call('userAdd', Object.assign({}, d, { role: 'teacher' })); S.modal = null; },
  async userAdd(d) {
    const roles = Object.keys(d).filter(k => k.startsWith('r_')).map(k => k.slice(2));
    await call('userAdd', { studentId: d.studentId, username: d.username, password: d.password, loc: d.loc, roles }); S.form.ua = { q: '' };
  }
};
const SERVER_FORMS = ['locAdd', 'courseAdd', 'subjectAdd', 'regAdd', 'tradAdd', 'actionAdd', 'setTargets'];

function showError(e) {
  const msg = e && e.message ? e.message : 'Something went wrong.';
  if (S.modal) {
    S.modal.err = msg;
    const m = document.querySelector('.modal'); if (m) { let p = m.querySelector('.err'); if (!p) { p = document.createElement('p'); p.className = 'err'; p.setAttribute('role', 'alert'); m.appendChild(p); } p.textContent = msg; }
  } else toast(msg);
  if (!(e instanceof ApiError)) console.error(e);
}

/* Asks for confirmation in the app's own dialog: browsers inside apps often block confirm() and answer "no"
   without showing anything. Confirming runs the action again with yes = true; Cancel brings back any dialog
   that was open. */
function sure(text, okLabel, act, arg) { S.modal = { t: 'confirm', text, okLabel, act, arg, back: S.modal }; }

async function runGuarded(fn, rerenderOnError) {
  if (busy) return; busy = true; document.body.style.cursor = 'progress';
  try { await fn(); render(); }
  catch (e) { showError(e); if (rerenderOnError) render(); }
  finally { busy = false; document.body.style.cursor = ''; }
}

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
  if (el.dataset.act === 'overlay' && ev.target !== el) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  runGuarded(() => fn(el.dataset.arg, el, ev), false);
});
document.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-form]'); if (!f) return; ev.preventDefault();
  const name = f.dataset.form; const d = Object.fromEntries(new FormData(f));
  const fn = F[name] || (SERVER_FORMS.includes(name) ? (x => call(name, x)) : null); if (!fn) return;
  runGuarded(() => fn(d), name === 'login');
});
/* reads an Excel file on the server and returns what it found, for the creator to check before anything is saved */
async function excelPreview(kind, file, qs) {
  if (!/\.xlsx$/i.test(file.name)) throw new ApiError('Choose an Excel file ending in .xlsx. An older .xls file can be opened in Excel and saved as .xlsx.');
  if (META.maxUpload && file.size > META.maxUpload) throw new ApiError('That file is larger than ' + Math.round(META.maxUpload / 1048576) + ' MB. Split it into smaller files.');
  const r = await fetch('/api/excel/' + kind + '-preview?' + new URLSearchParams(qs), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || 'The file could not be read.');
  return j;
}
function onInput(ev) {
  const el = ev.target;
  if (el.dataset && el.dataset.upload && ev.type === 'change' && el.files && el.files[0]) {
    const file = el.files[0]; const d = el.dataset; el.value = '';
    runGuarded(async () => {
      if (d.upload === 'ssc') S.modal = { t: 'sscImport', file: file.name, p: await excelPreview('ssc', file, { course: d.course, sem: d.sem }) };
      if (d.upload === 'mcq') S.modal = { t: 'mcqImport', file: file.name, items: (await excelPreview('mcq', file, { course: d.course, sem: d.sem, sub: d.sub })).items };
    });
    return;
  }
  if (el.dataset && el.dataset.call === 'setAccess') { if (ev.type === 'change') runGuarded(() => call('setAccess', { tid: el.dataset.tid, access: el.value })); return; }
  if (!el.dataset || !el.dataset.bind) return;
  setPath(el.dataset.bind, el.type === 'checkbox' ? el.checked : el.value);
  if (el.dataset.bind.indexOf('p.') === 0) Object.keys(S.p).filter(k => k.indexOf('pg_') === 0).forEach(k => { delete S.p[k]; });
  if (el.dataset.bind.indexOf('exam.') === 0 && S.exam) {
    const n = examCount(); const c = document.getElementById('ex-count'); if (c) c.textContent = n + ' of ' + S.exam.qs.length + ' answered.';
    const b = document.getElementById('ex-submit'); if (b) b.disabled = n < S.exam.qs.length;
  }
  if (el.dataset.rerender && ev.type === 'change') render();
}
document.addEventListener('input', onInput);
/* no right-click menu (Save as, Copy) on the reading page */
document.addEventListener('contextmenu', ev => { if (ev.target.closest && ev.target.closest('[data-noctx]')) ev.preventDefault(); });
document.addEventListener('change', onInput);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.modal) { S.modal = null; render(); } });
window.addEventListener('beforeunload', ev => { if (S.exam || S.draft) { ev.preventDefault(); ev.returnValue = ''; } });

/* ---------- start ---------- */
function startupError(msg) {
  document.getElementById('app').innerHTML = '<main class="login"><section class="card">' + '<img class="brandlogo logo-light" src="/img/logo.svg" alt="Almuntazar Canada" width="190" height="167"><img class="brandlogo logo-dark" src="/img/logo-reverse.svg" alt="Almuntazar Canada" width="190" height="167">' +
    '<h1 style="text-align:center;font-size:20px">The app could not start</h1><p class="err" role="alert">' + esc(msg) + '</p>' +
    '<button class="btn primary wide" type="button" onclick="location.reload()">Try again</button></section></main>';
}
(async function boot() {
  window.__amStarted = true;
  try { META = await api('GET', '/api/meta'); }
  catch (e) { startupError(e.message); return; }
  if (META.signedIn) { try { await loadData(); goFirst(); } catch { clearSession(); } }
  render();
})();

