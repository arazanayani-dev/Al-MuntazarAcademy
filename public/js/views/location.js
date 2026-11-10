/* Location responsible (primary or secondary) and coordinator: overview, classes, students, coordination. */
import { S, TODAY, ME } from '../state.js';
import { DOW, DOWL, fd, fdl, ft, addDays, pd } from '/shared/dates.js';
import { esc, chip, tile, pct, opts, act, tbl, pageSlice, pager } from '../ui.js';
import { editBtn } from './edit.js';
import { readinessDetail, chaptersToOpen, myCallsCard } from './shared.js';
import { callPeople } from '/shared/callpeople.js';
import {
  locMetrics, pendingResults, classStudents, classAtt, weeksDone, weekLabel, courseLabel, group, teacherName, course,
  allStats, statChip, locCalls, locActions, myLoc, daysAgo, semReady, ended, levelLabel, levelOpts, levelRank, teacherTitle
} from '../logic.js';

export const owners = () => { const l = myLoc(); return l ? [[l.primary, l.primary + ' (primary)'], [l.secondary, l.secondary + ' (secondary)']].filter(x => x[0]).concat(l.coordinator && l.coordinator !== 'None yet' ? [[l.coordinator, l.coordinator + ' (coordinator)']] : []).concat(callPeople(l).filter(p => !p.post).map(p => [p.name, p.name + ' (participant)'])).concat(ME.role === 'super' ? [[ME.name, ME.name]] : []) : []; };

/* Classes of a location, a page at a time. q narrows by class number, course or teacher. */
export function classesTable(code, canOpen, key, q) {
  const s = (q || '').trim().toLowerCase();
  const list = S.classes.filter(c => c.loc === code && (!s || [c.id, courseLabel(c), teacherName(c.teacherId)].some(v => String(v).toLowerCase().includes(s))))
    .sort((a, b) => (ended(a) ? 1 : 0) - (ended(b) ? 1 : 0));
  const pg = pageSlice(list, S.p['pg_' + key]);
  return tbl([['Class'], ['Course and time'], ['Teacher'], ['Students', 1], ['Attendance', 1], ['Syllabus chart']],
    pg.items.map(c => {
      const w = weeksDone(c.id);
      return '<tr><th scope="row">' + (canOpen ? act('openClass', c.id, c.id, 'link') : c.id) + '<div class="sub small" style="font-weight:500">' + group(c.g) + '</div>' + (c.status === 'completed' ? chip('ok', 'Course completed') : '') + (c.status === 'closed' ? chip('mute', 'Closed') : '') + '</th><td>' + esc(courseLabel(c)) + '<div class="sub small">' + DOW[c.day] + ' ' + ft(c.time) + '</div></td><td>' + (c.teacherId ? esc(teacherName(c.teacherId)) : chip('gold', 'Awaiting teacher')) + '</td><td class="r">' + classStudents(c.id).length + '</td><td class="r">' + pct(classAtt(c.id)) + '</td><td>' + (w ? weekLabel(c, w) : c.startOn > TODAY ? 'Starts ' + fd(c.startOn) : 'Not started') + '</td></tr>';
    })) + pager(key, pg);
}
/* Teacher list with each teacher's level; the level can be changed in place when canEdit. With logins
   (super admin only), it also shows each teacher's username or a button to create one. */
/* Teacher list. A promoted teacher's level comes from the academic team; with canEdit (super admin) the level
   and details of teachers from before promotions can still be set here, and logins listed with logins. */
export function teachersTable(list, canEdit, logins) {
  const login = t => { const u = S.users.find(x => x.teacherId === t.id || (t.sid && x.studentId === t.sid)); return '<td>' + (u ? esc(u.username) : '<span class="sub">No login yet</span>') + '</td>'; };
  const old = t => canEdit && !t.sid;
  return tbl([['Teacher'], ['Group'], ['Can teach'], ['Classes']].concat(logins ? [['Login']] : []).concat(canEdit ? [['']] : []), list.map(t => '<tr><th scope="row">' + esc(teacherTitle(t)) + (t.sid ? '' : ' ' + chip('warn', 'Not linked to a student')) + '</th><td>' + group(t.g) + '</td><td>' + esc(levelLabel(t)) +
    '</td><td>' + (S.classes.filter(c => c.teacherId === t.id && !ended(c)).map(c => c.id).join(', ') || 'None yet') + '</td>' + (logins ? login(t) : '') + (canEdit ? '<td class="acts">' + (old(t) ? act('teacherLinkOpen', t.id, 'Link to a student', 'btn primary') : '') + '</td>' : '') + '</tr>'));
}
export const levelField = id => '<div class="field"><label for="' + id + '">Can teach up to</label><select id="' + id + '" name="level" required>' + opts([['', 'Choose a level']].concat(levelOpts()), '') + '</select></div>';
function actionRows(filter, canClose) {
  const list = locActions(myLoc().code).filter(a => !a.done && (!filter || a.owner === filter));
  return list.map(a => { const late = a.due < TODAY; return '<div class="row"><div><div class="b">' + esc(a.text) + '</div><div class="small ' + (late ? 'warn-t' : 'sub') + '">' + esc(a.owner) + ' · due ' + fd(a.due) + (late ? ' · overdue' + (a.rem ? ', ' + a.rem + ' reminders sent' : '') : '') + '</div>' + (a.callDate ? '<div class="sub small">From the call of ' + fd(a.callDate) + (a.quote ? ': “' + esc(a.quote) + '”' : '') + '</div>' : '') + '</div><div class="btns">' + (canCoord() ? editBtn('action', a.id) : '') + (canClose ? act('closeAction', a.id, 'Mark done') : '') + '</div></div>'; }).join('') || '<p class="empty">No open action items.</p>';
}
const canCoord = () => ME.role === 'locadmin' || ME.role === 'coord' || ME.role === 'super';
/* who is on the weekly call: the location's staff always, and the students added */
function participantsBlock(l) {
  const list = callPeople(l); const can = ME.role === 'locadmin' || ME.role === 'super';
  const free = (ME.role === 'super' ? S.students : S.callPicks || []).filter(s => !s.left && !list.some(p => p.sid === s.id)).sort((a, b) => a.name.localeCompare(b.name));
  return '<div class="lab">Participants</div><div class="rows">' + (list.map(p => '<div class="row" style="padding:4px 0"><div>' + esc(p.name) + ((l.clashes || {})[p.sid] ? '<div class="small warn-t">Clash: also on the ' + esc(l.clashes[p.sid].join(' and ')) + ' call at this time</div>' : '') + '</div>' + (p.post ? chip('mute', p.post) : can ? act('partRemove', l.code + '|' + p.sid, 'Remove') : '') + '</div>').join('') || '<p class="sub small">No participants yet.</p>') + '</div>' +
    (can ? '<div class="form" style="margin-top:6px"><div class="field"><label for="cp-s">Add a participant</label><select id="cp-s" data-bind="form.part">' + opts([['', 'Choose a student']].concat(free.map(s => [s.id, s.name + (s.classId ? ' · ' + s.classId : '')])), S.form.part || '') + '</select></div>' + act('partAdd', l.code, 'Add', 'btn') + '</div>' : '');
}
function coordCard() {
  const l = myLoc(); const calls = locCalls(l.code);
  /* the next meeting from today, even if earlier ones have not been logged */
  let upcoming = l.nextCall > TODAY ? l.nextCall : TODAY; while (DOWL[pd(upcoming).getDay()] !== l.callDay) upcoming = addDays(upcoming, 1);
  return '<section class="card"><h2>Weekly coordination</h2><div><div class="b">Next call: ' + fdl(upcoming) + ' · ' + esc(l.callTime) + '</div><div class="sub small">Every ' + esc(l.callDay) + ' · fixed Meet link · notes typed in after the call</div></div>' +
    '<div class="btns">' + (l.meet ? '<a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(l.meet) + '" target="_blank" rel="noopener">Join Meet</a>' : act('toast', 'No Meet link is set for this location yet. A location responsible or the super admin can add one.', 'Join Meet', 'btn primary')) + (canCoord() ? act('callOpen', '', 'Log a meeting') : '') + (ME.role === 'locadmin' || ME.role === 'super' ? act('schedOpen', l.code, 'Change day, time or link') : '') + '</div>' +
    '<div class="lab">Last four meetings</div><div class="rows">' + (calls.slice(-4).reverse().map(c => { const att = c.att || []; const absent = att.filter(x => !x.present).map(x => x.name);
      return '<div class="row" style="padding:4px 0"><div><div class="btns" style="align-items:center">' + chip(c.status === 'Held' ? 'ok' : c.status === 'Missed' ? 'warnfill' : 'gold', fd(c.date) + ' · ' + c.status) + (att.length ? '<span class="small">' + (att.length - absent.length) + ' of ' + att.length + ' present</span>' : '') + '</div>' + (absent.length ? '<div class="sub small">Absent: ' + esc(absent.join(', ')) + '</div>' : '') + '</div>' +
        (canCoord() ? '<div class="btns">' + (c.status === 'Held' ? act('taskOpen', c.id, 'Tasks from transcript') : '') + act('callOpen', c.id, 'Edit') + act('callRemove', c.id, 'Remove') + '</div>' : '') + '</div>'; }).join('') || '<p class="sub small">No meetings logged yet.</p>') + '</div>' + participantsBlock(l) + '</section>';
}

/* Registrations: a student is first registered here, then allocated a class. Students who left a class without
   moving to another one wait here too. */
function regsCard() {
  /* search by name, phone or email, then 20 to a page */
  const q = String(S.p.rq || '').trim().toLowerCase();
  const list = S.regs.filter(r => !q || [r.name, r.phone, r.email, r.city].some(v => String(v || '').toLowerCase().includes(q)));
  const pg = pageSlice(list, S.p.pg_regs);
  return '<section class="card"><div class="card-h"><h2>Waiting for a class</h2>' + chip(S.regs.length ? 'gold' : 'mute', S.regs.length + ' waiting') + '</div>' +
    (S.regs.length > 5 ? '<div class="field" style="max-width:360px"><label for="rq">Search</label><input id="rq" type="search" placeholder="Name, phone or email" data-bind="p.rq" data-rerender="1" value="' + esc(S.p.rq || '') + '"></div>' : '') +
    '<div class="rows">' +
    (pg.items.map(r => '<div class="row"><div><div class="b">' + esc(r.name) + '</div><div class="sub small">' + (ME.role === 'super' ? esc((S.locations.find(l => l.code === r.loc) || {}).name || r.loc) + ' · ' : '') + group(r.g) + ' · ' + (r.sem ? (r.removed ? 'wants ' : 'repeats ') + esc(course(r.course).name) + ' Semester ' + r.sem + (r.from ? ' · was in ' + esc(r.from) : '') : 'wants ' + esc(course(r.course).name)) + (r.city ? ' · ' + esc(r.city) : '') + '</div>' + (r.phone || r.email || r.dob ? '<div class="sub small">' + [r.dob ? 'Born ' + fd(r.dob).slice(4) + ' ' + r.dob.slice(0, 4) : '', esc(r.phone || ''), esc(r.email || '')].filter(Boolean).join(' · ') + '</div>' : '') + '</div><div class="btns">' + editBtn('reg', r.id) + (r.sid ? '' : act('regRemove', r.id, 'Remove')) + act('allocOpen', r.id, 'Allocate a class', 'btn primary') + '</div></div>').join('') ||
      (q ? '<p class="empty">Nobody waiting matches "' + esc(S.p.rq) + '".</p>' : '<p class="empty">Nobody is waiting. Students you register appear here until they are given a class.</p>')) + '</div>' + pager('regs', pg) + '</section>';
}
/* The classes students have been allocated to, each opening its list of students */
const regClasses = () => S.classes.filter(c => ME.role === 'super' || c.loc === ME.loc);
function allocatedCard() {
  const cid = S.p.rcls;
  const c = cid && S.classes.find(x => x.id === cid);
  if (c) {
    const q = String(S.p.raq || '').trim().toLowerCase();
    const all = classStudents(c.id).slice().sort((a, b) => (b.joined || '') < (a.joined || '') ? -1 : (b.joined || '') > (a.joined || '') ? 1 : a.name < b.name ? -1 : 1);
    const list = all.filter(s => !q || [s.name, s.phone, s.email, s.city].some(v => String(v || '').toLowerCase().includes(q)));
    const pg = pageSlice(list, S.p.pg_ralloc);
    return '<section class="card"><div>' + act('regClass', '', 'All classes', 'link') + '</div>' +
      '<div class="card-h"><div><h2>' + esc(c.id) + '</h2><div class="sub small">' + esc(courseLabel(c)) + ' · ' + group(c.g) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + ' · ' + esc(teacherName(c.teacherId) || 'Awaiting teacher') + '</div></div><div class="btns">' + chip('ok', all.length + (all.length === 1 ? ' student' : ' students')) + act('openClass', c.id, 'Open class page') + '</div></div>' +
      (all.length > 5 ? '<div class="field" style="max-width:360px"><label for="raq">Search</label><input id="raq" type="search" placeholder="Name, phone or email" data-bind="p.raq" data-rerender="1" value="' + esc(S.p.raq || '') + '"></div>' : '') +
      tbl([['Student'], ['Contact'], ['City'], ['In this class since'], ['Allocated by']], pg.items.map(s => '<tr><th scope="row">' + esc(s.name) + '</th><td>' + esc([s.phone, s.email].filter(Boolean).join(' · ')) + '</td><td>' + esc(s.city || '') + '</td><td>' + (s.joined ? fd(s.joined) : '') + '</td><td>' + esc(s.allocatedBy || '') + '</td></tr>')) + pager('ralloc', pg) + '</section>';
  }
  const rows = regClasses().map(x => ({ c: x, n: classStudents(x.id).length, last: classStudents(x.id).reduce((m, s) => (s.joined || '') > m ? s.joined : m, '') }))
    .sort((a, b) => (ended(a.c) ? 1 : 0) - (ended(b.c) ? 1 : 0) || (a.c.id < b.c.id ? -1 : 1));
  const total = rows.reduce((t, r) => t + r.n, 0);
  const pg = pageSlice(rows, S.p.pg_rclasses);
  return '<section class="card"><div class="card-h"><h2>Allocated to a class</h2>' + chip('ok', total + (total === 1 ? ' student' : ' students') + ' in ' + rows.length + (rows.length === 1 ? ' class' : ' classes')) + '</div>' +
    tbl([['Class'], ['Course'], ['Group'], ['Teacher'], ['Students', 1], ['Last allocated'], ['']], pg.items.map(r => '<tr><th scope="row">' + act('regClass', r.c.id, esc(r.c.id), 'link') + (ended(r.c) ? ' ' + chip('mute', 'Finished') : '') + '</th><td>' + esc(courseLabel(r.c)) + '</td><td>' + group(r.c.g) + '</td><td>' + esc(teacherName(r.c.teacherId) || 'Awaiting teacher') + '</td><td class="r">' + r.n + '</td><td>' + (r.last ? fd(r.last) : '–') + '</td><td>' + act('regClass', r.c.id, 'View students') + '</td></tr>')) + pager('rclasses', pg) + '</section>';
}
function regForm() {
  return '<section class="card"><h2>Register a new student</h2><form class="form" data-form="regAdd">' +
      /* the super admin is not tied to a location, so chooses which one the student registers at */
      (ME.role === 'super' ? '<div class="field"><label for="rg-a">Academy location</label><select id="rg-a" name="loc" required>' + opts([['', 'Choose']].concat(S.locations.filter(l => !l.disabled).map(l => [l.code, l.name])), '') + '</select></div>' : '') +
      '<div class="field"><label for="rg-n">Name</label><input id="rg-n" name="first" autocomplete="off" required></div>' +
      '<div class="field"><label for="rg-l">Last name</label><input id="rg-l" name="last" autocomplete="off" required></div>' +
      '<div class="field"><label for="rg-g">Gender</label><select id="rg-g" name="g" required>' + opts([['', 'Choose'], ['F', 'Female'], ['M', 'Male']], '') + '</select></div>' +
      '<div class="field"><label for="rg-d">Date of birth</label><input id="rg-d" name="dob" type="date" min="1900-01-01" max="' + TODAY + '" required></div>' +
      '<div class="field"><label for="rg-t">Location</label><input id="rg-t" name="city" value="' + esc(ME.locName || '') + '" required></div>' +
      '<div class="field"><label for="rg-p">Phone number</label><input id="rg-p" name="phone" type="tel" autocomplete="off" required></div>' +
      '<div class="field"><label for="rg-e">Email ID</label><input id="rg-e" name="email" type="email" autocomplete="off" required></div>' +
      '<div class="field"><label for="rg-c">Course wanted</label><select id="rg-c" name="course">' + opts(S.courses.map(c => [c.code, c.name]), 'BAS') + '</select></div>' +
      '<button class="btn primary" type="submit">Register student</button></form></section>';
}
/* on the overview: how many are waiting, with the way to the Registrations page */
function regsSummary() {
  return '<section class="card"><div class="card-h"><h2>Registrations</h2>' + chip(S.regs.length ? 'gold' : 'mute', S.regs.length + ' waiting for a class') + '</div><div class="btns">' + act('nav', 'regs', 'Register or allocate students', 'btn primary') + '</div></section>';
}
export function viewRegistrations() {
  const tab = S.p.rtab === 'allocated' ? 'allocated' : 'waiting';
  const allocated = regClasses().reduce((t, c) => t + classStudents(c.id).length, 0);
  const tb = (k, label, n) => '<button type="button" class="pick' + (tab === k ? ' on' : '') + '" aria-pressed="' + (tab === k) + '" data-act="regTab" data-arg="' + k + '">' + label + ' (' + n + ')</button>';
  return '<div class="head"><div><h1>' + (ME.role === 'super' ? 'Registrations' : 'Registrations in ' + esc(ME.locName)) + '</h1><div class="sub">Register a student first, then allocate a class. Allocated students move to the Allocated tab, listed by class.</div></div></div>' +
    '<div class="seg" role="group" aria-label="Registrations" style="max-width:480px">' + tb('waiting', 'Waiting', S.regs.length) + tb('allocated', 'Allocated', allocated) + '</div>' +
    (tab === 'waiting' ? regForm() + regsCard() : allocatedCard());
}

export function viewLocHome() {
  const l = myLoc(); const m = locMetrics(ME.loc); const pend = pendingResults(ME.loc); const await_ = S.classes.filter(c => c.loc === ME.loc && c.status === 'awaiting');
  const acts = locActions(ME.loc);
  const attn = await_.map(c => '<div class="row"><div><div class="b">' + c.id + ' is awaiting a teacher</div><div class="sub small">Created by ' + esc(c.createdBy || 'the coordinator') + (c.createdOn ? ' on ' + fd(c.createdOn) : '') + ' · ' + esc(courseLabel(c)) + ' · ' + group(c.g) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + '</div></div>' + act('assignOpen', c.id, 'Assign teacher', 'btn primary') + '</div>')
    .concat(m.unlogged.sort((a, b) => a.date < b.date ? -1 : 1).map(x => { const d = daysAgo(x.date); return '<div class="row"><div><div class="b">' + x.classId + ' · session not logged for ' + d + ' days</div><div class="small ' + (d > 7 ? 'warn-t' : 'sub') + '">' + fdl(x.date) + '</div></div><div class="btns">' + act('remind', x.id, 'Remind teacher') + act('logOpen', x.id, 'Log it for them') + '</div></div>'; }))
    .concat(S.classes.filter(c => c.loc === ME.loc && semReady(c).ready).map(c => { const r = semReady(c); return '<div class="row"><div><div class="b">' + c.id + ' has finished Semester ' + c.sem + '</div><div class="sub small">All ' + r.weeks + ' sessions held and results published · choose who moves on</div></div>' + act('promoteOpen', c.id, r.last ? 'Complete the course' : 'Move to Semester ' + (c.sem + 1), 'btn primary') + '</div>'; }))
    /* classes that have finished their course and can move up a level */
    .concat(S.classes.filter(c => c.loc === ME.loc && c.status === 'completed' && !c.promotedTo && S.courses[levelRank(c.course) + 1]).map(c => '<div class="row"><div><div class="b">' + c.id + ' has completed ' + esc(course(c.course).name) + '</div><div class="sub small">Ready to move up to ' + esc(S.courses[levelRank(c.course) + 1].name) + '</div></div>' + act('nextOpen', c.id, 'Move up', 'btn primary') + '</div>'))
    /* chapters a class has finished whose paper nobody has opened yet */
    .concat(S.classes.filter(c => c.loc === ME.loc).flatMap(c => chaptersToOpen(c).map(x => '<div class="row"><div><div class="b">' + c.id + ' · ' + esc(x.k.name) + ' chapter ' + x.n + ' paper is ready to open</div><div class="sub small">Finished in week ' + x.due.week + ' (' + fd(x.due.on) + ') · the teacher has not opened it yet</div></div>' + act('chWinOpen', c.id + '|' + x.k.key + '|' + x.n, 'Open paper') + '</div>')))
    /* teachers not yet ready to teach the syllabus of their class (a warning; sessions can still be logged) */
    .concat((S.readiness || []).filter(r => !r.ready).map(r => '<div class="row"><div><div class="b">' + esc(r.teacher) + ' is not ready to teach ' + esc(r.title) + '</div><div class="small warn-t">' + esc(r.cids.join(', ')) + ' · ' + readinessDetail(r) + '</div></div></div>'))
    .concat(pend.map(p =>'<div class="row"><div><div class="b">' + p.c.id + ' · Semester ' + p.sem + ' results to review</div><div class="sub small">' + p.taken + ' of ' + p.total + ' students have exam marks</div></div>' + act('marks', p.c.id + '|' + p.sem, 'Review and publish') + '</div>'));
  return '<div class="head"><div><h1>' + esc(l.name) + '</h1><div class="sub">' + m.classes + ' classes · ' + m.students + ' students · coordinator ' + esc(l.coordinator) + '</div></div><div class="btns">' + act('classNew', '', 'Create class', 'btn primary') + '</div></div>' +
    '<section class="tiles" aria-label="Performance">' +
      tile('Sessions held', m.held + ' of ' + m.planned, (m.planned - m.held) + ' cancelled') +
      tile('Attendance', pct(m.att), 'Last 4 weeks') +
      tile('Sessions not logged', m.unlogged.length, m.old ? m.old + ' older than 7 days' : 'None older than 7 days', m.old > 0) +
      tile('Active students', (m.students - m.fu) + ' of ' + m.students, m.risk + ' at risk · ' + m.fu + ' in follow-up', m.fu > 0) +
      tile('Coordination calls', m.calls + ' of ' + m.callsN, 'Held in the last 4 weeks') + '</section>' +
    '<div class="cols"><div class="main">' + myCallsCard() + '<section class="card"><h2>Needs your attention</h2><div class="rows">' + (attn.join('') || '<p class="empty">Nothing is waiting for you.</p>') + '</div></section>' + regsSummary() +
      '<section class="card"><div class="card-h"><h2>Classes</h2></div>' + classesTable(ME.loc, true, 'home') + '</section></div>' +
    '<div class="side">' + coordCard() + '<section class="card"><div class="card-h"><h2>Open action items</h2>' + (acts.some(a => !a.done && a.due < TODAY) ? chip('warn', acts.filter(a => !a.done && a.due < TODAY).length + ' overdue') : '') + '</div><div class="rows">' + actionRows('', true) + '</div></section></div></div>';
}

export function viewClasses() {
  const can = ME.role === 'locadmin';
  return '<div class="head"><div><h1>Classes in ' + esc(ME.locName) + '</h1><div class="sub">' + (can ? 'You can create classes and assign teachers' : 'You can add classes; the primary or secondary responsible person assigns the teacher') + '</div></div><div class="btns">' + act('classNew', '', 'Create class', 'btn primary') + '</div></div>' +
    '<section class="card"><div class="form"><div class="field" style="max-width:320px"><label for="cl-q">Search</label><input id="cl-q" type="search" data-bind="p.q" data-rerender="1" value="' + esc(S.p.q || '') + '" placeholder="Class number, course or teacher"></div></div>' + classesTable(ME.loc, true, 'classes', S.p.q) + '</section>' +
    '<section class="card"><h2>Teachers</h2><p class="sub small">A teacher can take classes at their level and below. Levels run ' + esc(S.courses.map(c => c.name).join(', ')) + '.</p>' +
      teachersTable(S.teachers.filter(t => !t.loc || t.loc === ME.loc), false) +
      '<p class="sub small" style="margin-top:8px">New teachers come from the academic team, who promote a student to a teaching level once they have passed that course.</p></section>';
}

export function viewStudents() {
  const f = S.p.status || ''; const q = (S.p.q || '').trim().toLowerCase();
  const list = allStats().filter(x => x.c.loc === ME.loc && (!f || x.st.status === f) && (!q || x.s.name.toLowerCase().includes(q) || x.c.id.toLowerCase().includes(q)))
    .sort((a, b) => a.s.name.localeCompare(b.s.name));
  const pg = pageSlice(list, S.p.pg_students);
  return '<div class="head"><div><h1>Students in ' + esc(ME.locName) + '</h1><div class="sub">Status is worked out from attendance; nobody is ever marked inactive</div></div></div>' +
    '<section class="card"><div class="form"><div class="field" style="max-width:320px"><label for="st-q">Search</label><input id="st-q" type="search" data-bind="p.q" data-rerender="1" value="' + esc(S.p.q || '') + '" placeholder="Student name or class number"></div>' +
      '<div class="field" style="max-width:260px"><label for="st-f">Status</label><select id="st-f" data-bind="p.status" data-rerender="1">' + opts([['', 'All'], ['new', 'New'], ['active', 'Active'], ['risk', 'At risk'], ['followup', 'In follow-up']], f) + '</select></div><p class="sub small">' + list.length + ' students</p></div>' +
    tbl([['Student'], ['Class'], ['Status'], ['Missed in a row', 1], ['Attendance', 1], ['']], pg.items.map(x => '<tr><th scope="row">' + esc(x.s.name) + '</th><td>' + act('openClass', x.c.id, x.c.id, 'link') + '</td><td>' + statChip(x.st.status) + '</td><td class="r">' + x.st.miss + '</td><td class="r">' + pct(x.st.pct) + '</td><td>' + (x.st.status === 'risk' || x.st.status === 'followup' ? act('reminder', x.s.id, 'Preview reminder') : '') + '</td></tr>')) + pager('students', pg) + '</section>';
}

export function viewCoord() {
  const su = ME.role === 'super'; const code = myLoc().code;
  return '<div class="head"><div><h1>Coordination</h1><div class="sub">One call a week for ' + (su ? 'each' : 'this') + ' location, with action items followed up until closed</div></div></div>' +
    (su ? '<section class="card"><div class="form"><div class="field" style="max-width:320px"><label for="co-l">Location</label><select id="co-l" data-bind="p.loc" data-rerender="1">' + opts(S.locations.filter(l => !l.disabled).map(l => [l.code, l.name]), code) + '</select></div></div></section>' : '') +
    '<div class="cols"><div class="main">' + coordCard() + '<section class="card"><h2>Open action items</h2><div class="rows">' + actionRows('', true) + '</div></section></div>' +
    '<section class="card side"><h2>Add an action item</h2><form data-form="actionAdd" style="display:flex;flex-direction:column;gap:12px">' + (su ? '<input type="hidden" name="loc" value="' + esc(code) + '">' : '') +
      '<div class="field"><label for="ai-t">What needs doing</label><input id="ai-t" name="text" required></div>' +
      '<div class="field"><label for="ai-o">Owner</label><select id="ai-o" name="owner">' + opts(owners(), ME.name) + '</select></div>' +
      '<div class="field"><label for="ai-d">Due date</label><input id="ai-d" name="due" type="date" value="' + addDays(TODAY, 7) + '"></div>' +
      '<button class="btn primary" type="submit">Add action item</button></form></section></div>';
}

export function viewCoordHome() {
  const await_ = S.classes.filter(c => c.loc === ME.loc && c.status === 'awaiting');
  return '<div class="head"><div><h1>' + esc(ME.locName) + '</h1><div class="sub">Coordinator view</div></div><div class="btns">' + act('classNew', '', 'Create class', 'btn primary') + '</div></div>' +
    '<div class="cols"><div class="main">' + myCallsCard() + regsSummary() +
      '<section class="card"><h2>Classes awaiting a teacher</h2><div class="rows">' + (await_.map(c => '<div class="row"><div><div class="b">' + c.id + '</div><div class="sub small">' + esc(courseLabel(c)) + ' · ' + group(c.g) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + ' · waiting for the primary or secondary responsible person</div></div></div>').join('') || '<p class="empty">Every class has a teacher.</p>') + '</div></section></div>' +
    '<div class="side">' + coordCard() + '<section class="card"><h2>My action items</h2><div class="rows">' + actionRows(ME.name, true) + '</div></section></div></div>';
}
