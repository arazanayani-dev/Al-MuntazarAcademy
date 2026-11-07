/* Super admin: overview of all locations, locations, master lists, user accounts and reports. */
import { S, TODAY, ME } from '../state.js';
import { DOW, DOWL, fd, fdl, ft, addDays, weekStart } from '/shared/dates.js';
import { esc, chip, tile, pct, opts, act, tbl, pageSlice, pager } from '../ui.js';
import {
  locMetrics, cls, course, courseLabel, group, teacherName, classStudents, allSessions, stuStats, statChip, semResult, ended, startOf, approved,
  classAtt, allStats, attIn, locCalls, daysAgo, TG, rd, metBoth, avg, personOpts, activeLocs
} from '../logic.js';
import { teachersTable, levelField } from './location.js';
import { editBtn } from './edit.js';
import { myCallsCard } from './shared.js';

function locRow(l) {
  const m = locMetrics(l.code);
  return { classes: m.classes, students: m.students, held: m.planned ? Math.round(m.held / m.planned * 100) : null, att: m.att, pass: m.pass, calls: m.calls, callsN: m.callsN, actions: m.actions, await: m.awaiting, unlogged: m.old };
}

export function viewSuperHome() {
  const rows = activeLocs().map(l => ({ l, r: locRow(l) }));
  const sum = k => rows.reduce((a, x) => a + (x.r[k] || 0), 0);
  const ready = Object.keys(S.qcount || {}).length; /* course-semester-subject papers with approved questions */
  const waiting = ['questions', 'materials', 'trainings', 'traditions'].reduce((t, k) => t + (S[k] || []).filter(x => x.status === 'pending').length, 0);
  const examSlots = S.courses.reduce((t, c) => t + c.sems * S.subjects.filter(s => s.exam).length, 0);
  const chartSlots = S.courses.reduce((t, c) => t + c.sems, 0);
  return '<div class="head"><div><h1>All locations</h1><div class="sub">' + rows.length + ' locations · ' + sum('classes') + ' classes · ' + sum('students') + ' students</div></div>' +
    '<div class="btns">' + act('nav', 'locations', 'Add location', 'btn primary') + '</div></div>' + myCallsCard() +
    '<section class="tiles" aria-label="Academy performance">' +
      tile('Locations', rows.length,'Each with a responsible person') +
      tile('Classes', sum('classes'), 'Across all locations') +
      tile('Students', sum('students'), 'Enrolled now') +
      tile('Classes awaiting a teacher', sum('await'), 'Created by coordinators') +
      tile('Sessions not logged', sum('unlogged'), 'Older than 7 days', sum('unlogged') > 0) +
    '</section>' +
    '<section class="card"><div class="card-h"><h2>Locations side by side</h2><span class="sub small">Worked out from the records of each location</span></div>' +
      tbl([['Location'], ['Primary responsible'], ['Classes', 1], ['Students', 1], ['Sessions held', 1], ['Attendance', 1], ['Pass rate', 1], ['Calls, last 4 weeks'], ['Open actions', 1], ['']],
        rows.map(x => '<tr><th scope="row">' + esc(x.l.name) + ' <span class="sub">' + esc(x.l.code) + '</span></th><td>' + esc(x.l.primary) + '</td><td class="r">' + x.r.classes + '</td><td class="r">' + x.r.students + '</td><td class="r">' + pct(x.r.held) + '</td><td class="r">' + pct(x.r.att) + '</td><td class="r">' + pct(x.r.pass) + '</td><td>' + (x.r.callsN ? (x.r.calls < 3 ? chip('warnfill', x.r.calls + ' of ' + x.r.callsN + ' held') : x.r.calls + ' of ' + x.r.callsN + ' held') : '<span class="sub">None recorded</span>') + '</td><td class="r">' + x.r.actions + '</td><td>' + act('report', x.l.code, 'Report') + '</td></tr>')) +
    '</section>' +
    '<div class="cols"><section class="card main"><h2>Academic readiness</h2><div class="rows">' +
      '<div class="row"><div>Syllabus charts loaded</div><div class="b num">' + Object.keys(S.charts).filter(k => S.charts[k]).length + ' of ' + chartSlots + '</div></div>' +
      '<div class="row"><div>Exam papers with approved questions</div><div class="b num">' + ready + ' of ' + examSlots + '</div></div>' +
      '<div class="row"><div>Approved questions in the bank</div><div class="b num">' + S.questions.filter(q => !q.retired && approved(q)).length + '</div></div>' +
      '<div class="row"><div>Approved traditions in the library</div><div class="b num">' + S.traditions.filter(approved).length + '</div></div>' +
      '<div class="row"><div>Waiting for approval</div><div class="b num">' + waiting + '</div></div></div>' +
      '<p class="sub small">These counts come from what the academic team has loaded and approved.</p></section>' +
    '<section class="card side"><h2>Reports and MIS</h2><p class="sub">Predefined reports, or build your own with filters and chosen columns.</p>' + act('nav', 'reports', 'Open reports', 'btn primary') + '</section></div>';
}

/* Every class in every location, for the super admin: open it, or edit it (including its start date). */
export function viewAllClasses() {
  const lc = S.p.loc || ''; const q = (S.p.q || '').trim().toLowerCase();
  const list = S.classes.filter(c => (!lc || c.loc === lc) && (!q || [c.id, courseLabel(c), teacherName(c.teacherId)].some(v => String(v).toLowerCase().includes(q))))
    .sort((a, b) => (ended(a) ? 1 : 0) - (ended(b) ? 1 : 0) || (a.id < b.id ? -1 : 1));
  const pg = pageSlice(list, S.p.pg_all);
  return '<div class="head"><div><h1>Classes</h1><div class="sub">Every class in every location. Only the super admin can change a start date.</div></div><div class="btns">' + act('classNew', '', 'Create class', 'btn primary') + '</div></div>' +
    '<section class="card"><div class="form"><div class="field"><label for="ac-l">Location</label><select id="ac-l" data-bind="p.loc" data-rerender="1">' + opts([['', 'All locations']].concat(S.locations.map(l => [l.code, l.name])), lc) + '</select></div>' +
      '<div class="field"><label for="ac-q">Search</label><input id="ac-q" type="search" data-bind="p.q" data-rerender="1" value="' + esc(S.p.q || '') + '" placeholder="Class number, course or teacher"></div><p class="sub small">' + list.length + ' classes</p></div>' +
    tbl([['Class'], ['Location'], ['Course'], ['Teacher'], ['Day and time (India)'], ['Start date'], ['Students', 1], ['']],
      pg.items.map(c => '<tr><th scope="row">' + act('openClass', c.id, c.id, 'link') + ' <span class="sub small" style="font-weight:500">' + group(c.g) + '</span>' + (ended(c) ? ' ' + chip('mute', c.status === 'closed' ? 'Closed' : 'Completed') : '') + '</th><td>' + esc((S.locations.find(l => l.code === c.loc) || { name: c.loc }).name) + '</td><td>' + esc(courseLabel(c)) + '</td><td>' + esc(teacherName(c.teacherId) || 'Awaiting teacher') + '</td><td>' + DOW[c.day] + ' ' + ft(c.time) + '</td><td>' + (startOf(c) ? fd(startOf(c)) : '–') + '</td><td class="r">' + classStudents(c.id).length + '</td><td class="acts">' + (ended(c) ? '' : editBtn('class', c.id)) + '</td></tr>')) + pager('all', pg) + '</section>';
}

/* someone named at a location has its role through their login; without one they cannot sign in to do the job */
const post = (l, k) => esc(l[k]) + (l[k + 'Sid'] && !S.users.some(u => u.studentId === l[k + 'Sid']) ? ' ' + chip('warn', 'No login yet') : '');

export function viewLocations() {
  /* disabled locations are kept for reference on their own tab, away from the working list */
  const off = S.locations.filter(l => l.disabled); const tab = S.p.locs === 'disabled' ? 'disabled' : 'active';
  const shown = tab === 'disabled' ? off : activeLocs();
  const tabBtn = (k, label) => act('locsTab', k, label, tab === k ? 'btn primary' : 'btn');
  return '<div class="head"><div><h1>Locations</h1><div class="sub">Each location has a short code used in class numbers</div></div></div>' +
    '<section class="card"><div class="btns" style="margin-bottom:8px">' + tabBtn('active', 'Active (' + activeLocs().length + ')') + tabBtn('disabled', 'Disabled (' + off.length + ')') + '</div>' +
      (tab === 'disabled' && !off.length ? '<p class="empty">No locations are disabled.</p>' :
      tbl([['Location'], ['Code'], ['Primary'], ['Secondary'], ['Coordinator'], [tab === 'disabled' ? 'Disabled' : 'Weekly call'], ['']],
      shown.map(l => '<tr><th scope="row">' + esc(l.name) + '</th><td>' + esc(l.code) + '</td><td>' + (l.disabled ? esc(l.primary) : post(l, 'primary')) + '</td><td>' + (l.disabled ? esc(l.secondary) : post(l, 'secondary')) + '</td><td>' + (l.disabled ? esc(l.coordinator) : post(l, 'coordinator')) + '</td><td>' + (l.disabled ? (l.disabledOn ? fd(l.disabledOn) + ' by ' + esc(l.disabledBy || '') : '') + (l.disabledReason ? '<div class="sub small wrapcell">' + esc(l.disabledReason) + '</div>' : '') : esc(l.callDay) + ' · ' + esc(l.callTime)) + '</td><td class="acts"><div class="btns">' + editBtn('location', l.code) + (l.disabled ? act('locEnable', l.code, 'Enable') : act('locOffOpen', l.code, 'Disable')) + '</div></td></tr>'))) + '</section>' +
    '<section class="card"><h2>Add a location</h2><form class="form" data-form="locAdd">' +
      '<div class="field"><label for="la-name">Name</label><input id="la-name" name="name" required></div>' +
      '<div class="field"><label for="la-code">Short code (3 letters)</label><input id="la-code" name="code" maxlength="3" pattern="[A-Za-z]{3}" required></div>' +
      '<div class="field"><label for="la-pri">Primary responsible</label><select id="la-pri" name="primary" required>' + opts(personOpts('', 'Choose a student'), '') + '</select></div>' +
      '<div class="field"><label for="la-sec">Secondary responsible (optional)</label><select id="la-sec" name="secondary">' + opts(personOpts('', 'None'), '') + '</select></div>' +
      '<div class="field"><label for="la-co">Coordinator (optional)</label><select id="la-co" name="coordinator">' + opts(personOpts('', 'None yet'), '') + '</select></div>' +
      '<div class="field"><label for="la-day">Weekly call day</label><select id="la-day" name="callDay">' + opts(DOWL.map(d => [d, d]), 'Monday') + '</select></div>' +
      '<div class="field"><label for="la-time">Call time</label><input id="la-time" name="callTime" value="8:00 PM"></div>' +
      '<div class="field"><label for="la-meet">Fixed Meet link</label><input id="la-meet" name="meet" placeholder="Paste the Google Meet link"></div>' +
      '<button class="btn primary" type="submit">Add location</button></form></section>';
}

export function viewMasters() {
  return '<div class="head"><div><h1>Master lists</h1><div class="sub">New course types and subjects can be added without development work</div></div></div>' +
    '<div class="cols"><section class="card main"><h2>Course types</h2>' +
      tbl([['Course type'], ['Code'], ['Semesters', 1], ['Sessions per semester', 1], ['']], S.courses.map(c => '<tr><th scope="row">' + esc(c.name) + '</th><td>' + esc(c.code) + '</td><td class="r">' + c.sems + '</td><td class="r">' + c.weeks + '</td><td class="acts">' + editBtn('course', c.code) + '</td></tr>')) +
      '<form class="form" data-form="courseAdd"><div class="field"><label for="ca-n">Name</label><input id="ca-n" name="name" required></div>' +
      '<div class="field"><label for="ca-c">Code</label><input id="ca-c" name="code" maxlength="3" pattern="[A-Za-z]{3}" required></div>' +
      '<div class="field"><label for="ca-s">Semesters</label><input id="ca-s" name="sems" type="number" min="1" max="10" value="5"></div>' +
      '<div class="field"><label for="ca-w">Sessions per semester</label><input id="ca-w" name="weeks" type="number" min="1" max="60" value="8"></div>' +
      '<button class="btn primary" type="submit">Add course type</button></form></section>' +
    '<section class="card side"><h2>Subjects in a one-hour session</h2>' +
      tbl([['Subject'], ['Minutes', 1], ['Examined'], ['']], S.subjects.map(s => '<tr><th scope="row">' + esc(s.name) + '</th><td class="r">' + s.min + '</td><td>' + (s.exam ? 'Yes' : 'No') + '</td><td class="acts">' + editBtn('subject', s.key) + '</td></tr>')) +
      '<form class="form" data-form="subjectAdd"><div class="field"><label for="sa-n">Name</label><input id="sa-n" name="name" required></div>' +
      '<div class="field"><label for="sa-m">Minutes</label><input id="sa-m" name="min" type="number" min="1" max="60" value="10"></div>' +
      '<button class="btn primary" type="submit">Add subject</button></form></section></div>' +
    '<section class="card"><h2>Teachers</h2><p class="sub small">A teacher can take classes at their level and below. Levels follow the order of the course types above. Teachers are not added here: every teacher is a student first, and the academic team promotes them under Teaching levels. A teacher marked "Not linked to a student" cannot be given new classes until linked to their student record.' + ((ME.roles || []).includes('acmaker') ? ' ' + act('nav', 'acmaker:teachers', 'Promote teachers', 'link') : '') + '</p>' +
      teachersTable(S.teachers, true, true) + '</section>';
}

export const ROLE_NAMES = { super: 'Super admin', acmaker: 'Academic content creator', academic: 'Academic content approver', locadmin: 'Location responsible', coord: 'Coordinator', trainer: 'Teacher training faculty', social: 'Social media content creator', support: 'Systems support', teacher: 'Teacher', student: 'Student' };
export const ASSIGNABLE = ['super', 'acmaker', 'academic', 'locadmin', 'coord', 'trainer', 'social', 'support'];

/* Every login belongs to a person (registered as a student first). Roles are assigned to the login; teacher
   comes from a teaching level and student from the person, so neither is ticked here. */
export function viewUsers() {
  const f = S.form.ua || (S.form.ua = { q: '' });
  const q = (f.q || '').trim().toLowerCase();
  const free = S.students.filter(s => !S.users.some(u => u.studentId === s.id) && (!q || s.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const where = u => u.loc ? (S.locations.find(l => l.code === u.loc) || {}).name || u.loc : '';
  /* disabled logins are kept for reference on their own tab, away from the working list */
  const off = S.users.filter(u => u.disabled); const tab = S.p.users === 'disabled' ? 'disabled' : 'active';
  const shown = tab === 'disabled' ? off : S.users.filter(u => !u.disabled);
  const tabBtn = (k, label) => act('usersTab', k, label, tab === k ? 'btn primary' : 'btn');
  return '<div class="head"><div><h1>People and logins</h1><div class="sub">Every person is registered as a student first. A login belongs to one person and can hold several roles; teacher comes from a teaching level given by the academic team.</div></div></div>' +
    '<div class="cols"><section class="card main"><div class="btns" style="margin-bottom:8px">' + tabBtn('active', 'Active (' + (S.users.length - off.length) + ')') + tabBtn('disabled', 'Disabled (' + off.length + ')') + '</div>' +
      (tab === 'disabled' && !off.length ? '<p class="empty">No logins are disabled.</p>' :
      tbl([['Name'], ['Username'], ['Roles'], ['Location'], ['Status'], ['']], shown.map(u => '<tr><th scope="row">' + esc(u.name) + (u.studentId || u.teacherId ? '' : ' <span class="sub small" style="font-weight:500">no person record</span>') + '</th><td>' + esc(u.username) + '</td><td class="wrapcell">' + esc((u.roles || [u.role]).map(r => ROLE_NAMES[r] || r).join(', ')) + '</td><td>' + esc(where(u)) + '</td><td>' + (u.disabled ? chip('warn', 'Disabled') + (u.disabledOn ? '<div class="sub small">' + fd(u.disabledOn) + ' by ' + esc(u.disabledBy || '') + '</div>' : '') : u.demo ? chip('gold', 'Sample password') : chip('ok', 'Active')) + '</td><td><div class="btns">' + editBtn('user', u.id, 'Edit roles') + act('userResetOpen', u.id, 'Reset password') + (u.id !== ME.id ? act('userToggle', u.id, u.disabled ? 'Enable' : 'Disable') : '') + '</div></td></tr>'))) +
      '<p class="sub small">Accounts marked "Sample password" still use the password set when the sample data was loaded. Reset them before going live.</p></section>' +
    '<section class="card side"><h2>Create a login</h2><p class="sub small">Choose the person first. Someone new is registered as a student (Registrations, or Add students on a class) before they get a login.</p>' +
      '<div class="field"><label for="ua-q">Find the person</label><input id="ua-q" type="search" data-bind="form.ua.q" data-rerender="1" value="' + esc(f.q || '') + '" placeholder="Name"></div>' +
      '<form data-form="userAdd" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="ua-s">Person</label><select id="ua-s" name="studentId" required>' + opts([['', free.length ? 'Choose a person' : 'Nobody without a login matches']].concat(free.slice(0, 200).map(s => [s.id, s.name + (s.classId ? ' · ' + s.classId : ' · not in a class')])), '') + '</select></div>' +
      '<div class="field"><label for="ua-u">Username</label><input id="ua-u" name="username" autocomplete="off" autocapitalize="off" required pattern="[A-Za-z0-9._\\-]{3,40}"></div>' +
      '<div class="field"><span class="lab">Roles (leave all unticked for a student-only login)</span><div class="checks">' + ASSIGNABLE.map(r => '<label class="check"><input type="checkbox" name="r_' + r + '">' + esc(ROLE_NAMES[r]) + '</label>').join('') + '</div></div>' +
      '<div class="field"><label for="ua-l">Location (for location responsible or coordinator)</label><select id="ua-l" name="loc">' + opts([['', 'None']].concat(activeLocs().map(l => [l.code, l.name])), '') + '</select></div>' +
      '<div class="field"><label for="ua-p">First password (8 characters or more)</label><input id="ua-p" name="password" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<button class="btn primary" type="submit">Create login</button></form></section></div>';
}

function readingReport(from, to) {
  const t = TG(); const weeks = []; for (let w = weekStart(from); w <= to; w = addDays(w, 7)) if (addDays(w, 6) < TODAY) weeks.push(w);
  const all = [];
  const rows = S.classes.filter(c => c.status === 'active' && c.course !== 'INR').map(c => {
    const studs = classStudents(c.id); const es = []; studs.forEach(s => weeks.forEach(w => { const e = rd(s.id, w); if (e) es.push(e); })); all.push.apply(all, es);
    const poss = studs.length * weeks.length;
    return '<tr><th scope="row">' + c.id + '</th><td>' + esc(teacherName(c.teacherId) || '') + '</td><td class="r">' + studs.length + '</td><td class="r">' + (es.length ? Math.round(es.length / poss * 100) + '%' : 'No data') + '</td><td class="r">' + (avg(es.map(e => e.ayat)) ?? '–') + '</td><td class="r">' + (avg(es.map(e => e.pages)) ?? '–') + '</td><td class="r">' + (es.length ? Math.round(es.filter(metBoth).length / es.length * 100) + '%' : '–') + '</td></tr>';
  });
  return '<div class="tiles">' + tile('Weeks in period', weeks.length, 'Completed weeks only') + tile('Average ayat', avg(all.map(e => e.ayat)) ?? 'No data', 'A week · target ' + t.ayat) + tile('Average pages', avg(all.map(e => e.pages)) ?? 'No data', 'A week · target ' + t.pages) + tile('Both targets met', all.length ? Math.round(all.filter(metBoth).length / all.length * 100) + '%' : 'No data', 'Of weekly entries') + '</div>' +
    tbl([['Class'], ['Teacher'], ['Students', 1], ['Weeks logged', 1], ['Average ayat', 1], ['Average pages', 1], ['Both targets met', 1]], rows) +
    '<p class="sub small">Weekly reading applies to Basic, Intermediate and Advance, not the Introductory course.</p>';
}

function customReport() {
  const f = S.form.cr || (S.form.cr = { set: 'students', loc: '', course: '', g: '', status: '', cols: { cls: true, status: true, att: true, loc: false, teacher: false, group: false, course: false, students: true, day: true } });
  const filt = '<div class="form">' +
    '<div class="field"><label for="cr-set">Data</label><select id="cr-set" data-bind="form.cr.set" data-rerender="1">' + opts([['students', 'Students'], ['classes', 'Classes']], f.set) + '</select></div>' +
    '<div class="field"><label for="cr-loc">Location</label><select id="cr-loc" data-bind="form.cr.loc" data-rerender="1">' + opts([['', 'All']].concat(S.locations.filter(l => S.classes.some(c => c.loc === l.code)).map(l => [l.code, l.name])), f.loc) + '</select></div>' +
    '<div class="field"><label for="cr-co">Course type</label><select id="cr-co" data-bind="form.cr.course" data-rerender="1">' + opts([['', 'All']].concat(S.courses.map(c => [c.code, c.name])), f.course) + '</select></div>' +
    '<div class="field"><label for="cr-g">Group</label><select id="cr-g" data-bind="form.cr.g" data-rerender="1">' + opts([['', 'All'], ['F', 'Sisters'], ['M', 'Brothers']], f.g) + '</select></div>' +
    (f.set === 'students' ? '<div class="field"><label for="cr-st">Status</label><select id="cr-st" data-bind="form.cr.status" data-rerender="1">' + opts([['', 'All'], ['new', 'New'], ['active', 'Active'], ['risk', 'At risk'], ['followup', 'In follow-up']], f.status) + '</select></div>' : '') + '</div>';
  const colDefs = f.set === 'students' ? [['cls', 'Class'], ['loc', 'Location'], ['course', 'Course'], ['group', 'Group'], ['status', 'Status'], ['att', 'Attendance']] : [['loc', 'Location'], ['course', 'Course'], ['group', 'Group'], ['teacher', 'Teacher'], ['day', 'Day and time'], ['students', 'Students'], ['att', 'Attendance']];
  const checks = '<div><div class="lab">Columns</div><div class="checks">' + colDefs.map(c => '<label class="check"><input type="checkbox" id="cc-' + c[0] + '" data-bind="form.cr.cols.' + c[0] + '" data-rerender="1"' + (f.cols[c[0]] ? ' checked' : '') + '>' + c[1] + '</label>').join('') + '</div></div>';
  const on = colDefs.filter(c => f.cols[c[0]]);
  const okC = c => (!f.loc || c.loc === f.loc) && (!f.course || c.course === f.course) && (!f.g || c.g === f.g);
  const from = S.p.from || addDays(TODAY, -42), to = S.p.to || TODAY;
  let rows, csv;
  if (f.set === 'students') {
    const cell = { cls: x => x.c.id, loc: x => x.c.loc, course: x => esc(courseLabel(x.c)), group: x => group(x.c.g), status: x => statChip(x.st.status), att: x => pct(attIn(x.s, from, to)) };
    const list = allStats().filter(x => okC(x.c) && (!f.status || x.st.status === f.status));
    rows = list.map(x => '<tr><th scope="row">' + esc(x.s.name) + '</th>' + on.map(c => '<td>' + cell[c[0]](x) + '</td>').join('') + '</tr>');
    csv = [['Student'].concat(on.map(c => c[1]))].concat(list.map(x => [x.s.name].concat(on.map(c => c[0] === 'status' ? x.st.status : String(cell[c[0]](x)).replace(/<[^>]+>/g, '')))));
  } else {
    const cell = { loc: c => c.loc, course: c => esc(courseLabel(c)), group: c => group(c.g), teacher: c => esc(teacherName(c.teacherId) || 'Awaiting teacher'), day: c => DOW[c.day] + ' ' + ft(c.time), students: c => classStudents(c.id).length, att: c => pct(classAtt(c.id, from, to)) };
    const list = S.classes.filter(okC);
    rows = list.map(c => '<tr><th scope="row">' + c.id + '</th>' + on.map(k => '<td>' + cell[k[0]](c) + '</td>').join('') + '</tr>');
    csv = [['Class'].concat(on.map(c => c[1]))].concat(list.map(c => [c.id].concat(on.map(k => String(cell[k[0]](c)).replace(/<[^>]+>/g, '')))));
  }
  S.form.crCsv = csv;
  return filt + checks + '<div class="card-h"><p class="sub small">' + rows.length + ' rows</p>' + act('csv', '', 'Download CSV') + '</div>' + tbl([[f.set === 'students' ? 'Student' : 'Class']].concat(on.map(c => [c[1]])), rows);
}

export function viewReports() {
  const rp = S.p.report || 'location'; const lc = S.p.loc || (S.locations[0] && S.locations[0].code);
  const from = S.p.from || addDays(TODAY, -42); const to = S.p.to || TODAY; const inR = x => x.date >= from && x.date <= to;
  const list = [['location', 'Location report'], ['register', 'Class register'], ['followup', 'Students at risk or in follow-up'], ['unlogged', 'Sessions not logged'], ['results', 'Semester results'], ['reading', 'Weekly reading'], ['custom', 'Build a custom report']];
  const dated = rp === 'location' || rp === 'unlogged' || rp === 'custom' || rp === 'reading';
  let body = '';
  if (rp === 'location') {
    const cs = S.classes.filter(c => c.loc === lc); const ids = cs.map(c => c.id); const ss = S.sessions.filter(x => ids.includes(x.classId) && inR(x));
    let p = 0, n = 0; ss.filter(x => x.held && x.logged).forEach(x => Object.keys(x.att).forEach(k => { n++; if (x.att[k] === 'p') p++; }));
    const calls = locCalls(lc).filter(inR);
    body = '<div class="tiles">' + tile('Classes', cs.length, 'Today') + tile('Students', S.students.filter(s => ids.includes(s.classId)).length, 'Enrolled today') +
      tile('Sessions held', ss.filter(x => x.held).length + ' of ' + ss.length, 'In this period') + tile('Not logged', ss.filter(x => x.held && !x.logged).length, 'In this period') +
      tile('Attendance', n ? Math.round(p / n * 100) + '%' : 'No data', 'In this period') + tile('Calls held', calls.filter(c => c.status === 'Held').length + ' of ' + calls.length, 'In this period') + '</div>' +
      tbl([['Class'], ['Course'], ['Group'], ['Teacher'], ['Students', 1], ['Sessions held', 1], ['Not logged', 1], ['Attendance', 1], ['In follow-up', 1]],
        cs.map(c => {
          const cx = allSessions(c.id).filter(inR); const fu = classStudents(c.id).filter(s => stuStats(s).status === 'followup').length;
          return '<tr><th scope="row">' + c.id + '</th><td>' + esc(courseLabel(c)) + '</td><td>' + group(c.g) + '</td><td>' + esc(teacherName(c.teacherId) || 'Awaiting teacher') + '</td><td class="r">' + classStudents(c.id).length + '</td><td class="r">' + cx.filter(x => x.held).length + ' of ' + cx.length + '</td><td class="r">' + cx.filter(x => x.held && !x.logged).length + '</td><td class="r">' + pct(classAtt(c.id, from, to)) + '</td><td class="r">' + fu + '</td></tr>';
        }));
  }
  if (rp === 'register') body = tbl([['Class'], ['Location'], ['Course'], ['Group'], ['Teacher'], ['Day and time (India)'], ['Start date'], ['Students', 1]],
    S.classes.map(c => '<tr><th scope="row">' + act('openClass', c.id, c.id, 'link') + (ended(c) ? ' ' + chip('mute', c.status === 'closed' ? 'Closed' : 'Completed') : '') + '</th><td>' + c.loc + '</td><td>' + esc(courseLabel(c)) + '</td><td>' + group(c.g) + '</td><td>' + esc(teacherName(c.teacherId) || 'Awaiting teacher') + '</td><td>' + DOW[c.day] + ' ' + ft(c.time) + '</td>' +
      '<td><div class="btns" style="align-items:center">' + (startOf(c) ? fd(startOf(c)) : '–') + (ME.role === 'super' && !ended(c) ? editBtn('class', c.id, 'Change') : '') + '</div></td><td class="r">' + classStudents(c.id).length + '</td></tr>'));
  if (rp === 'followup') body = tbl([['Student'], ['Class'], ['Status'], ['Missed in a row', 1], ['Attendance', 1]],
    allStats().filter(x => x.st.status === 'risk' || x.st.status === 'followup').map(x => '<tr><th scope="row">' + esc(x.s.name) + '</th><td>' + x.c.id + '</td><td>' + statChip(x.st.status) + '</td><td class="r">' + x.st.miss + '</td><td class="r">' + pct(x.st.pct) + '</td></tr>'));
  if (rp === 'unlogged') body = tbl([['Class'], ['Session date'], ['Days waiting', 1], ['Teacher']],
    S.sessions.filter(x => x.held && !x.logged && inR(x)).map(x => '<tr><th scope="row">' + x.classId + '</th><td>' + fdl(x.date) + '</td><td class="r">' + daysAgo(x.date) + '</td><td>' + esc(teacherName((cls(x.classId) || {}).teacherId)) + '</td></tr>'));
  if (rp === 'results') {
    const rows = []; S.classes.forEach(c => {
      for (let sem = 1; sem <= c.sem; sem++) {
        const ids = classStudents(c.id).map(s => s.id); const res = ids.map(id => semResult(id, c.course, sem)); const n = res.filter(r => r !== 'none').length; if (!n) continue;
        const marks = S.results.filter(r => r.cid === c.id && r.sem === sem && r.pct != null).map(r => r.pct); const a = Math.round(marks.reduce((x, y) => x + y, 0) / marks.length);
        rows.push('<tr><th scope="row">' + c.id + '</th><td>Semester ' + sem + '</td><td class="r">' + n + ' of ' + ids.length + '</td><td class="r">' + a + '%</td><td class="r">' + res.filter(r => r === 'pass').length + '</td><td>' + (S.published[c.id + '|' + sem] ? chip('ok', 'Published') : chip('gold', 'Not published')) + '</td></tr>');
      }
    });
    body = tbl([['Class'], ['Semester'], ['Took the exams', 1], ['Average mark', 1], ['Passed', 1], ['Status']], rows);
  }
  if (rp === 'reading') body = readingReport(from, to);
  if (rp === 'custom') body = customReport();
  return '<div class="head"><div><h1>Reports</h1><div class="sub">Predefined reports and a custom builder, each for a chosen period</div></div></div>' +
    '<section class="card"><div class="form"><div class="field"><label for="rp-sel">Report</label><select id="rp-sel" data-bind="p.report" data-rerender="1">' + opts(list, rp) + '</select></div>' +
    (rp === 'location' ? '<div class="field"><label for="rp-loc">Location</label><select id="rp-loc" data-bind="p.loc" data-rerender="1">' + opts(S.locations.map(l => [l.code, l.name]), lc) + '</select></div>' : '') +
    '<div class="field"><label for="rp-from">Start date</label><input id="rp-from" type="date" data-bind="p.from" data-rerender="1" value="' + from + '"></div>' +
    '<div class="field"><label for="rp-to">End date</label><input id="rp-to" type="date" data-bind="p.to" data-rerender="1" value="' + to + '"></div></div>' +
    '<div class="btns">' + act('range', '7', 'Last 7 days') + act('range', '28', 'Last 4 weeks') + act('range', '90', 'Last 90 days') + '</div>' +
    '<p class="sub small">' + (dated ? 'Period: ' + fd(from) + ' to ' + fd(to) + '. Sessions, attendance and calls count this period only; student status is as of today.' : 'This report shows the position as of today.') + '</p>' +
    body + '</section>';
}
