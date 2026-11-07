/* Builds the data each signed-in person receives. Each role gets only the records its screens need;
   question answers never leave the server except to the academic team and super admin, and academic
   content waiting for approval stays within the academic team. */
import { canSeeMaterial, approved, ACADEMIC_ROLES, rolesOf, teacherIdFor, ownerSidFor } from './access.js';
import { publicUser } from './auth.js';
import { readinessRows } from './readiness.js';
import { PASS } from '../shared/grading.js';
import { callPeople, clashesOf } from '../shared/callpeople.js';

const strip = o => { const { id, ...rest } = o; return rest; };
/* teachers and students get the approved version of a material, not an update waiting for approval */
const liveOnly = m => { const { draft, chart, chartNote, ...rest } = m; return rest; };

/* A person with several roles receives what each role receives, combined. When two roles see the same record
   differently (a student sees only their own attendance), the more senior role's copy is kept. */
export function snapshot(store, user) {
  const roles = rolesOf(store, user);
  if (!roles.length) return withoutPrivate(store, user, roles, roleSnapshot(store, user, null));
  const parts = roles.map(r => roleSnapshot(store, { ...user, role: r, teacherId: teacherIdFor(store, user) }, r));
  const out = { ...parts[0] };
  for (const p of parts.slice(1)) for (const [k, v] of Object.entries(p)) {
    if (!Array.isArray(v)) { if (out[k] === undefined || (typeof v === 'object' && v && !Array.isArray(v) && Object.keys(v).length > Object.keys(out[k] || {}).length)) out[k] = v; continue; }
    const have = new Set((out[k] || []).map(x => x.id ?? x.key ?? x.code));
    out[k] = (out[k] || []).concat(v.filter(x => !have.has(x.id ?? x.key ?? x.code)));
  }
  return withoutPrivate(store, user, roles, out);
}

/* Date of birth, phone and email go only to the person themselves, the staff of the location the student is at
   and the super admin. */
function withoutPrivate(store, user, roles, out) {
  const all = roles.includes('super'); const loc = (roles.includes('locadmin') || roles.includes('coord')) && user.loc;
  const strip = ({ dob, phone, email, ...rest }) => rest;
  const classLoc = s => { const c = s.classId && store.find('classes', s.classId); return c ? c.loc : null; };
  if (out.students) out.students = out.students.map(s => all || s.id === user.studentId || (loc && classLoc(s) === loc) ? s : strip(s));
  if (out.regs) out.regs = out.regs.map(r => all || (loc && r.loc === loc) ? r : strip(r));
  /* who is on a location's weekly call: that location's staff and the super admin see all; a participant, themselves */
  /* those who see a call's list also get who on it clashes with another call, which they cannot work out themselves */
  const withClashes = l => { const clashes = {}; if (!l.disabled) for (const p of callPeople(l)) { const c = clashesOf(store.all('locations'), l, p.sid); if (c.length) clashes[p.sid] = c; } return { ...l, clashes }; };
  if (out.locations) out.locations = out.locations.map(l => all || l.code === loc ? withClashes(l) : { ...l, participants: (l.participants || []).filter(p => p.sid === user.studentId) });
  return out;
}

function roleSnapshot(store, user, role) {
  const all = c => store.all(c);
  const base = {
    courses: all('courses').map(strip),
    subjects: all('subjects').map(strip),
    locations: all('locations'),
    teachers: all('teachers'),
    exams: all('exams'),
    /* outside the academic team, only approved traditions are used */
    traditions: ACADEMIC_ROLES.includes(user.role) ? all('traditions') : all('traditions').filter(approved),
    published: store.get('published', {}),
    charts: store.get('charts', {}),
    /* live syllabus chart topics per course-semester: { b: [...weeks], l: [...], e: [...] } */
    chartData: store.get('chartData', {}),
    targets: store.get('targets', { ayat: 0, pages: 0 }),
    /* approved questions per course-semester-subject, so exam windows show whether each paper is ready */
    qcount: all('questions').filter(q => !q.retired && !q.aud && approved(q)).reduce((o, q) => { const k = q.course + '-' + q.sem + '-' + q.sub; o[k] = (o[k] || 0) + 1; return o; }, {}),
    /* approved questions per chapter paper: course-semester-subject-chapter */
    chapterCount: all('questions').filter(q => q.chapter && !q.retired && approved(q)).reduce((o, q) => { const k = q.course + '-' + q.sem + '-' + q.sub + '-' + q.chapter; o[k] = (o[k] || 0) + 1; return o; }, {}),
    chapterTitles: all('questions').filter(q => q.chapter && q.chapterTitle && approved(q)).reduce((o, q) => { o[q.course + '-' + q.sem + '-' + q.sub + '-' + q.chapter] = q.chapterTitle; return o; }, {}),
    /* names of the teacher training faculty, offered as facilitators */
    trainers: all('users').filter(u => !u.disabled && rolesOf(store, u).includes('trainer')).map(u => u.name)
  };
  const forClasses = ids => {
    const set = new Set(ids);
    const students = all('students').filter(s => set.has(s.classId));
    const sids = new Set(students.map(s => s.id));
    return {
      students,
      sessions: all('sessions').filter(x => set.has(x.classId)),
      results: all('results').filter(r => sids.has(r.sid)),
      reading: all('reading').filter(r => sids.has(r.sid))
    };
  };

  if (ACADEMIC_ROLES.includes(user.role)) {
    return {
      ...base,
      classes: all('classes'), students: all('students'), sessions: all('sessions'), results: all('results'),
      reading: all('reading'), questions: all('questions'), calls: all('calls'), actions: all('actions'), regs: all('regs'),
      materials: all('materials'), shares: all('shares'), trainings: all('trainings'), promotions: all('promotions'), chartDrafts: store.get('chartDrafts', {}),
      readiness: readinessRows(store, all('classes')),
      users: user.role === 'super' ? all('users').map(u => ({ ...publicUser(u), roles: rolesOf(store, u) })) : []
    };
  }

  if (user.role === 'locadmin' || user.role === 'coord') {
    const classes = all('classes');
    const mine = forClasses(classes.filter(c => c.loc === user.loc).map(c => c.id));
    const sids = new Set(mine.students.map(s => s.id));
    return {
      ...base,
      classes,
      ...mine,
      /* usernames of this location's students who have a login, so the class page can show them */
      logins: Object.fromEntries(all('users').filter(u => u.studentId && sids.has(u.studentId)).map(u => [u.studentId, u.username])),
      calls: all('calls').filter(c => c.loc === user.loc),
      actions: all('actions').filter(a => a.loc === user.loc),
      regs: all('regs').filter(r => r.loc === user.loc),
      readiness: readinessRows(store, classes.filter(c => c.loc === user.loc)),
      /* who can be added to the weekly call: every student, by name and class only */
      callPicks: user.role === 'locadmin' ? all('students').filter(s => !s.left).map(s => ({ id: s.id, name: s.name, classId: s.classId })) : [],
      questions: [], materials: [], shares: [], trainings: []
    };
  }

  if (user.role === 'teacher') {
    const t = store.find('teachers', user.teacherId);
    const classes = all('classes').filter(c => c.teacherId === user.teacherId);
    const ids = new Set(classes.map(c => c.id));
    return {
      ...base,
      classes,
      ...forClasses([...ids]),
      materials: t ? all('materials').filter(m => canSeeMaterial(store, t, m)).map(liveOnly) : [],
      shares: all('shares').filter(s => ids.has(s.cid)),
      trainings: all('trainings').filter(approved),
      readiness: readinessRows(store, classes),
      questions: [], calls: [], actions: [], regs: []
    };
  }

  if (user.role === 'student') {
    const me = store.find('students', user.studentId);
    const c = me && store.find('classes', me.classId);
    /* the tasks given to this person at a weekly coordination call; older ones are matched by name */
    const tasks = me ? all('actions').map(a => ({ ...a, ownerSid: a.ownerSid || ownerSidFor(store.find('locations', a.loc), a.owner) })).filter(a => a.ownerSid === me.id) : [];
    if (!me || !c) return { ...base, classes: [], students: me ? [me] : [], sessions: [], results: [], reading: [], materials: [], shares: [], trainings: [], questions: [], calls: [], actions: tasks, regs: [] };
    const assistant = c.assistantId === me.id;
    const classmates = all('students').filter(s => s.classId === c.id && (assistant || s.id === me.id))
      .map(s => s.id === me.id ? s : { id: s.id, name: s.name, g: s.g, classId: s.classId, joined: s.joined });
    const sessions = all('sessions').filter(x => x.classId === c.id)
      .map(x => assistant ? x : { ...x, att: x.att[me.id] ? { [me.id]: x.att[me.id] } : {} });
    const shares = all('shares').filter(s => s.cid === c.id);
    const mids = new Set(shares.map(s => s.mid));
    return {
      ...base,
      classes: [c],
      students: classmates,
      sessions,
      /* a chapter paper's mark is shown at once; a semester exam's waits until the results are published */
      results: all('results').filter(r => r.sid === me.id && (r.chapter || base.published[r.cid + '|' + r.sem])).concat(
        /* unpublished results only tell the student that an exam was submitted, and whether it is below the
           pass mark (so they can sit it again while the window is open) */
        all('results').filter(r => r.sid === me.id && !r.chapter && !base.published[r.cid + '|' + r.sem]).map(r => ({ ...r, pct: null, pending: true, below: r.pct < PASS }))),
      reading: all('reading').filter(r => r.sid === me.id),
      materials: all('materials').filter(m => mids.has(m.id) && m.share && approved(m)).map(liveOnly),
      shares,
      trainings: [], questions: [], calls: [], actions: tasks, regs: []
    };
  }
  /* roles without screens yet (training faculty, social media, systems support), or an account with no role */
  return { ...base, classes: [], students: [], sessions: [], results: [], reading: [], materials: [], shares: [], trainings: [], questions: [], calls: [], actions: [], regs: [] };
}
