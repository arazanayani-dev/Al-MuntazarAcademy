/* Who may see what. Shared by the data snapshot and the action handlers. */

export const ROLE_LABELS = {
  super: 'Super admin',
  acmaker: 'Academic content creator',
  academic: 'Academic content approver',
  locadmin: 'Location responsible',
  coord: 'Coordinator',
  trainer: 'Teacher training faculty',
  social: 'Social media content creator',
  support: 'Systems support',
  teacher: 'Teacher',
  student: 'Student'
};
/* Roles the super admin assigns to a person. Teacher comes from an approved teaching level and student from
   the person's own record, so neither is assigned by hand. */
export const ASSIGNABLE = ['super', 'acmaker', 'academic', 'locadmin', 'coord', 'trainer', 'social', 'support'];
const ORDER = ['super', 'academic', 'acmaker', 'locadmin', 'coord', 'trainer', 'social', 'support', 'teacher', 'student'];

/* The teacher record of a login: its own (older accounts) or the one promoted from its person record. */
export function teacherIdFor(store, u) {
  if (u.teacherId && store.find('teachers', u.teacherId)) return u.teacherId;
  const t = u.studentId && store.all('teachers').find(x => x.sid === u.studentId && x.level);
  return t ? t.id : null;
}
/* Every role a login holds, most senior first: assigned roles, plus teacher and student from the person. */
export function rolesOf(store, u) {
  const set = new Set(u.roles || (u.role && u.role !== 'teacher' && u.role !== 'student' ? [u.role] : []));
  if (teacherIdFor(store, u)) set.add('teacher');
  if (u.studentId && store.find('students', u.studentId)) set.add('student');
  return ORDER.filter(r => set.has(r));
}

export function scopes(store, tid) {
  return store.all('classes').filter(c => c.teacherId === tid).map(c => ({ course: c.course, sem: c.sem, cid: c.id }));
}

/* Academic content (questions, materials, trainings, traditions) is used only once an approver has approved
   it. Records from before approvals existed have no status and count as approved. */
export const approved = x => !x.status || x.status === 'approved';
/* academic roles see every item, whatever its approval status */
export const ACADEMIC_ROLES = ['acmaker', 'academic', 'super'];

export function canSeeMaterial(store, t, m) {
  if (!approved(m)) return false;
  if (t.access === 'all' || m.course === 'ALL') return true;
  const sc = scopes(store, t.id);
  if (t.access === 'course') return sc.some(s => s.course === m.course);
  return sc.some(s => s.course === m.course && (!m.sem || s.sem === m.sem));
}

export function invited(store, tid, tr) {
  if (!approved(tr)) return false;
  if (tr.course === 'ALL') return true;
  return scopes(store, tid).some(s => s.course === tr.course && (!tr.sem || s.sem === tr.sem || (tr.kind === 'Refresher' && s.sem === tr.sem - 1)));
}

/* Who can be given work at a location's weekly call: its responsible persons, coordinator and participants. */
export function meetingPeople(l) {
  const names = [l.primary, l.secondary, l.coordinator !== 'None yet' ? l.coordinator : '', ...(l.participants || []).map(p => p.name)];
  return [...new Set(names.filter(Boolean))];
}

/* The person (student id) an action item's owner name stands for at a location, if they are a student on record. */
export function ownerSidFor(l, owner) {
  if (!l || !owner) return null;
  const post = ['primary', 'secondary', 'coordinator'].find(k => l[k] === owner && l[k + 'Sid']);
  if (post) return l[post + 'Sid'];
  const p = (l.participants || []).find(x => x.name === owner);
  return p ? p.sid : null;
}

/* A short description of the signed-in person, sent to the browser. */
export function describeUser(store, u) {
  const roles = rolesOf(store, u);
  const loc = u.loc && store.find('locations', u.loc);
  const one = r => {
    if (r === 'locadmin' && loc) return (loc.primary === u.name ? 'Primary responsible, ' : loc.secondary === u.name ? 'Secondary responsible, ' : 'Responsible, ') + loc.name;
    if (r === 'coord' && loc) return 'Coordinator, ' + loc.name;
    if (r === 'student') { const s = store.find('students', u.studentId); const c = s && store.find('classes', s.classId); if (c && c.assistantId === s.id) return 'Student and class assistant'; }
    return ROLE_LABELS[r] || r;
  };
  return { id: u.id, username: u.username, name: u.name, role: roles[0] || null, roles, loc: u.loc || null, locName: loc ? loc.name : null, teacherId: teacherIdFor(store, u), studentId: u.studentId || null, label: roles.map(one).join(' · '), labels: Object.fromEntries(roles.map(r => [r, one(r)])) };
}
