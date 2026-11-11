/* Dialogs. */
import { S, ME, TODAY } from '../state.js';
import { DOW, DOWL, fd, fdl, ft, pd, addDays } from '/shared/dates.js';
import { esc, opts, act, chip, tx, stmtList, pct } from '../ui.js';
import {
  cls, stu, course, subName, courseLabel, group, classStudents, classSessions, stuStats, statChip, semResult, semReady, moveTargets, ended, levelLabel, assignable, paperCounts, examSubs, nextDate, whenFor, nextCounter, QTYPE, myLoc, myStudent, teacherName, levelRank, teacherTitle
} from '../logic.js';
import { certsFor } from './student.js';
import { certificateHtml } from './certificate.js';
import { callPeople } from '/shared/callpeople.js';
import { owners } from './location.js';
import { editModal } from './edit.js';

export function modalHtml() {
  const m = S.modal; if (!m) return ''; let b = '';
  if (m.t === 'edit') b = editModal(m);
  if (m.t === 'assign') {
    const c = cls(m.cid); const list = assignable(c.g, c.course);
    b = '<h2>Assign a teacher to ' + c.id + '</h2><p class="sub">Only ' + (c.g === 'F' ? 'sisters' : 'brothers') + ' who teach ' + esc(course(c.course).name) + ' or a higher level are offered.</p>' +
      (list.length ? '<div class="field"><label for="as-t">Teacher</label><select id="as-t" data-bind="form.teacher">' + opts(list.map(t => { const n = S.classes.filter(k => k.teacherId === t.id && !ended(k)).length; return [t.id, teacherTitle(t) + ' · ' + levelLabel(t) + ' · ' + n + (n === 1 ? ' class' : ' classes')]; }), S.form.teacher) + '</select></div>' +
      '<div class="btns">' + act('assignSave', c.id, 'Assign teacher', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>' : '<p>No ' + (c.g === 'F' ? 'sister' : 'brother') + ' teachers at ' + esc(course(c.course).name) + ' level or higher are on the list yet. Add one under Classes, or raise a teacher\'s level there.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>');
  }
  if (m.t === 'class') {
    const f = S.form; const su = ME.role === 'super'; const can = ME.role === 'locadmin' || su; const k = course(f.course);
    if (f.teacher && !assignable(f.g, f.course).some(t => t.id === f.teacher)) f.teacher = ''; /* course or group changed */
    /* the first session is the class day on or after the start date */
    let first = /^\d{4}-\d{2}-\d{2}$/.test(f.start || '') ? f.start : ''; if (first) while (pd(first).getDay() !== +f.day) first = addDays(first, 1);
    b = '<h2>' + (su ? 'Create class' : 'Create class in ' + esc(ME.locName)) + '</h2>' +
      '<div class="form">' + (su ? '<div class="field"><label for="cl-loc">Location</label><select id="cl-loc" data-bind="form.loc">' + opts([['', 'Choose']].concat(S.locations.filter(l => !l.disabled).map(l => [l.code, l.name])), f.loc) + '</select></div>' : '') + '<div class="field"><label for="cl-c">Course type</label><select id="cl-c" data-bind="form.course" data-rerender="1">' + opts(S.courses.map(c => [c.code, c.name]), f.course) + '</select></div>' +
      '<div class="field"><label for="cl-s">Semester</label><select id="cl-s" data-bind="form.sem">' + opts(Array.from({ length: k.sems }, (_, i) => [i + 1, 'Semester ' + (i + 1)]), f.sem) + '</select></div>' +
      '<div class="field"><label for="cl-l">Language</label><select id="cl-l" disabled><option>English</option></select></div>' +
      '<div class="field"><label for="cl-g">Group</label><select id="cl-g" data-bind="form.g" data-rerender="1">' + opts([['F', 'Sisters'], ['M', 'Brothers']], f.g) + '</select></div>' +
      '<div class="field"><label for="cl-d">Day</label><select id="cl-d" data-bind="form.day" data-rerender="1">' + opts(DOWL.map((d, i) => [i, d]), f.day) + '</select></div>' +
      '<div class="field"><label for="cl-t">Time (India)</label><input id="cl-t" type="time" data-bind="form.time" value="' + esc(f.time) + '"></div>' +
      '<div class="field"><label for="cl-sd">Start date</label><input id="cl-sd" type="date" data-bind="form.start" data-rerender="1" value="' + esc(f.start) + '" required></div>' +
      (can ? '<div class="field"><label for="cl-te">Teacher</label><select id="cl-te" data-bind="form.teacher">' + opts([['', 'Assign later']].concat(assignable(f.g, f.course).map(t => [t.id, teacherTitle(t) + ' · ' + levelLabel(t)])), f.teacher) + '</select></div>' : '') +
      '<div class="field"><label for="cl-m">Google Meet link</label><input id="cl-m" type="url" data-bind="form.meet" value="' + esc(f.meet) + '" placeholder="Paste the class Meet link"></div></div>' +
      (first ? '<p class="small"><span class="b">First class: ' + fdl(first) + '</span>' + (first < TODAY ? '<span class="warn-t"> · this is in the past, so sessions from then until today will be listed for logging</span>' : '') + '</p>' : '') +
      '<p class="sub small">Class number will be ' + esc(ME.loc) + '-' + f.course + '-' + String(nextCounter(ME.loc, f.course)).padStart(3, '0') + '.' + (can ? '' : ' The class is saved as awaiting teacher until the primary or secondary responsible person assigns one.') + '</p>' +
      '<div class="btns">' + act('classSave', '', 'Create class', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'chWin') {
    const c = cls(m.cid); const subj = (S.subjects.find(x => x.key === m.sub) || {}).name || m.sub; const title = (S.chapterTitles || {})[c.course + '-' + c.sem + '-' + m.sub + '-' + m.n];
    b = '<h2>' + esc(subj) + ' chapter ' + m.n + ' paper for ' + c.id + '</h2>' + (title ? '<p class="b">' + esc(title) + '</p>' : '') +
      '<p class="sub">Students of this class can take this paper once, between these dates. A student who does not take it gets 0 for it. Other classes are not affected.</p>' +
      '<div class="form"><div class="field"><label for="cw-f">Opens</label><input id="cw-f" type="date" data-bind="form.from" value="' + esc(S.form.from) + '"></div>' +
      '<div class="field"><label for="cw-t">Closes</label><input id="cw-t" type="date" min="' + TODAY + '" data-bind="form.to" value="' + esc(S.form.to) + '"></div></div>' +
      '<div class="btns">' + act('chWinSave', '', 'Open paper', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'examWin') {
    const c = cls(m.cid); const missing = paperCounts(c.course, c.sem).filter(x => !x.n);
    b = '<h2>Semester ' + c.sem + ' exams for ' + c.id + '</h2><p class="sub">Students of this class can take ' + esc(examSubs().map(s => s.name).join(', ')) + ' between these dates, once each. Other classes are not affected.</p>' +
      (missing.length ? '<p class="small warn-t">There are no approved questions yet for ' + esc(missing.map(x => x.s.name).join(', ')) + ', so the window cannot open until the academic team has approved them.</p>' : '') +
      '<div class="form"><div class="field"><label for="ew-f">Window opens</label><input id="ew-f" type="date" data-bind="form.from" value="' + esc(S.form.from) + '"></div>' +
      '<div class="field"><label for="ew-t">Window closes</label><input id="ew-t" type="date" min="' + TODAY + '" data-bind="form.to" value="' + esc(S.form.to) + '"></div></div>' +
      '<div class="btns">' + act('examWinSave', c.id, 'Open exam window', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'sendBack') {
    b = '<h2>Send back to the creator</h2><p class="sub">Say what needs changing. ' + esc(m.who || 'The creator') + ' sees your note, edits the item and sends it again.</p>' +
      '<div class="field"><label for="sb-n">What needs changing</label><textarea id="sb-n" rows="3" data-bind="form.note">' + esc(S.form.note) + '</textarea></div>' +
      '<div class="btns">' + act('sendBackSave', '', 'Send back', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'assist') {
    const c = cls(m.cid); const studs = classStudents(c.id).slice().sort((a, b) => a.name.localeCompare(b.name));
    const login = s => S.logins ? (S.logins[s.id] ? ' · signs in as ' + S.logins[s.id] : ' · no login yet') : '';
    b = '<h2>Class assistant for ' + c.id + '</h2><p class="sub">The class assistant can log sessions and attendance for the class, using their own student login.</p>' +
      (studs.length ? '<div class="field"><label for="ca-s">Class assistant</label><select id="ca-s" data-bind="form.sid">' + opts([['', 'No class assistant']].concat(studs.map(s => [s.id, s.name + login(s)])), S.form.sid) + '</select></div>' +
        (S.logins ? '<p class="sub small">A student with no login yet can be given one with Create login next to their name.</p>' : '<p class="sub small">The student needs a login to log sessions. The location responsible or coordinator can create one.</p>') +
        '<div class="btns">' + act('assistSave', c.id, 'Save', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>'
        : '<p>This class has no students yet.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>');
  }
  if (m.t === 'promote') {
    const c = cls(m.cid); const k = course(c.course); const r = semReady(c); const studs = classStudents(c.id);
    const lab = { pass: chip('ok', 'Passed'), fail: chip('warn', 'Failed'), incomplete: chip('gold', 'Incomplete'), none: chip('mute', 'No marks') };
    const warn = [r.held < r.weeks ? 'Only ' + r.held + ' of ' + r.weeks + ' sessions of Semester ' + c.sem + ' have been held.' : '', !r.pub ? 'Semester ' + c.sem + ' results are not published yet.' : ''].filter(Boolean);
    b = '<h2>' + (r.last ? 'Complete the ' + esc(k.name) + ' course for ' + c.id : 'Move ' + c.id + ' to Semester ' + (c.sem + 1)) + '</h2>' +
      '<p class="sub">Tick the students who ' + (r.last ? 'have completed the course' : 'move up with the class') + '. Students who passed are ticked to start with. Anyone left unticked goes back to registrations to repeat Semester ' + c.sem + ' in another class; their record and results are kept.</p>' +
      warn.map(w => '<p class="small warn-t">' + w + '</p>').join('') +
      '<div class="rows">' + (studs.map(s => { const st = stuStats(s); return '<div class="row"><label class="check"><input type="checkbox" data-bind="form.up.' + s.id + '"' + (S.form.up[s.id] ? ' checked' : '') + '><span class="b">' + esc(s.name) + '</span></label><div class="btns">' + lab[semResult(s.id, c.course, c.sem)] + chip('mute', 'Attendance ' + pct(st.pct)) + '</div></div>'; }).join('') || '<p class="empty">This class has no students.</p>') + '</div>' +
      (r.last ? '' : '<div class="field"><label for="pr-d">Semester ' + (c.sem + 1) + ' starts on</label><input id="pr-d" type="date" min="' + TODAY + '" data-bind="form.start" value="' + esc(S.form.start) + '"></div>') +
      '<p class="sub small">This cannot be undone.' + (r.last && S.courses[levelRank(c.course) + 1] ? ' Next, you can move the class up to ' + esc(S.courses[levelRank(c.course) + 1].name) + '.' : '') + '</p>' +
      '<div class="btns">' + act('promoteSave', c.id, r.last ? 'Complete the course' : 'Move to Semester ' + (c.sem + 1), 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  /* a teaching level outside the rule, with a reason, for the approver to decide */
  if (m.t === 'levelExc') {
    const sid = m.sid || S.form.sid; const t = sid ? S.teachers.find(x => x.sid === sid) : null;
    const levels = S.courses.filter(c => !t || !t.level || levelRank(c.code) > levelRank(t.level));
    b = '<h2>Request a teaching level exception</h2><p class="sub">For someone who is not eligible under the rule (a student of a higher level, or having passed all of that level). The approver sees it marked as an exception, with your reason, and it stays on the teacher\'s record.</p>' +
      (m.sid ? '<p class="b">' + esc((stu(m.sid) || {}).name || '') + (t && t.level ? ' <span class="sub" style="font-weight:500">teaches up to ' + esc(course(t.level).name) + ' now</span>' : '') + '</p>'
        : '<div class="field"><label for="ex-s">Student</label><select id="ex-s" data-bind="form.sid" data-rerender="1">' + opts([['', 'Choose a student']].concat(S.students.filter(s => !s.left).slice().sort((a, x) => a.name.localeCompare(x.name)).map(s => [s.id, s.name + (s.classId ? ' · ' + s.classId : '')])), S.form.sid) + '</select></div>') +
      '<div class="field"><label for="ex-l">Can teach up to</label><select id="ex-l" data-bind="form.level">' + opts([['', 'Choose a level']].concat(levels.map(c => [c.code, c.name])), S.form.level) + '</select></div>' +
      '<div class="field"><label for="ex-r">Reason (required)</label><textarea id="ex-r" rows="3" data-bind="form.reason" required>' + esc(S.form.reason || '') + '</textarea></div>' +
      '<div class="btns">' + act('excSave', '', 'Send for approval', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'nextLevel') {
    const c = cls(m.cid); const k = S.courses[levelRank(c.course) + 1]; const studs = classStudents(c.id);
    b = '<h2>Move ' + c.id + ' up to ' + esc(k.name) + '</h2><p class="sub">This creates a new ' + esc(k.name) + ' class, Semester 1, on the same day and time, with the students ticked. ' + c.id + ' stays on record with its marks. Anyone left unticked stays with the finished class and can be placed later. Not ready yet? Choose Not now; the Move up button stays on the class page.</p>' +
      '<div class="rows">' + (studs.map(s => '<div class="row" style="padding:4px 0"><label class="check"><input type="checkbox" data-bind="form.up.' + s.id + '"' + (S.form.up[s.id] ? ' checked' : '') + '><span class="b">' + esc(s.name) + '</span></label></div>').join('') || '<p class="empty">This class has no students left.</p>') + '</div>' +
      '<div class="form"><div class="field"><label for="nl-d">Starts on</label><input id="nl-d" type="date" min="' + TODAY + '" data-bind="form.start" value="' + esc(S.form.start) + '"></div>' +
      '<div class="field"><label for="nl-t">Teacher</label><select id="nl-t" data-bind="form.teacher">' + opts([['', 'Assign later']].concat(assignable(c.g, k.code).map(t => [t.id, teacherTitle(t) + ' · ' + levelLabel(t)])), S.form.teacher) + '</select></div></div>' +
      '<div class="btns">' + act('nextSave', c.id, 'Move up to ' + esc(k.name), 'btn primary') + act('modalClose', '', 'Not now') + '</div>';
  }
  if (m.t === 'move') {
    const s = stu(m.sid); const from = cls(s.classId); const list = moveTargets(s); const to = cls(S.form.cid);
    b = '<h2>Move ' + esc(s.name) + '</h2><p class="sub">From ' + from.id + ' · ' + esc(courseLabel(from)) + '. Only ' + group(s.g).toLowerCase() + ' classes are offered. Results and certificates stay with the student; attendance in the new class counts from today.</p>' +
      (list.length ? '<div class="field"><label for="mv-c">Move to</label><select id="mv-c" data-bind="form.cid" data-rerender="1">' + opts(list.map(c => [c.id, c.id + ' · ' + courseLabel(c) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + (c.status === 'awaiting' ? ' · awaiting teacher' : '') + ' · ' + (c.loc === from.loc ? classStudents(c.id).length + ' students' : (S.locations.find(l => l.code === c.loc) || { name: c.loc }).name)]), S.form.cid) + '</select></div>' +
        (to && (to.course !== from.course || to.sem !== from.sem) ? '<p class="small warn-t">' + to.id + ' is on ' + esc(courseLabel(to)) + ', not ' + esc(courseLabel(from)) + '.</p>' : '') +
        (from.assistantId === s.id ? '<p class="small warn-t">' + esc(s.name) + ' is the class assistant of ' + from.id + ' and will stop being its assistant.</p>' : '') +
        '<div class="btns">' + act('moveSave', s.id, 'Move student', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>'
        : '<p>There is no other ' + group(s.g).toLowerCase() + ' class to move to.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>');
  }
  if (m.t === 'addStu') {
    const c = cls(m.cid); const fit = r => (r.course === c.course ? 0 : 2) + (!r.sem || r.sem === c.sem ? 0 : 1);
    const regs = S.regs.filter(r => r.g === c.g && r.from !== c.id).sort((a, b) => fit(a) - fit(b));
    b = '<h2>Add students to ' + c.id + '</h2><p class="sub">' + esc(courseLabel(c)) + ' · ' + group(c.g) + ' · ' + classStudents(c.id).length + ' students now. Choose from the students waiting; the window stays open so you can add several. A new student is registered first, under Registrations.</p>' +
      '<h3 style="margin-top:12px">Waiting in registrations</h3><div class="rows">' + (regs.map(r => '<div class="row"><div><div class="b">' + esc(r.name) + '</div><div class="sub small">' + (r.sem ? (r.removed ? 'wants ' : 'repeats ') + esc(course(r.course).name) + ' Semester ' + r.sem : 'wants ' + esc(course(r.course).name)) + (r.city ? ' · lives in ' + esc(r.city) : '') + '</div></div>' + act('addReg', r.id + '|' + c.id, 'Add to class') + '</div>').join('') || '<p class="empty">No ' + group(c.g).toLowerCase() + ' are waiting.</p>') + '</div>' +
      '<div class="btns">' + act('modalClose', '', 'Done', 'btn primary') + act('regsFromClass', '', 'Register a new student') + '</div>';
  }
  if (m.t === 'close') {
    const c = cls(m.cid); const f = S.form; const studs = classStudents(c.id);
    const targets = studs.length ? moveTargets(studs[0]) : [];
    const where = [['reg', 'Back to registrations, to await a class']].concat(targets.map(t => [t.id, 'Move to ' + t.id + ' · ' + courseLabel(t) + ' · ' + DOW[t.day] + ' ' + ft(t.time) + ' · ' + (t.loc === c.loc ? classStudents(t.id).length + ' students' : (S.locations.find(l => l.code === t.loc) || { name: t.loc }).name)]));
    const unlogged = S.sessions.filter(x => x.classId === c.id && !x.logged).length;
    b = '<h2>Close ' + c.id + '</h2><p class="sub">' + esc(courseLabel(c)) + ' · ' + group(c.g) + ' · ' + studs.length + (studs.length === 1 ? ' student' : ' students') + '. The class keeps its records but takes no more sessions or students.</p>' +
      '<div class="field"><label for="cc-r">Reason for closing</label><input id="cc-r" data-bind="form.reason" value="' + esc(f.reason) + '" placeholder="For example: teacher unavailable, too few students" required></div>' +
      (studs.length ? '<div class="field"><label for="cc-a">Students</label><select id="cc-a" data-bind="form.all" data-rerender="1">' + opts(where.concat([['each', 'Choose for each student']]), f.all) + '</select></div>' +
        (f.all === 'each' ? '<div class="rows">' + studs.map(s => '<div class="row"><div class="b">' + esc(s.name) + '</div><select aria-label="Where ' + esc(s.name) + ' goes" data-bind="form.dest.' + s.id + '">' + opts(where, f.dest[s.id] || 'reg') + '</select></div>').join('') + '</div>' : '') : '') +
      (unlogged ? '<p class="small warn-t">' + unlogged + (unlogged === 1 ? ' session was' : ' sessions were') + ' never logged and will be recorded as cancelled because the class closed.</p>' : '') +
      '<p class="sub small">This cannot be undone.</p>' +
      '<div class="btns">' + act('closeSave', c.id, 'Close class', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'login') {
    const t = S.teachers.find(x => x.id === m.tid);
    b = '<h2>Create a login for ' + esc(t.name) + '</h2><p class="sub">' + esc(t.name) + ' will sign in with these details and see the classes assigned to them.</p>' +
      '<form data-form="teacherLogin" style="display:flex;flex-direction:column;gap:12px"><input type="hidden" name="teacherId" value="' + esc(t.id) + '"><input type="hidden" name="name" value="' + esc(t.name) + '">' +
      '<div class="field"><label for="tl-u">Username</label><input id="tl-u" name="username" autocomplete="off" autocapitalize="off" required pattern="[A-Za-z0-9._\\-]{3,40}"></div>' +
      '<div class="field"><label for="tl-p">First password (8 characters or more)</label><input id="tl-p" name="password" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<div class="btns"><button class="btn primary" type="submit">Create login</button>' + act('modalClose', '', 'Cancel') + '</div></form>';
  }
  if (m.t === 'stuLogin') {
    const s = stu(m.sid);
    b = '<h2>Create a login for ' + esc(s.name) + '</h2><p class="sub">' + esc(s.name) + ' will sign in with these details and see their own class, exams, results and reading.</p>' +
      '<form data-form="studentLogin" style="display:flex;flex-direction:column;gap:12px"><input type="hidden" name="sid" value="' + esc(s.id) + '">' +
      '<div class="field"><label for="sl-u">Username</label><input id="sl-u" name="username" autocomplete="off" autocapitalize="off" required pattern="[A-Za-z0-9._\\-]{3,40}"></div>' +
      '<div class="field"><label for="sl-p">First password (8 characters or more)</label><input id="sl-p" name="password" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<div class="btns"><button class="btn primary" type="submit">Create login</button>' + act('modalClose', '', 'Cancel') + '</div></form>';
  }
  if (m.t === 'remove') {
    const s = stu(m.sid); const from = cls(s.classId); const f = S.form;
    const radio = (v, label, hint) => '<label class="check"><input type="radio" name="rm-mode" value="' + v + '" data-bind="form.mode" data-rerender="1"' + (f.mode === v ? ' checked' : '') + '><span><span class="b">' + label + '</span><br><span class="sub small">' + hint + '</span></span></label>';
    b = '<h2>Remove ' + esc(s.name) + ' from ' + from.id + '</h2><p class="sub">Nothing is deleted. Results, certificates and past attendance are kept.</p>' +
      '<div class="rows">' + radio('wait', 'Waiting for another class', 'Goes back to registrations awaiting a class, to be allocated again') + radio('left', 'Left the academy', 'Taken off the class and recorded as having left') + '</div>' +
      (f.mode === 'left' ? '<div class="field"><label for="rm-r">Reason (optional)</label><input id="rm-r" data-bind="form.reason" value="' + esc(f.reason) + '" placeholder="For example: moved away, no longer able to attend"></div>' : '') +
      (from.assistantId === s.id ? '<p class="small warn-t">' + esc(s.name) + ' is the class assistant of ' + from.id + ' and will stop being its assistant.</p>' : '') +
      '<div class="btns">' + act('removeSave', s.id, 'Remove from class', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'alloc') {
    const r = S.regs.find(x => x.id === m.rid); const fit = c => (c.loc === r.loc ? 0 : 4) + (c.course === r.course ? 0 : 2) + (!r.sem || c.sem === r.sem ? 0 : 1);
    const list = S.classes.filter(c => c.g === r.g && !ended(c) && c.id !== r.from).sort((a, b) => fit(a) - fit(b));
    b = '<h2>Allocate a class to ' + esc(r.name) + '</h2><p class="sub">' + group(r.g) + ' classes only. A student can be in one class at a time, in any location.</p>' +
      (list.length ? '<div class="field"><label for="al-c">Class</label><select id="al-c" data-bind="form.cid">' + opts(list.map(c => [c.id, c.id + ' · ' + courseLabel(c) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + (c.status === 'awaiting' ? ' · awaiting teacher' : '')]), S.form.cid) + '</select></div>' +
        '<div class="btns">' + act('allocSave', r.id, 'Add student and allocate', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>'
      : '<p class="small warn-t">There is no ' + group(r.g).toLowerCase() + ' class to allocate yet. The student stays registered; create a class under Classes, then come back.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>');
  }
  /* tasks from a meeting's transcript: paste it, then review what was suggested before anything is saved */
  if (m.t === 'tasks' && m.step === 'paste') {
    const c = S.calls.find(x => x.id === m.callId);
    b = '<h2>Tasks from the transcript</h2><p class="sub">' + esc(myLoc().name) + ' · meeting of ' + fdl(c.date) + '. Paste the transcript and Claude suggests the tasks agreed in it. You review them before anything is saved.</p>' +
      '<div class="field"><label for="tk-t">Transcript of the call</label><textarea id="tk-t" rows="12" data-bind="form.transcript"' + (m.busy ? ' disabled' : '') + '>' + esc(S.form.transcript || '') + '</textarea></div>' +
      '<p class="sub small">The transcript is sent to Anthropic to be read and is not stored in this app. Only the tasks you save are kept, each with the line it came from.</p>' +
      (m.busy ? '<p class="b" role="status">Reading the transcript… this can take a minute or two.</p>' : '<div class="btns">' + act('taskAnalyse', '', 'Suggest tasks', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>');
  }
  if (m.t === 'tasks' && m.step === 'review') {
    const list = S.form.tasks; const who = [['', 'Choose who']].concat(owners());
    b = '<h2>Review the suggested tasks</h2>' + (list.length ? '<p class="sub">Correct anything, choose an owner where it is missing, and untick what you do not want. Nothing is saved until you click Save.</p>' : '<p>No agreed tasks were found in this transcript. You can still add action items by hand.</p>') +
      (m.dropped ? '<p class="small gold-t">' + m.dropped + (m.dropped === 1 ? ' suggestion was' : ' suggestions were') + ' left out because the line quoted could not be found in the transcript.</p>' : '') +
      list.map((t, i) => '<div class="qa"><label class="check"><input type="checkbox" data-bind="form.tasks.' + i + '.include"' + (t.include ? ' checked' : '') + '>Keep this task</label>' +
        '<div class="field"><label for="tk-x' + i + '">Task</label><input id="tk-x' + i + '" data-bind="form.tasks.' + i + '.text" value="' + esc(t.text) + '"></div>' +
        '<div class="form"><div class="field"><label for="tk-o' + i + '">Owner</label><select id="tk-o' + i + '" data-bind="form.tasks.' + i + '.owner">' + opts(who, t.owner) + '</select></div>' +
        '<div class="field"><label for="tk-d' + i + '">Due date</label><input id="tk-d' + i + '" type="date" data-bind="form.tasks.' + i + '.due" value="' + esc(t.due) + '"></div></div>' +
        '<div class="sub small">From the transcript: “' + esc(t.quote) + '”</div></div>').join('') +
      '<div class="btns">' + (list.length ? act('taskSave', '', 'Save tasks', 'btn primary') : '') + act('modalClose', '', list.length ? 'Cancel' : 'Close', list.length ? 'btn' : 'btn primary') + '</div>';
  }
  /* disabling a location: what is running there, what happens to it, and why */
  if (m.t === 'locOff') {
    const l = S.locations.find(x => x.code === m.code); const f = S.form;
    const classes = S.classes.filter(c => c.loc === l.code && !ended(c)); const regs = S.regs.filter(r => r.loc === l.code);
    const others = S.locations.filter(x => !x.disabled && x.code !== l.code).map(x => [x.code, x.name]);
    const any = classes.length || regs.length;
    b = '<h2>Disable ' + esc(l.name) + '</h2><p class="small warn-t">This location leaves the working lists and its staff lose their location role. Its past marks stay, and it stays on the Disabled tab.</p>' +
      (classes.length ? '<div class="lab">Running classes (' + classes.length + ')</div><div class="rows">' + classes.map(c => '<div class="row" style="padding:4px 0"><div><div class="b">' + esc(c.id) + '</div><div class="sub small">' + esc(courseLabel(c)) + ' · ' + classStudents(c.id).length + ' students · ' + esc(c.teacherId ? teacherName(c.teacherId) : 'awaiting a teacher') + '</div></div></div>').join('') + '</div>' : '<p class="sub small">No classes are running here.</p>') +
      (regs.length ? '<div class="lab">Waiting for a class (' + regs.length + ')</div><p class="sub small">' + regs.map(r => esc(r.name)).join(', ') + '</p>' : '') +
      (any ? '<div class="field"><label for="lo-m">What should happen to them?</label><select id="lo-m" data-bind="form.mode" data-rerender="1">' + opts([['', 'Choose'], ['move', 'Move them to another location'], ['close', 'Close the classes along with this location']], f.mode) + '</select></div>' : '') +
      (any && f.mode === 'move' ? '<div class="field"><label for="lo-t">Move to</label><select id="lo-t" data-bind="form.target">' + opts([['', 'Choose a location']].concat(others), f.target) + '</select></div><p class="sub small">Teachers and students stay with their classes, and each class keeps its number.</p>' : '') +
      (any && f.mode === 'close' ? '<div class="field"><label for="lo-d">Where do the students go?</label><select id="lo-d" data-bind="form.dest">' + opts([['', 'Choose']].concat(others.map(o => [o[0], 'Wait for a class at ' + o[1]])).concat([['left', 'Recorded as having left']]), f.dest) + '</select></div><p class="small warn-t">Closing a class cannot be undone. Its sessions not yet logged are cancelled. Marks stay.</p>' : '') +
      '<div class="field"><label for="lo-r">Reason (required)</label><textarea id="lo-r" rows="2" data-bind="form.reason" required>' + esc(f.reason || '') + '</textarea></div>' +
      '<div class="btns">' + act('locOffSave', '', 'Disable location', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'callSched') {
    const l = S.locations.find(x => x.code === m.code);
    b = '<h2>Weekly call details</h2><p class="sub">' + esc(l.name) + ' · now every ' + esc(l.callDay) + ' at ' + esc(l.callTime) + '. Everyone on the call is told.</p>' +
      '<div class="form"><div class="field"><label for="cs-d">Day</label><select id="cs-d" data-bind="form.callDay">' + opts(DOWL.map(d => [d, d]), S.form.callDay) + '</select></div>' +
      '<div class="field"><label for="cs-t">Time</label><input id="cs-t" type="time" data-bind="form.time" value="' + esc(S.form.time) + '" required></div></div>' +
      '<div class="field"><label for="cs-m">Meet link</label><input id="cs-m" type="url" data-bind="form.meet" value="' + esc(S.form.meet) + '" placeholder="https://meet.google.com/..."></div>' +
      '<div class="btns">' + act('schedSave', '', 'Save', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'teacherLink') {
    const t = S.teachers.find(x => x.id === m.tid);
    const list = S.students.filter(s => !s.left && s.g === t.g && !S.teachers.some(x => x.sid === s.id)).sort((a, b) => a.name.localeCompare(b.name));
    b = '<h2>Link ' + esc(teacherTitle(t)) + ' to a student</h2><p class="sub">Every teacher is a student first. Choose this teacher\'s student record. They keep their teaching level; their name and group then follow the student record. If they are not listed, register them and allocate a class first.</p>' +
      '<div class="field"><label for="tl-s">Student</label><select id="tl-s" data-bind="form.sid">' + opts([['', list.length ? 'Choose a student' : 'No student available']].concat(list.map(s => [s.id, s.name + (s.classId ? ' · ' + s.classId : '')])), S.form.sid) + '</select></div>' +
      '<div class="btns">' + act('teacherLinkSave', '', 'Link', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'call') {
    const l = myLoc(); const was = m.edit ? S.calls.find(c => c.id === S.form.id) : null;
    /* everyone on the attendance list: the current participants, and anyone since removed who was on this meeting */
    const now = callPeople(l); const people = now.concat(((was && was.att) || []).filter(x => !now.some(p => p.sid === x.sid)));
    b = '<h2>' + (m.edit ? 'Edit the weekly call' : 'Log the weekly call') + '</h2><p class="sub">' + esc(l.name) + ' · every ' + esc(l.callDay) + '. A meeting is logged once it has taken place; earlier ones can be logged late.</p>' +
      '<div class="form"><div class="field"><label for="ca-da">Date of the meeting</label><input id="ca-da" type="date" max="' + TODAY + '" data-bind="form.date" value="' + esc(S.form.date) + '" required></div>' +
      '<div class="field"><label for="ca-st">Status</label><select id="ca-st" data-bind="form.status" data-rerender="1">' + opts([['Held', 'Held'], ['Missed', 'Missed'], ['Rescheduled', 'Rescheduled']], S.form.status) + '</select></div></div>' +
      (S.form.status === 'Held' ? '<div class="lab">Attendance</div>' + (people.length ? '<div class="rows">' + people.map(p => '<label class="check"><input type="checkbox" data-bind="form.att.' + esc(p.sid) + '"' + (S.form.att[p.sid] !== false ? ' checked' : '') + '>' + esc(p.name) + '</label>').join('') + '</div><p class="sub small">Untick anyone who did not attend.</p>' : '<p class="sub small">Nobody is on this call yet.</p>') : '') +
      (m.edit ? '' : '<div class="field"><label for="ca-ai">Action item from this call (optional)</label><input id="ca-ai" data-bind="form.text" value="' + esc(S.form.text) + '" placeholder="What needs doing"></div>' +
      '<div class="form"><div class="field"><label for="ca-ow">Owner</label><select id="ca-ow" data-bind="form.owner">' + opts(owners(), S.form.owner) + '</select></div>' +
      '<div class="field"><label for="ca-du">Due date</label><input id="ca-du" type="date" data-bind="form.due" value="' + esc(S.form.due) + '"></div></div>') +
      '<div class="btns">' + act('callSave', '', m.edit ? 'Save changes' : 'Save meeting', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'reminder') {
    const s = stu(m.sid); const c = cls(s.classId); const st = stuStats(s); const d = nextDate(c); const w = whenFor(c, d, 5.5); const tr = S.traditions[st.miss % Math.max(1, S.traditions.length)] || { text: '', source: '' };
    const l = myLoc();
    const msg = 'Salaamun alaykum ' + s.name + ',\n\nWe missed you in the last ' + st.miss + ' sessions of your ' + course(c.course).name + ' class (' + c.id + ').\n\nYour attendance this semester: ' + pct(st.pct) + '\nSessions missed: ' + st.missed.map(x => fd(x.date) + (x.week ? ' (week ' + x.week + ')' : '')).reverse().join(', ') + '\nTopics you missed are on your dashboard under Syllabus.\n\nNext class: ' + fdl(w.date) + ' at ' + w.time + ' India time\nJoin: ' + (c.meet || '[class Meet link]') + '\n\n' + tr.text + '\n' + tr.source;
    b = '<h2>Reminder to ' + esc(s.name) + '</h2><p class="sub">Sent by email and WhatsApp, one for each missed session and never more than one a week. ' + statChip(st.status) + '</p><div class="msg">' + esc(msg) + '</div>' +
      '<p class="sub small">' + (st.status === 'followup' ? 'Because ' + st.miss + ' sessions were missed in a row, this is also escalated to ' + esc([l.primary, l.secondary, l.coordinator].filter(x => x && x !== 'None yet').join(', ')) + ' with an action item to contact the student personally.' : 'The teacher has been alerted. After 4 missed sessions in a row it escalates to the location admins.') + '</p>' +
      '<div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>';
  }
  if (m.t === 'cert') {
    /* a student's own certificate, or one staff opened from the class page (m.sid) */
    const s = m.sid ? stu(m.sid) : myStudent(); const x = s && certsFor(s).find(k => k.key === m.key);
    b = x ? certificateHtml(s, x, x.date || TODAY) +
      '<div class="btns">' + act('print', '', 'Print or save as PDF', 'btn primary') + (m.cid ? act('certsOpen', m.cid, 'All certificates') : '') + act('modalClose', '', 'Close') + '</div>'
      : '<p>This certificate is not available.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>';
  }
  if (m.t === 'certs') {
    /* every certificate earned by the students of a class, for staff to view and print */
    const c = cls(m.cid); const rows = classStudents(c.id).map(s => ({ s, list: certsFor(s) })).filter(r => r.list.length);
    b = '<h2>Certificates · ' + esc(c.id) + '</h2><p class="sub small">Open a certificate to view it, then print it or save it as a PDF.</p>' +
      (rows.length ? '<div class="rows">' + rows.map(r => '<div class="row" style="align-items:flex-start"><div><div class="b">' + esc(r.s.name) + '</div>' +
        r.list.map(x => '<div class="btns" style="margin-top:6px;align-items:center"><span class="small">' + esc(x.title) + '</span>' + act('certFor', r.s.id + '::' + x.key + '::' + c.id, 'View', 'btn') + '</div>').join('') + '</div></div>').join('') + '</div>'
        : '<p class="empty">No student in this class has a certificate yet. Certificates come with published semester results, passed chapter papers and completing the course.</p>') +
      '<div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>';
  }
  if (m.t === 'sscImport') {
    /* a syllabus chart read from Excel: say what already exists, and ask before making a new chart */
    const p = m.p; const k = course(p.course); const names = list => list.map(subName).join(', '); const tag = p.course === 'INR' ? 'Session' : 'Week';
    const clash = p.subjects.filter(x => (p.approved && p.approved.subjects.includes(x)) || (p.pending && p.pending.subjects.includes(x)));
    const where = k.name + ' Semester ' + p.sem;
    const exists = clash.length
      ? '<div class="card" style="background:var(--gold-tint);border-color:var(--gold-ink);gap:6px"><div class="b gold-t">An SSC already exists for ' + esc(names(clash)) + ' in ' + esc(where) + '.</div>' +
        (p.approved ? '<div class="small">In use now' + (p.approved.approvedBy ? ', approved by ' + esc(p.approved.approvedBy) : '') + (p.approved.on ? ' on ' + fd(p.approved.on) : '') + ': ' + esc(names(p.approved.subjects)) + '.</div>' : '') +
        (p.pending ? '<div class="small">Waiting for approval' + (p.pending.by ? ', from ' + esc(p.pending.by) : '') + (p.pending.on ? ' on ' + fd(p.pending.on) : '') + ': ' + esc(names(p.pending.subjects)) + '. A new upload replaces this draft.</div>' : '') +
        '<div class="b" style="margin-top:4px">Do you want to create a new SSC for ' + esc(names(clash)) + ' in ' + esc(where) + '?</div><div class="sub small">The current chart stays in use until the new one is approved.' + (p.subjects.length > clash.length ? ' ' + esc(names(p.subjects.filter(x => !clash.includes(x)))) + ' will be added as new.' : '') + '</div></div>'
      : '<p class="sub">No SSC exists yet for ' + esc(names(p.subjects)) + ' in ' + esc(where) + '. Creating it sends it for approval; teachers see it once it is approved.</p>';
    const others = ['b', 'l', 'e'].filter(x => !p.subjects.includes(x));
    b = '<h2>Syllabus chart from Excel</h2><p class="sub small">' + esc(m.file) + ' · ' + esc(where) + ' · ' + p.weeks + ' ' + tag.toLowerCase() + 's</p>' + exists +
      (p.problems.length ? '<div class="small warn-t">' + p.problems.map(esc).join('<br>') + '</div>' : '') +
      '<div class="scroll" style="max-height:46vh;overflow:auto">' + '<table><thead><tr><th scope="col">' + tag + '</th>' + p.subjects.map(x => '<th scope="col">' + esc(subName(x)) + '</th>').join('') + '</tr></thead><tbody>' +
        Array.from({ length: p.weeks }, (_, i) => '<tr><th scope="row">' + (i + 1) + '</th>' + p.subjects.map(x => '<td class="wrapcell">' + (p[x][i] ? esc(p[x][i]) : '<span class="sub">Empty</span>') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
      (others.length ? '<p class="sub small">' + esc(names(others)) + ' ' + (others.length === 1 ? 'is' : 'are') + ' not in the file, so ' + (others.length === 1 ? 'its' : 'their') + ' topics stay as they are.</p>' : '') +
      '<div class="btns">' + (clash.length ? act('sscImportSave', 'new', 'Yes, create a new SSC', 'btn primary') : act('sscImportSave', '', 'Create SSC and send for approval', 'btn primary')) + act('modalClose', '', clash.length ? 'No, keep the current one' : 'Cancel') + '</div>';
  }
  if (m.t === 'mcqImport') {
    /* multiple-choice questions read from Excel, checked row by row */
    const items = m.items; const ok = items.filter(x => !x.errors.length && !x.dupe); const dup = items.filter(x => x.dupe); const bad = items.filter(x => x.errors.length);
    const where = q => course(q.course).name + ' · Sem ' + q.sem + ' · ' + subName(q.sub) + (q.aud === 'teacher' ? ' · Teacher readiness quiz' : q.chapter ? ' · Ch ' + q.chapter : '');
    const shown = items.slice(0, 300);
    b = '<h2>Questions from Excel</h2><p class="sub small">' + esc(m.file) + ' · ' + items.length + (items.length === 1 ? ' row' : ' rows') + '</p>' +
      '<div class="btns">' + chip('ok', ok.length + ' ready to import') + (dup.length ? chip('mute', dup.length + ' already in the bank') : '') + (bad.length ? chip('warn', bad.length + ' with problems') : '') + '</div>' +
      (bad.length ? '<p class="small warn-t">Rows with problems are left out. Fix them in the file and upload it again; questions already imported are skipped then.</p>' : '') +
      '<div class="scroll" style="max-height:48vh;overflow:auto"><table><thead><tr><th scope="col" class="r">Row</th><th scope="col">Question</th><th scope="col">Where</th><th scope="col">Answer</th><th scope="col">Status</th></tr></thead><tbody>' +
        shown.map(x => '<tr><td class="r">' + x.row + '</td><td class="wrapcell">' + tx(x.q.text || '<no question>') + (x.errors.length ? '<div class="small warn-t">Problem: ' + esc(x.errors.join('; ')) + '</div>' : '') + '</td><td>' + (x.errors.length ? '' : esc(where(x.q))) + '</td><td class="wrapcell">' + (x.errors.length ? '' : 'ABCD'[x.q.correct] + '. ' + esc(x.q.options[x.q.correct]).slice(0, 60)) + '</td><td>' +
          (x.errors.length ? chip('warn', 'Left out') : x.dupe ? chip('mute', 'Already in bank') : chip('ok', 'Ready')) + '</td></tr>').join('') + '</tbody></table></div>' +
      (items.length > shown.length ? '<p class="sub small">Showing the first ' + shown.length + ' rows; all ' + ok.length + ' ready questions are imported.</p>' : '') +
      '<p class="sub small">Imported questions go to the approver and are used in papers once approved.</p>' +
      '<div class="btns">' + (ok.length ? act('mcqImportSave', '', 'Import ' + ok.length + (ok.length === 1 ? ' question' : ' questions'), 'btn primary') : '') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'import') {
    const P = S.paper;
    if (!m.step || !P) b = '<h2>Import a question paper</h2><p>Upload the paper as a Word (.docx) file. Number each question (1. 2. 3.) and put its options on lines starting a) b) c) d); mark each answer in yellow highlight, or in bold. The questions are shown for you to check before anything is saved.</p>' +
      '<div class="field"><label for="im-f">Word file</label><input id="im-f" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></div>' +
      '<p class="sub small">PDF papers cannot be read yet; save them as Word first. ' + act('importRun', '', 'Or try the sample paper', 'link') + '</p>' +
      '<div class="btns">' + act('importUpload', '', 'Read the paper', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
    else {
      const qs = P.questions; const can = q => q.type !== 'bank' && q.type !== 'other';
      const total = qs.reduce((t, q) => t + (q.type === 'bank' ? q.blanks : can(q) ? 1 : 0), 0); const found = qs.filter(q => can(q) && q.correct !== '').length; const skipped = qs.filter(q => q.type === 'other').length; const f = S.form.qb;
      b = '<h2>' + qs.length + ' questions found in ' + esc(P.file) + '</h2><p class="sub small">' + found + ' of ' + total + ' answers were marked in the file, ' + (total - found) + ' are still needed.' + (skipped ? ' ' + skipped + ' cannot be imported (see below).' : '') + ' Ticked questions are saved to ' + esc(course(f.course).name) + ', Semester ' + f.sem + ', the subject chosen in the question bank, and sent for approval.</p>' +
        (P.bank && P.bank.length ? '<p class="small">Word bank: ' + P.bank.map(tx).join(' · ') + '</p>' : '') + '<div>' + S.form.imp.map((q, i) => '<div class="qa"><label class="check"><input type="checkbox" id="im-' + i + '" data-bind="form.imp.' + i + '.include"' + (q.include ? ' checked' : '') + (can(q) ? '' : ' disabled') + '><span class="b">' + (P.sample ? q.s + '.' : '') + q.n + '. ' + tx(q.text) + '</span></label><div class="btns">' + (QTYPE[q.type] ? chip('mute', QTYPE[q.type]) : chip('warn', 'Cannot be imported')) + chip('mute', q.type === 'bank' ? q.blanks + ' blanks, 1 mark each' : q.marks + (q.marks === 1 ? ' mark' : ' marks')) + '</div>' + stmtList(q) +
          (q.type === 'bank' ? '<div class="small warn-t">No answers are marked in the file. The blanks need their words chosen from the bank before this can be saved.</div>'
            : q.type === 'other' ? (q.options.length ? '<ol type="a">' + q.options.map(o => '<li>' + tx(o) + '</li>').join('') + '</ol>' : '') + '<div class="small warn-t">' + esc(q.how) + ' Add it with Quick add instead.</div>'
            : '<div class="field"><label for="im-c' + i + '">Correct answer</label><select id="im-c' + i + '" data-bind="form.imp.' + i + '.correct">' + opts([['', 'Choose the answer']].concat(q.options.map((o, j) => [j, 'ABCD'[j] + '. ' + o])), q.correct) + '</select></div><div class="small ' + (q.correct === '' ? 'warn-t' : 'sub') + '">' + esc(q.how) + '</div>') + '</div>').join('') + '</div><div class="btns">' + act('importSave', '', 'Save ticked questions', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
    }
  }
  if (m.t === 'share') {
    const mt = S.materials.find(x => x.id === m.mid); const mine = S.classes.filter(c => c.teacherId === ME.teacherId && (mt.course === 'ALL' || (c.course === mt.course && (!mt.sem || c.sem === mt.sem))));
    b = '<h2>Share with a class</h2><p><span class="b">' + esc(mt.title) + '</span></p><p class="sub small">Every student in the class sees it under Syllabus and materials.</p>' +
      (mine.length ? '<div class="field"><label for="sh-c">Class</label><select id="sh-c" data-bind="form.cid">' + opts(mine.map(c => [c.id, c.id + ' · ' + courseLabel(c) + ' · ' + classStudents(c.id).length + ' students' + (S.shares.some(s => s.mid === mt.id && s.cid === c.id) ? ' · already shared' : '')]), S.form.cid) + '</select></div><div class="btns">' + act('shareSave', mt.id, 'Share', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>'
        : '<p>None of your classes is on this course and semester.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>');
  }
  if (m.t === 'confirm') b = '<h2>Please confirm</h2><p>' + esc(m.text) + '</p><div class="btns">' + act('confirmYes', '', m.okLabel || 'Yes', 'btn primary') + act('confirmNo', '', 'Cancel') + '</div>';
  if (m.t === 'chDone') {
    const [co, sem, sub, n] = m.key.split('|'); const title = (S.chapterTitles || {})[[co, sem, sub, n].join('-')]; const subj = (S.subjects.find(x => x.key === sub) || {}).name || sub;
    b = '<h2>' + esc(subj) + ' · Chapter ' + n + ' paper</h2>' + (title ? '<p class="b">' + esc(title) + '</p>' : '') +
      '<div class="tiles" style="grid-template-columns:1fr"><div><div class="t-v">' + m.pct + '%</div><div class="t-s">' + (m.passed ? 'Passed. Well done!' : 'Below the pass mark of 50%') + '</div></div></div>' +
      '<p class="sub small">' + (m.passed ? 'Your certificate for completing this chapter is ready.' : 'Go over the chapter again, then sit the paper again from your Exams page while it is open. Your best mark counts, and passing earns the certificate.') + '</p>' +
      '<div class="btns">' + (m.passed ? act('cert', m.key, 'View certificate', 'btn primary') : '') + act('modalClose', '', 'Done', m.passed ? 'btn' : 'btn primary') + '</div>';
  }
  if (m.t === 'done') b = '<h2>Exam submitted</h2><p>Your answers are saved. Your mark appears under Exams once the results are published.</p><div class="btns">' + act('modalClose', '', 'Done', 'btn primary') + '</div>';
  if (m.t === 'pw') b = '<h2>Change password</h2><form data-form="changePassword" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="pw-c">Current password</label><input id="pw-c" name="current" type="password" autocomplete="current-password" required></div><div class="field"><label for="pw-n">New password (8 characters or more)</label><input id="pw-n" name="next" type="password" autocomplete="new-password" minlength="8" required></div><div class="btns"><button class="btn primary" type="submit">Change password</button>' + act('modalClose', '', 'Cancel') + '</div></form>';
  if (m.t === 'userReset') {
    const u = S.users.find(x => x.id === m.id);
    b = '<h2>Reset password for ' + esc(u.name) + '</h2><form data-form="userReset" style="display:flex;flex-direction:column;gap:12px"><input type="hidden" name="id" value="' + esc(u.id) + '"><div class="field"><label for="ur-p">New password (8 characters or more)</label><input id="ur-p" name="password" type="password" autocomplete="new-password" minlength="8" required></div><p class="sub small">They will be signed out everywhere and must use the new password.</p><div class="btns"><button class="btn primary" type="submit">Reset password</button>' + act('modalClose', '', 'Cancel') + '</div></form>';
  }
  return '<div class="overlay" data-act="overlay"><div class="modal' + (m.t === 'cert' ? ' modal-cert' : m.t === 'sscImport' || m.t === 'mcqImport' ? ' modal-wide' : '') + '" role="dialog" aria-modal="true">' + b + (m.err ? '<p class="err" role="alert">' + esc(m.err) + '</p>' : '') + '</div></div>';
}
