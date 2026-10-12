/* Builds the data each signed-in person receives. Each role gets only the records its screens need;
   question answers never leave the server except to the academic team and super admin. */
import { canSeeMaterial } from './access.js';
import { publicUser } from './auth.js';

const strip = o => { const { id, ...rest } = o; return rest; };

export function snapshot(store, user) {
  const all = c => store.all(c);
  const base = {
    courses: all('courses').map(strip),
    subjects: all('subjects').map(strip),
    locations: all('locations'),
    teachers: all('teachers'),
    exams: all('exams'),
    traditions: all('traditions'),
    published: store.get('published', {}),
    charts: store.get('charts', {}),
    targets: store.get('targets', { ayat: 0, pages: 0 })
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

  if (user.role === 'super' || user.role === 'academic') {
    return {
      ...base,
      classes: all('classes'), students: all('students'), sessions: all('sessions'), results: all('results'),
      reading: all('reading'), questions: all('questions'), calls: all('calls'), actions: all('actions'), regs: all('regs'),
      materials: all('materials'), shares: all('shares'), trainings: all('trainings'),
      users: user.role === 'super' ? all('users').map(publicUser) : []
    };
  }

  if (user.role === 'locadmin' || user.role === 'coord') {
    const classes = all('classes');
    return {
      ...base,
      classes,
      ...forClasses(classes.filter(c => c.loc === user.loc).map(c => c.id)),
      calls: all('calls').filter(c => c.loc === user.loc),
      actions: all('actions').filter(a => a.loc === user.loc),
      regs: all('regs').filter(r => r.loc === user.loc),
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
      materials: t ? all('materials').filter(m => canSeeMaterial(store, t, m)) : [],
      shares: all('shares').filter(s => ids.has(s.cid)),
      trainings: all('trainings'),
      questions: [], calls: [], actions: [], regs: []
    };
  }

  if (user.role === 'student') {
    const me = store.find('students', user.studentId);
    const c = me && store.find('classes', me.classId);
    if (!me || !c) return { ...base, classes: [], students: [], sessions: [], results: [], reading: [], materials: [], shares: [], trainings: [], questions: [], calls: [], actions: [], regs: [] };
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
      results: all('results').filter(r => r.sid === me.id && base.published[r.cid + '|' + r.sem]).concat(
        /* unpublished results only tell the student that an exam was submitted */
        all('results').filter(r => r.sid === me.id && !base.published[r.cid + '|' + r.sem]).map(r => ({ ...r, pct: null, pending: true }))),
      reading: all('reading').filter(r => r.sid === me.id),
      materials: all('materials').filter(m => mids.has(m.id) && m.share),
      shares,
      trainings: [], questions: [], calls: [], actions: [], regs: []
    };
  }
  throw new Error('Unknown role');
}
