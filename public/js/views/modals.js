/* Dialogs. */
import { S, ME, TODAY } from '../state.js';
import { DOW, DOWL, fd, fdl, ft } from '/shared/dates.js';
import { esc, opts, act, chip, tx, stmtList, pct } from '../ui.js';
import {
  cls, stu, course, courseLabel, group, classStudents, stuStats, statChip, nextDate, whenFor, nextCounter, QTYPE, myLoc, myStudent
} from '../logic.js';
import { certsFor } from './student.js';
import { owners } from './location.js';

export function modalHtml() {
  const m = S.modal; if (!m) return ''; let b = '';
  if (m.t === 'assign') {
    const c = cls(m.cid); const list = S.teachers.filter(t => t.g === c.g);
    b = '<h2>Assign a teacher to ' + c.id + '</h2><p class="sub">Only ' + (c.g === 'F' ? 'sisters' : 'brothers') + ' are offered, because the teacher must be the same gender as the class.</p>' +
      (list.length ? '<div class="field"><label for="as-t">Teacher</label><select id="as-t" data-bind="form.teacher">' + opts(list.map(t => { const n = S.classes.filter(k => k.teacherId === t.id).length; return [t.id, t.name + ' · ' + n + (n === 1 ? ' class' : ' classes')]; }), S.form.teacher) + '</select></div>' +
      '<div class="btns">' + act('assignSave', c.id, 'Assign teacher', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>' : '<p>No ' + (c.g === 'F' ? 'sister' : 'brother') + ' teachers are on the list yet. Add one under Classes first.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>');
  }
  if (m.t === 'class') {
    const f = S.form; const can = ME.role === 'locadmin'; const k = course(f.course);
    b = '<h2>Create class in ' + esc(ME.locName) + '</h2>' +
      '<div class="form"><div class="field"><label for="cl-c">Course type</label><select id="cl-c" data-bind="form.course" data-rerender="1">' + opts(S.courses.map(c => [c.code, c.name]), f.course) + '</select></div>' +
      '<div class="field"><label for="cl-s">Semester</label><select id="cl-s" data-bind="form.sem">' + opts(Array.from({ length: k.sems }, (_, i) => [i + 1, 'Semester ' + (i + 1)]), f.sem) + '</select></div>' +
      '<div class="field"><label for="cl-l">Language</label><select id="cl-l" disabled><option>English</option></select></div>' +
      '<div class="field"><label for="cl-g">Group</label><select id="cl-g" data-bind="form.g" data-rerender="1">' + opts([['F', 'Sisters'], ['M', 'Brothers']], f.g) + '</select></div>' +
      '<div class="field"><label for="cl-d">Day</label><select id="cl-d" data-bind="form.day">' + opts(DOWL.map((d, i) => [i, d]), f.day) + '</select></div>' +
      '<div class="field"><label for="cl-t">Time (India)</label><input id="cl-t" type="time" data-bind="form.time" value="' + esc(f.time) + '"></div>' +
      (can ? '<div class="field"><label for="cl-te">Teacher</label><select id="cl-te" data-bind="form.teacher">' + opts([['', 'Assign later']].concat(S.teachers.filter(t => t.g === f.g).map(t => [t.id, t.name])), f.teacher) + '</select></div>' : '') +
      '<div class="field"><label for="cl-m">Google Meet link</label><input id="cl-m" type="url" data-bind="form.meet" value="' + esc(f.meet) + '" placeholder="Paste the class Meet link"></div></div>' +
      '<p class="sub small">Class number will be ' + esc(ME.loc) + '-' + f.course + '-' + String(nextCounter(ME.loc, f.course)).padStart(3, '0') + '.' + (can ? '' : ' The class is saved as awaiting teacher until the primary or secondary responsible person assigns one.') + '</p>' +
      '<div class="btns">' + act('classSave', '', 'Create class', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'alloc') {
    const r = S.regs.find(x => x.id === m.rid); const list = S.classes.filter(c => c.g === r.g).sort((a, b) => (a.course === r.course ? 0 : 1) - (b.course === r.course ? 0 : 1));
    b = '<h2>Allocate a class to ' + esc(r.name) + '</h2><p class="sub">' + group(r.g) + ' classes only. A student can be in one class at a time, in any location.</p>' +
      '<div class="field"><label for="al-c">Class</label><select id="al-c" data-bind="form.cid">' + opts(list.map(c => [c.id, c.id + ' · ' + courseLabel(c) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + (c.status === 'awaiting' ? ' · awaiting teacher' : '')]), S.form.cid) + '</select></div>' +
      '<div class="btns">' + act('allocSave', r.id, 'Add student and allocate', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
  }
  if (m.t === 'call') {
    b = '<h2>Record the weekly call</h2><p class="sub">' + fdl(myLoc().nextCall) + '</p>' +
      '<div class="field"><label for="ca-st">Status</label><select id="ca-st" data-bind="form.status">' + opts([['Held', 'Held'], ['Missed', 'Missed'], ['Rescheduled', 'Rescheduled']], S.form.status) + '</select></div>' +
      '<div class="field"><label for="ca-ai">Action item from this call (optional)</label><input id="ca-ai" data-bind="form.text" value="' + esc(S.form.text) + '" placeholder="What needs doing"></div>' +
      '<div class="form"><div class="field"><label for="ca-ow">Owner</label><select id="ca-ow" data-bind="form.owner">' + opts(owners(), S.form.owner) + '</select></div>' +
      '<div class="field"><label for="ca-du">Due date</label><input id="ca-du" type="date" data-bind="form.due" value="' + esc(S.form.due) + '"></div></div>' +
      '<div class="btns">' + act('callSave', '', 'Save call', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
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
    const s = myStudent(); const x = certsFor(s).find(k => k.key === m.key);
    b = '<div class="cert"><div class="cn">Almuntazar Academy</div><div class="eyebrow">Certificate</div><div class="sub">This certifies that</div><div class="nm">' + esc(s.name) + '</div><div>' + esc(x.line) + '.</div><div class="sub small">Issued ' + fd(TODAY) + ' · No. ' + esc(x.no) + '</div><div class="sig">Dean, Almuntazar Academy</div></div>' +
      '<div class="btns">' + act('print', '', 'Print or save as PDF', 'btn primary') + act('modalClose', '', 'Close') + '</div>';
  }
  if (m.t === 'import') {
    const P = S.paper;
    if (!m.step || !P) b = '<h2>Import a question paper</h2><p>Upload a Word or PDF paper with each answer in yellow highlight or in bold. The system reads the questions and shows them for you to check before anything is saved.</p><p class="sub small">Reading uploaded papers is not switched on yet, so this loads the sample paper already read from Tauheed_1_MCQ_paper_-_new.docx.</p><div class="btns">' + act('importRun', '', 'Review what was found', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
    else {
      const qs = P.questions; const total = qs.reduce((t, q) => t + (q.type === 'bank' ? q.blanks : 1), 0); const found = qs.filter(q => q.type !== 'bank' && q.correct !== '').length; const f = S.form.qb;
      b = '<h2>' + qs.length + ' questions found</h2><p class="sub small">Tauheed QP, Chp 1: Paths of recognition · 50 marks · 1 hour · ' + found + ' of ' + total + ' answers were marked in the file, ' + (total - found) + ' are still needed. Ticked questions are saved to ' + esc(course(f.course).name) + ', Semester ' + f.sem + ', the subject chosen in the question bank.</p>' +
        '<p class="small">Word bank for section 3: ' + P.bank.map(tx).join(' · ') + '</p><div>' + S.form.imp.map((q, i) => '<div class="qa"><label class="check"><input type="checkbox" id="im-' + i + '" data-bind="form.imp.' + i + '.include"' + (q.include ? ' checked' : '') + (q.type === 'bank' ? ' disabled' : '') + '><span class="b">' + q.s + '.' + q.n + ' ' + tx(q.text) + '</span></label><div class="btns">' + chip('mute', QTYPE[q.type]) + chip('mute', q.type === 'bank' ? q.blanks + ' blanks, 1 mark each' : q.marks + (q.marks === 1 ? ' mark' : ' marks')) + '</div>' + stmtList(q) +
          (q.type === 'bank' ? '<div class="small warn-t">No answers are marked in the file. The blanks need their words chosen from the bank before this can be saved.</div>' : '<div class="field"><label for="im-c' + i + '">Correct answer</label><select id="im-c' + i + '" data-bind="form.imp.' + i + '.correct">' + opts([['', 'Choose the answer']].concat(q.options.map((o, j) => [j, 'ABCD'[j] + '. ' + o])), q.correct) + '</select></div><div class="small ' + (q.correct === '' ? 'warn-t' : 'sub') + '">' + esc(q.how) + '</div>') + '</div>').join('') + '</div><div class="btns">' + act('importSave', '', 'Save ticked questions', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
    }
  }
  if (m.t === 'share') {
    const mt = S.materials.find(x => x.id === m.mid); const mine = S.classes.filter(c => c.teacherId === ME.teacherId && (mt.course === 'ALL' || (c.course === mt.course && (!mt.sem || c.sem === mt.sem))));
    b = '<h2>Share with a class</h2><p><span class="b">' + esc(mt.title) + '</span></p><p class="sub small">Every student in the class sees it under Syllabus and materials.</p>' +
      (mine.length ? '<div class="field"><label for="sh-c">Class</label><select id="sh-c" data-bind="form.cid">' + opts(mine.map(c => [c.id, c.id + ' · ' + courseLabel(c) + ' · ' + classStudents(c.id).length + ' students' + (S.shares.some(s => s.mid === mt.id && s.cid === c.id) ? ' · already shared' : '')]), S.form.cid) + '</select></div><div class="btns">' + act('shareSave', mt.id, 'Share', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>'
        : '<p>None of your classes is on this course and semester.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>');
  }
  if (m.t === 'done') b = '<h2>Exam submitted</h2><p>Your answers are saved. Your mark appears under Exams once the results are published.</p><div class="btns">' + act('modalClose', '', 'Done', 'btn primary') + '</div>';
  if (m.t === 'pw') b = '<h2>Change password</h2><form data-form="changePassword" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="pw-c">Current password</label><input id="pw-c" name="current" type="password" autocomplete="current-password" required></div><div class="field"><label for="pw-n">New password (8 characters or more)</label><input id="pw-n" name="next" type="password" autocomplete="new-password" minlength="8" required></div><div class="btns"><button class="btn primary" type="submit">Change password</button>' + act('modalClose', '', 'Cancel') + '</div></form>';
  if (m.t === 'userReset') {
    const u = S.users.find(x => x.id === m.id);
    b = '<h2>Reset password for ' + esc(u.name) + '</h2><form data-form="userReset" style="display:flex;flex-direction:column;gap:12px"><input type="hidden" name="id" value="' + esc(u.id) + '"><div class="field"><label for="ur-p">New password (8 characters or more)</label><input id="ur-p" name="password" type="password" autocomplete="new-password" minlength="8" required></div><p class="sub small">They will be signed out everywhere and must use the new password.</p><div class="btns"><button class="btn primary" type="submit">Reset password</button>' + act('modalClose', '', 'Cancel') + '</div></form>';
  }
  return '<div class="overlay" data-act="overlay"><div class="modal" role="dialog" aria-modal="true">' + b + (m.err ? '<p class="err" role="alert">' + esc(m.err) + '</p>' : '') + '</div></div>';
}
