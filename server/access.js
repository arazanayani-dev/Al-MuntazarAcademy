/* Who may see what. Shared by the data snapshot and the action handlers. */

export const ROLE_LABELS = {
  super: 'Super admin',
  academic: 'Academic team',
  locadmin: 'Location responsible',
  coord: 'Coordinator',
  teacher: 'Teacher',
  student: 'Student'
};

export function scopes(store, tid) {
  return store.all('classes').filter(c => c.teacherId === tid).map(c => ({ course: c.course, sem: c.sem, cid: c.id }));
}

export function canSeeMaterial(store, t, m) {
  if (t.access === 'all' || m.course === 'ALL') return true;
  const sc = scopes(store, t.id);
  if (t.access === 'course') return sc.some(s => s.course === m.course);
  return sc.some(s => s.course === m.course && (!m.sem || s.sem === m.sem));
}

export function invited(store, tid, tr) {
  if (tr.course === 'ALL') return true;
  return scopes(store, tid).some(s => s.course === tr.course && (!tr.sem || s.sem === tr.sem || (tr.kind === 'Refresher' && s.sem === tr.sem - 1)));
}

/* A short description of the signed-in person, sent to the browser. */
export function describeUser(store, u) {
  let label = ROLE_LABELS[u.role] || u.role;
  const loc = u.loc && store.find('locations', u.loc);
  if (u.role === 'locadmin' && loc) label = (loc.primary === u.name ? 'Primary responsible, ' : loc.secondary === u.name ? 'Secondary responsible, ' : 'Responsible, ') + loc.name;
  if (u.role === 'coord' && loc) label = 'Coordinator, ' + loc.name;
  if (u.role === 'student') {
    const s = store.find('students', u.studentId);
    const c = s && store.find('classes', s.classId);
    if (c && c.assistantId === s.id) label = 'Student and class assistant';
  }
  return { id: u.id, username: u.username, name: u.name, role: u.role, loc: u.loc || null, locName: loc ? loc.name : null, teacherId: u.teacherId || null, studentId: u.studentId || null, label };
}
