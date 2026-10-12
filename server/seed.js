/* Sample data for a new installation, matching the original prototype.
   Dates are written as they were around Monday 12 Oct 2026 and shifted by whole weeks to the install date,
   so weekdays stay correct and the sample always looks recent. */
import { addDays, diffDays, weekStart, pd } from '../shared/dates.js';
import { hashPassword } from './auth.js';

const REF = '2026-10-12';
const BELIEF = ['Tauheed', 'Adl', 'Nabuwwat', 'Imamat', 'Maad'];

function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const DEMO_USERS = [
  { username: 'abbas', name: 'Br. Abbas', role: 'super' },
  { username: 'tahera', name: 'Sr. Tahera', role: 'academic' },
  { username: 'jafar', name: 'Br. Jafar', role: 'locadmin', loc: 'MUM' },
  { username: 'kazim', name: 'Br. Kazim', role: 'locadmin', loc: 'MUM' },
  { username: 'sabiha', name: 'Sr. Sabiha', role: 'coord', loc: 'MUM' },
  { username: 'maryam', name: 'Sr. Maryam', role: 'teacher', teacherId: 't1' },
  { username: 'zainab', name: 'Zainab H.', role: 'student', studentId: 'zainab' }
];

export function seed(store, today, password) {
  const shift = Math.floor(diffDays(REF, today) / 7) * 7;
  const D = s => addDays(s, shift);
  const T0 = D(REF);
  const rnd = rng(11);
  const S = {
    courses: [
      { code: 'INR', name: 'Introductory', sems: 1, weeks: 5 },
      { code: 'BAS', name: 'Basic', sems: 5, weeks: 8 },
      { code: 'INT', name: 'Intermediate', sems: 5, weeks: 13 },
      { code: 'ADV', name: 'Advance', sems: 5, weeks: 26 }],
    subjects: [
      { key: 'q', name: 'Quran recitation', min: 5, exam: false },
      { key: 'b', name: 'Belief', min: 30, exam: true },
      { key: 'l', name: 'Islamic Laws', min: 15, exam: true },
      { key: 'e', name: 'Ethics', min: 10, exam: true }],
    locations: [
      { code: 'BAH', name: 'Bahrain', primary: 'Br. Yusuf', secondary: 'Br. Naqi', coordinator: 'Sr. Amina', callDay: 'Sunday', callTime: '8:30 PM' },
      { code: 'DAR', name: 'Dar es Salaam', primary: 'Br. Murtaza', secondary: 'Br. Taqi', coordinator: 'Br. Akbar', callDay: 'Tuesday', callTime: '9:00 PM' },
      { code: 'KUL', name: 'Kuala Lumpur', primary: 'Br. Imran', secondary: 'Br. Sadiq', coordinator: 'None yet', callDay: 'Friday', callTime: '8:00 PM' },
      { code: 'LON', name: 'London', primary: 'Br. Sajjad', secondary: 'Br. Baqir', coordinator: 'Sr. Hawra', callDay: 'Wednesday', callTime: '9:30 PM' },
      { code: 'MUM', name: 'Mumbai', primary: 'Br. Jafar', secondary: 'Br. Kazim', coordinator: 'Sr. Sabiha', callDay: 'Monday', callTime: '8:00 PM', nextCall: T0 },
      { code: 'TOR', name: 'Toronto', primary: 'Br. Mehdi', secondary: 'Br. Askari', coordinator: 'Sr. Naseem', callDay: 'Thursday', callTime: '8:00 PM' }],
    teachers: [
      { id: 't1', name: 'Sr. Maryam', g: 'F' }, { id: 't2', name: 'Sr. Fatima A.', g: 'F' }, { id: 't3', name: 'Br. Ali R.', g: 'M' },
      { id: 't4', name: 'Br. Hasan M.', g: 'M' }, { id: 't5', name: 'Sr. Zehra N.', g: 'F' }, { id: 't6', name: 'Br. Qasim T.', g: 'M' },
      { id: 't7', name: 'Br. Mohsin D.', g: 'M' }, { id: 't8', name: 'Sr. Rabab S.', g: 'F' }],
    classes: [], students: [], sessions: [], results: [], questions: []
  };
  S.teachers.forEach(t => { t.access = 'own'; t.loc = 'MUM'; t.tzName = 'India'; t.tzOff = 5.5; });

  const SIS = ['Batool', 'Kulsum', 'Ruqayya', 'Masooma', 'Narjis', 'Zehra', 'Sukaina', 'Tahera', 'Rabab', 'Hawra', 'Amina', 'Naseem', 'Shabnam', 'Farwa', 'Kaneez', 'Nargis', 'Zahra', 'Mehjabeen', 'Sughra', 'Asiya', 'Hajra', 'Khadija', 'Sayyeda', 'Tasneem', 'Insiya', 'Arwa', 'Alia', 'Samina', 'Rubab', 'Nazneen', 'Shahida', 'Fizza', 'Bushra', 'Kausar', 'Maryam', 'Sakina', 'Fatima'];
  const BRO = ['Ali', 'Hasan', 'Husain', 'Abbas', 'Mehdi', 'Sajjad', 'Baqir', 'Sadiq', 'Taqi', 'Naqi', 'Askari', 'Murtaza', 'Haider', 'Qasim', 'Akbar', 'Asghar', 'Mohsin', 'Imran', 'Yusuf', 'Salman', 'Meesam', 'Zeeshan', 'Kumail', 'Ammar', 'Mikail', 'Yasir', 'Zaki', 'Riyaz', 'Shabbir', 'Mustafa', 'Jawad', 'Hadi', 'Sibtain'];
  const INI = 'KSAJNTBDFQZHRM';
  let nF = 0, nM = 0, nS = 0, nX = 0;
  const pAttend = {};
  const teacherName = id => { const t = S.teachers.find(t => t.id === id); return t ? t.name : ''; };
  function mkName(g) { const list = g === 'F' ? SIS : BRO; const i = g === 'F' ? nF++ : nM++; return list[i % list.length] + ' ' + INI[(i * 5 + Math.floor(i / list.length) * 3) % INI.length] + '.'; }
  function mkClass(c, n, first) {
    S.classes.push(c);
    for (let i = 0; i < n; i++) {
      const f = first && first[i];
      const id = f && f.id || ('s' + (++nS));
      pAttend[id] = f && f.p || (rnd() < .2 ? .78 : .94);
      S.students.push({ id, name: f ? f.name : mkName(c.g), g: c.g, classId: c.id, joined: f && f.joined ? D(f.joined) : D('2026-01-01'), city: f && f.city || '', tzName: 'India', tzOff: 5.5, prefs: { email: true, wa: true, absence: true } });
    }
  }
  function mkSessions(cid, last, count, o) {
    o = o || {}; const cls = S.classes.find(c => c.id === cid); let wk = 1;
    last = D(last);
    const cancelledDates = (o.cancelled || []).map(D), unloggedDates = (o.unlogged || []).map(D);
    for (let i = count - 1; i >= 0; i--) {
      const dt = addDays(last, -7 * i); const cancelled = cancelledDates.includes(dt); const unlogged = unloggedDates.includes(dt);
      const x = { id: 'x' + (++nX), classId: cid, date: dt, held: !cancelled, logged: cancelled || !unlogged, week: cancelled ? null : wk, att: {}, reason: cancelled ? 'Teacher travelling' : '', loggedBy: '' };
      if (!cancelled) {
        if (x.logged) { S.students.filter(s => s.classId === cid && s.joined <= dt).forEach(s => { x.att[s.id] = rnd() < pAttend[s.id] ? 'p' : 'a'; }); x.loggedBy = teacherName(cls.teacherId); }
        wk++;
      }
      S.sessions.push(x);
    }
  }
  function forceLast(stId, vals) {
    const st = S.students.find(s => s.id === stId);
    const ss = S.sessions.filter(x => x.classId === st.classId && x.held && x.logged).sort((a, b) => a.date < b.date ? 1 : -1);
    vals.forEach((v, i) => { if (ss[i]) ss[i].att[stId] = v; });
  }
  const T = h => h * 60;
  mkClass({ id: 'MUM-INR-002', loc: 'MUM', course: 'INR', sem: 1, g: 'F', teacherId: 't2', day: 3, time: T(20), status: 'active' }, 11);
  mkClass({ id: 'MUM-BAS-003', loc: 'MUM', course: 'BAS', sem: 2, g: 'F', teacherId: 't1', assistantId: 'zainab', day: 4, time: T(19.5), status: 'active', meet: 'https://meet.google.com/xvw-xhch-xdc' }, 14, [
    { id: 'zainab', name: 'Zainab H.', p: 1, city: 'Toronto' }, { id: 'fatimar', name: 'Fatima R.', p: 1 }, { id: 'sakinam', name: 'Sakina M.', p: 1 }]);
  mkClass({ id: 'MUM-BAS-004', loc: 'MUM', course: 'BAS', sem: 2, g: 'M', teacherId: 't3', day: 0, time: T(9), status: 'active' }, 12);
  mkClass({ id: 'MUM-BAS-005', loc: 'MUM', course: 'BAS', sem: 1, g: 'M', teacherId: null, day: 5, time: T(20), status: 'awaiting', createdBy: 'Sr. Sabiha', createdOn: D('2026-10-09') }, 0);
  mkClass({ id: 'MUM-INT-001', loc: 'MUM', course: 'INT', sem: 1, g: 'M', teacherId: 't4', day: 6, time: T(20.5), status: 'active' }, 16, [{ id: 'newm', name: 'Riyaz D.', joined: '2026-10-05', p: 1 }]);
  mkClass({ id: 'MUM-ADV-001', loc: 'MUM', course: 'ADV', sem: 1, g: 'F', teacherId: 't5', day: 6, time: T(18), status: 'active' }, 23, [
    { id: 'fu1', name: 'Shahida T.', p: 1 }, { id: 'fu2', name: 'Kausar N.', p: 1 }, { id: 'rk1', name: 'Bushra F.', p: 1 }, { id: 'ex1', name: 'Fizza Q.', p: 1 }]);
  mkClass({ id: 'BAH-BAS-001', loc: 'BAH', course: 'BAS', sem: 1, g: 'F', teacherId: 't1', day: 6, time: T(21), status: 'active' }, 9);
  const zainab = S.students.find(s => s.id === 'zainab'); zainab.tzName = 'Toronto'; zainab.tzOff = -4;
  mkSessions('MUM-INR-002', '2026-10-07', 3, { unlogged: ['2026-10-07'] });
  mkSessions('MUM-BAS-003', '2026-10-08', 5, { unlogged: ['2026-10-08'] });
  mkSessions('MUM-BAS-004', '2026-10-11', 1);
  mkSessions('MUM-INT-001', '2026-10-10', 10, { cancelled: ['2026-09-05'] });
  mkSessions('MUM-ADV-001', '2026-10-10', 20, { unlogged: ['2026-10-03'] });
  mkSessions('BAH-BAS-001', '2026-10-10', 4);
  forceLast('zainab', ['p', 'p', 'p', 'a']);
  forceLast('sakinam', ['a', 'a', 'p', 'p']);
  forceLast('fatimar', ['p', 'p', 'a', 'p']);
  forceLast('fu1', ['a', 'a', 'a', 'a', 'a', 'p']);
  forceLast('fu2', ['a', 'a', 'a', 'a', 'p']);
  forceLast('rk1', ['a', 'a', 'p']);
  forceLast('ex1', ['e', 'p', 'p']);
  forceLast('newm', ['p']);
  /* Semester 1 results for the two Basic classes now in Semester 2 */
  let nR = 0;
  ['MUM-BAS-003', 'MUM-BAS-004'].forEach(cid => {
    S.students.filter(s => s.classId === cid).forEach(s => {
      ['b', 'l', 'e'].forEach(sub => {
        S.results.push({ id: 'r' + (++nR), sid: s.id, cid, course: 'BAS', sem: 1, sub, pct: 58 + Math.floor(rnd() * 38), attempt: 1, date: D('2026-07-15') });
      });
    });
  });
  const setRes = (sid, sub, pct) => { S.results.find(r => r.sid === sid && r.sem === 1 && r.sub === sub).pct = pct; };
  setRes('zainab', 'b', 82); setRes('zainab', 'l', 64); setRes('zainab', 'e', 76); setRes('fatimar', 'l', 42);

  /* Question bank: Belief questions are definitional; the others are placeholders for the academic team */
  let nQ = 0;
  const addQ = (course, sem, sub, text, options, correct, extra) => S.questions.push(Object.assign({ id: 'q' + (++nQ), course, sem, sub, text, options, correct, retired: false, type: 'single' }, extra || {}));
  addQ('BAS', 2, 'b', 'Adl, the subject of this semester, refers to which belief?', ['The oneness of God', 'Divine justice', 'Prophethood', 'The Day of Resurrection'], 1);
  addQ('BAS', 2, 'b', 'Which of these is one of the five roots of religion studied in this course?', ['Salat', 'Sawm', 'Imamat', 'Hajj'], 2);
  addQ('BAS', 2, 'b', 'Tauheed, studied in Semester 1, means:', ['The oneness of God', 'Divine justice', 'Prophethood', 'Leadership after the Prophet'], 0);
  addQ('BAS', 2, 'b', 'Nabuwwat, the subject of Semester 3, means:', ['Divine justice', 'The Day of Resurrection', 'Prophethood', 'The oneness of God'], 2);
  addQ('BAS', 2, 'b', 'Maad, the subject of Semester 5, refers to:', ['Prophethood', 'The Day of Resurrection', 'Divine justice', 'Leadership after the Prophet'], 1);
  addQ('BAS', 2, 'b', 'The five roots of religion are Tauheed, Adl, Nabuwwat, Imamat and ____.', [], 0, { type: 'fill', answers: ['Maad', 'Meaad'] });
  addQ('BAS', 2, 'b', 'Match each term to its meaning.', [], 0, { type: 'match', left: ['Tauheed', 'Adl', 'Nabuwwat', 'Maad'], right: ['The oneness of God', 'Divine justice', 'Prophethood', 'The Day of Resurrection'] });
  addQ('BAS', 2, 'b', 'Select the translation of this ayat (Al-Fatiha 1:2).', ['In the name of Allah, the Beneficent, the Merciful', 'All praise belongs to Allah, Lord of the worlds', 'Master of the Day of Judgement', 'Guide us on the straight path'], 1, { type: 'ayah', ar: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ' });
  [['l', 'Islamic Laws'], ['e', 'Ethics']].forEach(p => { for (let i = 1; i <= 3; i++) addQ('BAS', 2, p[0], '[' + p[1] + ' sample question ' + i + ': the academic team writes the real question]', ['[Option A, marked correct]', '[Option B]', '[Option C]', '[Option D]'], 0); });

  const exams = ['b', 'l', 'e'].map(sub => ({ id: 'BAS-2-' + sub, course: 'BAS', sem: 2, sub, open: false, from: D('2026-11-02'), to: D('2026-11-08') }));
  const traditions = [
    { id: 'h1', text: '[Tradition on the significance of acquiring knowledge: text to be supplied by the academic team]', source: '[Source]' },
    { id: 'h2', text: '[Second tradition: text to be supplied by the academic team]', source: '[Source]' }];
  const calls = [['2026-09-14', 'Held'], ['2026-09-21', 'Held'], ['2026-09-28', 'Missed'], ['2026-10-05', 'Held']].map((c, i) => ({ id: 'c' + (i + 1), loc: 'MUM', date: D(c[0]), status: c[1] }));
  const actions = [
    { id: 'a1', loc: 'MUM', text: 'Confirm the Semester 2 exam window with the academic team', owner: 'Br. Kazim', due: D('2026-10-09'), done: false, rem: 2 },
    { id: 'a2', loc: 'MUM', text: 'Follow up the two unlogged sessions', owner: 'Sr. Sabiha', due: D('2026-10-12'), done: false, rem: 0 },
    { id: 'a3', loc: 'MUM', text: 'Find a teacher for MUM-BAS-005', owner: 'Br. Jafar', due: D('2026-10-14'), done: false, rem: 0 }];
  const regs = [
    { id: 'r1', loc: 'MUM', name: 'Hawra B.', g: 'F', course: 'INR', city: 'Pune' },
    { id: 'r2', loc: 'MUM', name: 'Zaki F.', g: 'M', course: 'BAS', city: 'Mumbai' },
    { id: 'r3', loc: 'MUM', name: 'Insiya Q.', g: 'F', course: 'BAS', city: 'Nairobi' }];
  const materials = [
    { id: 'm1', title: 'Basic Semester 2 syllabus: Belief (Adl)', type: 'Syllabus', course: 'BAS', sem: 2, sub: 'b', week: null, share: true, src: 'Basic-Sem2-Belief-syllabus.pdf', date: '2026-09-01' },
    { id: 'm2', title: 'Basic Semester 2 syllabus: Islamic Laws', type: 'Syllabus', course: 'BAS', sem: 2, sub: 'l', week: null, share: true, src: 'Basic-Sem2-Laws-syllabus.pdf', date: '2026-09-01' },
    { id: 'm3', title: 'Basic Semester 2 syllabus: Ethics', type: 'Syllabus', course: 'BAS', sem: 2, sub: 'e', week: null, share: true, src: 'Basic-Sem2-Ethics-syllabus.pdf', date: '2026-09-01' },
    { id: 'm4', title: 'Teacher guide: Adl, Semester 2', type: 'Teacher guide', course: 'BAS', sem: 2, sub: 'b', week: null, share: false, src: 'Teacher-guide-Adl.pdf', date: '2026-08-28' },
    { id: 'm5', title: 'Slides for week 6: Belief', type: 'Slides', course: 'BAS', sem: 2, sub: 'b', week: 6, share: true, src: 'https://drive.google.com/', date: '2026-10-05' },
    { id: 'm6', title: 'Basic Semester 1 syllabus: Belief (Tauheed)', type: 'Syllabus', course: 'BAS', sem: 1, sub: 'b', week: null, share: true, src: 'Basic-Sem1-Belief-syllabus.pdf', date: '2026-08-01' },
    { id: 'm7', title: 'Handbook: teaching adults online', type: 'Teacher guide', course: 'ALL', sem: 0, sub: 'all', week: null, share: false, src: 'Online-teaching-handbook.pdf', date: '2026-07-15' },
    { id: 'm8', title: 'Teacher guide: Tauheed, Intermediate Semester 1', type: 'Teacher guide', course: 'INT', sem: 1, sub: 'b', week: null, share: false, src: 'Teacher-guide-Int-Tauheed.pdf', date: '2026-08-10' },
    { id: 'm9', title: 'Basic Semester 4 syllabus: Belief (Imamat)', type: 'Syllabus', course: 'BAS', sem: 4, sub: 'b', week: null, share: true, src: 'Basic-Sem4-Belief-syllabus.pdf', date: '2026-08-01' },
    { id: 'm10', title: 'Basic Semester 2 reading book: Adl', type: 'Book', course: 'BAS', sem: 2, sub: 'b', week: null, pages: 420, share: true, src: 'Basic-Sem2-reading-book.pdf', date: '2026-09-05' },
    { id: 'm11', title: 'General reading book: Ethics in daily life', type: 'Book', course: 'ALL', sem: 0, sub: 'all', week: null, pages: 180, share: true, src: 'Ethics-daily-life.pdf', date: '2026-08-20' }];
  materials.forEach(m => { m.date = D(m.date); });
  const shares = [{ id: 'sh1', mid: 'm10', cid: 'MUM-BAS-003', date: D('2026-09-14'), by: 'Sr. Maryam' }, { id: 'sh2', mid: 'm1', cid: 'MUM-BAS-003', date: D('2026-09-10'), by: 'Sr. Maryam' }, { id: 'sh3', mid: 'm6', cid: 'BAH-BAS-001', date: D('2026-09-19'), by: 'Sr. Maryam' }];
  const trainings = [
    { id: 'tr1', title: 'Refresher: Adl before Semester 2 week 6', kind: 'Refresher', course: 'BAS', sem: 2, date: D('2026-10-17'), time: 11 * 60, mode: 'Online on Google Meet', facilitator: 'Sr. Tahera', req: true, rsvp: {}, attended: null },
    { id: 'tr2', title: 'Using the session log and student follow-up', kind: 'Programme', course: 'ALL', sem: 0, date: D('2026-10-25'), time: 10 * 60, mode: 'Online on Google Meet', facilitator: 'Br. Abbas', req: false, rsvp: { t3: 'yes', t4: 'yes', t5: 'no' }, attended: null },
    { id: 'tr3', title: 'Refresher: Imamat before Semester 4', kind: 'Refresher', course: 'BAS', sem: 4, date: D('2026-11-07'), time: 11 * 60, mode: 'Online on Google Meet', facilitator: 'Sr. Tahera', req: true, rsvp: {}, attended: null },
    { id: 'tr0', title: 'Orientation for teachers', kind: 'Programme', course: 'ALL', sem: 0, date: D('2026-09-20'), time: 10 * 60, mode: 'Online on Google Meet', facilitator: 'Br. Abbas', req: true, rsvp: { t1: 'yes', t2: 'yes', t3: 'yes', t4: 'yes', t5: 'yes' }, attended: { t1: true, t2: true, t3: true, t4: true, t5: false } }];

  /* Weekly reading for the last five weeks */
  const reading = [];
  const stuStatus = s => {
    const ss = S.sessions.filter(x => x.classId === s.classId && x.held && x.logged && x.date >= s.joined).sort((a, b) => a.date < b.date ? -1 : 1);
    let miss = 0; for (let i = ss.length - 1; i >= 0; i--) { const a = ss[i].att[s.id] || 'a'; if (a === 'e') continue; if (a === 'a') miss++; else break; }
    return miss >= 4 ? 'followup' : miss >= 2 ? 'risk' : 'active';
  };
  (function () {
    let s2 = 11; const r2 = () => { s2 = (s2 * 9301 + 49297) % 233280; return s2 / 233280; };
    const weeks = [-35, -28, -21, -14, -7].map(n => addDays(weekStart(T0), n));
    S.students.forEach(s => {
      const c = S.classes.find(c => c.id === s.classId); if (!c || (c.loc !== 'MUM' && c.teacherId !== 't1') || c.course === 'INR') return;
      const st = stuStatus(s);
      weeks.forEach((w, i) => {
        if (addDays(w, 6) < s.joined) return;
        if (s.id === 'zainab' && i === 4) return;
        if ((st === 'followup' && i >= 2) || (st === 'risk' && i >= 3) || r2() < 0.15) return;
        const ayat = Math.min(520, Math.round((0.85 + r2() * 0.4) * 35) * 10); const pages = Math.round((0.85 + r2() * 0.4) * 70);
        reading.push({ id: s.id + '|' + w, sid: s.id, week: w, ayat: s.id === 'zainab' ? [350, 380, 320, 350][i] : ayat, pages: s.id === 'zainab' ? [70, 64, 72, 58][i] : pages, book: c.id === 'MUM-BAS-003' ? 'm10' : '' });
      });
    });
  })();

  store.tx(() => {
    const put = (c, list) => list.forEach(o => store.put(c, o));
    put('courses', S.courses.map(c => ({ id: c.code, ...c })));
    put('subjects', S.subjects.map(s => ({ id: s.key, ...s })));
    put('locations', S.locations.map(l => ({ id: l.code, meet: '', nextCall: l.nextCall || nextWeekday(T0, l.callDay), ...l })));
    put('teachers', S.teachers);
    put('classes', S.classes.map(c => ({ meet: '', ...c })));
    put('students', S.students);
    put('sessions', S.sessions);
    put('results', S.results);
    put('questions', S.questions);
    put('exams', exams);
    put('traditions', traditions);
    put('calls', calls);
    put('actions', actions);
    put('regs', regs);
    put('materials', materials);
    put('shares', shares);
    put('trainings', trainings);
    put('reading', reading);
    store.set('published', { 'MUM-BAS-003|1': true });
    store.set('charts', { 'INR-1': true, 'BAS-1': true, 'BAS-2': true });
    store.set('targets', { ayat: 350, pages: 70 });
    DEMO_USERS.forEach(u => store.put('users', { id: 'u-' + u.username, ...u, password: hashPassword(password), demo: true }));
  });
}

function nextWeekday(from, dayName) {
  const idx = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(dayName);
  let d = from; while (pd(d).getDay() !== idx) d = addDays(d, 1); return d;
}

export { BELIEF };
