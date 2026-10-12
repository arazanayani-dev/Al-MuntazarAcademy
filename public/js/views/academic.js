/* Academic team: syllabus chart, question bank, exams, traditions, materials library and teacher training. */
import { S, TODAY, ME } from '../state.js';
import { fd, addDays } from '/shared/dates.js';
import { esc, chip, opts, act, tbl, tx, stmtList, isAr } from '../ui.js';
import { course, lesson, subName, QTYPE, MTYPES, ACCESS, scopes, matScope, sharesOf, invited, trWhen, matHref } from '../logic.js';

export function viewChart() {
  const co = S.p.course || 'BAS'; const k = course(co); const sem = Math.min(+(S.p.sem || 2), k.sems); const loaded = S.charts[co + '-' + sem];
  const fake = { course: co, sem };
  return '<div class="head"><div><h1>Standard Syllabus Chart</h1><div class="sub">The fixed weekly plan teachers log each session against</div></div></div>' +
    '<section class="card"><div class="form"><div class="field"><label for="ch-c">Course type</label><select id="ch-c" data-bind="p.course" data-rerender="1">' + opts(S.courses.map(c => [c.code, c.name]), co) + '</select></div>' +
    '<div class="field"><label for="ch-s">Semester</label><select id="ch-s" data-bind="p.sem" data-rerender="1">' + opts(Array.from({ length: k.sems }, (_, i) => [i + 1, 'Semester ' + (i + 1)]), sem) + '</select></div></div>' +
    (loaded ? tbl([[co === 'INR' ? 'Session' : 'Week'], ['Belief'], ['Islamic Laws'], ['Ethics']], Array.from({ length: k.weeks }, (_, i) => { const l = lesson(fake, i + 1); return '<tr><th scope="row">' + (i + 1) + '</th><td>' + esc(l.b) + '</td><td>' + esc(l.l) + '</td><td>' + esc(l.e) + '</td></tr>'; })) +
      '<p class="sub small">Bracketed entries stand in for the real chart, which will be loaded from the Excel template once the academy returns it.</p>'
      : '<p class="empty">This chart is not loaded yet.</p><div class="btns">' + act('chartLoad', co + '-' + sem, 'Mark chart as loaded', 'btn primary') + '</div>') + '</section>';
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
  const ed = f.edit ? list.find(q => q.id === f.edit) : null; if (!ed) f.edit = null;
  const t = ed ? ed.type : f.type || 'single';
  return '<div class="head"><div><h1>Question bank</h1><div class="sub">Questions of several types, all marked automatically, stored by course type, semester and subject</div></div>' +
    '<div class="btns">' + act('importOpen', '', 'Import a question paper') + '</div></div>' +
    '<div class="cols"><section class="card main"><div class="form">' +
      '<div class="field"><label for="qb-c">Course type</label><select id="qb-c" data-bind="form.qb.course" data-rerender="1">' + opts(S.courses.map(c => [c.code, c.name]), f.course) + '</select></div>' +
      '<div class="field"><label for="qb-s">Semester</label><select id="qb-s" data-bind="form.qb.sem" data-rerender="1">' + opts(Array.from({ length: k.sems }, (_, i) => [i + 1, 'Semester ' + (i + 1)]), f.sem) + '</select></div>' +
      '<div class="field"><label for="qb-u">Subject</label><select id="qb-u" data-bind="form.qb.sub" data-rerender="1">' + opts(S.subjects.filter(s => s.exam).map(s => [s.key, s.name]), f.sub) + '</select></div></div>' +
      '<div class="card-h"><h2>' + list.filter(q => !q.retired).length + ' questions</h2></div><div>' +
      (list.map((q, i) => '<div class="qa"><div class="b">' + (i + 1) + '. ' + tx(q.text) + '</div><div class="btns">' + chip('mute', QTYPE[q.type]) + (q.retired ? chip('warn', 'Retired') : '') + (ed && ed.id === q.id ? chip('gold', 'Editing') : '') + '</div>' + qShow(q) +
        (q.retired ? '' : '<div class="btns">' + act('qEdit', q.id, 'Edit', 'link') + act('qRetire', q.id, 'Retire', 'link') + '</div>') + '</div>').join('') || '<p class="empty">No questions here yet. Add the first one with Quick add.</p>') + '</div></section>' +
    '<section class="card side" id="q-form"><h2>' + (ed ? 'Edit question' : 'Quick add') + '</h2><p class="sub small">' + (ed ? 'Changes apply to new exams. Past results keep the mark that was given.' : 'Saves to ' + esc(k.name) + ', Semester ' + f.sem + ', ' + esc(subName(f.sub)) + ' and keeps the form open for the next question.') + '</p>' +
      '<div class="field"><label for="qa-type">Question type</label><select id="qa-type" data-bind="form.qb.type" data-rerender="1"' + (ed ? ' disabled' : '') + '>' + opts(Object.keys(QTYPE).filter(x => x !== 'bank' && (x !== 'combo' || t === 'combo')).map(x => [x, QTYPE[x]]), t) + '</select></div>' +
      '<form data-form="qAdd" style="display:flex;flex-direction:column;gap:12px">' + qFields(t, ed) +
      '<div class="btns"><button class="btn primary" type="submit">' + (ed ? 'Save changes' : 'Save and add another') + '</button>' + (ed ? act('qEditCancel', '', 'Cancel') : '') + '</div></form></section></div>';
}

export function viewExams() {
  return '<div class="head"><div><h1>Exams</h1><div class="sub">One exam per course type, semester and subject, assembled from the question bank</div></div></div>' +
    '<section class="card">' + tbl([['Exam'], ['Questions', 1], ['Window'], ['Status'], ['']],
      S.exams.map(e => {
        const n = S.questions.filter(q => !q.retired && q.course === e.course && q.sem === e.sem && q.sub === e.sub).length; const done = S.results.filter(r => r.course === e.course && r.sem === e.sem && r.sub === e.sub && r.date >= e.from).length;
        return '<tr><th scope="row">' + esc(course(e.course).name) + ' · Semester ' + e.sem + ' · ' + esc(subName(e.sub)) + '</th><td class="r">' + n + '</td><td>' + fd(e.from) + ' to ' + fd(e.to) + '</td><td>' + (e.open ? chip('ok', 'Open now') + ' <span class="sub small">' + done + ' taken</span>' : chip('gold', 'Scheduled')) + '</td><td>' + act('examToggle', e.id, e.open ? 'Close window' : 'Open window now', e.open ? 'btn' : 'btn primary') + '</td></tr>';
      })) +
      '<p class="sub small">Opening a window makes the Start exam button appear for every student in a class on that course and semester.</p></section>' +
    '<section class="card"><h2>Schedule a semester\'s exams</h2><form class="form" data-form="examAdd">' +
      '<div class="field"><label for="ea-c">Course type</label><select id="ea-c" name="course">' + opts(S.courses.map(c => [c.code, c.name]), 'BAS') + '</select></div>' +
      '<div class="field"><label for="ea-s">Semester</label><input id="ea-s" name="sem" type="number" min="1" max="10" value="1" required></div>' +
      '<div class="field"><label for="ea-f">Window opens</label><input id="ea-f" name="from" type="date" value="' + addDays(TODAY, 21) + '" required></div>' +
      '<div class="field"><label for="ea-t">Window closes</label><input id="ea-t" name="to" type="date" value="' + addDays(TODAY, 27) + '" required></div>' +
      '<button class="btn primary" type="submit">Schedule</button></form><p class="sub small">One exam is created for each examined subject. Scheduling an existing semester again moves its window.</p></section>';
}

export function viewTraditions() {
  return '<div class="head"><div><h1>Traditions library</h1><div class="sub">One tradition goes into each absence reminder, in rotation</div></div></div>' +
    '<div class="cols"><section class="card main"><h2>' + S.traditions.length + ' in the library</h2><div class="rows">' +
      S.traditions.map(t => '<div class="row"><div><div' + (isAr(t.text) ? ' class="ar" lang="ar" dir="rtl"' : '') + '>' + esc(t.text) + '</div><div class="sub small">' + esc(t.source) + '</div></div></div>').join('') + '</div></section>' +
    '<section class="card side"><h2>Add a tradition</h2><form data-form="tradAdd" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="tr-t">Text</label><textarea id="tr-t" name="text" rows="4" dir="auto" required></textarea></div>' +
      '<div class="field"><label for="tr-s">Source</label><input id="tr-s" name="source" required></div>' +
      '<button class="btn primary" type="submit">Add to library</button></form></section></div>';
}

export function viewMaterials() {
  const f = S.form.mf || (S.form.mf = { course: '', share: '', type: '' });
  const list = S.materials.filter(m => (!f.course || m.course === f.course) && (!f.share || String(m.share) === f.share) && (!f.type || m.type === f.type));
  return '<div class="head"><div><h1>Teaching materials</h1><div class="sub">One library for syllabus documents, books for students to read, teacher guides, slides and other material</div></div></div>' +
    '<div class="cols"><section class="card main"><div class="form">' +
      '<div class="field"><label for="mf-c">Course type</label><select id="mf-c" data-bind="form.mf.course" data-rerender="1">' + opts([['', 'All'], ['ALL', 'General (all courses)']].concat(S.courses.map(c => [c.code, c.name])), f.course) + '</select></div>' +
      '<div class="field"><label for="mf-y">Type</label><select id="mf-y" data-bind="form.mf.type" data-rerender="1">' + opts([['', 'All types']].concat(MTYPES.map(x => [x, x])), f.type) + '</select></div>' +
      '<div class="field"><label for="mf-s">Who can see it</label><select id="mf-s" data-bind="form.mf.share" data-rerender="1">' + opts([['', 'Any'], ['false', 'Teachers only'], ['true', 'Shareable with students']], f.share) + '</select></div></div>' +
      '<div class="rows">' + (list.map(m => {
        const sh = sharesOf(m.id); const href = matHref(m);
        return '<div class="row"><div><div class="b">' + esc(m.title) + '</div><div class="sub small">' + esc(matScope(m)) + ' · ' + esc(m.src) + ' · added ' + fd(m.date) + '</div><div class="btns" style="margin-top:6px">' + chip('mute', m.type) + (m.share ? chip('ok', 'Shareable with students') : chip('gold', 'Teachers only')) + (sh.length ? chip('mute', 'Shared with ' + sh.length + (sh.length === 1 ? ' class' : ' classes')) : '') + '</div></div>' + (href ? '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(href) + '" target="_blank" rel="noopener">Open</a>' : '') + '</div>';
      }).join('') || '<p class="empty">No material matches these filters.</p>') + '</div></section>' +
    '<div class="side"><section class="card"><h2>Add material</h2><form data-form="matAdd" style="display:flex;flex-direction:column;gap:12px">' +
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
      '<button class="btn primary" type="submit">Add to library</button></form></section>' +
    '<section class="card"><h2>Weekly reading targets</h2><p class="sub small">What each student is expected to log every week. Changes apply from the next week.</p><form class="form" data-form="setTargets">' +
      '<div class="field"><label for="tg-a">Ayat a week</label><input id="tg-a" name="ayat" type="number" min="0" inputmode="numeric" value="' + esc(S.targets.ayat) + '"></div>' +
      '<div class="field"><label for="tg-p">Pages a week</label><input id="tg-p" name="pages" type="number" min="0" inputmode="numeric" value="' + esc(S.targets.pages) + '"></div><button class="btn" type="submit">Save targets</button></form></section>' +
    '<section class="card"><h2>Teacher access levels</h2><p class="sub small">Own classes: material for the courses and semesters they teach. Course type: every semester of those courses. All material: the whole library.</p>' +
      tbl([['Teacher'], ['Classes'], ['Access']], S.teachers.map(t => '<tr><th scope="row">' + esc(t.name) + '</th><td>' + (scopes(t.id).map(s => s.cid).join(', ') || 'None yet') + '</td><td><label class="sr" for="acc-' + t.id + '">Access for ' + esc(t.name) + '</label><select id="acc-' + t.id + '" class="inline-select" data-call="setAccess" data-tid="' + t.id + '">' + opts(Object.keys(ACCESS).map(k => [k, ACCESS[k]]), t.access) + '</select></td></tr>')) + '</section></div></div>';
}

export function viewTraining() {
  const up = S.trainings.filter(t => t.date >= TODAY).sort((a, b) => a.date < b.date ? -1 : 1); const past = S.trainings.filter(t => t.date < TODAY);
  const row = tr => {
    const inv = S.teachers.filter(t => invited(t.id, tr)); const yes = inv.filter(t => tr.rsvp[t.id] === 'yes').length; const no = inv.filter(t => tr.rsvp[t.id] === 'no').length;
    return '<div class="row"><div><div class="b">' + esc(tr.title) + '</div><div class="sub small">' + trWhen(tr) + ' · ' + esc(tr.mode) + ' · ' + esc(tr.facilitator) + '</div><div class="btns" style="margin-top:6px">' + chip('mute', tr.kind) + (tr.req ? chip('gold', 'Required') : chip('mute', 'Optional')) + chip('mute', tr.course === 'ALL' ? 'All teachers' : course(tr.course).name + ' · Semester ' + tr.sem) + '</div>' +
      '<div class="small" style="margin-top:6px">' + (tr.attended ? 'Attended: ' + Object.values(tr.attended).filter(Boolean).length + ' of ' + inv.length : inv.length + ' invited · ' + yes + ' attending · ' + no + ' not attending · ' + (inv.length - yes - no) + ' not replied') + '</div></div></div>';
  };
  return '<div class="head"><div><h1>Teacher training</h1><div class="sub">Programmes and refreshers, with invitations, replies and attendance</div></div></div>' +
    '<div class="cols"><div class="main"><section class="card"><h2>Coming up</h2><div class="rows">' + (up.map(row).join('') || '<p class="empty">Nothing scheduled.</p>') + '</div></section>' +
      '<section class="card"><h2>Held</h2><div class="rows">' + (past.map(row).join('') || '<p class="empty">Nothing held yet.</p>') + '</div></section>' +
      '<p class="sub small">Refreshers go to teachers whose classes are on that semester or the one before it.</p></div>' +
    '<section class="card side"><h2>Schedule training</h2><form data-form="trainAdd" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="tr-ti">Title</label><input id="tr-ti" name="title" required></div>' +
      '<div class="field"><label for="tr-k">Kind</label><select id="tr-k" name="kind">' + opts([['Programme', 'Training programme'], ['Refresher', 'Refresher on a topic']], 'Programme') + '</select></div>' +
      '<div class="form"><div class="field"><label for="tr-c">For teachers of</label><select id="tr-c" name="course">' + opts([['ALL', 'All teachers']].concat(S.courses.map(c => [c.code, c.name])), 'ALL') + '</select></div>' +
      '<div class="field"><label for="tr-s">Semester</label><select id="tr-s" name="sem">' + opts([[0, 'All']].concat([1, 2, 3, 4, 5].map(i => [i, 'Semester ' + i])), 0) + '</select></div></div>' +
      '<div class="form"><div class="field"><label for="tr-d">Date</label><input id="tr-d" name="date" type="date" value="' + addDays(TODAY, 14) + '" required></div>' +
      '<div class="field"><label for="tr-tm">Time (India)</label><input id="tr-tm" name="time" type="time" value="11:00" required></div></div>' +
      '<div class="field"><label for="tr-f">Facilitator</label><input id="tr-f" name="facilitator" value="' + esc(ME.name) + '"></div>' +
      '<div class="field"><label for="tr-m">Meet link or venue</label><input id="tr-m" name="mode" placeholder="Paste the Google Meet link"></div>' +
      '<label class="check"><input type="checkbox" name="req" id="tr-r">Attendance is required</label>' +
      '<button class="btn primary" type="submit">Schedule and invite</button></form></section></div>';
}
