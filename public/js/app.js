/* App shell: sign-in, navigation, rendering, and the wiring from buttons and forms to the server. */
import { S, ME, TODAY, setSession, clearSession } from './state.js';
import { addDays } from '/shared/dates.js';
import { esc, act, icon } from './ui.js';
import { cls, verseRef, versesBefore } from './logic.js';
import { viewSuperHome, viewLocations, viewMasters, viewUsers, viewReports } from './views/admin.js';
import { viewChart, viewBank, viewExams, viewTraditions, viewMaterials, viewTraining } from './views/academic.js';
import { viewLocHome, viewClasses, viewStudents, viewCoord, viewCoordHome } from './views/location.js';
import { viewTeacherHome, viewTeacherClasses, viewTeacherMaterials, viewTeacherTraining, viewTeacherProfile } from './views/teacher.js';
import { viewStudentHome, viewStudentExams, viewStudentMaterials, viewStudentProfile } from './views/student.js';
import { viewClass, viewMarks, viewLog, viewExamTake, examCount } from './views/shared.js';
import { modalHtml } from './views/modals.js';

const TABS = {
  super: [['home', 'Overview'], ['locations', 'Locations'], ['masters', 'Master lists', 'Masters'], ['users', 'User accounts', 'Users'], ['reports', 'Reports']],
  academic: [['chart', 'Syllabus chart', 'Chart'], ['bank', 'Question bank', 'Questions'], ['exams', 'Exams'], ['materials', 'Materials'], ['training', 'Training'], ['traditions', 'Traditions']],
  locadmin: [['home', 'Overview'], ['classes', 'Classes'], ['students', 'Students'], ['coord', 'Coordination']],
  coord: [['home', 'Overview'], ['classes', 'Classes'], ['students', 'Students']],
  teacher: [['home', 'Home'], ['classes', 'Classes'], ['materials', 'Materials'], ['training', 'Training'], ['profile', 'Profile']],
  student: [['home', 'Home'], ['exams', 'Exams'], ['materials', 'Materials'], ['profile', 'Profile']]
};
const VIEWS = {
  'super.home': viewSuperHome, 'super.locations': viewLocations, 'super.masters': viewMasters, 'super.users': viewUsers, 'super.reports': viewReports,
  'academic.chart': viewChart, 'academic.bank': viewBank, 'academic.exams': viewExams, 'academic.traditions': viewTraditions, 'academic.materials': viewMaterials, 'academic.training': viewTraining,
  'locadmin.home': viewLocHome, 'locadmin.classes': viewClasses, 'locadmin.students': viewStudents, 'locadmin.coord': viewCoord,
  'coord.home': viewCoordHome, 'coord.classes': viewClasses, 'coord.students': viewStudents,
  'teacher.home': viewTeacherHome, 'teacher.classes': viewTeacherClasses, 'teacher.materials': viewTeacherMaterials, 'teacher.training': viewTeacherTraining, 'teacher.profile': viewTeacherProfile,
  'student.home': viewStudentHome, 'student.exams': viewStudentExams, 'student.materials': viewStudentMaterials, 'student.profile': viewStudentProfile
};
const SHARED = { class: viewClass, marks: viewMarks, log: viewLog, exam: viewExamTake };
let META = { demo: false, demoUsers: [] };
let busy = false;

/* ---------- server ---------- */
class ApiError extends Error {}
async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  if (r.status === 401 && url !== '/api/login') { clearSession(); render(); throw new ApiError('Please sign in again.'); }
  if (!r.ok) throw new ApiError(j.error || 'Something went wrong. Please try again.');
  return j;
}
async function call(name, args) {
  const j = await api('POST', '/api/action/' + name, args || {});
  setSession(j.me, j.today, j.data);
  if (j.toast) toast(j.toast);
  return j.result;
}
async function loadData() {
  const j = await api('GET', '/api/data');
  setSession(j.me, j.today, j.data);
}

/* ---------- rendering ---------- */
function navHtml() {
  const tabs = TABS[ME.role]; const cur = S.tab || tabs[0][0];
  const b = (t, cl) => '<button type="button" class="' + cl + '" data-act="nav" data-arg="' + t[0] + '"' + (cur === t[0] ? ' aria-current="page"' : '') + '>' + icon(t[0]) + '<span>' + (cl === 'bt' ? (t[2] || t[1]) : t[1]) + '</span></button>';
  const side = '<nav class="side" aria-label="Menu"><div class="side-who"><div class="b">' + esc(ME.name) + '</div><div class="sub small">' + esc(ME.label) + '</div></div>' + tabs.map(t => b(t, 'navi')).join('') + '</nav>';
  const many = tabs.length > 5; const shown = many ? tabs.slice(0, 4) : tabs; const rest = many ? tabs.slice(4) : []; const inRest = rest.some(t => t[0] === cur);
  const bar = '<nav class="tabbar" aria-label="Menu">' + shown.map(t => b(t, 'bt')).join('') +
    (many ? '<button type="button" class="bt" data-act="more" aria-expanded="' + !!S.more + '"' + (inRest ? ' aria-current="page"' : '') + '>' + icon('more') + '<span>More</span></button>' : '') + '</nav>' +
    (many && S.more ? '<div class="more-sheet">' + rest.map(t => b(t, 'navi')).join('') + '</div>' : '');
  return { side, bar };
}

function loginHtml() {
  const f = S.login || (S.login = { username: '', err: '' });
  return '<main class="login"><section class="card"><div class="brandbig">Almuntazar Academy</div><h1 style="text-align:center;font-size:20px">Sign in</h1>' +
    '<form data-form="login" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="li-u">Username</label><input id="li-u" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" value="' + esc(f.username) + '" required></div>' +
      '<div class="field"><label for="li-p">Password</label><input id="li-p" name="password" type="password" autocomplete="current-password" required></div>' +
      (f.err ? '<p class="err" role="alert">' + esc(f.err) + '</p>' : '') +
      '<button class="btn primary wide" type="submit">Sign in</button></form>' +
    (META.demoUsers.length ? '<div><div class="eyebrow" style="margin-bottom:6px">Sample accounts</div><p class="sub small" style="margin-bottom:8px">Pick one to fill in the username. The sample password is in the README.</p><div class="demo-list">' +
      META.demoUsers.map(u => '<button type="button" data-act="pickUser" data-arg="' + esc(u.username) + '"><span class="b">' + esc(u.name) + '</span><span class="sub small">' + esc(u.username) + ' · ' + esc({ super: 'Super admin', academic: 'Academic team', locadmin: 'Location responsible', coord: 'Coordinator', teacher: 'Teacher', student: 'Student' }[u.role]) + '</span></button>').join('') + '</div></div>' : '') +
    '</section></main>';
}

function render() {
  const app = document.getElementById('app');
  if (!ME) { app.innerHTML = loginHtml(); document.getElementById('modal-root').innerHTML = ''; return; }
  const fn = SHARED[S.view] || VIEWS[ME.role + '.' + S.view] || VIEWS[ME.role + '.' + TABS[ME.role][0][0]];
  const narrow = ME.role === 'teacher' || ME.role === 'student' || S.view === 'log' || S.view === 'exam';
  const showNav = S.view !== 'exam'; const n = navHtml();
  let body;
  try { body = fn(); } catch (e) { console.error(e); body = '<section class="card"><p class="err">This page could not be shown.</p>' + act('nav', TABS[ME.role][0][0], 'Go to the first page') + '</section>'; }
  app.innerHTML =
    '<header class="bar"><div class="bar-in"><div class="brand">Almuntazar Academy</div>' +
    '<div class="acct"><span><span class="nm">' + esc(ME.name) + '</span> · ' + esc(ME.label) + '</span>' + act('pwOpen', '', 'Password', '') + act('logout', '', 'Sign out', '') + '</div></div></header>' +
    (META.demo ? '<div class="note"><div>Sample data is loaded · reset it with <code>npm run seed -- --reset</code></div></div>' : '') +
    '<div class="shell' + (showNav ? ' has-nav' : '') + '">' + (showNav ? n.side : '') +
    '<main class="wrap' + (narrow ? ' narrow' : '') + '">' + body + '</main></div>' + (showNav ? n.bar : '');
  document.getElementById('modal-root').innerHTML = modalHtml();
}

let toastTimer;
function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000); }
function go(view, p) { S.view = view; S.p = p || {}; S.more = false; if (TABS[ME.role].some(t => t[0] === view)) S.tab = view; window.scrollTo(0, 0); }
function setPath(path, val) { const k = path.split('.'); let o = S; for (let i = 0; i < k.length - 1; i++) { if (o[k[i]] == null) o[k[i]] = {}; o = o[k[i]]; } o[k[k.length - 1]] = val; }
function resetUi() { Object.assign(S, { view: 'home', p: {}, modal: null, draft: null, exam: null, form: {}, back: null, tab: null, more: false }); }

/* ---------- button actions ---------- */
const A = {
  nav(v) { S.back = null; go(v); },
  more() { S.more = !S.more; },
  pickUser(u) { S.login = { username: u, err: '' }; setTimeout(() => { const p = document.getElementById('li-p'); if (p) p.focus(); }, 0); },
  async logout() { await api('POST', '/api/logout'); clearSession(); resetUi(); },
  rdWeek(w) { S.form.rd.week = w; },
  toast(t) { toast(t); },
  back() { const b = S.back; S.back = null; if (b) go(b.view, b.p); else go(TABS[ME.role][0][0]); },
  report(code) { go('reports', { report: 'location', loc: code }); },
  openClass(cid) { S.back = { view: S.view, p: S.p }; go('class', { cid }); },
  marks(arg) { const a = arg.split('|'); S.back = { view: S.view, p: S.p }; go('marks', { cid: a[0], sem: +a[1] }); },
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
  importOpen() { S.modal = { t: 'import', step: 0 }; },
  async importRun() {
    S.paper = S.paper || await api('GET', '/api/sample-paper');
    S.form.imp = S.paper.questions.map(q => Object.assign({}, q, { include: q.type !== 'bank' && q.correct !== '' }));
    S.modal = { t: 'import', step: 1 };
  },
  async importSave() { const f = S.form.qb; await call('importSave', { course: f.course, sem: f.sem, sub: f.sub, items: S.form.imp.map((q, idx) => ({ idx, include: q.include, correct: q.correct })) }); S.modal = null; },
  shareOpen(mid) { const mt = S.materials.find(x => x.id === mid); const mine = S.classes.filter(c => c.teacherId === ME.teacherId && (mt.course === 'ALL' || (c.course === mt.course && (!mt.sem || c.sem === mt.sem)))); S.form = { cid: mine.length ? mine[0].id : '' }; S.modal = { t: 'share', mid }; },
  async shareSave(mid) { await call('shareSave', { mid, cid: S.form.cid }); S.modal = null; },
  async rsvp(arg) { const a = arg.split('|'); await call('rsvp', { id: a[0], answer: a[1] }); },
  async publish(key) { await call('publish', { key }); },
  async remind(id) { await call('remind', { id }); },
  async chartLoad(key) { await call('chartLoad', { key }); },
  async qRetire(id) { if (confirm('Retire this question? It will not be used in new exams.')) await call('qRetire', { id }); },
  async examToggle(id) { await call('examToggle', { id }); },
  async closeAction(id) { await call('closeAction', { id }); },
  async userToggle(id) { await call('userToggle', { id }); },
  assignOpen(cid) { const c = cls(cid); const l = S.teachers.filter(t => t.g === c.g); S.form = { teacher: l[0] ? l[0].id : '' }; S.modal = { t: 'assign', cid }; },
  async assignSave(cid) { await call('assignSave', { cid, teacher: S.form.teacher }); S.modal = null; },
  classNew() { S.form = { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00', teacher: '', meet: '' }; S.modal = { t: 'class' }; },
  async classSave() { await call('classSave', S.form); S.modal = null; },
  allocOpen(rid) { const r = S.regs.find(x => x.id === rid); const l = S.classes.filter(c => c.g === r.g).sort((a, b) => (a.course === r.course ? 0 : 1) - (b.course === r.course ? 0 : 1)); S.form = { cid: l[0] ? l[0].id : '' }; S.modal = { t: 'alloc', rid }; },
  async allocSave(rid) { await call('allocSave', { rid, cid: S.form.cid }); S.modal = null; },
  callOpen() { S.form = { status: 'Held', text: '', owner: ME.name, due: addDays(TODAY, 7) }; S.modal = { t: 'call' }; },
  async callSave() { await call('callSave', S.form); S.modal = null; },
  reminder(sid) { S.modal = { t: 'reminder', sid }; },
  cert(key) { S.modal = { t: 'cert', key }; },
  modalClose() { S.modal = null; },
  async pref(key) { await call('pref', { key }); },
  logOpen(sid) { const x = S.sessions.find(s => s.id === sid); const c = cls(x.classId); S.back = { view: S.view, p: S.p }; S.draft = { sid, held: true, reason: '', verse: verseRef(versesBefore(c, x.week) + 3), covered: { b: true, l: true, e: true }, att: {}, note: '' }; go('log'); },
  logHeld(v) { S.draft.held = v === '1'; },
  logAtt(arg) { const a = arg.split('|'); S.draft.att[a[0]] = a[1]; },
  async logSave() { await call('logSave', S.draft); S.draft = null; A.back(); },
  async examStart(id) {
    if (!confirm('You have one attempt. Start the exam now?')) return;
    const r = await call('examStart', { id });
    S.exam = { attemptId: r.attemptId, examId: r.examId, qs: r.qs, i: 0, ans: r.qs.map(q => q.type === 'match' ? q.left.map(() => '') : undefined) };
    go('exam');
  },
  examPick(j) { S.exam.ans[S.exam.i] = +j; },
  examGo(n) { S.exam.i = Math.max(0, Math.min(S.exam.qs.length - 1, S.exam.i + +n)); window.scrollTo(0, 0); },
  async examSubmit() { await call('examSubmit', { attemptId: S.exam.attemptId, ans: S.exam.ans }); S.exam = null; go('exams'); S.modal = { t: 'done' }; },
  overlay(_, el, ev) { if (ev.target === el) S.modal = null; }
};

/* ---------- form submissions ---------- */
async function upload(file) {
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
    resetUi(); await loadData(); go(TABS[ME.role][0][0]);
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
  async userAdd(d) { await call('userAdd', d); S.form.ua = { role: 'teacher' }; }
};
const SERVER_FORMS = ['locAdd', 'courseAdd', 'subjectAdd', 'teacherAdd', 'tradAdd', 'actionAdd', 'examAdd', 'setTargets'];

function showError(e) {
  const msg = e && e.message ? e.message : 'Something went wrong.';
  if (S.modal) {
    S.modal.err = msg;
    const m = document.querySelector('.modal'); if (m) { let p = m.querySelector('.err'); if (!p) { p = document.createElement('p'); p.className = 'err'; p.setAttribute('role', 'alert'); m.appendChild(p); } p.textContent = msg; }
  } else toast(msg);
  if (!(e instanceof ApiError)) console.error(e);
}

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
function onInput(ev) {
  const el = ev.target;
  if (el.dataset && el.dataset.call === 'setAccess') { if (ev.type === 'change') runGuarded(() => call('setAccess', { tid: el.dataset.tid, access: el.value })); return; }
  if (!el.dataset || !el.dataset.bind) return;
  setPath(el.dataset.bind, el.type === 'checkbox' ? el.checked : el.value);
  if (el.dataset.bind.indexOf('exam.') === 0 && S.exam) {
    const n = examCount(); const c = document.getElementById('ex-count'); if (c) c.textContent = 'One attempt. ' + n + ' of ' + S.exam.qs.length + ' answered.';
    const b = document.getElementById('ex-submit'); if (b) b.disabled = n < S.exam.qs.length;
  }
  if (el.dataset.rerender && ev.type === 'change') render();
}
document.addEventListener('input', onInput);
document.addEventListener('change', onInput);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.modal) { S.modal = null; render(); } });
window.addEventListener('beforeunload', ev => { if (S.exam || S.draft) { ev.preventDefault(); ev.returnValue = ''; } });

/* ---------- start ---------- */
(async function boot() {
  try { META = await api('GET', '/api/meta'); } catch { /* keep defaults */ }
  if (META.signedIn) { try { await loadData(); go(TABS[ME.role][0][0]); } catch { clearSession(); } }
  render();
})();

