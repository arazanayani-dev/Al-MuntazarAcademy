/* Academic team: syllabus chart, question bank, exam papers, traditions, materials library, teacher training
   and approvals. Maker-checker: the content creator (acmaker) adds and edits; the approver (academic) approves
   or sends back. Nothing is used by teachers or students until it is approved. */
import { S, TODAY, ME } from '../state.js';
import { fd, addDays } from '/shared/dates.js';
import { esc, chip, opts, act, tbl, tx, stmtList, isAr } from '../ui.js';
import { course, lesson, subName, QTYPE, MTYPES, ACCESS, scopes, matScope, sharesOf, invited, trWhen, matHref, approved, statusChip, examSubs, paperCounts, stu, group, levelRank, canNominate, teacherOfPerson, teacherTitle } from '../logic.js';
import { editBtn } from './edit.js';
import { readyChip, readinessDetail } from './shared.js';

const maker = () => ME.role === 'acmaker';
/* status chip, plus the approver's note when an item was sent back */
const status = x => statusChip(x) + (x.status === 'rejected' && x.reviewNote ? '<div class="small warn-t" style="flex-basis:100%">Note from ' + esc(x.reviewedBy || 'the approver') + ': ' + esc(x.reviewNote) + '</div>' : '');
const pendingNote = (n, what) => n ? '<p class="sub small">' + n + ' ' + what + (n === 1 ? ' is' : ' are') + ' waiting for approval' + (maker() ? '.' : '. ' + act('nav', 'review', 'Review now', 'link')) + '</p>' : '';
/* a syllabus that fills a chart column: how many chapters were read, or why none could be */
const chartChip = m => m.chart ? chip('ok', approved(m) ? 'Fills the ' + subName(m.chart.sub) + ' column of the chart' : m.chart.chapters + ' chapters read for the ' + subName(m.chart.sub) + ' column of the chart') : m.chartNote ? '<div class="small warn-t" style="flex-basis:100%">' + esc(m.chartNote) + '</div>' : '';
const chartPlan = m => m.chart ? '<div class="small" style="margin-top:6px"><span class="b">Weekly topics for the ' + esc(course(m.course).name) + ' Semester ' + m.sem + ' chart (' + esc(subName(m.chart.sub)) + ')</span>, used once this syllabus is approved:<ol style="margin:4px 0 0;padding-left:22px">' + m.chart.weeks.map(w => '<li>' + esc(w) + '</li>').join('') + '</ol></div>' : m.chartNote ? '<div class="small warn-t">' + esc(m.chartNote) + '</div>' : '';
/* questions drafted by AI from a syllabus: progress, how many, or why it could not */
const qgenChip = m => {
  const g = m.qgen; if (!g) return '';
  if (g.status === 'queued') return chip('gold', 'Questions: waiting to be drafted');
  if (g.status === 'running') return chip('gold', g.part === 'teacher' ? 'Drafting the teacher readiness quiz…' : 'Drafting questions… ' + (g.done || 0) + ' of ' + (g.total || '?') + ' steps (each chapter, then the teacher quiz)');
  const mine = S.questions.filter(q => q.source === m.id && !q.retired); const tq = mine.filter(q => q.aud === 'teacher');
  const waiting = mine.filter(q => q.status === 'pending').length; const ok = mine.filter(q => approved(q)).length;
  return (g.made ? chip('ok', ok + ' questions approved · ' + waiting + ' waiting' + ' (chapter papers' + (tq.length ? ' and a ' + tq.length + '-question teacher quiz)' : ')')) : '') +
    (approved(m) && m.chart && g.status === 'done' ? act('qgenRetry', m.id + '|teacher', tq.length ? 'Redraft teacher quiz' : 'Draft teacher quiz', 'btn') : '') +
    /* chapter pools drafted before pools were 24: a paper draws 12 at random, so a bigger pool makes retakes a real test */
    (() => { const pools = {}; mine.filter(q => !q.aud && q.chapter && q.status !== 'rejected').forEach(q => { pools[q.chapter] = (pools[q.chapter] || 0) + 1; }); const small = Object.values(pools).filter(n => n < 24).length;
      return approved(m) && m.chart && g.status === 'done' && small ? '<div class="small gold-t" style="flex-basis:100%">' + small + (small === 1 ? ' chapter has' : ' chapters have') + ' fewer than 24 questions. A paper draws 12 at random for each attempt, so a larger pool means a retake is not the same paper. ' + act('qgenRetry', m.id + '|more', 'Draft more questions', 'link') + '</div>' : ''; })() +
    (g.note ? '<div class="small ' + (g.status === 'failed' ? 'warn-t' : 'sub') + '" style="flex-basis:100%">' + esc(g.note) + '</div>' : '');
};
/* an update to an approved material, waiting for approval or sent back */
const updateChip = m => !m.draft ? '' : m.draft.status === 'pending' ? chip('gold', 'Update waiting for approval' + (m.draft.fileId !== m.fileId ? ': new file ' + m.draft.src : '')) : '<div class="small warn-t" style="flex-basis:100%">Update sent back by ' + esc(m.draft.reviewedBy || 'the approver') + ': ' + esc(m.draft.reviewNote || '') + '. The current version is still in use.</div>';
const readOnly = what => '<section class="card side"><h2>Approval</h2><p class="sub small">The academic content creator adds and edits ' + what + '. You approve each one, or send it back with a note, under Approvals.</p>' + act('nav', 'review', 'Open approvals', 'btn primary') + '</section>';

/* The Standard Syllabus Chart: each week's Belief, Islamic Laws and Ethics topic for a course and semester.
   The creator edits it; changes go live once approved. */
export function viewChart() {
  const co = S.p.course || 'BAS'; const k = course(co); const sem = Math.min(+(S.p.sem || 2), k.sems); const key = co + '-' + sem;
  const data = (S.chartData || {})[key]; const draft = (S.chartDrafts || {})[key]; const loaded = S.charts[key] || data;
  const fake = { course: co, sem }; const tag = co === 'INR' ? 'Session' : 'Week';
  const editing = maker() && S.p.edit; const src = editing ? S.form.ch : null;
  const head = '<div class="head"><div><h1>Standard Syllabus Chart</h1><div class="sub">The fixed weekly plan teachers log each session against</div></div>' +
    (maker() && !editing ? '<div class="btns">' + act('chartEdit', key, data || draft ? 'Edit this chart' : 'Fill in this chart', 'btn primary') + '</div>' : '') + '</div>';
  const pick = '<div class="form"><div class="field"><label for="ch-c">Course type</label><select id="ch-c" data-bind="p.course" data-rerender="1"' + (editing ? ' disabled' : '') + '>' + opts(S.courses.map(c => [c.code, c.name]), co) + '</select></div>' +
    '<div class="field"><label for="ch-s">Semester</label><select id="ch-s" data-bind="p.sem" data-rerender="1"' + (editing ? ' disabled' : '') + '>' + opts(Array.from({ length: k.sems }, (_, i) => [i + 1, 'Semester ' + (i + 1)]), sem) + '</select></div></div>';
  const status = draft ? (draft.status === 'pending' ? '<p class="small gold-t">Changes by ' + esc(draft.submittedBy || 'the creator') + ' are waiting for approval' + (maker() ? '.' : '. ' + act('nav', 'review', 'Review now', 'link')) + '</p>' : '<p class="small warn-t">Changes were sent back by ' + esc(draft.reviewedBy || 'the approver') + ': ' + esc(draft.reviewNote || '') + '</p>') : '';
  if (editing) {
    const cell = (sub, i) => '<td><textarea rows="2" style="width:100%;min-width:180px" aria-label="' + tag + ' ' + (i + 1) + ' ' + sub + '" data-bind="form.ch.' + sub + '.' + i + '">' + esc(src[sub][i] || '') + '</textarea></td>';
    return head + '<section class="card">' + pick + '<p class="sub small">Type each ' + tag.toLowerCase() + '\'s topic. Leave a cell empty if the chart does not cover it yet. Saving sends the chart for approval; teachers keep seeing the current chart until then.</p>' +
      tbl([[tag], ['Belief'], ['Islamic Laws'], ['Ethics']], Array.from({ length: k.weeks }, (_, i) => '<tr><th scope="row">' + (i + 1) + '</th>' + cell('b', i) + cell('l', i) + cell('e', i) + '</tr>')) +
      '<div class="btns">' + act('chartSaveNow', key, 'Save and send for approval', 'btn primary') + act('chartEditCancel', '', 'Cancel') + '</div></section>';
  }
  return head + '<section class="card">' + pick + status +
    (loaded ? tbl([[tag], ['Belief'], ['Islamic Laws'], ['Ethics']], Array.from({ length: k.weeks }, (_, i) => { const l = lesson(fake, i + 1); const c = t => /^\[/.test(t) ? '<span class="sub">' + esc(t) + '</span>' : esc(t); return '<tr><th scope="row">' + (i + 1) + '</th><td class="wrapcell">' + c(l.b) + '</td><td class="wrapcell">' + c(l.l) + '</td><td class="wrapcell">' + c(l.e) + '</td></tr>'; })) +
      (data ? '<p class="sub small">' + (data.sources ? Object.entries(data.sources).map(([sub, s]) => esc(subName(sub)) + ': from the syllabus "' + esc(s.title) + '"' + (s.approvedBy ? ', approved by ' + esc(s.approvedBy) : '') + (s.on ? ' on ' + fd(s.on) : '')).join('. ') + '. Approving a new syllabus for a subject updates its column.' : data.note ? esc(data.note) : 'Written by ' + esc(data.by || 'the academic team') + (data.approvedBy ? ', approved by ' + esc(data.approvedBy) : '') + (data.on ? ' on ' + fd(data.on) : '') + '.') + '</p>' : '<p class="sub small">Bracketed entries stand in for topics the chart does not have yet.</p>')
      : '<p class="empty">This chart is not filled in yet.</p>') + '</section>';
}

function qShow(q) {
  if (q.type === 'fill') return '<div class="small">Accepted answers: <span class="c">' + q.answers.map(esc).join(', ') + '</span></div>';
  if (q.type === 'match') return '<ol>' + q.left.map((l, i) => '<li>' + esc(l) + ' <span class="sub">matches</span> <span class="c">' + esc(q.right[i]) + '</span></li>').join('') + '</ol>';
  return (q.type === 'ayah' ? '<div class="ar" lang="ar" dir="rtl">' + esc(q.ar) + '</div>' : '') + stmtList(q) + '<ol type="A">' + q.options.map((o, j) => '<li' + (j === q.correct ? ' class="c"' : '') + '>' + tx(o) + (j === q.correct ? ' (correct)' : '') + '</li>').join('') + '</ol>';
}
function qFields(t, q) {
  const v = x => esc(x == null ? '' : x); let s = ''; const choice = t === 'single' || t === 'ayah' || t === 'combo';
  if (t === 'ayah') s += '<div class="field"><label for="qa-ar">Ayat in Arabic</label><textarea id="qa-ar" name="ar" rows="2" dir="rtl" lang="ar" class="ar" required>' + v(q && q.ar) + '</textarea></div>';
  const lab = t === 'ayah' ? 'Instruction' : t === 'fill' ? 'Sentence, with ____ where the blank goes' : t === 'match' ? 'Instruction' : 'Question';
  const def = t === 'ayah' ? 'Select the translation of this ayat.' : t === 'match' ? 'Match each term to its meaning.' : '';
  s += '<div class="field"><label for="qa-t">' + lab + '</label><textarea id="qa-t" name="text" rows="' + (t === 'single' ? 3 : 2) + '"' + (q && isAr(q.text) ? ' dir="auto"' : '') + ' required>' + v(q ? q.text : def) + '</textarea></div>';
  if (choice) {
    s += ['A', 'B', 'C', 'D'].map((L, i) => '<div class="field"><label for="qa-o' + i + '">' + (t === 'ayah' ? 'Translation ' : 'Option ') + L + '</label><input id="qa-o' + i + '" name="o' + i + '" value="' + v(q && q.options[i]) + '" required></div>').join('') +
      '<div class="field"><label for="qa-c">Correct answer</label><select id="qa-c" name="correct">' + opts([[0, 'A'], [1, 'B'], [2, 'C'], [3, 'D']], q ? q.correct : 0) + '</select></div>';
  }
  if (t === 'fill') s += '<div class="field"><label for="qa-a">Accepted answers, separated by commas</label><input id="qa-a" name="answers" value="' + v(q && q.answers.join(', ')) + '" required></div><p class="sub small">Capitals, spaces and apostrophes are ignored when marking, so Maad and Ma\'ad count as the same answer.</p>';
  if (t === 'match') s += [0, 1, 2, 3].map(i => '<div class="form"><div class="field"><label for="qa-l' + i + '">Left ' + (i + 1) + '</label><input id="qa-l' + i + '" name="l' + i + '" value="' + v(q && q.left[i]) + '"' + (i < 2 ? ' required' : '') + '></div><div class="field"><label for="qa-r' + i + '">Its match</label><input id="qa-r' + i + '" name="r' + i + '" value="' + v(q && q.right[i]) + '"' + (i < 2 ? ' required' : '') + '></div></div>').join('') + '<p class="sub small">Enter each pair side by side. Students see the right-hand column shuffled.</p>';
  return s;
}
export function viewBank() {
  const f = S.form.qb || (S.form.qb = { course: 'BAS', sem: 2, sub: 'b', type: 'single', edit: null });
  const k = course(f.course); if (+f.sem > k.sems) f.sem = 1;
  const list = S.questions.filter(q => q.course === f.course && q.sem === +f.sem && q.sub === f.sub);
  const ed = maker() && f.edit ? list.find(q => q.id === f.edit) : null; if (!ed) f.edit = null;
  const t = ed ? ed.type : f.type || 'single';
  /* teacher readiness quiz questions are listed here too, so they can be edited, but never go into student papers */
  const live = list.filter(q => !q.retired && !q.aud && approved(q)).length; const waiting = list.filter(q => q.status === 'pending').length;
  return '<div class="head"><div><h1>Question bank</h1><div class="sub">Questions of several types, all marked automatically, stored by course type, semester and subject</div></div>' +
    (maker() ? '<div class="btns">' + act('importOpen', '', 'Import a question paper') + '</div>' : '') + '</div>' +
    '<div class="cols"><section class="card main"><div class="form">' +
      '<div class="field"><label for="qb-c">Course type</label><select id="qb-c" data-bind="form.qb.course" data-rerender="1">' + opts(S.courses.map(c => [c.code, c.name]), f.course) + '</select></div>' +
      '<div class="field"><label for="qb-s">Semester</label><select id="qb-s" data-bind="form.qb.sem" data-rerender="1">' + opts(Array.from({ length: k.sems }, (_, i) => [i + 1, 'Semester ' + (i + 1)]), f.sem) + '</select></div>' +
      '<div class="field"><label for="qb-u">Subject</label><select id="qb-u" data-bind="form.qb.sub" data-rerender="1">' + opts(S.subjects.filter(s => s.exam).map(s => [s.key, s.name]), f.sub) + '</select></div></div>' +
      '<div class="card-h"><h2>' + live + ' approved questions</h2></div>' + pendingNote(waiting, waiting === 1 ? 'question' : 'questions') + '<div>' +
      (list.map((q, i) => '<div class="qa"><div class="b">' + (i + 1) + '. ' + tx(q.text) + '</div><div class="btns">' + chip('mute', QTYPE[q.type]) + (q.chapter ? chip('mute', 'Chapter ' + q.chapter + ' paper') : '') + (q.aud === 'teacher' ? chip('gold', 'Teacher readiness quiz' + (q.basis === 'guide' ? ' · from the teacher\'s guide' : '')) : '') + (q.ai ? chip('mute', 'Drafted by AI') : '') + (q.retired ? chip('warn', 'Retired') : '') + status(q) + (ed && ed.id === q.id ? chip('gold', 'Editing') : '') + '</div>' + qShow(q) +
        (q.retired || !maker() ? '' : '<div class="btns">' + act('qEdit', q.id, 'Edit', 'link') + act('qRetire', q.id, 'Retire', 'link') + '</div>') + '</div>').join('') || '<p class="empty">No questions here yet.' + (maker() ? ' Add the first one with Quick add.' : '') + '</p>') + '</div></section>' +
    (maker() ? '<section class="card side" id="q-form"><h2>' + (ed ? 'Edit question' : 'Quick add') + '</h2><p class="sub small">' + (ed ? 'Saving sends the question for approval again. Until it is approved it is not used in exams.' : 'Saves to ' + esc(k.name) + ', Semester ' + f.sem + ', ' + esc(subName(f.sub)) + ' and sends it for approval. The form stays open for the next question.') + '</p>' +
      '<div class="field"><label for="qa-type">Question type</label><select id="qa-type" data-bind="form.qb.type" data-rerender="1"' + (ed ? ' disabled' : '') + '>' + opts(Object.keys(QTYPE).filter(x => x !== 'bank' && (x !== 'combo' || t === 'combo')).map(x => [x, QTYPE[x]]), t) + '</select></div>' +
      '<form data-form="qAdd" style="display:flex;flex-direction:column;gap:12px">' + qFields(t, ed) +
      '<div class="btns"><button class="btn primary" type="submit">' + (ed ? 'Save and send for approval' : 'Save and add another') + '</button>' + (ed ? act('qEditCancel', '', 'Cancel') : '') + '</div></form></section>'
      : readOnly('questions')) + '</div>';
}

/* Exam papers: which course-semester-subject papers have approved questions. Each class's teacher or location
   responsible opens its own exam window for the days it sits the exams. */
export function viewExams() {
  const rows = []; S.courses.forEach(k => { for (let sem = 1; sem <= k.sems; sem++) rows.push({ k, sem, p: paperCounts(k.code, sem) }); });
  const waiting = (co, sem, sub) => S.questions.filter(q => q.status === 'pending' && !q.retired && !q.aud && q.course === co && q.sem === sem && q.sub === sub).length;
  return '<div class="head"><div><h1>Exam papers</h1><div class="sub">Each paper is drawn from the approved questions of its course type, semester and subject</div></div></div>' +
    '<section class="card"><p class="sub small">Exam windows are not set here: each class\'s teacher or location responsible opens the exams for the days that class sits them. A paper can only be opened once it has approved questions.</p>' +
      tbl([['Course and semester']].concat(examSubs().map(s => [esc(s.name), 1])).concat([['Paper']]), rows.map(r => {
        const ready = r.p.every(x => x.n);
        return '<tr><th scope="row">' + esc(r.k.name) + ' · Semester ' + r.sem + '</th>' + r.p.map(x => { const w = waiting(r.k.code, r.sem, x.s.key); return '<td class="r">' + x.n + (w ? ' <span class="small gold-t">+' + w + ' waiting</span>' : '') + '</td>'; }).join('') +
          '<td>' + (ready ? chip('ok', 'Ready') : r.p.some(x => x.n) ? chip('gold', 'Incomplete') : chip('mute', 'No questions')) + '</td></tr>';
      })) + '</section>';
}

export function viewTraditions() {
  const waiting = S.traditions.filter(t => t.status === 'pending').length;
  return '<div class="head"><div><h1>Traditions library</h1><div class="sub">One approved tradition goes into each absence reminder, in rotation</div></div></div>' +
    '<div class="cols"><section class="card main"><h2>' + S.traditions.filter(approved).length + ' approved in the library</h2>' + pendingNote(waiting, waiting === 1 ? 'tradition' : 'traditions') + '<div class="rows">' +
      S.traditions.map(t => '<div class="row"><div><div' + (isAr(t.text) ? ' class="ar" lang="ar" dir="rtl"' : '') + '>' + esc(t.text) + '</div><div class="sub small">' + esc(t.source) + '</div>' + (t.status ? '<div class="btns" style="margin-top:4px">' + status(t) + '</div>' : '') + '</div>' + (maker() ? editBtn('trad', t.id) : '') + '</div>').join('') + '</div></section>' +
    (maker() ? '<section class="card side"><h2>Add a tradition</h2><p class="sub small">It is used in reminders once approved.</p><form data-form="tradAdd" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="tr-t">Text</label><textarea id="tr-t" name="text" rows="4" dir="auto" required></textarea></div>' +
      '<div class="field"><label for="tr-s">Source</label><input id="tr-s" name="source" required></div>' +
      '<button class="btn primary" type="submit">Add and send for approval</button></form></section>' : readOnly('traditions')) + '</div>';
}

export function viewMaterials() {
  const f = S.form.mf || (S.form.mf = { course: '', share: '', type: '' });
  const list = S.materials.filter(m => (!f.course || m.course === f.course) && (!f.share || String(m.share) === f.share) && (!f.type || m.type === f.type));
  const waiting = S.materials.filter(m => m.status === 'pending' || (m.draft && m.draft.status === 'pending')).length; const checker = !maker();
  return '<div class="head"><div><h1>Teaching materials</h1><div class="sub">One library for syllabus documents, books for students to read, teacher guides, slides and other material</div></div></div>' +
    '<div class="cols"><section class="card main"><div class="form">' +
      '<div class="field"><label for="mf-c">Course type</label><select id="mf-c" data-bind="form.mf.course" data-rerender="1">' + opts([['', 'All'], ['ALL', 'General (all courses)']].concat(S.courses.map(c => [c.code, c.name])), f.course) + '</select></div>' +
      '<div class="field"><label for="mf-y">Type</label><select id="mf-y" data-bind="form.mf.type" data-rerender="1">' + opts([['', 'All types']].concat(MTYPES.map(x => [x, x])), f.type) + '</select></div>' +
      '<div class="field"><label for="mf-s">Who can see it</label><select id="mf-s" data-bind="form.mf.share" data-rerender="1">' + opts([['', 'Any'], ['false', 'Teachers only'], ['true', 'Shareable with students']], f.share) + '</select></div></div>' +
      pendingNote(waiting, 'item' + (waiting === 1 ? '' : 's')) +
      '<div class="rows">' + (list.map(m => {
        const sh = sharesOf(m.id); const href = matHref(m);
        return '<div class="row"><div><div class="b">' + esc(m.title) + '</div><div class="sub small">' + esc(matScope(m)) + ' · ' + esc(m.src) + ' · added ' + fd(m.date) + '</div><div class="btns" style="margin-top:6px">' + chip('mute', m.type) + (m.share ? chip('ok', 'Shareable with students') : chip('gold', 'Teachers only')) + (sh.length ? chip('mute', 'Shared with ' + sh.length + (sh.length === 1 ? ' class' : ' classes')) : '') + status(m) + chartChip(m) + updateChip(m) + qgenChip(m) + '</div></div><div class="btns">' + editBtn('mat', m.id) + (m.type === 'Syllabus' && m.fileId && m.course !== 'ALL' && m.sub !== 'all' && (!m.qgen || /done|failed/.test(m.qgen.status)) ? act('qgenRetry', m.id, m.qgen ? 'Draft questions again' : 'Draft questions') : '') + (href ? act('readOpen', m.id, 'Read') : '') + '</div></div>';
      }).join('') || '<p class="empty">No material matches these filters.</p>') + '</div></section>' +
    '<div class="side">' + (maker() ? '<section class="card"><h2>Add material</h2><p class="sub small">Teachers see it once it is approved. A <span class="b">Syllabus</span> for one course, semester and subject, uploaded as a PDF or Word file, also fills that subject\'s weekly topics in the Standard Syllabus Chart when it is approved.</p><form data-form="matAdd" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="ma-t">Title</label><input id="ma-t" name="title" required></div>' +
      '<div class="field"><label for="ma-y">Type</label><select id="ma-y" name="type">' + opts(MTYPES.map(x => [x, x]), 'Syllabus') + '</select></div>' +
      '<div class="form"><div class="field"><label for="ma-c">Course type</label><select id="ma-c" name="course">' + opts([['ALL', 'All courses']].concat(S.courses.map(c => [c.code, c.name])), 'BAS') + '</select></div>' +
      '<div class="field"><label for="ma-s">Semester</label><select id="ma-s" name="sem">' + opts([[0, 'All']].concat([1, 2, 3, 4, 5].map(i => [i, 'Semester ' + i])), 2) + '</select></div></div>' +
      '<div class="form"><div class="field"><label for="ma-u">Subject</label><select id="ma-u" name="sub">' + opts([['all', 'All']].concat(S.subjects.filter(s => s.exam).map(s => [s.key, s.name])), 'b') + '</select></div>' +
      '<div class="field"><label for="ma-w">Session (optional)</label><input id="ma-w" name="week" type="number" min="1" max="60"></div></div>' +
      '<div class="field"><label for="ma-pg">Pages (books only)</label><input id="ma-pg" name="pages" type="number" min="1" inputmode="numeric"></div>' +
      '<div class="field"><label for="ma-v">Who can see it</label><select id="ma-v" name="share">' + opts([['true', 'Teachers, and shareable with students'], ['false', 'Teachers only']], 'true') + '</select></div>' +
      '<div class="field"><label for="ma-f">Upload a file</label><input id="ma-f" name="file" type="file"></div>' +
      '<div class="field"><label for="ma-l">Or paste a link</label><input id="ma-l" name="link" type="url" placeholder="Google Drive or YouTube link"></div>' +
      '<button class="btn primary" type="submit">Add and send for approval</button></form></section>' : '') +
    '<section class="card"><h2>Weekly reading targets</h2><p class="sub small">What each student is expected to log every week. Changes apply from the next week.' + (checker ? '' : ' Set by the academic approver.') + '</p>' +
      (checker ? '<form class="form" data-form="setTargets"><div class="field"><label for="tg-a">Ayat a week</label><input id="tg-a" name="ayat" type="number" min="0" inputmode="numeric" value="' + esc(S.targets.ayat) + '"></div>' +
        '<div class="field"><label for="tg-p">Pages a week</label><input id="tg-p" name="pages" type="number" min="0" inputmode="numeric" value="' + esc(S.targets.pages) + '"></div><button class="btn" type="submit">Save targets</button></form>'
        : '<div class="b">' + esc(S.targets.ayat) + ' ayat and ' + esc(S.targets.pages) + ' pages a week</div>') + '</section>' +
    '<section class="card"><h2>Teacher access levels</h2><p class="sub small">Own classes: material for the courses and semesters they teach. Course type: every semester of those courses. All material: the whole library.' + (checker ? '' : ' Set by the academic approver.') + '</p>' +
      tbl([['Teacher'], ['Classes'], ['Access']], S.teachers.map(t => '<tr><th scope="row">' + esc(teacherTitle(t)) + '</th><td>' + (scopes(t.id).map(s => s.cid).join(', ') || 'None yet') + '</td><td>' + (checker ? '<label class="sr" for="acc-' + t.id + '">Access for ' + esc(teacherTitle(t)) + '</label><select id="acc-' + t.id + '" class="inline-select" data-call="setAccess" data-tid="' + t.id + '">' + opts(Object.keys(ACCESS).map(k => [k, ACCESS[k]]), t.access) + '</select>' : esc(ACCESS[t.access])) + '</td></tr>')) + '</section></div></div>';
}

export function viewTraining() {
  const up = S.trainings.filter(t => t.date >= TODAY).sort((a, b) => a.date < b.date ? -1 : 1); const past = S.trainings.filter(t => t.date < TODAY);
  const row = tr => {
    const inv = S.teachers.filter(t => invited(t.id, tr)); const yes = inv.filter(t => tr.rsvp[t.id] === 'yes').length; const no = inv.filter(t => tr.rsvp[t.id] === 'no').length;
    return '<div class="row"><div><div class="b">' + esc(tr.title) + '</div><div class="sub small">' + trWhen(tr) + ' · ' + esc(tr.mode) + ' · ' + esc(tr.facilitator) + '</div><div class="btns" style="margin-top:6px">' + chip('mute', tr.kind) + (tr.req ? chip('gold', 'Required') : chip('mute', 'Optional')) + chip('mute', tr.course === 'ALL' ? 'All teachers' : course(tr.course).name + ' · Semester ' + tr.sem) + status(tr) + '</div>' +
      '<div class="small" style="margin-top:6px">' + (!approved(tr) ? inv.length + ' teachers will be invited once it is approved' : tr.attended ? 'Attended: ' + Object.values(tr.attended).filter(Boolean).length + ' of ' + inv.length : inv.length + ' invited · ' + yes + ' attending · ' + no + ' not attending · ' + (inv.length - yes - no) + ' not replied') + '</div></div>' + (maker() ? editBtn('train', tr.id) : '') + '</div>';
  };
  return '<div class="head"><div><h1>Teacher training</h1><div class="sub">Programmes and refreshers, with invitations, replies and attendance</div></div></div>' +
    '<div class="cols"><div class="main"><section class="card"><h2>Coming up</h2><div class="rows">' + (up.map(row).join('') || '<p class="empty">Nothing scheduled.</p>') + '</div></section>' +
      '<section class="card"><h2>Held</h2><div class="rows">' + (past.map(row).join('') || '<p class="empty">Nothing held yet.</p>') + '</div></section>' +
      '<p class="sub small">Refreshers go to teachers whose classes are on that semester or the one before it.</p></div>' +
    (maker() ? '<section class="card side"><h2>Schedule training</h2><p class="sub small">Teachers are invited once it is approved.</p><form data-form="trainAdd" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="tr-ti">Title</label><input id="tr-ti" name="title" required></div>' +
      '<div class="field"><label for="tr-k">Kind</label><select id="tr-k" name="kind">' + opts([['Programme', 'Training programme'], ['Refresher', 'Refresher on a topic']], 'Programme') + '</select></div>' +
      '<div class="form"><div class="field"><label for="tr-c">For teachers of</label><select id="tr-c" name="course">' + opts([['ALL', 'All teachers']].concat(S.courses.map(c => [c.code, c.name])), 'ALL') + '</select></div>' +
      '<div class="field"><label for="tr-s">Semester</label><select id="tr-s" name="sem">' + opts([[0, 'All']].concat([1, 2, 3, 4, 5].map(i => [i, 'Semester ' + i])), 0) + '</select></div></div>' +
      '<div class="form"><div class="field"><label for="tr-d">Date</label><input id="tr-d" name="date" type="date" value="' + addDays(TODAY, 14) + '" required></div>' +
      '<div class="field"><label for="tr-tm">Time (India)</label><input id="tr-tm" name="time" type="time" value="11:00" required></div></div>' +
      '<div class="field"><label for="tr-f">Facilitator</label><input id="tr-f" name="facilitator" list="tr-fl" value="' + esc((S.trainers || [])[0] || '') + '" placeholder="Teacher training faculty"><datalist id="tr-fl">' + (S.trainers || []).map(n => '<option value="' + esc(n) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label for="tr-m">Meet link or venue</label><input id="tr-m" name="mode" placeholder="Paste the Google Meet link"></div>' +
      '<label class="check"><input type="checkbox" name="req" id="tr-r">Attendance is required</label>' +
      '<button class="btn primary" type="submit">Schedule and send for approval</button></form></section>' : readOnly('trainings')) + '</div>';
}

/* The approver's queue: everything the content creator has submitted and not yet had approved. */
export function viewReview() {
  const by = x => '<div class="sub small">Submitted by ' + esc(x.submittedBy || 'the creator') + (x.submittedOn ? ' on ' + fd(x.submittedOn) : '') + '</div>';
  const btns = (kind, x) => '<div class="btns">' + (x.submittedById === ME.id ? chip('mute', 'You submitted this') : act('approve', kind + '|' + x.id, 'Approve', 'btn primary') + act('sendBackOpen', kind + '|' + x.id + '|' + (x.submittedBy || ''), 'Send back')) + '</div>';
  const pend = l => l.filter(x => x.status === 'pending');
  const qs = pend(S.questions), ms = S.materials.filter(m => m.status === 'pending' || (m.draft && m.draft.status === 'pending')), ts = pend(S.trainings), hs = pend(S.traditions), ps = pend(S.promotions || []);
  const cs = Object.entries(S.chartDrafts || {}).filter(([, d]) => d.status === 'pending');
  const back = ['questions', 'materials', 'trainings', 'traditions', 'promotions'].reduce((t, k) => t + (S[k] || []).filter(x => x.status === 'rejected').length, 0);
  const section = (title, list, html) => '<section class="card"><div class="card-h"><h2>' + title + '</h2>' + chip(list.length ? 'gold' : 'mute', list.length + ' waiting') + '</div>' + (list.length ? '<div class="rows">' + list.map(html).join('') + '</div>' : '<p class="empty">Nothing waiting.</p>') + '</section>';
  return '<div class="head"><div><h1>Approvals</h1><div class="sub">Content from the academic content creator. Approved items are used straight away; sent-back items return to the creator with your note.</div></div></div>' +
    (back ? '<p class="sub small">' + back + (back === 1 ? ' item is' : ' items are') + ' back with the creator for changes.</p>' : '') +
    questionGroups(qs, by, btns) +
    section('Materials', ms, m => {
      const up = m.draft && m.draft.status === 'pending'; const v = up ? Object.assign({}, m, m.draft) : m; const href = matHref(v);
      const changes = up ? ['title', 'type', 'course', 'sem', 'sub', 'week', 'pages', 'share'].filter(k => String(m[k] ?? '') !== String(m.draft[k] ?? '')).length + (m.draft.fileId !== m.fileId ? 1 : 0) : 0;
      return '<div class="row"><div><div class="b">' + esc(v.title) + (up ? ' ' + chip('gold', 'Update to an approved item') : '') + '</div><div class="sub small">' + esc(v.type) + ' · ' + esc(matScope(v)) + ' · ' + (v.share ? 'shareable with students' : 'teachers only') + '</div>' +
        (up ? '<div class="small">' + (m.draft.fileId !== m.fileId ? 'New file: <span class="b">' + esc(m.draft.src) + '</span> (replaces ' + esc(m.src) + '). ' : '') + (changes ? changes + (changes === 1 ? ' change' : ' changes') + '. ' : 'No changes. ') + 'The current version stays in use until you approve.</div>' : '') +
        chartPlan(v) + by(up ? m.draft : m) + '</div><div class="btns">' + (href ? act('readOpen', m.id + (up ? '|draft' : ''), up ? 'Read new version' : 'Read') : '') + btns('mat', up ? Object.assign({}, m.draft, { id: m.id }) : m) + '</div></div>';
    }) +
    section('Trainings', ts, tr => '<div class="row"><div><div class="b">' + esc(tr.title) + '</div><div class="sub small">' + trWhen(tr) + ' · ' + esc(tr.kind) + ' · ' + (tr.course === 'ALL' ? 'all teachers' : esc(course(tr.course).name) + (tr.sem ? ' · Semester ' + tr.sem : '')) + (tr.req ? ' · required' : '') + '</div>' + by(tr) + '</div>' + btns('train', tr) + '</div>') +
    section('Traditions', hs, h => '<div class="row"><div><div' + (isAr(h.text) ? ' class="ar" lang="ar" dir="rtl"' : '') + '>' + esc(h.text) + '</div><div class="sub small">' + esc(h.source) + '</div>' + by(h) + '</div>' + btns('trad', h) + '</div>') +
    section('Syllabus charts', cs, ([key, d]) => { const [co, sem] = key.split('-'); const k = course(co); const weeks = Array.from({ length: k.weeks }, (_, i) => i).filter(i => d.b[i] || d.l[i] || d.e[i]);
      return '<div class="qa"><div class="b">' + esc(k.name) + ' · Semester ' + sem + '</div>' + tbl([[co === 'INR' ? 'Session' : 'Week'], ['Belief'], ['Islamic Laws'], ['Ethics']], weeks.map(i => '<tr><th scope="row">' + (i + 1) + '</th><td class="wrapcell">' + esc(d.b[i] || '') + '</td><td class="wrapcell">' + esc(d.l[i] || '') + '</td><td class="wrapcell">' + esc(d.e[i] || '') + '</td></tr>')) + by(d) + btns('chart', Object.assign({ id: key }, d)) + '</div>'; }) +
    section('Teaching levels', ps, p => { const s = stu(p.sid); return '<div class="row"><div><div class="b">' + esc(p.name) + ' to teach up to ' + esc(course(p.level).name) + (p.exception ? ' ' + chip('warn', 'Exception to the rule') : '') + '</div><div class="sub small">' + (p.from ? 'Teaches up to ' + esc(course(p.from).name) + ' now' : 'Not a teacher yet') + (s ? ' · ' + group(s.g) + (s.classId ? ' · studying in ' + esc(s.classId) : '') : '') + '</div>' + (p.exception ? '<div class="small warn-t">Not eligible under the rule. Reason given: ' + esc(p.reason || '') + '</div>' : '') + by(p) + '</div>' + btns('promo', p) + '</div>'; });
}

/* Questions waiting for approval. Questions drafted from a syllabus are grouped as one paper per chapter (or
   per syllabus for subjects without chapter papers), approved or sent back together or one by one. */
function questionGroups(qs, by, btns) {
  const groups = new Map();
  qs.forEach(q => { const k = q.source ? q.source + '|' + (q.chapter || q.chapterTitle || '') : 'single'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(q); });
  const one = q => '<div class="qa"><div class="b">' + esc(course(q.course).name) + ' · Semester ' + q.sem + ' · ' + esc(subName(q.sub)) + ' · ' + QTYPE[q.type] + (q.basis === 'guide' ? ' ' + chip('gold', 'From the teacher\'s guide') : '') + '</div><div>' + tx(q.text) + '</div>' + qShow(q) +
    /* what the question tests, and the passage that settles its answer (checked to be in the text) */
    (q.evidence ? '<div class="small sub" style="border-left:3px solid var(--line);padding-left:8px">' + (q.point ? 'Tests: <span class="b">' + esc(q.point) + '</span><br>' : '') + 'From the ' + (q.basis === 'guide' ? 'teacher\'s guide' : 'syllabus') + ': “' + esc(q.evidence) + '”</div>' : '') + (q.source ? '' : by(q)) + btns('q', q) + '</div>';
  const body = [...groups.entries()].map(([k, list]) => {
    if (k === 'single') return list.map(one).join('');
    const q0 = list[0]; const m = S.materials.find(x => x.id === q0.source); const ids = list.map(q => q.id).join(',');
    const mine = q0.submittedById === ME.id;
    return '<div class="qa" style="background:var(--bg);padding:10px 12px;border-radius:8px"><div class="card-h"><div><div class="b">' + (q0.aud === 'teacher' ? 'Teacher readiness quiz (for teachers, not students)' : (q0.chapter ? 'Chapter ' + q0.chapter + ' paper' : 'Questions') + (q0.chapterTitle ? ': ' + esc(q0.chapterTitle) : '')) + '</div>' +
      '<div class="sub small">' + esc(course(q0.course).name) + ' · Semester ' + q0.sem + ' · ' + esc(subName(q0.sub)) + ' · ' + list.length + ' questions' + (q0.ai ? ' drafted by AI' : '') + (m ? ' from "' + esc(m.title) + '"' : '') + '. Check each against the syllabus before approving.</div></div>' +
      '<div class="btns">' + (mine ? chip('mute', 'You submitted this') : act('approveMany', ids, 'Approve whole paper', 'btn primary') + act('sendBackManyOpen', ids, 'Send back whole paper')) + '</div></div></div>' + list.map(one).join('');
  }).join('');
  return '<section class="card"><div class="card-h"><h2>Questions</h2>' + chip(qs.length ? 'gold' : 'mute', qs.length + ' waiting') + '</div>' + (qs.length ? body : '<p class="empty">Nothing waiting.</p>') + '</section>';
}

/* Syllabus readiness of every teacher with a running class: read in the app, then the readiness quiz passed. */
function readinessTable() {
  const list = (S.readiness || []).slice().sort((a, b) => (a.ready - b.ready) || a.teacher.localeCompare(b.teacher)); if (!list.length) return '';
  return '<section class="card"><div class="card-h"><h2>Syllabus readiness</h2>' + chip(list.every(r => r.ready) ? 'ok' : 'warn', list.filter(r => r.ready).length + ' of ' + list.length + ' ready') + '</div>' +
    '<p class="sub small">Each teacher reads the syllabus of their classes in the app and passes its readiness quiz (80%) before teaching it. A teacher given a class later is added automatically.</p>' +
    tbl([['Teacher'], ['Syllabus'], ['Classes'], ['Progress'], ['']], list.map(r => '<tr><th scope="row">' + esc(r.teacher) + '</th><td>' + esc(r.title) + ' <span class="sub small">' + esc(matScope(r)) + '</span></td><td>' + esc(r.cids.join(', ')) + '</td><td class="wrapcell small">' + readinessDetail(r) + (r.quizReady ? '' : ' · <span class="warn-t">no approved quiz yet</span>') + (r.guide ? '' : ' · <span class="gold-t">no teacher\'s guide uploaded yet</span>') + '</td><td>' + readyChip(r) + '</td></tr>')) + '</section>';
}

/* Teaching levels: every teacher is a person (student record) promoted to teach up to a level. The content
   creator nominates a student of a higher level, or someone who has passed all of that level; the approver
   approves it. A teacher already listed is promoted from their own row. */
export function viewTeachingLevels() {
  const f = S.form.tl || (S.form.tl = { level: '', q: '', to: {} });
  const people = S.students; const teachers = S.teachers.slice().sort((a, b) => a.name.localeCompare(b.name));
  const promos = S.promotions || []; const waiting = promos.filter(p => p.status === 'pending'); const back = promos.filter(p => p.status === 'rejected');
  const canAt = (s, code) => { const t = teacherOfPerson(s.id); return !(t && levelRank(t.level) >= levelRank(code)) && !waiting.some(p => p.sid === s.id) && !s.left && canNominate(s, code); };
  /* opens on the first level someone can actually be nominated for */
  if (!f.level) f.level = (S.courses.find(c => people.some(s => canAt(s, c.code))) || S.courses[0] || {}).code;
  const k = course(f.level); const q = (f.q || '').trim().toLowerCase();
  const eligible = maker() ? people.filter(s => canAt(s, k.code) && (!q || s.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name)) : [];
  /* a teacher's own row: the higher levels they can be promoted to now, or why there are none */
  const promote = t => {
    if (!t.sid) return '<span class="small warn-t">Link to a student first (Master lists)</span>';
    if (waiting.some(p => p.sid === t.sid)) return chip('gold', 'Waiting for approval');
    const s = stu(t.sid); const above = S.courses.filter(c => levelRank(c.code) > levelRank(t.level));
    if (!above.length) return '<span class="sub small">Highest level</span>';
    const can = s ? above.filter(c => canAt(s, c.code)) : [];
    /* levels beyond what the rule allows can be requested as an exception */
    const exc = s && can.length < above.length ? act('excOpen', t.sid, 'Request exception', can.length ? 'link' : 'btn') : '';
    if (!can.length) return '<div class="sub small">To teach ' + esc(above[0].name) + ': must study a higher level, or pass all of ' + esc(above[0].name) + '</div>' + exc;
    f.to = f.to || {}; if (!can.some(c => c.code === f.to[t.id])) f.to[t.id] = can[can.length - 1].code;
    return '<div class="btns" style="align-items:center"><select aria-label="Promote ' + esc(teacherTitle(t)) + ' to" data-bind="form.tl.to.' + esc(t.id) + '">' + opts(can.map(c => [c.code, c.name]), f.to[t.id]) + '</select>' + act('nominateTeacher', t.id, 'Promote', 'btn primary') + exc + '</div>';
  };
  const byException = t => t.exception && t.exception.level === t.level ? ' ' + chip('gold', 'By exception') + '<div class="sub small">' + esc(t.exception.reason) + ' · approved by ' + esc(t.exception.approvedBy) + ' on ' + fd(t.exception.on) + '</div>' : '';
  const live = c => S.classes.filter(x => x.teacherId === c.id && x.status !== 'completed' && x.status !== 'closed').map(x => x.id).join(', ') || 'None yet';
  return '<div class="head"><div><h1>Teaching levels</h1><div class="sub">This is where teachers are added. Every teacher is a student first: a student of one level can be promoted to teach the levels below it. Only people promoted to a level, or higher, are offered when a class at that level needs a teacher.</div></div></div>' +
    '<div class="cols"><div class="main">' +
      (waiting.length ? '<section class="card"><div class="card-h"><h2>Waiting for approval</h2>' + chip('gold', waiting.length + ' waiting') + '</div><div class="rows">' + waiting.map(p => '<div class="row"><div><div class="b">' + esc(p.name) + ' to teach up to ' + esc(course(p.level).name) + (p.exception ? ' ' + chip('gold', 'Exception') : '') + '</div><div class="sub small">Nominated by ' + esc(p.submittedBy || '') + (p.submittedOn ? ' on ' + fd(p.submittedOn) : '') + (p.reason ? ' · ' + esc(p.reason) : '') + '</div></div>' + (maker() ? '' : act('nav', 'review', 'Review', 'btn')) + '</div>').join('') + '</div></section>' : '') +
      (back.length ? '<section class="card"><h2>Sent back</h2><div class="rows">' + back.map(p => '<div class="row"><div><div class="b">' + esc(p.name) + ' to teach up to ' + esc(course(p.level).name) + '</div><div class="small warn-t">Note from ' + esc(p.reviewedBy || 'the approver') + ': ' + esc(p.reviewNote || '') + '</div></div></div>').join('') + '</div></section>' : '') +
      '<section class="card"><h2>' + teachers.filter(t => t.level).length + ' teachers</h2>' +
        (maker() ? '<p class="sub small">To raise a teacher\'s highest level, choose it in their row and click Promote. It takes effect once the approver approves it.</p>' : ME.roles.includes('acmaker') ? '<p class="small gold-t">You are on the approver\'s page. ' + act('nav', 'acmaker:teachers', 'Promote teachers as content creator', 'link') + '</p>' : '<p class="sub small">The academic content creator promotes teachers; you approve it under Approvals.</p>') +
        tbl([['Teacher'], ['Group'], ['Can teach up to'], ['Classes now']].concat(maker() ? [['Promote to']] : []), teachers.map(t =>'<tr><th scope="row">' + esc(teacherTitle(t)) + (t.sid ? '' : ' ' + chip('warn', 'Not linked to a student')) + '</th><td>' + group(t.g) + '</td><td>' + (t.level ? esc(course(t.level).name) + (t.since && t.since[t.level] ? ' <span class="sub small">since ' + fd(t.since[t.level]) + '</span>' : '') + byException(t) : chip('warn', 'No level yet')) + '</td><td>' + esc(live(t)) + '</td>' + (maker() ? '<td>' + promote(t) + '</td>' : '') + '</tr>')) + '</section>' + readinessTable() + '</div>' +
    (maker() ? '<section class="card side"><h2>Nominate for a level</h2><p class="sub small">Students of a higher level than the one chosen, and anyone who has passed every semester of it, who do not yet teach at that level or higher. The nomination takes effect once the approver approves it.</p>' +
      '<div class="form"><div class="field"><label for="tl-l">Level</label><select id="tl-l" data-bind="form.tl.level" data-rerender="1">' + opts(S.courses.map(c => [c.code, c.name]), f.level) + '</select></div>' +
      '<div class="field"><label for="tl-q">Search</label><input id="tl-q" type="search" data-bind="form.tl.q" data-rerender="1" value="' + esc(f.q) + '" placeholder="Name"></div></div>' +
      '<div class="rows">' + (eligible.slice(0, 50).map(s => { const t = teacherOfPerson(s.id); return '<div class="row"><div><div class="b">' + esc(s.name) + '</div><div class="sub small">' + group(s.g) + (t && t.level ? ' · teaches up to ' + esc(course(t.level).name) : '') + (s.classId ? ' · ' + esc(s.classId) : '') + '</div></div>' + act('nominate', s.id + '|' + k.code, 'Nominate') + '</div>'; }).join('') || '<p class="empty">Nobody is eligible to teach ' + esc(k.name) + (q ? ' with that name' : ' yet: no student of a higher level, and nobody has passed all of it') + '.</p>') + '</div>' +
      '<p class="sub small" style="margin-top:8px">Someone not listed? ' + act('excOpen', '', 'Request an exception', 'link') + '</p></section>'
      : readOnly('teaching-level nominations')) + '</div>';
}
