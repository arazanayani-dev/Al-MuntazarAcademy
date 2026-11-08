/* One Edit dialog for every kind of record. Each entry says how to find the record, which fields it has,
   their current values and the server action that saves them. The server enforces the same rules and roles
   as creating the record. */
import { S, ME, TODAY } from '../state.js';
import { DOWL } from '/shared/dates.js';
import { esc, opts, act } from '../ui.js';
import { cls, stu, course, classSessions, classStudents, levelOpts, MTYPES, startOf, personOpts, personValue } from '../logic.js';
import { owners } from './location.js';

const G = [['F', 'Sisters'], ['M', 'Brothers']];
const GENDER = [['F', 'Female'], ['M', 'Male']];
/* a person's details, as on the registration form; records from before last names existed have one name */
const PERSON = () => [['first', 'Name', 'text', { req: 1 }], ['last', 'Last name'], ['dob', 'Date of birth', 'date', { min: '1900-01-01', max: TODAY }], ['city', 'Location'], ['phone', 'Phone number', 'tel'], ['email', 'Email ID', 'email']];
const personValues = r => ({ first: r.first != null ? r.first : r.name, last: r.last || '', dob: r.dob || '', city: r.city || '', phone: r.phone || '', email: r.email || '' });
const ROLES = ['super', 'acmaker', 'academic', 'locadmin', 'coord', 'trainer', 'social', 'support'];
const ROLE_LABEL = { super: 'Super admin', acmaker: 'Academic content creator', academic: 'Academic content approver', locadmin: 'Location responsible', coord: 'Coordinator', trainer: 'Teacher training faculty', social: 'Social media content creator', support: 'Systems support' };
const SEMS = n => Array.from({ length: n }, (_, i) => [i + 1, 'Semester ' + (i + 1)]);
const COURSES = () => S.courses.map(c => [c.code, c.name]);
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
/* field: [key, label, type, { opts, req, ro, hint, wide, show, min, max }] */
const pick = (r, keys) => Object.fromEntries(keys.map(k => [k, r[k] == null ? '' : r[k]]));

export const EDIT = {
  location: {
    find: id => S.locations.find(l => l.code === id), action: 'locEdit', title: r => 'Edit ' + r.name,
    note: r => 'The short code ' + r.code + ' cannot change because it is part of every class number.',
    fields: r => [['name', 'Name', 'text', { req: 1 }], ['primary', 'Primary responsible', 'select', { opts: personOpts(personValue(r, 'primary'), 'Choose a student') }], ['secondary', 'Secondary responsible (optional)', 'select', { opts: personOpts(personValue(r, 'secondary'), 'None') }], ['coordinator', 'Coordinator', 'select', { opts: personOpts(personValue(r, 'coordinator'), 'None yet') }],
      ['callDay', 'Weekly call day', 'select', { opts: DOWL.map(d => [d, d]) }], ['callTime', 'Call time'], ['meet', 'Fixed Meet link', 'url', { wide: 1 }]],
    values: r => Object.assign(pick(r, ['name', 'callDay', 'callTime', 'meet']), { primary: personValue(r, 'primary'), secondary: personValue(r, 'secondary'), coordinator: personValue(r, 'coordinator') })
  },
  course: {
    find: id => S.courses.find(c => c.code === id), action: 'courseEdit', title: r => 'Edit ' + r.name,
    note: r => 'The code ' + r.code + ' cannot change because it is part of every class number.',
    fields: () => [['name', 'Name', 'text', { req: 1 }], ['sems', 'Semesters', 'number', { min: 1, max: 10 }], ['weeks', 'Sessions per semester', 'number', { min: 1, max: 60 }]],
    values: r => pick(r, ['name', 'sems', 'weeks'])
  },
  subject: {
    find: id => S.subjects.find(s => s.key === id), action: 'subjectEdit', title: r => 'Edit ' + r.name,
    fields: () => [['name', 'Name', 'text', { req: 1 }], ['min', 'Minutes', 'number', { min: 1, max: 60 }]],
    values: r => pick(r, ['name', 'min'])
  },
  teacher: {
    find: id => S.teachers.find(t => t.id === id), action: 'teacherEdit', title: r => 'Edit ' + r.name,
    fields: r => { const busy = S.classes.some(c => c.teacherId === r.id && c.status !== 'completed' && c.status !== 'closed');
      return [['name', 'Name', 'text', { req: 1 }], ['g', 'Teaches', 'select', { opts: G, ro: busy, hint: busy ? 'Fixed while they teach a running class.' : '' }],
        ['level', 'Can teach up to', 'select', { opts: (r.level ? [] : [['', 'Not set']]).concat(levelOpts()) }]]; },
    values: r => pick(r, ['name', 'g', 'level'])
  },
  user: {
    find: id => S.users.find(u => u.id === id), action: 'userEdit', title: r => 'Roles and login: ' + r.name,
    note: r => (r.studentId || r.teacherId ? 'The name follows the person record. ' : '') + 'Teacher comes from a teaching level and student from the person record, so they are not ticked here.',
    fields: r => [['username', 'Username', 'text', { req: 1 }]]
      .concat(ROLES.map(k => ['r_' + k, ROLE_LABEL[k], 'check']))
      .concat([['loc', 'Location (for location responsible or coordinator)', 'select', { opts: [['', 'None']].concat(S.locations.filter(l => !l.disabled).map(l => [l.code, l.name])) }]]),
    values: r => Object.assign(pick(r, ['username', 'loc']), Object.fromEntries(ROLES.map(k => ['r_' + k, (r.roles || [r.role]).includes(k)]))),
    out: f => ({ username: f.username, loc: f.loc, roles: ROLES.filter(k => f['r_' + k]) })
  },
  class: {
    find: id => cls(id), action: 'classEdit', title: r => 'Edit ' + r.id,
    note: r => 'The course type cannot change because it is part of the class number. The teacher is changed with Assign teacher.',
    fields: r => {
      const logged = classSessions(r.id).some(x => x.logged); const studs = classStudents(r.id).length > 0;
      return [['day', 'Day', 'select', { opts: DOWL.map((d, i) => [i, d]) }], ['time', 'Time (India)', 'time', { req: 1 }],
        ['sem', 'Semester', 'select', { opts: SEMS(course(r.course).sems), ro: logged, hint: logged ? 'Fixed once a session of this semester is logged.' : '' }],
        ['g', 'Group', 'select', { opts: G, ro: studs, hint: studs ? 'Fixed while the class has students.' : '' }]]
        .concat(ME.role === 'super' ? [['start', 'Start date', 'date', { req: 1, hint: logged ? 'Logged sessions stay as they are; sessions not yet logged are listed again from the new date.' : 'Sessions are listed weekly from the new date.' }]] : [])
        .concat([['meet', 'Google Meet link', 'url', { wide: 1 }]]);
    },
    values: r => ({ day: r.day, time: hm(r.time), sem: r.sem, g: r.g, start: startOf(r), meet: r.meet || '' })
  },
  reg: {
    find: id => S.regs.find(r => r.id === id), action: 'regEdit', title: r => 'Edit registration: ' + r.name,
    fields: r => [...PERSON(), ['g', 'Gender', 'select', { opts: GENDER, ro: !!r.sid }], ['course', 'Course wanted', 'select', { opts: COURSES() }]],
    /* a returning student's details are on their student record */
    values: r => Object.assign(personValues(Object.assign({}, r.sid ? stu(r.sid) : null, r)), pick(r, ['g', 'course']))
  },
  student: {
    find: id => stu(id), action: 'studentEdit', title: r => 'Edit ' + r.name,
    fields: () => PERSON(),
    values: r => personValues(r)
  },
  action: {
    find: id => S.actions.find(a => a.id === id), action: 'actionEdit', title: () => 'Edit action item',
    fields: () => [['text', 'What needs doing', 'text', { req: 1, wide: 1 }], ['owner', 'Owner', 'select', { opts: owners() }], ['due', 'Due date', 'date']],
    values: r => pick(r, ['text', 'owner', 'due'])
  },
  trad: {
    find: id => S.traditions.find(t => t.id === id), action: 'tradEdit', title: () => 'Edit tradition',
    note: () => 'Saving sends it for approval again.',
    fields: () => [['text', 'Text', 'textarea', { req: 1, wide: 1 }], ['source', 'Source', 'text', { req: 1, wide: 1 }]],
    values: r => pick(r, ['text', 'source'])
  },
  mat: {
    find: id => S.materials.find(m => m.id === id), action: 'matEdit', title: r => 'Edit ' + r.title,
    note: r => (ME.role === 'acmaker'
      ? (r.status === 'pending' ? 'It is waiting for approval; your changes join it.' : 'Your changes, including a new file, wait for approval. Everyone keeps seeing the current version until then.')
      : 'Your changes take effect straight away.') + ' Classes it is shared with see the new version on their next read.' + (r.type === 'Syllabus' ? ' A new syllabus file also updates its column of the Standard Syllabus Chart.' : ''),
    file: true,
    fields: r => [['title', 'Title', 'text', { req: 1, wide: 1 }], ['type', 'Type', 'select', { opts: MTYPES.map(x => [x, x]) }],
      ['course', 'Course type', 'select', { opts: [['ALL', 'All courses']].concat(COURSES()) }], ['sem', 'Semester', 'select', { opts: [[0, 'All']].concat(SEMS(5)) }],
      ['sub', 'Subject', 'select', { opts: [['all', 'All']].concat(S.subjects.filter(s => s.exam).map(s => [s.key, s.name])) }], ['week', 'Session (optional)', 'number', { min: 1, max: 60 }],
      ['pages', 'Pages (books only)', 'number', { min: 1 }], ['share', 'Who can see it', 'select', { opts: [['true', 'Teachers, and shareable with students'], ['false', 'Teachers only']] }]]
      .concat(r.fileId ? [] : [['link', 'Link', 'url', { wide: 1 }]])
      .concat([['file', r.fileId ? 'Replace the file (now: ' + r.src + ')' : 'Attach a file', 'file', { wide: 1, hint: 'Leave empty to keep the current file.' }]]),
    /* a creator editing an item with an update waiting starts from that update */
    values: r => { const v = r.draft && ME.role === 'acmaker' ? Object.assign({}, r, r.draft) : r; return Object.assign(pick(v, ['title', 'type', 'course', 'sem', 'sub', 'week', 'pages']), { share: String(!!v.share), link: v.fileId || v.src === 'No file attached' ? '' : v.src }); }
  },
  train: {
    find: id => S.trainings.find(t => t.id === id), action: 'trainEdit', title: r => 'Edit ' + r.title,
    note: () => 'Saving sends it for approval again. Invited teachers are told about the change once it is approved.',
    fields: () => [['title', 'Title', 'text', { req: 1, wide: 1 }], ['kind', 'Kind', 'select', { opts: [['Programme', 'Training programme'], ['Refresher', 'Refresher on a topic']] }],
      ['course', 'For teachers of', 'select', { opts: [['ALL', 'All teachers']].concat(COURSES()) }], ['sem', 'Semester', 'select', { opts: [[0, 'All']].concat(SEMS(5)) }],
      ['date', 'Date', 'date', { req: 1 }], ['time', 'Time (India)', 'time', { req: 1 }], ['facilitator', 'Facilitator'], ['mode', 'Meet link or venue'], ['req', 'Attendance is required', 'check']],
    values: r => Object.assign(pick(r, ['title', 'kind', 'course', 'sem', 'date', 'facilitator', 'mode']), { time: hm(r.time), req: !!r.req })
  }
};

/* An Edit button for a record: editBtn('class', c.id). */
export const editBtn = (kind, id, label) => act('editOpen', kind + '|' + id, label || 'Edit');

function field(f, [k, label, type = 'text', x = {}]) {
  const id = 'ed-' + k; const v = f[k] == null ? '' : f[k]; const ro = x.ro ? ' disabled' : ''; const bind = ' data-bind="form.' + k + '"';
  if (type === 'file') return '<div class="field" style="flex-basis:100%;max-width:none"><label for="ed-file">' + esc(label) + '</label><input id="ed-file" type="file">' + (x.hint ? '<span class="sub small">' + esc(x.hint) + '</span>' : '') + '</div>';
  if (type === 'check') return '<label class="check" style="flex-basis:100%"><input type="checkbox" id="' + id + '"' + bind + (v ? ' checked' : '') + ro + '>' + esc(label) + '</label>';
  let input;
  if (type === 'select') input = '<select id="' + id + '"' + bind + ro + '>' + opts(x.opts, v) + '</select>';
  else if (type === 'textarea') input = '<textarea id="' + id + '" rows="4" dir="auto"' + bind + ro + (x.req ? ' required' : '') + '>' + esc(v) + '</textarea>';
  else input = '<input id="' + id + '" type="' + type + '"' + bind + ro + ' value="' + esc(v) + '"' + (x.req ? ' required' : '') + (x.min != null ? ' min="' + x.min + '"' : '') + (x.max != null ? ' max="' + x.max + '"' : '') + '>';
  return '<div class="field"' + (x.wide ? ' style="flex-basis:100%;max-width:none"' : '') + '><label for="' + id + '">' + esc(label) + '</label>' + input + (x.hint ? '<span class="sub small">' + esc(x.hint) + '</span>' : '') + '</div>';
}

export function editModal(m) {
  const sp = EDIT[m.kind]; const r = sp && sp.find(m.id);
  if (!r) return '<h2>Not found</h2><p>This record no longer exists.</p><div class="btns">' + act('modalClose', '', 'Close', 'btn primary') + '</div>';
  const note = sp.note ? sp.note(r) : '';
  return '<h2>' + esc(sp.title(r)) + '</h2>' + (note ? '<p class="sub small">' + esc(note) + '</p>' : '') +
    '<div class="form">' + sp.fields(r).map(x => field(S.form, x)).join('') + '</div>' +
    '<div class="btns">' + act('editSave', '', 'Save changes', 'btn primary') + act('modalClose', '', 'Cancel') + '</div>';
}
