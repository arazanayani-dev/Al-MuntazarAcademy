/* Location responsible (primary or secondary) and coordinator: overview, classes, students, coordination. */
import { S, TODAY, ME } from '../state.js';
import { DOW, fd, fdl, ft, addDays } from '/shared/dates.js';
import { esc, chip, tile, pct, opts, act, tbl } from '../ui.js';
import {
  locMetrics, pendingResults, classStudents, classAtt, weeksDone, weekLabel, courseLabel, group, teacherName, course,
  allStats, statChip, locCalls, locActions, myLoc, daysAgo
} from '../logic.js';

export const owners = () => { const l = myLoc(); return l ? [[l.primary, l.primary + ' (primary)'], [l.secondary, l.secondary + ' (secondary)']].concat(l.coordinator && l.coordinator !== 'None yet' ? [[l.coordinator, l.coordinator + ' (coordinator)']] : []) : []; };

export function classesTable(code, canOpen) {
  return tbl([['Class'], ['Course and time'], ['Teacher'], ['Students', 1], ['Attendance', 1], ['Syllabus chart']],
    S.classes.filter(c => c.loc === code).map(c => {
      const w = weeksDone(c.id);
      return '<tr><th scope="row">' + (canOpen ? act('openClass', c.id, c.id, 'link') : c.id) + '<div class="sub small" style="font-weight:500">' + group(c.g) + '</div></th><td>' + esc(courseLabel(c)) + '<div class="sub small">' + DOW[c.day] + ' ' + ft(c.time) + '</div></td><td>' + (c.teacherId ? esc(teacherName(c.teacherId)) : chip('gold', 'Awaiting teacher')) + '</td><td class="r">' + classStudents(c.id).length + '</td><td class="r">' + pct(classAtt(c.id)) + '</td><td>' + (w ? weekLabel(c, w) : 'Not started') + '</td></tr>';
    }));
}
function actionRows(filter, canClose) {
  const list = locActions(ME.loc).filter(a => !a.done && (!filter || a.owner === filter));
  return list.map(a => { const late = a.due < TODAY; return '<div class="row"><div><div class="b">' + esc(a.text) + '</div><div class="small ' + (late ? 'warn-t' : 'sub') + '">' + esc(a.owner) + ' · due ' + fd(a.due) + (late ? ' · overdue' + (a.rem ? ', ' + a.rem + ' reminders sent' : '') : '') + '</div></div>' + (canClose ? act('closeAction', a.id, 'Mark done') : '') + '</div>'; }).join('') || '<p class="empty">No open action items.</p>';
}
function coordCard() {
  const l = myLoc(); const calls = locCalls(ME.loc);
  return '<section class="card"><h2>Weekly coordination</h2><div><div class="b">Next call: ' + fdl(l.nextCall) + ' · ' + esc(l.callTime) + '</div><div class="sub small">Every ' + esc(l.callDay) + ' · fixed Meet link · notes typed in after the call</div></div>' +
    '<div class="btns">' + (l.meet ? '<a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(l.meet) + '" target="_blank" rel="noopener">Join Meet</a>' : act('toast', 'No Meet link is set for this location yet. The super admin can add one.', 'Join Meet', 'btn primary')) + (ME.role === 'locadmin' ? act('callOpen', '', 'Record call') : '') + '</div>' +
    '<div class="lab">Last four weeks</div><div class="btns">' + (calls.slice(-4).map(c => chip(c.status === 'Held' ? 'ok' : c.status === 'Missed' ? 'warnfill' : 'gold', fd(c.date).slice(4) + ' · ' + c.status)).join('') || '<span class="sub small">No calls recorded yet.</span>') + '</div></section>';
}

export function viewLocHome() {
  const l = myLoc(); const m = locMetrics(ME.loc); const pend = pendingResults(ME.loc); const await_ = S.classes.filter(c => c.loc === ME.loc && c.status === 'awaiting');
  const acts = locActions(ME.loc);
  const attn = await_.map(c => '<div class="row"><div><div class="b">' + c.id + ' is awaiting a teacher</div><div class="sub small">Created by ' + esc(c.createdBy || 'the coordinator') + (c.createdOn ? ' on ' + fd(c.createdOn) : '') + ' · ' + esc(courseLabel(c)) + ' · ' + group(c.g) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + '</div></div>' + act('assignOpen', c.id, 'Assign teacher', 'btn primary') + '</div>')
    .concat(m.unlogged.sort((a, b) => a.date < b.date ? -1 : 1).map(x => { const d = daysAgo(x.date); return '<div class="row"><div><div class="b">' + x.classId + ' · session not logged for ' + d + ' days</div><div class="small ' + (d > 7 ? 'warn-t' : 'sub') + '">' + fdl(x.date) + '</div></div><div class="btns">' + act('remind', x.id, 'Remind teacher') + act('logOpen', x.id, 'Log it for them') + '</div></div>'; }))
    .concat(S.regs.length ? ['<div class="row"><div><div class="b">' + S.regs.length + (S.regs.length === 1 ? ' registration is' : ' registrations are') + ' waiting for a class</div><div class="sub small">' + S.regs.slice(0, 3).map(r => esc(r.name)).join(', ') + (S.regs.length > 3 ? ' and more' : '') + '</div></div>' + act('nav', 'regs', 'Allocate classes', 'btn primary') + '</div>'] : [])
    .concat(pend.map(p => '<div class="row"><div><div class="b">' + p.c.id + ' · Semester ' + p.sem + ' results to review</div><div class="sub small">' + p.taken + ' of ' + p.total + ' students have exam marks</div></div>' + act('marks', p.c.id + '|' + p.sem, 'Review and publish') + '</div>'));
  return '<div class="head"><div><h1>' + esc(l.name) + '</h1><div class="sub">' + m.classes + ' classes · ' + m.students + ' students · coordinator ' + esc(l.coordinator) + '</div></div><div class="btns">' + act('classNew', '', 'Create class', 'btn primary') + '</div></div>' +
    '<section class="tiles" aria-label="Performance">' +
      tile('Sessions held', m.held + ' of ' + m.planned, (m.planned - m.held) + ' cancelled') +
      tile('Attendance', pct(m.att), 'Last 4 weeks') +
      tile('Sessions not logged', m.unlogged.length, m.old ? m.old + ' older than 7 days' : 'None older than 7 days', m.old > 0) +
      tile('Active students', (m.students - m.fu) + ' of ' + m.students, m.risk + ' at risk · ' + m.fu + ' in follow-up', m.fu > 0) +
      tile('Coordination calls', m.calls + ' of ' + m.callsN, 'Held in the last 4 weeks') + '</section>' +
    '<div class="cols"><div class="main"><section class="card"><h2>Needs your attention</h2><div class="rows">' + (attn.join('') || '<p class="empty">Nothing is waiting for you.</p>') + '</div></section>' +
      '<section class="card"><div class="card-h"><h2>Classes</h2></div>' + classesTable(ME.loc, true) + '</section></div>' +
    '<div class="side">' + coordCard() + '<section class="card"><div class="card-h"><h2>Open action items</h2>' + (acts.some(a => !a.done && a.due < TODAY) ? chip('warn', acts.filter(a => !a.done && a.due < TODAY).length + ' overdue') : '') + '</div><div class="rows">' + actionRows('', true) + '</div></section></div></div>';
}

export function viewClasses() {
  const can = ME.role === 'locadmin';
  return '<div class="head"><div><h1>Classes in ' + esc(ME.locName) + '</h1><div class="sub">' + (can ? 'You can create classes and assign teachers' : 'You can add classes; the primary or secondary responsible person assigns the teacher') + '</div></div><div class="btns">' + act('classNew', '', 'Create class', 'btn primary') + '</div></div>' +
    '<section class="card">' + classesTable(ME.loc, true) + '</section>' +
    (can ? '<section class="card"><h2>Add a teacher</h2><p class="sub small">Teachers added here can then be assigned to classes.</p><form class="form" data-form="teacherAdd"><div class="field"><label for="te-n">Name</label><input id="te-n" name="name" required></div><div class="field"><label for="te-g">Teaches</label><select id="te-g" name="g">' + opts([['F', 'Sisters'], ['M', 'Brothers']], 'F') + '</select></div><button class="btn primary" type="submit">Add teacher</button></form></section>' : '');
}

export function viewStudents() {
  const f = S.p.status || ''; const list = allStats().filter(x => x.c.loc === ME.loc && (!f || x.st.status === f));
  return '<div class="head"><div><h1>Students in ' + esc(ME.locName) + '</h1><div class="sub">Status is worked out from attendance; nobody is ever marked inactive</div></div></div>' +
    '<section class="card"><div class="form"><div class="field" style="max-width:260px"><label for="st-f">Status</label><select id="st-f" data-bind="p.status" data-rerender="1">' + opts([['', 'All'], ['new', 'New'], ['active', 'Active'], ['risk', 'At risk'], ['followup', 'In follow-up']], f) + '</select></div><p class="sub small">' + list.length + ' students</p></div>' +
    tbl([['Student'], ['Class'], ['Status'], ['Missed in a row', 1], ['Attendance', 1], ['']], list.map(x => '<tr><th scope="row">' + esc(x.s.name) + '</th><td>' + x.c.id + '</td><td>' + statChip(x.st.status) + '</td><td class="r">' + x.st.miss + '</td><td class="r">' + pct(x.st.pct) + '</td><td>' + (x.st.status === 'risk' || x.st.status === 'followup' ? act('reminder', x.s.id, 'Preview reminder') : '') + '</td></tr>')) + '</section>';
}

export function viewCoord() {
  return '<div class="head"><div><h1>Coordination</h1><div class="sub">One call a week for this location, with action items followed up until closed</div></div></div>' +
    '<div class="cols"><div class="main">' + coordCard() + '<section class="card"><h2>Open action items</h2><div class="rows">' + actionRows('', true) + '</div></section></div>' +
    '<section class="card side"><h2>Add an action item</h2><form data-form="actionAdd" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="ai-t">What needs doing</label><input id="ai-t" name="text" required></div>' +
      '<div class="field"><label for="ai-o">Owner</label><select id="ai-o" name="owner">' + opts(owners(), ME.name) + '</select></div>' +
      '<div class="field"><label for="ai-d">Due date</label><input id="ai-d" name="due" type="date" value="' + addDays(TODAY, 7) + '"></div>' +
      '<button class="btn primary" type="submit">Add action item</button></form></section></div>';
}

export function viewCoordHome() {
  const await_ = S.classes.filter(c => c.loc === ME.loc && c.status === 'awaiting');
  return '<div class="head"><div><h1>' + esc(ME.locName) + '</h1><div class="sub">Coordinator view</div></div><div class="btns">' + act('classNew', '', 'Create class', 'btn primary') + '</div></div>' +
    '<div class="cols"><div class="main"><section class="card"><div class="card-h"><h2>Registrations awaiting a class</h2><div class="btns">' + chip('gold', S.regs.length + ' waiting') + act('nav', 'regs', 'Register a student', 'btn primary') + '</div></div><div class="rows">' +
      (S.regs.map(r => '<div class="row"><div><div class="b">' + esc(r.name) + '</div><div class="sub small">' + group(r.g) + ' · wants ' + esc(course(r.course).name) + (r.city ? ' · lives in ' + esc(r.city) : '') + '</div></div></div>').join('') || '<p class="empty">No registrations are waiting.</p>') + '</div><p class="sub small">The primary or secondary responsible person allocates each registration to a class.</p></section>' +
      '<section class="card"><h2>Classes awaiting a teacher</h2><div class="rows">' + (await_.map(c => '<div class="row"><div><div class="b">' + c.id + '</div><div class="sub small">' + esc(courseLabel(c)) + ' · ' + group(c.g) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + ' · waiting for the primary or secondary responsible person</div></div></div>').join('') || '<p class="empty">Every class has a teacher.</p>') + '</div></section></div>' +
    '<div class="side">' + coordCard() + '<section class="card"><h2>My action items</h2><div class="rows">' + actionRows(ME.name, true) + '</div></section></div></div>';
}

/* New students enter the system only here. Location staff register them; the location manager allocates a class. */
export function viewRegs() {
  const can = ME.role === 'locadmin'; const regs = S.regs.slice().sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
  const row = r => '<tr><th scope="row">' + esc(r.name) + (r.notes ? '<div class="sub small" style="font-weight:500;white-space:normal">' + esc(r.notes) + '</div>' : '') + '</th><td>' + group(r.g) + '</td><td>' + esc(course(r.course).name) + '</td><td>' + esc(r.city || '') + '</td><td>' + esc([r.phone, r.email].filter(Boolean).join(' · ')) + '</td><td>' + (r.date ? fd(r.date) : '') + (r.by ? '<div class="sub small">by ' + esc(r.by) + '</div>' : '') + '</td><td><div class="btns">' + (can ? act('allocOpen', r.id, 'Allocate a class', 'btn primary') : '') + act('regRemove', r.id, 'Remove', 'link') + '</div></td></tr>';
  return '<div class="head"><div><h1>Registrations</h1><div class="sub">Every new student is registered here first, then ' + (can ? 'you allocate' : 'the location manager allocates') + ' them to a class</div></div></div>' +
    '<div class="cols"><section class="card main"><div class="card-h"><h2>Waiting for a class</h2>' + chip('gold', regs.length + ' waiting') + '</div>' +
      tbl([['Student'], ['Group'], ['Wants'], ['City'], ['Contact'], ['Registered'], ['']], regs.map(row)) + '</section>' +
    '<section class="card side"><h2>Register a student</h2><form data-form="regAdd" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="rg-n">Full name</label><input id="rg-n" name="name" required></div>' +
      '<div class="form"><div class="field"><label for="rg-g">Group</label><select id="rg-g" name="g">' + opts([['F', 'Sisters'], ['M', 'Brothers']], 'F') + '</select></div>' +
      '<div class="field"><label for="rg-c">Course wanted</label><select id="rg-c" name="course">' + opts(S.courses.map(c => [c.code, c.name]), 'INR') + '</select></div></div>' +
      '<div class="field"><label for="rg-ci">City</label><input id="rg-ci" name="city"></div>' +
      '<div class="form"><div class="field"><label for="rg-p">Phone or WhatsApp</label><input id="rg-p" name="phone" type="tel" inputmode="tel"></div>' +
      '<div class="field"><label for="rg-e">Email</label><input id="rg-e" name="email" type="email"></div></div>' +
      '<div class="field"><label for="rg-no">Notes (optional)</label><textarea id="rg-no" name="notes" rows="2"></textarea></div>' +
      '<button class="btn primary" type="submit">Register student</button></form></section></div>';
}
