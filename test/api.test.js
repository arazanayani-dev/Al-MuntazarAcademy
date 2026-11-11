import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { SqliteStore } from '../server/db.js';
import { ensureSessions } from '../server/actions.js';

const PW = 'almuntazar123';
/* stands in for Claude when drafting questions: 12 well-formed questions per chapter (plus one broken one,
   which must be dropped), in the shape the real call returns */
const asked = [];
async function fakeAsk(meta) {
  asked.push(meta);
  /* the evidence is a passage of the text, as the real drafting must give */
  const evidence = meta.text.split(/\s+/).slice(0, 8).join(' ');
  const single = i => ({ type: 'single', basis: meta.guide && i === 1 ? 'guide' : 'syllabus', point: 'point ' + i, evidence: meta.guide && i === 1 ? meta.guide.split(/\s+/).slice(0, 8).join(' ') : evidence, text: 'Ch' + meta.n + ' Q' + i + ' about ' + meta.title + '?', options: ['Right', 'Wrong A', 'Wrong B', 'Wrong C'], correct: 0, statements: [], answers: [], left: [], right: [] });
  return [1, 2, 3, 4, 5, 6, 7].map(single).concat([
    /* two that the checks must leave out: evidence not in the text, and a right answer that stands out by length */
    { type: 'single', point: 'invented', evidence: 'a sentence that appears nowhere in the syllabus text at all', text: 'Ch' + meta.n + ': an ungrounded question?', options: ['A', 'B', 'C', 'D'], correct: 0, statements: [], answers: [], left: [], right: [] },
    { type: 'single', point: 'tell', evidence, text: 'Ch' + meta.n + ': which answer is longest?', options: ['Because it is a very long and detailed answer that gives every single reason in full', 'No', 'Not so', 'Never'], correct: 0, statements: [], answers: [], left: [], right: [] },
    { type: 'fill', evidence, text: 'Ch' + meta.n + ': the first root is ____.', options: [], correct: 0, statements: [], answers: ['Tauheed'], left: [], right: [] },
    { type: 'fill', evidence, text: 'Ch' + meta.n + ': the second root is ____.', options: [], correct: 0, statements: [], answers: ['Adl'], left: [], right: [] },
    { type: 'combo', evidence, text: 'Ch' + meta.n + ': which are true?\ni. One\nii. Two\niii. Three', options: ['i and ii', 'ii and iii', 'i and iii', 'all three'], correct: 0, statements: ['i. One', 'ii. Two', 'iii. Three'], answers: [], left: [], right: [] },
    { type: 'combo', evidence, text: 'Ch' + meta.n + ': which are false?', options: ['i only', 'ii only', 'iii only', 'i and iii'], correct: 1, statements: ['One', 'Two', 'Three'], answers: [], left: [], right: [] },
    { type: 'match', evidence, text: 'Ch' + meta.n + ': match.', options: [], correct: 0, statements: [], answers: [], left: ['Tauheed', 'Adl', 'Nabuwwat'], right: ['Oneness', 'Justice', 'Prophethood'] },
    { type: 'single', text: 'Broken: three options', options: ['a', 'b', 'c'], correct: 0, statements: [], answers: [], left: [], right: [] },
    { type: 'single', text: 'According to the chapter, what is Adl?', options: ['Justice', 'Mercy', 'Power', 'Knowledge'], correct: 0, statements: [], answers: [], left: [], right: [] }
  ]);
}
/* the answers a student would give to an attempt, all right or all wrong: options and match columns are
   shuffled for each attempt, so the answer is the place the option was shown in */
function answersFor(att, wrong) {
  return att.qids.map((id, i) => {
    const q = store.find('questions', id);
    if (q.type === 'fill') return wrong ? 'zzz' : q.answers[0];
    if (q.type === 'match') return wrong ? q.left.map(() => '') : q.left.map((_, j) => String(att.perms[i].indexOf(j)));
    const want = wrong ? (q.correct + 1) % q.options.length : q.correct; const shown = att.operms && att.operms[i];
    return shown ? shown.indexOf(want) : want;
  });
}
let server, base, store, dir;

before(async () => {
  process.env.SEED_PASSWORD = PW;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-test-'));
  store = await SqliteStore.open(':memory:');
  const askTasks = async () => [
    { task: 'Call the parents of the absent students', owner: 'sr. sabiha', due: '2026-08-07', quote: 'she will call the parents of the absent students by Friday' },
    { task: 'Update the notice board', owner: 'Somebody Unknown', due: '2020-01-01', quote: 'Everybody agreed we should update the notice board soon' },
    { task: 'An invented task', owner: 'Sr. Sabiha', due: '', quote: 'this line was never said by anyone at the meeting' }
  ];
  const app = await createApp({ store, dataDir: dir, today: () => '2026-10-12', askQuestions: fakeAsk, askTasks });
  await new Promise(r => { server = app.listen(0, r); });
  base = 'http://localhost:' + server.address().port;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function login(username, password = PW) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!r.ok) return { status: r.status };
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const req = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  /* raw: sends a file body, as the browser does for uploads; bytes: fetches a file download */
  const raw = async (url, buf) => { const res = await fetch(base + url, { method: 'POST', headers: { cookie, 'Content-Type': 'application/octet-stream' }, body: buf }); return { status: res.status, body: await res.json().catch(() => null) }; };
  const bytes = async url => { const res = await fetch(base + url, { headers: { cookie } }); return { status: res.status, type: res.headers.get('content-type'), buf: Buffer.from(await res.arrayBuffer()) }; };
  return { status: 200, get: url => req('GET', url), act: (name, args) => req('POST', '/api/action/' + name, args || {}), raw, bytes };
}

test('the sign-in page is not told about any accounts', async () => {
  const meta = await (await fetch(base + '/api/meta')).json();
  assert.deepEqual(Object.keys(meta).sort(), ['maxUpload', 'setupMessage', 'signedIn', 'temporary', 'today']);
  assert.ok(!JSON.stringify(meta).includes('abbas'));
});

/* a new student comes in through registration, then gets a class */
async function enrol(who, cid, name) {
  const [first, ...rest] = name.split(' '); const g = store.find('classes', cid).g;
  const r = await who.act('regAdd', { first, last: rest.join(' '), g, dob: '1990-01-01', city: 'Thane', phone: '+91 98200 12345', email: name.toLowerCase().replace(/\W/g, '') + '@example.com', course: store.find('classes', cid).course });
  assert.equal(r.status, 200);
  return who.act('allocSave', { rid: store.all('regs').find(x => x.name === name).id, cid });
}

test('sign-in rejects a wrong password and accepts the right one', async () => {
  assert.equal((await login('zainab', 'wrong-password')).status, 401);
  const z = await login('zainab');
  assert.equal(z.status, 200);
  const d = await z.get('/api/data');
  assert.equal(d.body.me.role, 'student');
  assert.equal((await fetch(base + '/api/data')).status, 401);
});

test('students never receive question answers or other students\' attendance', async () => {
  const su = await login('abbas');
  assert.equal((await su.act('userAdd', { username: 'fatimar', name: 'Fatima R.', role: 'student', studentId: 'fatimar', password: 'password123' })).status, 200);
  const f = await login('fatimar', 'password123');
  const d = (await f.get('/api/data')).body.data;
  assert.equal(d.questions.length, 0);
  assert.deepEqual(d.students.map(s => s.id), ['fatimar']);
  for (const x of d.sessions) assert.ok(Object.keys(x.att).every(k => k === 'fatimar'));
  assert.equal((await f.get('/api/sample-paper')).status, 403);
});

test('actions are refused outside a role or scope', async () => {
  const z = await login('zainab');
  assert.equal((await z.act('publish', { key: 'MUM-BAS-003|2' })).status, 403);
  const t = await login('maryam');
  const other = store.all('sessions').find(x => x.classId === 'MUM-INR-002' && !x.logged);
  assert.equal((await t.act('logSave', { sid: other.id, held: true, att: {} })).status, 403);
  const co = await login('sabiha');
  assert.equal((await co.act('assignSave', { cid: 'MUM-BAS-005', teacher: 't3' })).status, 403);
});

test('a registration is added to the caller\'s location and allocated to a class', async () => {
  const lr = await login('jafar');
  const form = { first: 'Ruqayya', last: 'S.', g: 'F', dob: '1990-05-14', city: 'Thane', phone: '+91 98200 12345', email: 'Ruqayya@Example.com', course: 'BAS' };
  // every detail is required, and checked
  for (const k of ['first', 'last', 'g', 'dob', 'city', 'phone', 'email']) assert.equal((await lr.act('regAdd', { ...form, [k]: '' })).status, 400, k + ' is required');
  assert.equal((await lr.act('regAdd', { ...form, dob: '2999-01-01' })).status, 400, 'a birth date in the future');
  assert.equal((await lr.act('regAdd', { ...form, phone: '12' })).status, 400, 'a phone number too short');
  assert.equal((await lr.act('regAdd', { ...form, email: 'not-an-email' })).status, 400, 'an email without a domain');
  assert.equal((await lr.act('regAdd', form)).status, 200);
  const r = store.all('regs').find(x => x.name === 'Ruqayya S.');
  assert.equal(r.loc, 'MUM');
  assert.equal((await lr.act('allocSave', { rid: r.id, cid: 'MUM-BAS-003' })).status, 200);
  const made = store.all('students').find(s => s.name === 'Ruqayya S.' && s.classId === 'MUM-BAS-003');
  assert.ok(made); assert.equal(made.last, 'S.'); assert.equal(made.dob, '1990-05-14'); assert.equal(made.phone, '+91 98200 12345'); assert.equal(made.email, 'ruqayya@example.com');
  assert.ok(!store.find('regs', r.id));
  const t = await login('maryam');
  assert.equal((await t.act('regAdd', form)).status, 403);
  // a student sent back to registrations keeps their details, and editing the waiting record does not lose them
  assert.equal((await lr.act('removeStudent', { sid: made.id, mode: 'wait' })).status, 200);
  const back = store.all('regs').find(x => x.sid === made.id); assert.equal(back.phone, '+91 98200 12345');
  const shown = (await lr.get('/api/data')).body.data.regs.find(x => x.id === back.id); assert.equal(shown.email, 'ruqayya@example.com');
  assert.equal((await lr.act('regEdit', { id: back.id, first: shown.first, last: shown.last, dob: shown.dob, phone: shown.phone, email: shown.email, city: 'Pune', g: 'F', course: 'BAS' })).status, 200);
  assert.equal(store.find('students', made.id).dob, '1990-05-14'); assert.equal(store.find('students', made.id).city, 'Pune');
  assert.equal((await lr.act('allocSave', { rid: back.id, cid: 'MUM-BAS-003' })).status, 200);
  // date of birth, phone and email reach the location's staff, not the teacher or academic team
  const seen = async who => (await who.get('/api/data')).body.data.students.find(s => s.id === made.id);
  assert.equal((await seen(lr)).phone, '+91 98200 12345');
  for (const who of [t, await login('tahera')]) { const s = await seen(who); assert.ok(s); assert.equal(s.dob, undefined); assert.equal(s.phone, undefined); assert.equal(s.email, undefined); }
});

test('the super admin registers a student at a chosen location and allocates a class', async () => {
  const su = await login('abbas'); const c = store.find('classes', 'BAH-BAS-001');
  const form = { first: 'Sakina', last: 'Admin', g: c.g, dob: '1995-02-03', city: 'Manama', phone: '+973 3600 1234', email: 'sakina@example.com', course: 'BAS' };
  assert.equal((await su.act('regAdd', form)).status, 400, 'the location must be chosen');
  assert.equal((await su.act('regAdd', { ...form, loc: 'NOPE' })).status, 400);
  assert.equal((await su.act('regAdd', { ...form, loc: 'BAH' })).status, 200);
  const r = store.all('regs').find(x => x.name === 'Sakina Admin'); assert.equal(r.loc, 'BAH');
  assert.equal((await (await login('sabiha')).act('allocSave', { rid: r.id, cid: c.id })).status, 404, 'staff of another location cannot allocate it');
  assert.equal((await su.act('regEdit', { id: r.id, ...form, city: 'Muharraq' })).status, 200);
  assert.equal((await su.act('allocSave', { rid: r.id, cid: c.id })).status, 200);
  const s = store.all('students').find(x => x.name === 'Sakina Admin'); assert.equal(s.classId, c.id); assert.equal(s.city, 'Muharraq');
});

test('the same person cannot be registered twice, at any location', async () => {
  const lr = await login('jafar'), su = await login('abbas');
  const form = { first: 'Ali', last: 'Twice', g: 'M', dob: '1980-03-26', city: 'Mumbai', phone: '+91 98200 11111', email: 'ali.twice@example.com', course: 'BAS' };
  assert.equal((await lr.act('regAdd', form)).status, 200);
  const r = store.all('regs').find(x => x.name === 'Ali Twice');
  const again = await su.act('regAdd', { ...form, loc: 'KUL' });
  assert.equal(again.status, 400); assert.match(again.body.error, /Ali Twice is already registered and waiting for a class at Mumbai/);
  // however it is typed, and whichever details match
  const other = { phone: '+91 98200 22222', email: 'other@example.com' };
  assert.equal((await lr.act('regAdd', { ...form, ...other, first: 'ALI ', last: ' twice' })).status, 400, 'same name and date of birth');
  assert.equal((await lr.act('regAdd', { ...form, first: 'Alee', dob: '1981-01-01' })).status, 400, 'same phone and email');
  assert.equal((await lr.act('regAdd', { ...form, email: 'other@example.com', phone: '98200 11111', dob: '1981-01-01' })).status, 400, 'same name and phone, without the country code');
  // a family sharing a phone or an email is fine
  assert.equal((await lr.act('regAdd', { ...form, first: 'Zahra', g: 'F', dob: '1985-01-01', email: 'zahra.twice@example.com' })).status, 200);
  const z = store.all('regs').find(x => x.name === 'Zahra Twice');
  // an edit cannot make a duplicate, and saving a record unchanged is not one
  assert.equal((await lr.act('regEdit', { id: z.id, ...form, g: 'F' })).status, 400);
  assert.equal((await lr.act('regEdit', { id: r.id, ...form })).status, 200);
  // still caught once the person has a class
  assert.equal((await lr.act('allocSave', { rid: r.id, cid: 'MUM-INT-001' })).status, 200);
  const dup = await su.act('regAdd', { ...form, loc: 'KUL' }); assert.equal(dup.status, 400); assert.match(dup.body.error, /already registered, in class MUM-INT-001/);
  // a registration made by mistake can be removed, by its own location or the super admin
  assert.equal((await (await login('maryam')).act('regRemove', { id: z.id })).status, 403);
  assert.equal((await lr.act('regRemove', { id: z.id })).status, 200); assert.ok(!store.find('regs', z.id));
  // a student who left can register again
  const sid = store.all('students').find(x => x.name === 'Ali Twice').id;
  assert.equal((await lr.act('removeStudent', { sid, mode: 'left', reason: 'moved away' })).status, 200);
  assert.equal((await lr.act('regAdd', form)).status, 200);
  const back = store.all('regs').find(x => x.name === 'Ali Twice'); assert.equal(back.sid, undefined);
  assert.equal((await lr.act('regRemove', { id: back.id })).status, 200);
});

test('a location\'s responsible persons are chosen from the students, not typed', async () => {
  const su = await login('abbas'); const base = { name: 'Muscat', code: 'MCT', callDay: 'Monday', callTime: '8:00 PM' };
  assert.equal((await su.act('locAdd', { ...base, primary: 'Someone Typed', secondary: 'fatimar' })).status, 400, 'a typed name is refused');
  assert.equal((await su.act('locAdd', { ...base, secondary: 'fatimar' })).status, 400, 'the primary is needed');
  assert.equal((await su.act('locAdd', { ...base, name: 'Salalah', code: 'SLL', primary: 'sakinam' })).status, 200, 'the secondary is optional');
  assert.equal(store.find('locations', 'SLL').secondary, ''); store.tx(() => store.del('locations', 'SLL'));
  assert.equal((await su.act('locAdd', { ...base, primary: 'fatimar', secondary: 'fatimar' })).status, 400, 'two different people');
  assert.equal((await su.act('locAdd', { ...base, primary: 'fatimar', secondary: 'sakinam', coordinator: 'zainab' })).status, 200);
  const l = store.find('locations', 'MCT'); const nameOf = id => store.find('students', id).name;
  assert.equal(l.primary, nameOf('fatimar')); assert.equal(l.primarySid, 'fatimar'); assert.equal(l.coordinator, nameOf('zainab'));
  // an edit cannot type a name in, or take a person away; an earlier name can stay until replaced
  const edit = { id: 'MCT', name: 'Muscat', primary: 'fatimar', secondary: 'sakinam', callDay: 'Monday' };
  assert.equal((await su.act('locEdit', { ...edit, secondary: 'Typed Name' })).status, 400);
  assert.equal((await su.act('locEdit', { ...edit, primary: '' })).status, 400, 'the primary cannot be taken away');
  assert.equal((await su.act('locEdit', { ...edit, secondary: '' })).status, 200, 'the secondary can');
  assert.equal(store.find('locations', 'MCT').secondary, '');
  assert.equal((await su.act('locEdit', edit)).status, 200); assert.equal(store.find('locations', 'MCT').coordinator, 'None yet');
  const m = store.find('locations', 'MUM');
  assert.equal((await su.act('locEdit', { id: 'MUM', name: m.name, primary: m.primary, secondary: m.secondary, coordinator: m.coordinator, callDay: m.callDay })).status, 200, 'a name from before the rule');
  // a location with nobody set yet can still be edited
  store.tx(() => store.put('locations', { ...store.find('locations', 'TOR'), primary: '', secondary: '' }));
  assert.equal((await su.act('locEdit', { id: 'TOR', name: 'Toronto', primary: '', secondary: '', callDay: 'Friday' })).status, 200);
  // a change of name follows the person
  const s = store.find('students', 'sakinam');
  assert.equal((await su.act('studentEdit', { id: 'sakinam', first: 'Sakina', last: 'Renamed', city: s.city })).status, 200);
  assert.equal(store.find('locations', 'MCT').secondary, 'Sakina Renamed');
  await su.act('studentEdit', { id: 'sakinam', first: 'Sakina', last: 'M.', city: s.city });
  /* leave nobody holding this location's posts, for the tests after */
  store.tx(() => { const u = store.all('users').find(x => x.studentId === 'fatimar'); store.put('users', { ...u, roles: [] }); delete store.find('users', u.id).loc; store.del('locations', 'MCT'); });
});

test('the super admin creates a class at any location and can give it a teacher', async () => {
  const su = await login('abbas'); const form = { course: 'BAS', sem: 1, g: 'F', day: 2, time: '19:30', start: '2026-10-20' };
  assert.equal((await su.act('classSave', form)).status, 400, 'the location must be chosen');
  assert.equal((await su.act('classSave', { ...form, loc: 'NOPE' })).status, 400);
  const r = await su.act('classSave', { ...form, loc: 'LON' }); assert.equal(r.status, 200);
  const c = store.find('classes', r.body.result.id); assert.equal(c.id, 'LON-BAS-001'); assert.equal(c.loc, 'LON'); assert.equal(c.status, 'awaiting');
  assert.equal((await (await login('jafar')).act('assignSave', { cid: c.id, teacher: 't1' })).status, 403, 'staff of another location cannot');
  assert.equal((await su.act('assignSave', { cid: c.id, teacher: 't1' })).status, 200);
  assert.equal(store.find('classes', c.id).status, 'active');
  // with a teacher from the start
  const w = await su.act('classSave', { ...form, loc: 'LON', teacher: 't1' }); assert.equal(store.find('classes', w.body.result.id).teacherId, 't1');
  // a location responsible's location comes from their login, whatever is sent
  const own = await (await login('jafar')).act('classSave', { ...form, loc: 'LON' }); assert.equal(store.find('classes', own.body.result.id).loc, 'MUM');
  for (const id of [c.id, w.body.result.id, own.body.result.id]) store.tx(() => { store.all('sessions').filter(x => x.classId === id).forEach(x => store.del('sessions', x.id)); store.del('classes', id); });
});

test('being named at a location gives the role, and being replaced takes it away', async () => {
  const su = await login('abbas'); const base = { callDay: 'Monday', callTime: '8:00 PM' };
  const userOf = sid => store.all('users').find(u => u.studentId === sid);
  // a student with a login: zainab. Without one: sakinam and another
  const spare = store.all('students').find(s => s.classId && !userOf(s.id) && s.id !== 'sakinam').id;
  const added = await su.act('locAdd', { ...base, name: 'Doha', code: 'DOH', primary: 'zainab', secondary: spare, coordinator: 'sakinam' });
  assert.equal(added.status, 200); assert.match(added.body.toast, /Role given to Zainab H\./); assert.match(added.body.toast, /no login yet/);
  assert.deepEqual(userOf('zainab').roles, ['locadmin']); assert.equal(userOf('zainab').loc, 'DOH');
  const z = await login('zainab'); const me = (await z.get('/api/data')).body.me;
  assert.ok(me.roles.includes('locadmin')); assert.ok(me.roles.includes('student'), 'still a student too');
  // a login made later brings the role with it, at that location
  const made = await su.act('userAdd', { studentId: 'sakinam', username: 'sakina.m', password: 'password123', roles: [] });
  assert.equal(made.status, 200); assert.match(made.body.toast, /with the role at Doha/);
  assert.deepEqual(userOf('sakinam').roles, ['coord']); assert.equal(userOf('sakinam').loc, 'DOH');
  // the role cannot be taken away by hand while the post is held
  assert.equal((await su.act('userEdit', { id: userOf('zainab').id, username: 'zainab', roles: [] })).status, 400);
  // one person, one location
  const elsewhere = await su.act('locEdit', { id: 'TOR', name: 'Toronto', primary: 'zainab', callDay: 'Monday' });
  assert.equal(elsewhere.status, 400); assert.match(elsewhere.body.error, /already at Doha/);
  // moving between posts here keeps the right role; replacing someone removes it
  const moved = await su.act('locEdit', { ...base, id: 'DOH', name: 'Doha', primary: 'sakinam', secondary: spare, coordinator: 'zainab' });
  assert.equal(moved.status, 200); assert.deepEqual(userOf('zainab').roles, ['coord']); assert.deepEqual(userOf('sakinam').roles, ['locadmin']);
  const gone = await su.act('locEdit', { ...base, id: 'DOH', name: 'Doha', primary: 'sakinam', secondary: spare });
  assert.match(gone.body.toast, /Role removed from Zainab H\./); assert.deepEqual(userOf('zainab').roles, []); assert.equal(userOf('zainab').loc, undefined);
  assert.ok((await (await login('zainab')).get('/api/data')).body.me.roles.includes('student'), 'still signs in as a student');
  // a typed name from before, now chosen from the list as the same person, keeps the role
  store.tx(() => { store.put('locations', { ...store.find('locations', 'DOH'), coordinator: 'Zainab H.', coordinatorSid: undefined }); store.put('users', { ...userOf('zainab'), roles: ['coord'], loc: 'DOH' }); });
  const same = await su.act('locEdit', { ...base, id: 'DOH', name: 'Doha', primary: 'sakinam', secondary: spare, coordinator: 'zainab' });
  assert.equal(same.status, 200); assert.doesNotMatch(same.body.toast, /removed/); assert.deepEqual(userOf('zainab').roles, ['coord']); assert.equal(userOf('zainab').loc, 'DOH');
  await su.act('locEdit', { ...base, id: 'DOH', name: 'Doha', primary: 'sakinam', secondary: spare });
  // a login from before posts were chosen is matched by name and location when replaced
  const j = store.all('users').find(u => u.username === 'jafar');
  const m = store.find('locations', 'MUM'); const out = await su.act('locEdit', { id: 'MUM', name: m.name, primary: 'wafa1', secondary: m.secondary, coordinator: m.coordinator, callDay: m.callDay });
  assert.equal(out.status, 400, 'an unknown student is refused and nothing changes'); assert.ok(store.find('users', j.id).roles.includes('locadmin') || store.find('users', j.id).role === 'locadmin');
  store.tx(() => { store.del('users', userOf('sakinam').id); store.del('locations', 'DOH'); });
});

test('weekly coordination: the super admin runs it for any location, and participants come from the students', async () => {
  const su = await login('abbas'), lr = await login('jafar'), co = await login('sabiha'), t = await login('maryam');
  // the super admin records a call and action items for a chosen location
  assert.equal((await su.act('callSave', { status: 'Held' })).status, 400, 'the location must be chosen');
  // a meeting is logged only once it has taken place (today is 12 Oct), and each date once
  const future = await su.act('callSave', { loc: 'LON', date: '2026-10-13', status: 'Held' });
  assert.equal(future.status, 400); assert.match(future.body.error, /has not taken place yet/);
  assert.equal((await su.act('callSave', { loc: 'LON', status: 'Held' })).status, 400, 'the date is required');
  store.tx(() => store.put('locations', { ...store.find('locations', 'LON'), callDay: 'Wednesday', nextCall: '2026-10-07' }));
  assert.equal((await su.act('callSave', { loc: 'LON', date: '2026-09-30', status: 'Held' })).status, 200, 'a past meeting, logged late');
  assert.equal(store.find('locations', 'LON').nextCall, '2026-10-07', 'an older meeting leaves the next call alone');
  assert.equal((await su.act('callSave', { loc: 'LON', date: '2026-10-07', status: 'Held', text: 'Follow up', owner: 'Br. Abbas' })).status, 200);
  assert.equal(store.find('locations', 'LON').nextCall, '2026-10-14', 'the next one after it');
  assert.equal((await su.act('callSave', { loc: 'LON', date: '2026-10-07', status: 'Missed' })).status, 400, 'that date is already logged');
  const lonCalls = () => store.all('calls').filter(c => c.loc === 'LON').length; assert.equal(lonCalls(), 2);
  const item = store.all('actions').find(x => x.loc === 'LON' && x.text === 'Follow up'); assert.ok(item);
  assert.equal((await su.act('actionAdd', { loc: 'LON', text: 'Second item' })).status, 200);
  assert.equal((await lr.act('closeAction', { id: item.id })).status, 404, 'staff of another location cannot');
  assert.equal((await su.act('actionEdit', { id: item.id, text: 'Follow up again' })).status, 200);
  assert.equal((await su.act('closeAction', { id: item.id })).status, 200);
  // a location responsible's location comes from their login, whatever is sent
  assert.equal((await lr.act('actionAdd', { loc: 'LON', text: 'Mine' })).status, 200); assert.equal(store.all('actions').find(x => x.text === 'Mine').loc, 'MUM');
  // participants: any student, of any location, whose name and class is all the location responsible receives
  const here = store.all('students').find(s => s.classId === 'MUM-BAS-003' && s.id !== 'zainab').id;
  const away = store.all('students').find(s => s.classId && store.find('classes', s.classId).loc === 'BAH').id;
  assert.equal((await lr.act('participantAdd', { sid: 'Typed Name' })).status, 400, 'a typed name is refused');
  const picks = (await lr.get('/api/data')).body.data.callPicks; const pick = picks.find(p => p.id === away);
  assert.deepEqual(Object.keys(pick).sort(), ['classId', 'id', 'name'], 'nothing private about students elsewhere');
  assert.equal((await co.act('participantAdd', { sid: here })).status, 403, 'not the coordinator');
  assert.equal((await t.act('participantAdd', { sid: here })).status, 403);
  assert.equal((await lr.act('participantAdd', { sid: 'zainab' })).status, 200);
  assert.equal((await lr.act('participantAdd', { sid: 'zainab' })).status, 400, 'only once');
  assert.equal((await lr.act('participantAdd', { sid: away })).status, 200, 'a student of another location');
  assert.ok(store.all('outbox').some(o => o.to === 'zainab' && /weekly coordination call of/.test(o.text)), 'they are told');
  assert.deepEqual(store.find('locations', 'MUM').participants.map(p => p.sid), ['zainab', away]);
  // a participant sees their own place; the location's staff see all; others see none
  const parts = async who => (await who.get('/api/data')).body.data.locations.find(l => l.code === 'MUM').participants;
  assert.deepEqual((await parts(await login('zainab'))).map(p => p.sid), ['zainab']);
  assert.equal((await parts(co)).length, 2); assert.equal((await parts(t)).length, 0);
  // attendance per participant: present unless unticked, and only for a meeting that was held
  store.tx(() => { const m = store.find('locations', 'MUM'); store.put('locations', { ...m, nextCall: '2026-08-03', callDay: 'Monday' }); });
  assert.equal((await lr.act('callSave', { date: '2026-08-03', status: 'Held', att: { [away]: false, typed: true } })).status, 200);
  const held = store.all('calls').find(c => c.loc === 'MUM' && c.date === '2026-08-03');
  assert.deepEqual(held.att.map(x => [x.sid, x.present]), [['zainab', true], [away, false]]);
  assert.equal(store.find('locations', 'MUM').nextCall, '2026-08-10');
  assert.equal((await co.act('callSave', { id: held.id, date: '2026-08-03', status: 'Held' })).status, 200, 'a coordinator logs meetings too');
  // tasks from a pasted transcript: only suggested, checked, and saved after review
  const said = 'Sabiha said she will call the parents of the absent students by Friday. Everybody agreed we should update the notice board soon.';
  const post = async (cookieOf, body) => { const r = await fetch(base + '/api/transcript', { method: 'POST', headers: { cookie: cookieOf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const cookieFor = async u => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  const coCookie = await cookieFor('sabiha');
  assert.equal((await post(coCookie, { callId: 'nope', transcript: said })).status, 404);
  assert.equal((await post(coCookie, { callId: held.id, transcript: 'too short' })).status, 400);
  assert.equal((await post(await cookieFor('maryam'), { callId: held.id, transcript: said })).status, 403, 'not a teacher');
  const before = store.all('actions').length;
  const sug = await post(coCookie, { callId: held.id, transcript: said });
  assert.equal(sug.status, 200); assert.equal(sug.body.dropped, 1, 'a task whose quote is not in the transcript is left out');
  assert.deepEqual(sug.body.tasks.map(t => [t.text, t.owner, t.due]), [['Call the parents of the absent students', 'Sr. Sabiha', '2026-08-07'], ['Update the notice board', '', '']], 'an owner not on the list, and a date before the meeting, are left blank');
  assert.equal(store.all('actions').length, before, 'nothing is saved until reviewed');
  assert.equal((await co.act('actionsFromMeeting', { callId: held.id, items: [sug.body.tasks[1]] })).status, 400, 'an owner must be chosen');
  assert.equal((await co.act('actionsFromMeeting', { callId: held.id, items: [{ ...sug.body.tasks[1], owner: 'Someone Else' }] })).status, 400, 'from the location\'s people');
  assert.equal((await t.act('actionsFromMeeting', { callId: held.id, items: [sug.body.tasks[0]] })).status, 403);
  assert.equal((await co.act('actionsFromMeeting', { callId: held.id, items: [sug.body.tasks[0], { ...sug.body.tasks[1], owner: 'Zainab H.', due: '' }] })).status, 200);
  const saved = store.all('actions').filter(x => x.callId === held.id); assert.equal(saved.length, 2); assert.equal(saved[0].callDate, '2026-08-03'); assert.match(saved[0].quote, /call the parents/); assert.equal(saved[1].due, '2026-10-19');
  assert.ok(store.all('outbox').some(o => o.to === 'zainab' && /new task from/.test(o.text)), 'a participant given a task is told');
  // my tasks: the owner sees and closes their own tasks, and nobody else's
  const z = await login('zainab'); const zTask = saved[1]; assert.equal(zTask.ownerSid, 'zainab');
  const mine = async () => (await z.get('/api/data')).body.data.actions;
  assert.deepEqual((await mine()).map(x => x.id), [zTask.id], 'only their own, not the location\'s other items');
  assert.equal((await lr.act('actionAdd', { text: 'By hand', owner: 'Zainab H.' })).status, 200, 'a task added by hand counts too');
  const hand = store.all('actions').find(x => x.text === 'By hand'); assert.equal(hand.ownerSid, 'zainab'); assert.equal((await mine()).length, 2);
  assert.equal((await lr.act('actionEdit', { id: hand.id, text: 'By hand', owner: 'Sr. Sabiha' })).status, 200); assert.equal((await mine()).length, 1, 'given to someone else, it leaves their list');
  assert.equal((await z.act('closeAction', { id: hand.id })).status, 404, 'not theirs to close');
  assert.equal((await t.act('closeAction', { id: zTask.id })).status, 404, 'nor is it another person\'s to close');
  assert.equal((await z.act('closeAction', { id: zTask.id })).status, 200);
  const closed = store.find('actions', zTask.id); assert.equal(closed.done, true); assert.equal(closed.doneBy, 'Zainab H.');
  assert.equal((await z.act('closeAction', { id: zTask.id })).status, 400, 'already done');
  // a change of name follows the person
  const zs = store.find('students', 'zainab');
  assert.equal((await su.act('actionEdit', { id: saved[0].id, text: saved[0].text, owner: 'Zainab H.' })).status, 200);
  await su.act('studentEdit', { id: 'zainab', first: 'Zainab', last: 'Hussain', city: zs.city }); assert.equal(store.find('actions', saved[0].id).owner, 'Zainab Hussain');
  await su.act('studentEdit', { id: 'zainab', first: 'Zainab', last: 'H.', city: zs.city });
  store.tx(() => [...saved, hand].forEach(x => store.del('actions', x.id)));
  // edit: attendance corrected; the date cannot move to the future; another location's staff cannot touch it
  assert.equal((await lr.act('callSave', { id: held.id, date: '2026-08-03', status: 'Held', att: { zainab: false } })).status, 200);
  assert.deepEqual(store.find('calls', held.id).att.map(x => [x.sid, x.present]), [['zainab', false], [away, true]]);
  assert.equal((await lr.act('callSave', { id: held.id, date: '2026-10-20', status: 'Held' })).status, 400);
  assert.equal((await lr.act('callSave', { id: held.id, date: '2026-08-03', status: 'Missed' })).status, 200);
  assert.deepEqual(store.find('calls', held.id).att, [], 'no attendance for a meeting not held');
  // removed: a meeting logged today or later brings its date back as the next call
  assert.equal((await lr.act('callRemove', { id: held.id })).status, 200); assert.ok(!store.find('calls', held.id));
  store.tx(() => store.put('calls', { id: 'cfuture', loc: 'MUM', date: '2026-10-19', status: 'Held' }));
  store.tx(() => store.put('locations', { ...store.find('locations', 'MUM'), nextCall: '2026-10-26' }));
  assert.equal((await lr.act('callRemove', { id: 'cfuture' })).status, 200); assert.equal(store.find('locations', 'MUM').nextCall, '2026-10-19');
  store.tx(() => store.put('locations', { ...store.find('locations', 'MUM'), nextCall: '2026-10-12' }));
  // removing
  assert.equal((await co.act('participantRemove', { sid: 'zainab' })).status, 403);
  assert.equal((await lr.act('participantRemove', { sid: 'zainab' })).status, 200);
  assert.equal((await su.act('participantRemove', { loc: 'MUM', sid: away })).status, 200);
  assert.equal(store.find('locations', 'MUM').participants.length, 0);
  store.tx(() => store.all('actions').filter(x => x.text === 'Mine' || x.loc === 'LON').forEach(x => store.del('actions', x.id)));
});

test('a location no longer in use is disabled, and can be enabled again', async () => {
  const su = await login('abbas'), lr = await login('jafar'); const userOf = sid => store.all('users').find(u => u.studentId === sid);
  // the reason is required, and what is running there must go somewhere
  assert.equal((await lr.act('locDisable', { id: 'LON', reason: 'x' })).status, 403, 'only the super admin');
  assert.match((await su.act('locDisable', { id: 'LON', reason: '  ' })).body.error, /Give the reason/);
  assert.match((await su.act('locDisable', { id: 'MUM', reason: 'Closing' })).body.error, /Choose what happens/);
  assert.match((await su.act('locDisable', { id: 'MUM', reason: 'Closing', mode: 'move' })).body.error, /Choose the location to move/);
  assert.match((await su.act('locDisable', { id: 'MUM', reason: 'Closing', mode: 'move', target: 'MUM' })).body.error, /Choose the location to move/, 'not to itself');
  assert.match((await su.act('locDisable', { id: 'MUM', reason: 'Closing', mode: 'close' })).body.error, /Choose where the students go/);
  assert.ok(!store.find('locations', 'MUM').disabled, 'nothing changes when refused');
  // a person named there has the role, until it is disabled
  const spare = store.all('students').find(s => s.classId && !userOf(s.id) && s.g === 'F').id;
  assert.equal((await su.act('locEdit', { id: 'LON', name: 'London', primary: 'zainab', secondary: spare, callDay: 'Wednesday' })).status, 200);
  assert.deepEqual(userOf('zainab').roles, ['locadmin']);
  const off = await su.act('locDisable', { id: 'LON', reason: 'No students left in London' });
  assert.equal(off.status, 200); assert.match(off.body.toast, /Location role removed from Zainab H\./);
  const l = store.find('locations', 'LON'); assert.equal(l.disabled, true); assert.equal(l.disabledReason, 'No students left in London'); assert.equal(l.disabledBy, 'Br. Abbas'); assert.equal(l.disabledOn, '2026-10-12');
  assert.deepEqual(userOf('zainab').roles, []); assert.equal(userOf('zainab').loc, undefined); assert.equal(l.primary, 'Zainab H.', 'who was there stays on record');
  // it takes no new work
  const form = { first: 'New', last: 'Person', g: 'F', dob: '1990-01-01', city: 'London', phone: '+44 20 7946 0000', email: 'new.person@example.com', course: 'BAS', loc: 'LON' };
  assert.equal((await su.act('regAdd', form)).status, 400);
  assert.equal((await su.act('classSave', { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00', start: '2026-10-20', loc: 'LON' })).status, 400);
  assert.match((await su.act('callSave', { loc: 'LON', date: '2026-10-07', status: 'Held' })).body.error, /London is disabled/);
  assert.equal((await su.act('participantAdd', { loc: 'LON', sid: spare })).status, 400);
  assert.equal((await su.act('userEdit', { id: userOf('zainab').id, username: 'zainab', roles: ['coord'], loc: 'LON' })).status, 400);
  // someone named at a disabled location can work elsewhere
  assert.equal((await su.act('locEdit', { id: 'TOR', name: 'Toronto', primary: spare, callDay: 'Thursday' })).status, 200);
  store.tx(() => store.put('locations', { ...store.find('locations', 'TOR'), primary: '', primarySid: undefined }));
  // and enabling it gives the people named there their role back
  const on = await su.act('locEnable', { id: 'LON' });
  assert.equal(on.status, 200); assert.match(on.body.toast, /Role given to Zainab H\./); assert.ok(!store.find('locations', 'LON').disabled); assert.equal(store.find('locations', 'LON').disabledReason, undefined);
  assert.deepEqual(userOf('zainab').roles, ['locadmin']); assert.equal(userOf('zainab').loc, 'LON');
  store.tx(() => { store.put('locations', { ...store.find('locations', 'LON'), primary: 'Br. Sajjad', primarySid: undefined, secondary: 'Br. Baqir', secondarySid: undefined }); const z = userOf('zainab'); store.put('users', { ...z, roles: [] }); delete store.find('users', z.id).loc; });
});

test('disabling a location moves its classes elsewhere, or closes them with it', async () => {
  const su = await login('abbas');
  const newClass = async loc => (await su.act('classSave', { course: 'BAS', sem: 1, g: 'F', day: 2, time: '19:00', start: '2026-10-05', loc, teacher: 't1' })).body.result.id;
  const person = async (first, loc, cid) => {
    assert.equal((await su.act('regAdd', { first, last: 'Moved', g: 'F', dob: '1991-01-01', city: 'X', phone: '+91 98200 33333', email: first.toLowerCase() + '@example.com', course: 'BAS', loc })).status, 200);
    const r = store.all('regs').find(x => x.name === first + ' Moved');
    if (!cid) return r; assert.equal((await su.act('allocSave', { rid: r.id, cid })).status, 200); return store.all('students').find(s => s.name === first + ' Moved');
  };
  // moved: the class keeps its number, teacher and students; those waiting move too; everyone is told
  const c1 = await newClass('TOR'); const s1 = await person('One', 'TOR', c1); const w1 = await person('Wait', 'TOR');
  const moved = await su.act('locDisable', { id: 'TOR', reason: 'Merged into Dar es Salaam', mode: 'move', target: 'DAR' });
  assert.equal(moved.status, 200); assert.match(moved.body.toast, /1 class and 1 waiting moved to Dar es Salaam/);
  const k = store.find('classes', c1); assert.equal(k.loc, 'DAR'); assert.equal(k.status, 'active'); assert.equal(k.teacherId, 't1');
  assert.equal(store.find('students', s1.id).classId, c1); assert.equal(store.find('regs', w1.id).loc, 'DAR');
  assert.ok(store.all('outbox').some(o => o.to === s1.id && /now belongs to Dar es Salaam/.test(o.text)));
  // a later class at the old location does not reuse the moved class's number
  assert.equal((await su.act('locEnable', { id: 'TOR' })).status, 200);
  const c2 = await newClass('TOR'); assert.notEqual(c2, c1); assert.equal(+c2.split('-')[2], +c1.split('-')[2] + 1); assert.equal(store.find('classes', c1).loc, 'DAR', 'the moved class is untouched');
  // closed, with students waiting at another location: they keep their record
  const s2 = await person('Two', 'TOR', c2);
  const closed = await su.act('locDisable', { id: 'TOR', reason: 'Centre shut', mode: 'close', dest: 'MUM' });
  assert.equal(closed.status, 200); assert.match(closed.body.toast, /1 class closed\. 1 student waiting for a class at Mumbai/);
  const kc = store.find('classes', c2); assert.equal(kc.status, 'closed'); assert.match(kc.closed.reason, /Location disabled: Centre shut/);
  assert.equal(store.find('students', s2.id).classId, null); const back = store.all('regs').find(r => r.sid === s2.id); assert.equal(back.loc, 'MUM'); assert.equal(back.from, c2);
  assert.ok(store.all('sessions').filter(x => x.classId === c2).every(x => x.logged), 'its sessions are not left open');
  assert.equal((await su.act('locDisable', { id: 'TOR', reason: 'again' })).status, 400, 'already disabled');
  // closed, with students recorded as having left; someone new and waiting is removed
  const closedOthers = await su.act('locDisable', { id: 'DAR', reason: 'Merged again', mode: 'close', dest: 'left' });
  assert.equal(closedOthers.status, 200); assert.match(closedOthers.body.toast, /2 students recorded as having left/);
  const gone = store.find('students', s1.id); assert.equal(gone.classId, null); assert.equal(gone.left.reason, 'Merged again'); assert.equal(gone.left.from, c1);
  assert.ok(!store.find('regs', w1.id)); assert.equal(store.find('classes', c1).status, 'closed');
  // tidy up for the tests after
  assert.equal((await su.act('locEnable', { id: 'TOR' })).status, 200); assert.equal((await su.act('locEnable', { id: 'DAR' })).status, 200);
  store.tx(() => { store.del('regs', back.id); [s1.id, s2.id].forEach(id => store.del('students', id)); [c1, c2].forEach(id => { store.all('sessions').filter(x => x.classId === id).forEach(x => store.del('sessions', x.id)); store.del('classes', id); }); });
});

test('the people running a location are on its weekly call without being added', async () => {
  const su = await login('abbas');
  const a = store.all('students').filter(s => s.classId && !store.all('users').some(u => u.studentId === s.id)).slice(0, 3).map(s => s.id);
  assert.equal((await su.act('locAdd', { name: 'Qatar', code: 'QTR', primary: a[0], coordinator: a[1], callDay: 'Monday', callTime: '8:00 PM' })).status, 200);
  const on = await su.act('participantAdd', { loc: 'QTR', sid: a[0] });
  assert.equal(on.status, 400); assert.match(on.body.error, /on this call already, as primary responsible/);
  assert.equal((await su.act('participantAdd', { loc: 'QTR', sid: a[2] })).status, 200, 'others are added as before');
  assert.equal((await su.act('participantRemove', { loc: 'QTR', sid: a[0] })).status, 404, 'and they cannot be removed from it');
  // they are on the attendance, marked like anyone else
  assert.equal((await su.act('callSave', { loc: 'QTR', date: '2026-10-05', status: 'Held', att: { [a[1]]: false } })).status, 200);
  const c = store.all('calls').find(x => x.loc === 'QTR'); assert.deepEqual(c.att.map(x => [x.sid, x.present]), [[a[0], true], [a[1], false], [a[2], true]]);
  // someone added and later made responsible is listed once
  assert.equal((await su.act('locEdit', { id: 'QTR', name: 'Qatar', primary: a[0], secondary: a[2], coordinator: a[1], callDay: 'Monday' })).status, 200);
  assert.equal((await su.act('callSave', { loc: 'QTR', date: '2026-09-28', status: 'Held' })).status, 200);
  assert.equal(store.all('calls').find(x => x.loc === 'QTR' && x.date === '2026-09-28').att.length, 3);
  store.tx(() => { store.all('calls').filter(x => x.loc === 'QTR').forEach(x => store.del('calls', x.id)); store.del('locations', 'QTR'); });
});

test('a clash between two weekly calls is warned about, without being refused', async () => {
  const su = await login('abbas');
  const { callsClash } = await import('../public/shared/callpeople.js');
  const at = (callDay, callTime) => ({ callDay, callTime });
  assert.ok(callsClash(at('Monday', '8:00 PM'), at('Monday', '20:00')), 'however the time is written');
  assert.ok(callsClash(at('Monday', '8:00 PM'), at('Monday', '8:30 pm')), 'within the hour');
  assert.ok(!callsClash(at('Monday', '8:00 PM'), at('Monday', '9:00 PM')), 'an hour apart');
  assert.ok(!callsClash(at('Monday', '8:00 PM'), at('Tuesday', '8:00 PM')));
  assert.ok(callsClash(at('Monday', 'after prayers'), at('Monday', 'After Prayers')), 'unreadable times are compared as written');
  const a = store.all('students').filter(s => s.classId && !store.all('users').some(u => u.studentId === s.id)).slice(0, 2).map(s => s.id); const name = store.find('students', a[0]).name;
  assert.equal((await su.act('locAdd', { name: 'Aden', code: 'ADN', primary: a[0], callDay: 'Monday', callTime: '8:00 PM' })).status, 200);
  const add = await su.act('locAdd', { name: 'Basra', code: 'BSR', primary: a[1], callDay: 'Monday', callTime: '9:30 PM' });
  assert.equal(add.status, 200); assert.doesNotMatch(add.body.toast, /Clash/);
  // adding someone who is on another call then: allowed, with a warning
  const p = await su.act('participantAdd', { loc: 'BSR', sid: a[0] });
  assert.equal(p.status, 200); assert.doesNotMatch(p.body.toast, /Clash/, 'not at the same time yet');
  // moving a call onto another: allowed, with a warning naming who
  const moved = await su.act('locEdit', { id: 'BSR', name: 'Basra', primary: a[1], callDay: 'Monday', callTime: '8:15 PM' });
  assert.equal(moved.status, 200); assert.match(moved.body.toast, new RegExp('Clash: ' + name + ' is also on the Aden call'));
  const seen = (await su.get('/api/data')).body.data.locations.find(l => l.code === 'BSR'); assert.deepEqual(seen.clashes, { [a[0]]: ['Aden'] });
  assert.equal((await su.act('participantRemove', { loc: 'BSR', sid: a[0] })).status, 200);
  const back = await su.act('participantAdd', { loc: 'BSR', sid: a[0] }); assert.match(back.body.toast, /Clash/);
  // a disabled location's call does not clash
  assert.equal((await su.act('locDisable', { id: 'ADN', reason: 'Closed' })).status, 200);
  assert.deepEqual((await su.get('/api/data')).body.data.locations.find(l => l.code === 'BSR').clashes, {});
  store.tx(() => { store.del('locations', 'ADN'); store.del('locations', 'BSR'); });
});

test('a location responsible changes the day and time of their own weekly call', async () => {
  const lr = await login('jafar'), co = await login('sabiha'), t = await login('maryam'); const before = store.find('locations', 'MUM');
  assert.equal((await co.act('callSchedule', { callDay: 'Friday', time: '19:30' })).status, 403, 'not the coordinator');
  assert.equal((await t.act('callSchedule', { callDay: 'Friday', time: '19:30' })).status, 403);
  assert.equal((await lr.act('callSchedule', { callDay: 'Someday', time: '19:30' })).status, 400);
  assert.equal((await lr.act('callSchedule', { callDay: 'Friday', time: '25:00' })).status, 400);
  // the location comes from their login, whatever is sent
  const other = store.find('locations', 'BAH').callTime;
  store.tx(() => store.put('locations', { ...store.find('locations', 'MUM'), participants: [{ sid: 'zainab', name: 'Zainab H.' }] }));
  const r = await lr.act('callSchedule', { loc: 'BAH', callDay: 'Friday', time: '19:30' });
  assert.equal(r.status, 200); assert.match(r.body.toast, /now every Friday at 7:30 PM/);
  const l = store.find('locations', 'MUM'); assert.equal(l.callDay, 'Friday'); assert.equal(l.callTime, '7:30 PM'); assert.equal(store.find('locations', 'BAH').callTime, other);
  assert.equal(l.nextCall, '2026-10-16', 'the next call moves to the new day');
  assert.ok(store.all('outbox').some(o => o.to === 'zainab' && /is now every Friday at 7:30 PM/.test(o.text)), 'everyone on it is told');
  // a change of time alone leaves the next date; the same time again changes nothing
  assert.equal((await lr.act('callSchedule', { callDay: 'Friday', time: '20:00' })).status, 200); assert.equal(store.find('locations', 'MUM').nextCall, '2026-10-16');
  assert.match((await lr.act('callSchedule', { callDay: 'Friday', time: '20:00' })).body.toast, /Nothing has changed/);
  // the Meet link: a real web address only, set alone or cleared
  for (const bad of ['javascript:alert(1)', 'not a link', 'meet.google.com/abc']) assert.equal((await lr.act('callSchedule', { callDay: 'Friday', time: '20:00', meet: bad })).status, 400, bad);
  assert.equal(store.find('locations', 'MUM').meet || '', before.meet || '');
  const link = 'https://meet.google.com/abc-defg-hij';
  const linked = await lr.act('callSchedule', { callDay: 'Friday', time: '20:00', meet: link });
  assert.equal(linked.status, 200); assert.match(linked.body.toast, /has a new Meet link/); assert.equal(store.find('locations', 'MUM').meet, link);
  assert.ok(store.all('outbox').some(o => o.to === 'zainab' && /has a new Meet link/.test(o.text)));
  assert.equal((await co.act('callSchedule', { callDay: 'Friday', time: '20:00', meet: 'https://x.example' })).status, 403);
  assert.equal((await lr.act('callSchedule', { callDay: 'Friday', time: '20:00', meet: '' })).status, 200); assert.equal(store.find('locations', 'MUM').meet, '');
  const su = await login('abbas');
  assert.equal((await su.act('locEdit', { id: 'MUM', name: before.name, primary: before.primary, secondary: before.secondary, coordinator: before.coordinator, callDay: 'Friday', meet: 'javascript:alert(1)' })).status, 400, 'nor through the location form');
  store.tx(() => { const { participants, ...rest } = before; store.put('locations', { ...rest, participants: [] }); });
});

test('a class that finished its course moves up a level, as a new class', async () => {
  const su = await login('abbas'), lr = await login('jafar'), co = await login('sabiha');
  // the super admin can take a class through its last semester too
  const cid = (await su.act('classSave', { course: 'INR', sem: 1, g: 'F', day: 3, time: '18:00', start: '2026-10-07', loc: 'MUM', teacher: 't2', meet: 'https://meet.google.com/aaa-bbbb-ccc' })).body.result.id;
  for (const n of ['Up One', 'Up Two', 'Stay Here']) assert.equal((await enrol(lr, cid, n)).status, 200);
  const ids = store.all('students').filter(s => s.classId === cid).map(s => s.id); const [a, b, stay] = ids;
  const form = { cid, up: [a, b], start: '2026-10-20' };
  assert.match((await su.act('classNextLevel', form)).body.error, /has not completed/, 'not before the course is finished');
  assert.equal((await su.act('promote', { cid, up: ids })).status, 200); assert.equal(store.find('classes', cid).status, 'completed');
  // who, and what it needs
  assert.equal((await co.act('classNextLevel', form)).status, 403, 'not the coordinator');
  assert.equal((await (await login('maryam')).act('classNextLevel', form)).status, 403);
  assert.equal((await su.act('classNextLevel', { ...form, start: '2026-10-01' })).status, 400, 'the start date cannot be past');
  assert.equal((await su.act('classNextLevel', { ...form, up: [] })).status, 400, 'at least one student');
  assert.match((await su.act('classNextLevel', { ...form, teacher: 't2' })).body.error, /teaches up to Introductory and cannot take Basic/, 'the teacher must be able to teach the new level');
  const r = await lr.act('classNextLevel', { ...form, teacher: 't1' });
  assert.equal(r.status, 200); assert.match(r.body.toast, /2 students moved up to Basic/);
  // a new class: next level, Semester 1, same day, time and link; the finished class is untouched
  const n = store.find('classes', r.body.result.id); assert.match(n.id, /^MUM-BAS-/); assert.equal(n.sem, 1); assert.equal(n.status, 'active'); assert.equal(n.teacherId, 't1');
  assert.equal(n.day, 3); assert.equal(n.time, 18 * 60); assert.equal(n.meet, 'https://meet.google.com/aaa-bbbb-ccc'); assert.equal(n.startOn, '2026-10-20'); assert.equal(n.promotedFrom, cid);
  const old = store.find('classes', cid); assert.equal(old.status, 'completed'); assert.equal(old.promotedTo, n.id);
  // the ticked students move; their completion stays; the one left is still with the old class
  assert.equal(store.find('students', a).classId, n.id); assert.ok(store.find('students', a).completed.some(x => x.cid === cid));
  assert.equal(store.find('students', stay).classId, cid);
  assert.ok(store.all('outbox').some(o => o.to === a && /moved up to Basic/.test(o.text)));
  // once only; and nowhere to go from the top level
  assert.match((await su.act('classNextLevel', form)).body.error, /already moved up/);
  store.tx(() => store.put('classes', { ...store.find('classes', n.id), course: 'ADV', status: 'completed', promotedFrom: null }));
  assert.match((await su.act('classNextLevel', { cid: n.id, up: [a], start: '2026-10-20' })).body.error, /is the highest level/);
  store.tx(() => { for (const s of ids) store.del('students', s); for (const x of [cid, n.id]) { store.all('sessions').filter(z => z.classId === x).forEach(z => store.del('sessions', z.id)); store.del('classes', x); } });
});

test('a teacher logs a session once, with attendance', async () => {
  const t = await login('maryam');
  const x = store.all('sessions').find(s => s.classId === 'MUM-BAS-003' && !s.logged);
  const r = await t.act('logSave', { sid: x.id, held: true, att: { fatimar: 'a', sakinam: 'e' }, covered: { b: true } });
  assert.equal(r.status, 200);
  const saved = store.find('sessions', x.id);
  assert.equal(saved.logged, true);
  assert.equal(saved.att.fatimar, 'a');
  assert.equal(saved.att.zainab, 'p');
  assert.equal((await t.act('logSave', { sid: x.id, held: true })).status, 400);
});

test('exams are marked on the server and can be taken once', async () => {
  const z = await login('zainab');
  assert.equal((await z.act('examStart', { id: 'BAS-2-b' })).status, 400, 'no window open for the class yet');
  assert.equal((await (await login('jafar')).act('examOpen', { cid: 'MUM-BAS-003', from: '2026-10-12', to: '2026-10-18' })).status, 200);
  const st = await z.act('examStart', { id: 'BAS-2-b' });
  assert.equal(st.status, 200);
  const { attemptId, qs } = st.body.result;
  for (const q of qs) { assert.equal(q.correct, undefined); assert.equal(q.answers, undefined); }
  const att = store.find('attempts', attemptId);
  const ans = answersFor(att);
  /* the options are shown in a shuffled order, and marked against the original */
  assert.ok(att.operms.some((p, i) => p && p.some((k, j) => k !== j) && qs[i].options[0] === store.find('questions', att.qids[i]).options[p[0]]));
  assert.equal((await z.act('examSubmit', { attemptId, ans })).status, 200);
  const res = store.all('results').find(r => r.sid === 'zainab' && r.sem === 2 && r.sub === 'b');
  assert.equal(res.pct, 100);
  assert.equal((await z.act('examStart', { id: 'BAS-2-b' })).status, 400);
  const d = (await z.get('/api/data')).body.data;
  assert.equal(d.results.find(r => r.sem === 2 && r.sub === 'b').pct, null, 'unpublished marks stay hidden');
});

test('scheduled sessions appear once their date has passed', () => {
  const before = store.all('sessions').filter(x => x.classId === 'MUM-BAS-003').length;
  ensureSessions(store, '2026-10-30');
  const after = store.all('sessions').filter(x => x.classId === 'MUM-BAS-003');
  assert.equal(after.length, before + 3);
  assert.ok(after.slice(-3).every(x => !x.logged && x.held));
});

test('a class moves to its next semester; unticked students go back to registrations to repeat', async () => {
  const before = store.all('sessions').filter(x => x.classId === 'MUM-BAS-003').length;
  assert.equal((await (await login('sabiha')).act('promote', { cid: 'MUM-BAS-003', up: [] })).status, 403);
  const lr = await login('jafar');
  const ids = store.all('students').filter(s => s.classId === 'MUM-BAS-003').map(s => s.id);
  const r = await lr.act('promote', { cid: 'MUM-BAS-003', up: ids.filter(id => id !== 'sakinam'), start: '2026-11-05' });
  assert.equal(r.status, 200);
  const c = store.find('classes', 'MUM-BAS-003');
  assert.equal(c.sem, 3);
  assert.equal(c.startOn, '2026-11-05');
  assert.ok(store.all('sessions').filter(x => x.classId === c.id).every(x => x.sem === 2));
  assert.equal(store.find('students', 'zainab').classId, 'MUM-BAS-003');
  assert.equal(store.find('students', 'sakinam').classId, null);
  const reg = store.all('regs').find(x => x.sid === 'sakinam');
  assert.equal(reg.sem, 2);
  assert.equal(reg.from, 'MUM-BAS-003');

  ensureSessions(store, '2026-11-20');
  const next = store.all('sessions').filter(x => x.classId === c.id && x.sem === 3).sort((a, b) => a.date < b.date ? -1 : 1);
  assert.equal(next[0].date, '2026-11-05');
  assert.deepEqual(next.map(x => x.week), [1, 2, 3]);
  assert.equal(store.all('sessions').filter(x => x.classId === c.id).length, before + 3);

  assert.equal((await lr.act('allocSave', { rid: reg.id, cid: 'MUM-ADV-001' })).status, 200);
  assert.equal(store.find('students', 'sakinam').classId, 'MUM-ADV-001');
  assert.equal(store.all('students').filter(s => s.name === 'Sakina M.').length, 1, 'the existing student record is reused');
});

test('finishing the last semester completes the course', async () => {
  const lr = await login('jafar');
  const ids = store.all('students').filter(s => s.classId === 'MUM-INR-002').map(s => s.id);
  assert.equal((await lr.act('promote', { cid: 'MUM-INR-002', up: ids })).status, 200);
  assert.equal(store.find('classes', 'MUM-INR-002').status, 'completed');
  assert.ok(ids.every(id => store.find('students', id).completed.some(x => x.cid === 'MUM-INR-002')));
  assert.equal((await lr.act('promote', { cid: 'MUM-INR-002', up: ids })).status, 400);
});

test('a student is moved to another class and keeps their record', async () => {
  const co = await login('sabiha');
  assert.equal((await co.act('moveStudent', { sid: 'fatimar', cid: 'MUM-BAS-004' })).status, 400, 'brothers class refused');
  assert.equal((await co.act('moveStudent', { sid: 'fatimar', cid: 'MUM-BAS-003' })).status, 400, 'same class refused');
  assert.equal((await co.act('moveStudent', { sid: 'fatimar', cid: 'MUM-INR-002' })).status, 400, 'completed class refused');
  assert.equal((await (await login('maryam')).act('moveStudent', { sid: 'fatimar', cid: 'MUM-ADV-001' })).status, 403);
  const results = store.all('results').filter(r => r.sid === 'fatimar').length;
  assert.equal((await co.act('moveStudent', { sid: 'fatimar', cid: 'MUM-ADV-001' })).status, 200);
  const s = store.find('students', 'fatimar');
  assert.equal(s.classId, 'MUM-ADV-001');
  assert.equal(s.joined, '2026-10-12');
  assert.equal(store.all('results').filter(r => r.sid === 'fatimar').length, results);
});

test('a student is removed from a class, either to wait for another class or as having left', async () => {
  assert.equal((await (await login('maryam')).act('removeStudent', { sid: 'zainab' })).status, 403);
  const lr = await login('jafar');
  assert.equal((await lr.act('removeStudent', { sid: 'zainab', mode: 'wait' })).status, 200);
  assert.equal(store.find('students', 'zainab').classId, null);
  assert.equal(store.find('classes', 'MUM-BAS-003').assistantId, null, 'no longer the class assistant');
  const reg = store.all('regs').find(r => r.sid === 'zainab');
  assert.ok(reg && reg.removed && reg.from === 'MUM-BAS-003');
  assert.equal((await lr.act('allocSave', { rid: reg.id, cid: 'MUM-BAS-003' })).status, 200);
  assert.equal(store.find('students', 'zainab').classId, 'MUM-BAS-003');

  const results = store.all('results').filter(r => r.sid === 'zainab').length;
  assert.equal((await lr.act('removeStudent', { sid: 'zainab', mode: 'left', reason: 'Moved away' })).status, 200);
  const s = store.find('students', 'zainab');
  assert.equal(s.classId, null);
  assert.equal(s.left.reason, 'Moved away');
  assert.equal(store.all('regs').filter(r => r.sid === 'zainab').length, 0);
  assert.equal(store.all('results').filter(r => r.sid === 'zainab').length, results);
  assert.equal((await lr.act('removeStudent', { sid: 'zainab', mode: 'left' })).status, 404);
});

test('a new student can only join a class through registration', async () => {
  const co = await login('sabiha');
  assert.equal((await co.act('classAddStudent', { cid: 'MUM-BAS-004', name: 'Kumail J.' })).status, 404, 'there is no way straight into a class');
  assert.equal((await enrol(co, 'MUM-BAS-004', 'Kumail J.')).status, 200);
  const s = store.all('students').find(x => x.name === 'Kumail J.');
  assert.equal(s.classId, 'MUM-BAS-004');
  assert.equal(s.g, 'M');
  assert.equal(s.joined, '2026-10-12');
  assert.equal(s.phone, '+91 98200 12345');
});

test('closing a class sends each student to another class or back to registrations', async () => {
  const cid = 'MUM-BAS-004';
  const ids = store.all('students').filter(s => s.classId === cid).map(s => s.id);
  const [first, ...rest] = ids;
  assert.equal((await (await login('maryam')).act('closeClass', { cid, reason: 'x' })).status, 403, 'teachers cannot close classes');
  assert.equal((await (await login('sabiha')).act('closeClass', { cid: 'BAH-BAS-001', reason: 'x' })).status, 403, 'only classes in the coordinator\'s own location');
  const lr = await login('sabiha');
  assert.equal((await lr.act('closeClass', { cid, reason: ' ' })).status, 400, 'reason required');
  assert.equal((await lr.act('closeClass', { cid, reason: 'Teacher unavailable', dest: { [first]: 'MUM-BAS-003' } })).status, 400, 'sisters class refused');
  assert.equal(store.find('classes', cid).status, 'active', 'nothing changes when refused');
  const dest = { [first]: 'MUM-INT-001' }; rest.forEach(id => { dest[id] = 'reg'; });
  assert.equal((await lr.act('closeClass', { cid, reason: 'Teacher unavailable', dest })).status, 200);
  const c = store.find('classes', cid);
  assert.equal(c.status, 'closed');
  assert.equal(c.closed.reason, 'Teacher unavailable');
  assert.equal(store.find('students', first).classId, 'MUM-INT-001');
  assert.ok(rest.every(id => store.find('students', id).classId === null && store.all('regs').some(r => r.sid === id && r.from === cid)));
  assert.ok(store.all('sessions').filter(x => x.classId === cid).every(x => x.logged));
  assert.equal((await lr.act('closeClass', { cid, reason: 'again' })).status, 400);
  assert.equal((await enrol(lr, cid, 'Too Late')).status, 400, 'a closed class takes nobody');
  store.tx(() => store.del('regs', store.all('regs').find(x => x.name === 'Too Late').id));
  ensureSessions(store, '2027-01-30');
  assert.ok(store.all('sessions').filter(x => x.classId === cid).every(x => x.logged), 'no new sessions for a closed class');
});

test('teachers are only assigned classes at their level or below; levels of older teachers are set by the super admin', async () => {
  const lr = await login('jafar'), su = await login('abbas');
  const r = await lr.act('assignSave', { cid: 'MUM-INT-001', teacher: 't3' });
  assert.equal(r.status, 400, 'a Basic teacher cannot take an Intermediate class');
  assert.match(r.body.error, /teaches up to Basic/);
  assert.equal((await lr.act('assignSave', { cid: 'MUM-BAS-005', teacher: 't4' })).status, 200, 'an Intermediate teacher can take a Basic class');
  // an older teacher, from before person records, with no level: not assignable until the super admin sets one
  // a teacher from before person records keeps their level but gets no new class until linked to a student
  store.tx(() => store.put('teachers', { id: 't-old', name: 'Br. Old', g: 'M', level: 'BAS', access: 'own', loc: 'MUM' }));
  store.tx(() => store.put('users', { id: 'u-old', username: 'brold', name: 'Br. Old', teacherId: 't-old', roles: [] }));
  assert.match((await lr.act('assignSave', { cid: 'MUM-BAS-005', teacher: 't-old' })).body.error, /not linked to a student/);
  const brother = store.all('students').find(s => s.g === 'M' && s.classId && !store.all('teachers').some(x => x.sid === s.id) && !store.all('users').some(u => u.studentId === s.id));
  const sister = store.all('students').find(s => s.g === 'F' && s.classId);
  assert.equal((await lr.act('teacherLink', { tid: 't-old', sid: brother.id })).status, 403, 'not the location responsible');
  assert.equal((await su.act('teacherLink', { tid: 't-old', sid: 'Typed' })).status, 400);
  assert.equal((await su.act('teacherLink', { tid: 't-old', sid: sister.id })).status, 400, 'the same group');
  assert.equal((await su.act('teacherLink', { tid: 't-old', sid: 'p-t3' })).status, 400, 'someone already a teacher');
  assert.equal((await su.act('teacherLink', { tid: 't-old', sid: brother.id })).status, 200);
  const old = store.find('teachers', 't-old'); assert.equal(old.sid, brother.id); assert.equal(old.name, brother.name); assert.equal(old.level, 'BAS');
  assert.equal(store.find('users', 'u-old').studentId, brother.id, 'their login now belongs to the person');
  assert.equal((await su.act('teacherLink', { tid: 't-old', sid: brother.id })).status, 400, 'only once');
  assert.equal((await lr.act('assignSave', { cid: 'MUM-BAS-005', teacher: 't-old' })).status, 200);
  assert.equal((await lr.act('teacherAdd', { name: 'X', g: 'M', level: 'BAS' })).status, 404, 'teachers are not added directly');
  assert.equal((await su.act('teacherAdd', { name: 'X', g: 'M', level: 'BAS' })).status, 404);
  assert.equal((await su.act('teacherLevel', { tid: 't-old', level: 'ADV' })).status, 404, 'nor is a level set by hand');
});

test('a student who passed a course is nominated, approved, and then teaches with the same login', async () => {
  const mk = await login('rubab'), ap = await login('tahera'), lr = await login('jafar'), su = await login('abbas');
  const s = store.all('students').find(x => x.classId === 'MUM-INR-002');
  assert.match((await mk.act('levelNominate', { sid: s.id, level: 'INR' })).body.error, /cannot teach Introductory yet.*not yet passed Semester 1/);
  // give them published passing results in every examined subject of Introductory (one semester)
  store.tx(() => { ['b', 'l', 'e'].forEach((sub, i) => store.put('results', { id: 'rp' + i, sid: s.id, cid: 'MUM-INR-002', course: 'INR', sem: 1, sub, pct: 70, attempt: 1, date: '2026-10-01' })); store.set('published', { ...store.get('published', {}), 'MUM-INR-002|1': true }); });
  assert.equal((await ap.act('levelNominate', { sid: s.id, level: 'INR' })).status, 403, 'the approver does not nominate');
  assert.equal((await mk.act('levelNominate', { sid: s.id, level: 'INR' })).status, 200);
  assert.equal((await mk.act('levelNominate', { sid: s.id, level: 'INR' })).status, 400, 'one nomination waiting at a time');
  const p = store.all('promotions').find(x => x.sid === s.id);
  assert.ok(!store.all('teachers').some(t => t.sid === s.id), 'not a teacher until approved');
  assert.equal((await mk.act('review', { kind: 'promo', id: p.id, decision: 'approve' })).status, 403);
  assert.equal((await ap.act('review', { kind: 'promo', id: p.id, decision: 'approve' })).status, 200);
  const t = store.all('teachers').find(x => x.sid === s.id);
  assert.equal(t.level, 'INR'); assert.equal(t.name, s.name); assert.equal(t.g, s.g);
  assert.equal((await mk.act('levelNominate', { sid: s.id, level: 'BAS' })).status, 400, 'next level needs that course passed too');

  // assignable now, and their own login holds both roles
  const cid = (await lr.act('classSave', { course: 'INR', sem: 1, g: s.g, day: 2, time: '19:00', teacher: t.id })).body.result.id;
  assert.equal(store.find('classes', cid).teacherId, t.id);
  assert.equal((await su.act('userAdd', { username: 'newteacher', password: 'password123', roles: [] })).status, 400, 'a login needs a person');
  assert.equal((await su.act('userAdd', { studentId: s.id, username: 'newteacher', password: 'password123', roles: ['trainer'] })).status, 200);
  const me = await login('newteacher', 'password123');
  const d = (await me.get('/api/data')).body;
  assert.deepEqual(d.me.roles, ['trainer', 'teacher', 'student']);
  assert.ok(d.data.classes.some(c => c.id === cid), 'sees the class they teach');
  assert.ok(d.data.classes.some(c => c.id === 'MUM-INR-002'), 'and the class they study in');
  assert.ok(d.data.trainers.includes(s.name), 'listed as training faculty');
  const x = store.all('sessions').find(z => z.classId === 'MUM-INR-002' && !z.logged);
  assert.equal((await me.act('logSave', { sid: x.id, held: true, att: {} })).status, 403, 'cannot log a class they only study in');
  assert.equal((await su.act('userAdd', { studentId: s.id, username: 'twice', password: 'password123' })).status, 400, 'one login per person');
});

test('a student of a level can be nominated to teach the levels below it, without having passed them here', async () => {
  const mk = await login('rubab'), ap = await login('tahera');
  const s = store.all('students').find(x => x.classId && store.find('classes', x.classId).course === 'INT' && !store.all('teachers').some(t => t.sid === x.id) && !store.all('promotions').some(p => p.sid === x.id));
  assert.equal(store.all('results').filter(r => r.sid === s.id && r.course === 'BAS').length, 0);
  assert.match((await mk.act('levelNominate', { sid: s.id, level: 'INT' })).body.error, /cannot teach Intermediate yet/, 'not their own level');
  assert.match((await mk.act('levelNominate', { sid: s.id, level: 'ADV' })).body.error, /cannot teach Advance yet/, 'nor above it');
  assert.equal((await mk.act('levelNominate', { sid: s.id, level: 'BAS' })).status, 200, 'the level below');
  const p = store.all('promotions').find(x => x.sid === s.id && x.status === 'pending');
  assert.ok(!store.all('teachers').some(t => t.sid === s.id), 'not a teacher until approved');
  assert.equal((await ap.act('review', { kind: 'promo', id: p.id, decision: 'approve' })).status, 200);
  const t = store.all('teachers').find(x => x.sid === s.id); assert.equal(t.level, 'BAS');
});

test('a teaching level outside the rule can be given as an approved exception', async () => {
  const mk = await login('rubab'), ap = await login('tahera'), lr = await login('jafar');
  const s = store.all('students').find(x => x.classId && store.find('classes', x.classId).course === 'INT' && !store.all('teachers').some(t => t.sid === x.id) && !store.all('promotions').some(p => p.sid === x.id));
  // the rule still refuses their own level, and an exception needs a reason
  assert.match((await mk.act('levelNominate', { sid: s.id, level: 'ADV' })).body.error, /cannot teach Advance yet/);
  assert.match((await mk.act('levelNominate', { sid: s.id, level: 'ADV', exception: true, reason: '  ' })).body.error, /Give the reason/);
  assert.equal((await ap.act('levelNominate', { sid: s.id, level: 'ADV', exception: true, reason: 'x' })).status, 403, 'the approver does not request it');
  assert.equal((await lr.act('levelNominate', { sid: s.id, level: 'ADV', exception: true, reason: 'x' })).status, 403);
  // requested, not yet in effect, and marked for the approver
  const r = await mk.act('levelNominate', { sid: s.id, level: 'ADV', exception: true, reason: 'Twenty years of teaching experience' });
  assert.equal(r.status, 200); assert.match(r.body.toast, /Exception requested/);
  const p = store.all('promotions').find(x => x.sid === s.id && x.status === 'pending'); assert.equal(p.exception, true); assert.equal(p.reason, 'Twenty years of teaching experience');
  assert.ok(!store.all('teachers').some(t => t.sid === s.id), 'not a teacher until approved');
  assert.equal((await mk.act('review', { kind: 'promo', id: p.id, decision: 'approve' })).status, 403, 'not by the one who asked');
  // sent back, nothing changes; asked again and approved, it stays on the record
  assert.equal((await ap.act('review', { kind: 'promo', id: p.id, decision: 'reject', note: 'Please add dates' })).status, 200);
  assert.ok(!store.all('teachers').some(t => t.sid === s.id));
  assert.equal((await mk.act('levelNominate', { sid: s.id, level: 'ADV', exception: true, reason: 'Twenty years, since 2006' })).status, 200);
  const p2 = store.all('promotions').find(x => x.sid === s.id && x.status === 'pending');
  assert.equal((await ap.act('review', { kind: 'promo', id: p2.id, decision: 'approve' })).status, 200);
  const t = store.all('teachers').find(x => x.sid === s.id); assert.equal(t.level, 'ADV');
  assert.equal(t.exception.reason, 'Twenty years, since 2006'); assert.equal(t.exception.level, 'ADV'); assert.equal(t.exception.approvedBy, 'Sr. Tahera'); assert.equal(t.exception.requestedBy, 'Sr. Rubab');
  // they can now be given an Advance class like any teacher of that level
  const g = s.g; const cid = (await lr.act('classSave', { course: 'ADV', sem: 1, g, day: 2, time: '19:00', start: '2026-10-20', teacher: t.id })).body.result.id;
  assert.equal(store.find('classes', cid).teacherId, t.id);
  // a later promotion under the rule clears the mark; lower levels are still refused
  assert.match((await mk.act('levelNominate', { sid: s.id, level: 'BAS', exception: true, reason: 'x' })).body.error, /Choose a higher level/);
  store.tx(() => { store.all('sessions').filter(x => x.classId === cid).forEach(x => store.del('sessions', x.id)); store.del('classes', cid); store.del('teachers', t.id); });
});

test('a teacher\'s name is shown as Resp ... Sir, while the record keeps the plain name', async () => {
  const { teacherTitle } = await import('../public/shared/teachername.js');
  assert.equal(teacherTitle({ name: 'Naimat Chowdhry', g: 'M' }), 'Resp Naimat Chowdhry Sir');
  assert.equal(teacherTitle({ name: 'Fatima Ali', g: 'F' }), 'Resp Miss Fatima Ali');
  const lr = await login('jafar'); const t = store.find('teachers', 't4'); assert.ok(!t.name.startsWith('Resp'), 'the record is unchanged');
  const cid = (await lr.act('classSave', { course: 'BAS', sem: 1, g: t.g, day: 2, time: '19:00', start: '2026-10-20' })).body.result.id;
  const r = await lr.act('assignSave', { cid, teacher: t.id });
  assert.ok(r.body.toast.startsWith('Resp ' + t.name + ' Sir assigned'), r.body.toast); assert.equal(store.find('teachers', t.id).name, t.name);
  store.tx(() => { store.all('sessions').filter(x => x.classId === cid).forEach(x => store.del('sessions', x.id)); store.del('classes', cid); });
});

test('a disabled login is recorded, and can be enabled again', async () => {
  const su = await login('abbas'); const u = store.all('users').find(x => x.username === 'sabiha');
  assert.equal((await su.act('userToggle', { id: u.id })).status, 200);
  assert.equal(store.find('users', u.id).disabled, true); assert.equal(store.find('users', u.id).disabledOn, '2026-10-12'); assert.equal(store.find('users', u.id).disabledBy, 'Br. Abbas');
  assert.equal((await login('sabiha')).status, 401, 'cannot sign in');
  const seen = (await su.get('/api/data')).body.data.users.find(x => x.id === u.id); assert.equal(seen.disabled, true); assert.equal(seen.disabledBy, 'Br. Abbas');
  assert.equal((await su.act('userToggle', { id: u.id })).status, 200);
  assert.ok(!store.find('users', u.id).disabled); assert.equal(store.find('users', u.id).disabledOn, undefined);
  assert.equal((await login('sabiha')).status, 200);
});

test('a coordinator creates a login for a student in their location', async () => {
  const co = await login('sabiha');
  const bah = store.all('students').find(s => s.classId === 'BAH-BAS-001');
  assert.equal((await co.act('studentLogin', { sid: bah.id, username: 'bahstudent', password: 'password123' })).status, 403, 'other location refused');
  assert.equal((await co.act('studentLogin', { sid: 'fatimar', username: 'fatima2', password: 'password123' })).status, 400, 'already has a login');
  assert.equal((await co.act('studentLogin', { sid: 'fu1', username: 'zainab', password: 'password123' })).status, 400, 'username taken');
  assert.equal((await co.act('studentLogin', { sid: 'fu1', username: 'shahida', password: 'short' })).status, 400, 'password too short');
  assert.equal((await (await login('maryam')).act('studentLogin', { sid: 'fu1', username: 'shahida', password: 'password123' })).status, 403);
  assert.equal((await co.act('studentLogin', { sid: 'fu1', username: 'Shahida', password: 'password123' })).status, 200);
  assert.equal((await co.get('/api/data')).body.data.logins.fu1, 'shahida');
  const d = (await (await login('shahida', 'password123')).get('/api/data')).body;
  assert.equal(d.me.role, 'student');
  assert.deepEqual(d.data.classes.map(c => c.id), ['MUM-ADV-001']);
});

test('a new class starts on the chosen start date', async () => {
  const lr = await login('jafar');
  const later = await lr.act('classSave', { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00', start: '2026-11-04', teacher: 't1' });
  assert.equal(later.status, 200);
  const c = store.find('classes', later.body.result.id);
  assert.equal(c.startOn, '2026-11-04');
  ensureSessions(store, '2026-11-20');
  assert.deepEqual(store.all('sessions').filter(x => x.classId === c.id).map(x => x.date), ['2026-11-09', '2026-11-16'], 'first session is the first Monday on or after the start date');

  const earlier = await lr.act('classSave', { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00', start: '2026-09-28', teacher: 't1' });
  const e = store.find('classes', earlier.body.result.id);
  assert.equal(e.startOn, '2026-09-28', 'a past start date is kept, for a class that has already begun');
  const none = await lr.act('classSave', { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00' });
  assert.equal(store.find('classes', none.body.result.id).startOn, '2026-10-12', 'defaults to today');
});

test('only the super admin changes a start date; logged sessions are kept', async () => {
  const lr = await login('jafar');
  const cid = (await lr.act('classSave', { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00', start: '2026-09-28', teacher: 't1' })).body.result.id;
  ensureSessions(store, '2026-10-12');
  assert.deepEqual(store.all('sessions').filter(x => x.classId === cid).map(x => x.date), ['2026-09-28', '2026-10-05']);
  assert.equal((await lr.act('classStart', { cid, start: '2026-10-05' })).status, 403, 'location responsible cannot change it');
  assert.equal((await (await login('sabiha')).act('classStart', { cid, start: '2026-10-05' })).status, 403, 'coordinator cannot change it');
  const su = await login('abbas');
  assert.equal((await su.act('classStart', { cid, start: 'soon' })).status, 400);
  assert.equal((await su.act('classStart', { cid, start: '2026-10-05' })).status, 200);
  assert.equal(store.find('classes', cid).startOn, '2026-10-05');
  assert.deepEqual(store.all('sessions').filter(x => x.classId === cid).map(x => [x.date, x.week]), [['2026-10-05', 1]], 'unlogged sessions are listed again from the new date');
  const x = store.all('sessions').find(s => s.classId === cid);
  assert.equal((await lr.act('logSave', { sid: x.id, held: true, att: {} })).status, 200);
  assert.equal((await su.act('classStart', { cid, start: '2026-09-28' })).status, 200, 'still changeable after a session is logged');
  assert.deepEqual(store.all('sessions').filter(s => s.classId === cid).sort((p, q) => p.date < q.date ? -1 : 1).map(s => [s.date, s.week, s.logged]),
    [['2026-09-28', 1, false], ['2026-10-05', 2, true]], 'the logged session is kept and the earlier week is listed before it');
  assert.equal((await su.act('classStart', { cid, start: '2026-10-12' })).status, 200);
  assert.deepEqual(store.all('sessions').filter(s => s.classId === cid).map(s => [s.date, s.logged]), [['2026-10-05', true]], 'unlogged sessions before the new start are dropped; logged ones stay');
});

test('whoever can create a record can edit it, and nobody else', async () => {
  const su = await login('abbas'), lr = await login('jafar'), co = await login('sabiha'), ac = await login('tahera'), t = await login('maryam');
  // super admin: location, course type, subject, user, teacher
  assert.equal((await lr.act('locEdit', { id: 'MUM', name: 'X', primary: 'a', secondary: 'b' })).status, 403);
  assert.equal((await su.act('locEdit', { id: 'MUM', name: 'Mumbai Central', primary: 'Br. Jafar', secondary: 'Br. Kazim', coordinator: 'Sr. Sabiha', callDay: 'Monday', callTime: '8:00 PM' })).status, 200);
  assert.equal(store.find('locations', 'MUM').name, 'Mumbai Central');
  assert.equal((await su.act('courseEdit', { id: 'BAS', name: 'Basic', sems: 1, weeks: 8 })).status, 400, 'cannot drop below a semester in use');
  assert.equal((await su.act('subjectEdit', { id: 'q', name: 'Quran recitation', min: 7 })).status, 200);
  assert.equal((await su.act('userEdit', { id: store.all('users').find(u => u.username === 'jafar').id, name: 'Br. Jafar', username: 'kazim' })).status, 400, 'username taken');
  assert.match((await su.act('teacherEdit', { id: 't1', name: 'Sr. Maryam H.', g: 'F' })).body.error, /Edit the person instead/, 'a promoted teacher follows their person record');
  assert.equal((await lr.act('teacherEdit', { id: 't1', name: 'X', g: 'F' })).status, 403);
  assert.equal((await su.act('studentEdit', { id: 'p-t1', first: 'Sr. Maryam', last: 'H.', city: 'Mumbai' })).status, 200, 'the super admin edits any person');
  assert.equal(store.find('teachers', 't1').name, 'Sr. Maryam H.', 'the teacher record follows');
  assert.equal(store.all('users').find(u => u.username === 'maryam').name, 'Sr. Maryam H.', 'the login name follows');

  // location staff: class, registration, student; action items for the location responsible only
  const cid = (await lr.act('classSave', { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00', start: '2026-09-28', teacher: 't1' })).body.result.id;
  ensureSessions(store, '2026-10-12');
  assert.equal((await t.act('classEdit', { id: cid, day: 3, time: '19:00' })).status, 403, 'teachers cannot edit classes');
  assert.equal((await co.act('classEdit', { id: cid, day: 3, time: '19:00', sem: 1, g: 'F', meet: 'https://meet.google.com/abc', start: '2026-01-01' })).status, 200);
  let c = store.find('classes', cid);
  assert.equal(c.day, 3); assert.equal(c.time, 19 * 60); assert.equal(c.startOn, '2026-09-28', 'only the super admin changes the start date');
  assert.deepEqual(store.all('sessions').filter(x => x.classId === cid).map(x => x.date), ['2026-09-30', '2026-10-07'], 'sessions move to the new day');
  const first = store.all('sessions').find(x => x.classId === cid && x.date === '2026-09-30');
  assert.equal((await lr.act('logSave', { sid: first.id, held: true, att: {} })).status, 200);
  assert.equal((await lr.act('classEdit', { id: cid, day: 3, time: '19:00', sem: 2, g: 'F' })).status, 400, 'semester fixed once a session is logged');
  assert.equal((await su.act('classEdit', { id: cid, day: 3, time: '19:00', sem: 1, g: 'F', start: '2026-09-23' })).status, 200, 'the super admin can still move the start date');
  assert.deepEqual(store.all('sessions').filter(x => x.classId === cid).sort((p, q) => p.date < q.date ? -1 : 1).map(x => [x.date, x.logged]),
    [['2026-09-23', false], ['2026-09-30', true], ['2026-10-07', false]], 'logged session kept, others listed from the new date');
  assert.equal((await lr.act('logSave', { sid: first.id, held: true, att: {} })).status, 400, 'logging twice still refused');
  assert.equal((await lr.act('logSave', { sid: first.id, held: false, reason: 'Teacher unwell', edit: true })).status, 200, 'a logged session can be edited');
  assert.equal(store.find('sessions', first.id).editedBy, 'Br. Jafar');
  assert.equal(store.find('sessions', first.id).held, false);

  const rid = store.all('regs').find(r => r.loc === 'MUM').id;
  assert.equal((await co.act('regEdit', { id: rid, first: 'Renamed', last: 'R.', g: 'F', course: 'INT', city: 'Pune' })).status, 200);
  assert.equal(store.find('regs', rid).course, 'INT');
  assert.equal((await co.act('studentEdit', { id: 'fu2', first: 'Kausar', last: 'N. Z.', city: 'Thane' })).status, 200);
  const bah = store.all('students').find(s => s.classId === 'BAH-BAS-001');
  assert.equal((await co.act('studentEdit', { id: bah.id, first: 'X' })).status, 403);
  const aid = store.all('actions').find(a => a.loc === 'MUM').id;
  assert.equal((await t.act('actionEdit', { id: aid, text: 'X' })).status, 403);
  assert.equal((await co.act('actionEdit', { id: aid, text: 'Coordinators can edit these' })).status, 200);
  assert.equal((await lr.act('actionEdit', { id: aid, text: 'Call every absent student', owner: 'Sr. Sabiha', due: '2026-10-20' })).status, 200);

  // academic content creator: tradition, material, training (each edit goes back for approval)
  const mk = await login('rubab');
  assert.equal((await ac.act('tradEdit', { id: store.all('traditions')[0].id, text: 'X', source: 'Y' })).status, 403, 'the approver does not edit content');
  assert.equal((await mk.act('tradEdit', { id: store.all('traditions')[0].id, text: 'New text', source: 'Source' })).status, 200);
  const m = store.all('materials')[0];
  assert.equal((await mk.act('matEdit', { id: m.id, title: 'Renamed', type: 'Book', course: 'BAS', sem: 2, sub: 'b', share: 'false' })).status, 200);
  assert.equal(store.find('materials', m.id).draft.share, false, 'the change waits as an update');
  assert.equal(store.find('materials', m.id).share, true, 'the approved version stays in use');
  assert.equal(store.find('materials', m.id).draft.status, 'pending');
  const tr = store.all('trainings')[0];
  assert.equal((await mk.act('trainEdit', { id: tr.id, title: tr.title, kind: tr.kind, course: tr.course, sem: tr.sem, date: '2026-12-01', time: '10:30', req: true })).status, 200);
  assert.equal(store.find('trainings', tr.id).time, 630);
});

test('the teacher or location responsible chooses the class assistant, who can then log sessions', async () => {
  const cid = 'MUM-ADV-001'; const sid = 'rk1';
  assert.equal((await (await login('sabiha')).act('setAssistant', { cid, sid })).status, 403, 'coordinator cannot');
  assert.equal((await (await login('maryam')).act('setAssistant', { cid, sid })).status, 403, 'another class\'s teacher cannot');
  const lr = await login('jafar');
  assert.equal((await lr.act('setAssistant', { cid, sid: 'zainab' })).status, 400, 'must be a student of the class');
  assert.equal((await lr.act('setAssistant', { cid, sid })).status, 200);
  assert.equal(store.find('classes', cid).assistantId, sid);
  assert.equal((await lr.act('studentLogin', { sid, username: 'bushra', password: 'password123' })).status, 200);
  ensureSessions(store, '2026-10-12');
  const x = store.all('sessions').find(s => s.classId === cid && !s.logged);
  assert.equal((await (await login('bushra', 'password123')).act('logSave', { sid: x.id, held: true, att: {} })).status, 200, 'the assistant logs a session');
  assert.equal((await lr.act('setAssistant', { cid, sid: '' })).status, 200);
  assert.equal(store.find('classes', cid).assistantId, null);
  const own = store.all('students').find(s => s.classId === 'MUM-BAS-003');
  assert.equal((await (await login('maryam')).act('setAssistant', { cid: 'MUM-BAS-003', sid: own.id })).status, 200, 'the class\'s own teacher can');
  assert.equal(store.find('classes', 'MUM-BAS-003').assistantId, own.id);
});

test('a session dated before students were added can still record their attendance', async () => {
  const lr = await login('jafar'), su = await login('abbas');
  const cid = (await lr.act('classSave', { course: 'BAS', sem: 1, g: 'F', day: 1, time: '20:00', teacher: 't1' })).body.result.id;
  for (const name of ['Early One', 'Early Two', 'Early Three']) await enrol(lr, cid, name);
  const ids = store.all('students').filter(s => s.classId === cid).map(s => s.id);
  assert.ok(ids.every(id => store.find('students', id).joined === '2026-10-12'));
  assert.equal((await su.act('classStart', { cid, start: '2026-08-03' })).status, 200, 'start date moved months back');
  const x = store.all('sessions').filter(s => s.classId === cid).sort((p, q) => p.date < q.date ? -1 : 1)[0];
  assert.equal(x.date, '2026-08-03');
  assert.equal((await lr.act('setAssistant', { cid, sid: ids[0] })).status, 200);
  assert.equal((await lr.act('studentLogin', { sid: ids[0], username: 'earlyone', password: 'password123' })).status, 200);
  const as = await login('earlyone', 'password123');
  assert.equal((await as.act('logSave', { sid: x.id, held: true, att: { [ids[0]]: 'p', [ids[1]]: 'a', [ids[2]]: 'n' } })).status, 200);
  const saved = store.find('sessions', x.id);
  assert.deepEqual(saved.att, { [ids[0]]: 'p', [ids[1]]: 'a' }, 'marked students are recorded; "not yet" is left out');
  assert.equal(store.find('students', ids[0]).joined, '2026-08-03', 'joining date moves back to the session');
  assert.equal(store.find('students', ids[2]).joined, '2026-10-12', 'unmarked student keeps their joining date');
});

test('academic content is made by the creator and used only once the approver approves it', async () => {
  const mk = await login('rubab'), ap = await login('tahera');
  // roles: only the creator makes, only the approver approves
  assert.equal((await ap.act('qAdd', { course: 'BAS', sem: 3, sub: 'b', type: 'single', text: 'X', o0: 'a', o1: 'b', o2: 'c', o3: 'd', correct: 0 })).status, 403);
  assert.equal((await mk.act('qAdd', { course: 'BAS', sem: 3, sub: 'b', type: 'single', text: 'Nabuwwat means:', o0: 'Prophethood', o1: 'Justice', o2: 'Oneness', o3: 'Return', correct: 0 })).status, 200);
  const q = store.all('questions').find(x => x.text === 'Nabuwwat means:');
  assert.equal(q.status, 'pending'); assert.equal(q.submittedBy, 'Sr. Rubab');
  assert.equal((await mk.act('review', { kind: 'q', id: q.id, decision: 'approve' })).status, 403, 'the creator cannot approve');
  assert.equal((await ap.act('review', { kind: 'q', id: q.id, decision: 'reject' })).status, 400, 'sending back needs a note');
  assert.equal((await ap.act('review', { kind: 'q', id: q.id, decision: 'reject', note: 'Option B is unclear' })).status, 200);
  assert.equal(store.find('questions', q.id).reviewNote, 'Option B is unclear');
  assert.equal((await mk.act('qAdd', { edit: q.id, text: 'Nabuwwat means:', o0: 'Prophethood', o1: 'Divine justice', o2: 'Oneness', o3: 'Return', correct: 0 })).status, 200);
  assert.equal(store.find('questions', q.id).status, 'pending', 'an edit goes back for approval');
  assert.equal((await ap.act('review', { kind: 'q', id: q.id, decision: 'approve' })).status, 200);
  assert.equal(store.find('questions', q.id).status, 'approved');
  assert.equal((await ap.act('review', { kind: 'q', id: q.id, decision: 'approve' })).status, 400, 'only waiting items can be reviewed');

  // materials stay hidden from teachers until approved
  assert.equal((await mk.act('matAdd', { title: 'Week 8 slides', type: 'Slides', course: 'ALL', share: 'true', link: 'https://drive.google.com/x' })).status, 200);
  const mat = store.all('materials').find(x => x.title === 'Week 8 slides');
  const t = await login('maryam');
  assert.ok(!(await t.get('/api/data')).body.data.materials.some(x => x.id === mat.id), 'pending material hidden from teachers');
  assert.equal((await ap.act('review', { kind: 'mat', id: mat.id, decision: 'approve' })).status, 200);
  assert.ok((await t.get('/api/data')).body.data.materials.some(x => x.id === mat.id), 'approved material visible');

  // trainings invite teachers only on approval
  const before = store.all('outbox').length;
  assert.equal((await mk.act('trainAdd', { title: 'New refresher', kind: 'Programme', course: 'ALL', sem: 0, date: '2026-12-10', time: '11:00' })).status, 200);
  assert.equal(store.all('outbox').length, before, 'no invitations while waiting');
  const tr = store.all('trainings').find(x => x.title === 'New refresher');
  assert.ok(!(await t.get('/api/data')).body.data.trainings.some(x => x.id === tr.id));
  assert.equal((await ap.act('review', { kind: 'train', id: tr.id, decision: 'approve' })).status, 200);
  assert.ok(store.all('outbox').length > before, 'invitations sent on approval');

  // the academic team uploads files; teachers do not
  const up = r => fetch(base + '/api/upload', { method: 'POST', headers: { cookie: r, 'X-Filename': 'a.txt' }, body: 'x' });
  const cookieOf = async u => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  assert.equal((await up(await cookieOf('maryam'))).status, 403);
  assert.equal((await up(await cookieOf('rubab'))).status, 200);
  assert.equal((await up(await cookieOf('tahera'))).status, 200);
});

test('a class\'s teacher or location responsible opens its exams for a period, for that class only', async () => {
  const lr = await login('jafar'), co = await login('sabiha');
  const cid = (await lr.act('classSave', { course: 'BAS', sem: 2, g: 'F', day: 1, time: '20:00', teacher: 't1' })).body.result.id;
  await enrol(lr, cid, 'Exam Taker');
  const sid = store.all('students').find(s => s.name === 'Exam Taker').id;
  await lr.act('studentLogin', { sid, username: 'examtaker', password: 'password123' });
  const st = await login('examtaker', 'password123');
  assert.equal((await st.act('examStart', { id: 'BAS-2-b' })).status, 400, 'closed until the class opens it');
  assert.equal((await co.act('examOpen', { cid, from: '2026-10-12', to: '2026-10-14' })).status, 403, 'coordinator cannot open exams');
  assert.equal((await lr.act('examOpen', { cid, from: '2026-10-14', to: '2026-10-12' })).status, 400, 'dates must be in order');
  const nb = (await lr.act('examOpen', { cid: 'MUM-INT-001', from: '2026-10-12', to: '2026-10-14' }));
  assert.equal(nb.status, 400, 'no approved questions for that semester'); assert.match(nb.body.error, /no approved questions/);
  assert.equal((await (await login('maryam')).act('examOpen', { cid, from: '2026-10-13', to: '2026-10-20' })).status, 200, 'the class teacher opens it');
  assert.equal((await st.act('examStart', { id: 'BAS-2-b' })).status, 400, 'not before the window opens');
  assert.equal((await lr.act('examOpen', { cid, from: '2026-10-12', to: '2026-10-20' })).status, 200, 'the location responsible changes the dates');
  const s1 = await st.act('examStart', { id: 'BAS-2-b' });
  assert.equal(s1.status, 200);
  assert.ok(s1.body.result.qs.length > 0);
  const qids = store.find('attempts', s1.body.result.attemptId).qids;
  assert.ok(qids.every(id => { const q = store.find('questions', id); return !q.status || q.status === 'approved'; }), 'only approved questions are used');
  assert.equal((await lr.act('examClose', { cid })).status, 200);
  assert.equal((await st.act('examStart', { id: 'BAS-2-l' })).status, 400, 'closed early');
  assert.equal((await st.act('examSubmit', { attemptId: s1.body.result.attemptId, ans: [] })).status, 400, 'cannot submit after the window closes');
});

/* a minimal .docx: a zip holding word/document.xml with the given paragraphs ([text, 'hi' | 'b' | ''] runs) */
function makeDocx(paras) {
  const run = ([t, f]) => '<w:r>' + (f === 'hi' ? '<w:rPr><w:highlight w:val="yellow"/></w:rPr>' : f === 'b' ? '<w:rPr><w:b/></w:rPr>' : '') + '<w:t xml:space="preserve">' + t.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</w:t></w:r>';
  const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paras.map(p => '<w:p>' + (Array.isArray(p[0]) ? p : [p]).map(run).join('') + '</w:p>').join('') + '</w:body></w:document>';
  const name = Buffer.from('word/document.xml'); const data = Buffer.from(xml);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const cdOffset = 30 + name.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

test('the content creator uploads a Word question paper, checks it and imports it for approval', async () => {
  const doc = makeDocx([
    ['Section A', ''],
    ['1. Tauheed means: (1 mark)', ''], ['a) The oneness of God', 'hi'], ['b) Divine justice', ''], ['c) Prophethood', ''], ['d) The return', ''],
    ['2. Which of these are roots of religion? (2 marks)', ''], ['i) Tauheed', ''], ['ii) Salat', ''], ['iii) Adl', ''],
    ['a) i, iii', 'b'], ['b) ii only', ''], ['c) i, ii', ''], ['d) all of them', ''],
    ['3. The first root of religion is ____', ''],
    [['4. Pick one a) x1 b) y1 ', ''], ['c) z1', 'hi'], [' d) w1', '']]
  ]);
  const cookie = async u => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  const send = (c, body, name) => fetch(base + '/api/paper', { method: 'POST', headers: { cookie: c, 'X-Filename': name || 'paper.docx' }, body });
  const mk = await cookie('rubab');
  assert.equal((await send(await cookie('tahera'), doc)).status, 403, 'only the creator imports papers');
  assert.match((await (await send(mk, doc, 'paper.pdf')).json()).error, /PDF/);
  assert.match((await (await send(mk, Buffer.from('not a word file'))).json()).error, /not a Word/);
  const r = await send(mk, doc); assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.questions.length, 4);
  const [q1, q2, q3, q4] = p.questions;
  assert.equal(q1.type, 'single'); assert.equal(q1.correct, 0); assert.match(q1.how, /yellow highlight/); assert.equal(q1.text, 'Tauheed means:');
  assert.equal(q2.type, 'combo'); assert.deepEqual(q2.stmts, ['Tauheed', 'Salat', 'Adl']); assert.equal(q2.correct, 0); assert.match(q2.how, /bold/); assert.equal(q2.marks, 2);
  assert.equal(q3.type, 'other', 'no options, cannot be imported');
  assert.deepEqual(q4.options, ['x1', 'y1', 'z1', 'w1']); assert.equal(q4.correct, 2);

  const before = store.all('questions').length;
  const mkr = await login('rubab');
  const items = p.questions.map(q => ({ include: q.type !== 'other', correct: q.correct, q }));
  assert.equal((await mkr.act('importSave', { course: 'BAS', sem: 3, sub: 'b', items })).status, 200);
  const added = store.all('questions').slice(before);
  assert.equal(added.length, 3);
  assert.ok(added.every(q => q.status === 'pending' && q.course === 'BAS' && q.sem === 3));
  assert.equal(added.find(q => q.type === 'combo').stmts.length, 3);
});

test('the syllabus chart is written by the creator and used once approved', async () => {
  const mk = await login('rubab'), ap = await login('tahera'), t = await login('maryam');
  const b = Array.from({ length: 13 }, (_, i) => 'Belief topic ' + (i + 1));
  assert.equal((await ap.act('chartSave', { key: 'INT-1', b })).status, 403, 'the approver does not write charts');
  assert.equal((await mk.act('chartSave', { key: 'INT-1', b: [] })).status, 400, 'something must be filled in');
  assert.equal((await mk.act('chartSave', { key: 'INT-1', b })).status, 200);
  assert.ok(!(await t.get('/api/data')).body.data.chartData['INT-1'], 'not live until approved');
  assert.equal((await mk.act('review', { kind: 'chart', id: 'INT-1', decision: 'approve' })).status, 403);
  assert.equal((await ap.act('review', { kind: 'chart', id: 'INT-1', decision: 'approve' })).status, 200);
  const live = (await t.get('/api/data')).body.data.chartData['INT-1'];
  assert.equal(live.b.length, 13); assert.equal(live.b[0], 'Belief topic 1'); assert.equal(live.approvedBy, 'Sr. Tahera');
  assert.ok(store.get('charts')['INT-1']);
});

test('material files are shown inside the app, not downloaded, and Word files can be read as text', async () => {
  const cookie = async u => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  const mk = await cookie('rubab');
  const docx = makeDocx([['Week 1: Remembrance of Allah', 'b'], ['Allah is remembered in every state.', '']]);
  const up = await (await fetch(base + '/api/upload', { method: 'POST', headers: { cookie: mk, 'X-Filename': 'syllabus.docx', 'Content-Type': 'application/octet-stream' }, body: docx })).json();
  const f = await fetch(base + '/files/' + up.id, { headers: { cookie: mk } });
  assert.equal(f.status, 200); assert.equal(f.headers.get('content-disposition'), 'inline'); assert.match(f.headers.get('cache-control'), /no-store/);
  assert.equal(f.headers.get('x-frame-options'), 'SAMEORIGIN', 'the app can show it in a frame');
  const text = await (await fetch(base + '/files/' + up.id + '/text', { headers: { cookie: mk } })).json();
  assert.deepEqual(text.paragraphs.map(p => p.text), ['Week 1: Remembrance of Allah', 'Allah is remembered in every state.']);
  assert.equal(text.paragraphs[0].bold, true);
  assert.equal((await fetch(base + '/files/' + up.id, { headers: { cookie: await cookie('zainab') } })).status, 403, 'not shared with that student');
});

test('a syllabus document is reference material: it never changes the syllabus chart or drafts questions', async () => {
  const cookie = async u => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) })).headers.get('set-cookie').split(';')[0];
  const doc = makeDocx([['Chapter 1', 'b'], ['The Oneness of Allah', ''], ['Text of chapter one.', ''], ['Chapter 2', 'b'], ['Justice of Allah', ''], ['Text.', '']]);
  const up = await (await fetch(base + '/api/upload', { method: 'POST', headers: { cookie: await cookie('rubab'), 'X-Filename': 'Laws syllabus.docx', 'Content-Type': 'application/octet-stream' }, body: doc })).json();
  const mk = await login('rubab'), ap = await login('tahera');
  store.tx(() => store.set('chartData', { ...store.get('chartData', {}), 'BAS-3': { b: Array.from({ length: 8 }, (_, i) => 'Nabuwwat week ' + (i + 1)), l: [], e: [] } }));
  const r = await mk.act('matAdd', { title: 'Basic Semester 3 syllabus: Islamic Laws', type: 'Syllabus', course: 'BAS', sem: 3, sub: 'l', share: 'true', fileId: up.id });
  assert.equal(r.status, 200); assert.doesNotMatch(r.body.toast, /chapters were read|drafted/);
  const m = store.all('materials').find(x => x.title === 'Basic Semester 3 syllabus: Islamic Laws');
  assert.equal(m.chart, undefined); assert.equal(m.qgen, undefined, 'no questions are drafted');
  assert.equal((await ap.act('review', { kind: 'mat', id: m.id, decision: 'approve' })).status, 200);
  const ch = store.get('chartData')['BAS-3'];
  assert.deepEqual(ch.l, [], 'the Islamic Laws column is untouched'); assert.equal(ch.b[0], 'Nabuwwat week 1');
  /* an Akhlaq or Ahkam document that applies to every semester is uploaded once, for all semesters */
  const all = await mk.act('matAdd', { title: 'Akhlaq for every semester', type: 'Syllabus', course: 'BAS', sem: 0, sub: 'e', share: 'true', fileId: up.id });
  assert.equal(all.status, 200); assert.equal(store.all('materials').find(x => x.title === 'Akhlaq for every semester').sem, 0);
  /* drafting cannot be started by hand either */
  assert.equal((await mk.act('qgenRetry', { id: m.id, part: 'teacher' })).status, 400);
});

test('a shared material gets a new file; students keep the old one until the update is approved', async () => {
  const cookie = async u => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: u === 'inrstudent' ? 'password123' : PW }) })).headers.get('set-cookie').split(';')[0];
  const upload = async (u, name, body) => (await (await fetch(base + '/api/upload', { method: 'POST', headers: { cookie: await cookie(u), 'X-Filename': name, 'Content-Type': 'application/octet-stream' }, body })).json()).id;
  const mk = await login('rubab'), ap = await login('tahera');
  // a syllabus shared with a class, as students see it
  const f1 = await upload('rubab', 'old.docx', makeDocx([['Old syllabus', '']]));
  await mk.act('matAdd', { title: 'Shared syllabus', type: 'Syllabus', course: 'INR', sem: 1, sub: 'b', share: 'true', fileId: f1 });
  const m = store.all('materials').find(x => x.title === 'Shared syllabus');
  await ap.act('review', { kind: 'mat', id: m.id, decision: 'approve' });
  store.tx(() => store.put('shares', { id: 'sh-test', mid: m.id, cid: 'MUM-INR-002', date: '2026-10-12', by: 'test' }));
  const stu = store.all('students').find(s => s.classId === 'MUM-INR-002' && !store.all('users').some(u => u.studentId === s.id));
  assert.equal((await (await login('jafar')).act('studentLogin', { sid: stu.id, username: 'inrstudent', password: 'password123' })).status, 200);
  const st = await login('inrstudent', 'password123');
  const seen = async () => (await st.get('/api/data')).body.data.materials.find(x => x.id === m.id);

  // the creator replaces the file: an update waits, students still get the old file
  const f2 = await upload('rubab', 'new.docx', makeDocx([['Chapter 1', 'b'], ['New beginning', ''], ['Chapter 2', 'b'], ['Next step', '']]));
  const r = await mk.act('matEdit', { id: m.id, title: 'Shared syllabus', type: 'Syllabus', course: 'INR', sem: 1, sub: 'b', share: 'true', fileId: f2 });
  assert.equal(r.status, 200); assert.match(r.body.toast, /keeps seeing the current version/);
  assert.equal((await seen()).fileId, f1, 'students still read the approved file');
  assert.equal((await seen()).draft, undefined, 'students do not receive the update');
  assert.equal((await fetch(base + '/files/' + f2, { headers: { cookie: await cookie('inrstudent') } })).status, 403, 'nor can they open the new file yet');
  assert.equal((await mk.act('review', { kind: 'mat', id: m.id, decision: 'approve' })).status, 403);
  // sent back: old file stays; then resubmitted and approved: everyone gets the new file
  assert.equal((await ap.act('review', { kind: 'mat', id: m.id, decision: 'reject', note: 'Wrong file' })).status, 200);
  assert.equal(store.find('materials', m.id).fileId, f1); assert.equal(store.find('materials', m.id).draft.status, 'rejected');
  await mk.act('matEdit', { id: m.id, title: 'Shared syllabus v2', type: 'Syllabus', course: 'INR', sem: 1, sub: 'b', share: 'true', fileId: f2 });
  const ok = await ap.act('review', { kind: 'mat', id: m.id, decision: 'approve' });
  assert.equal(ok.status, 200); assert.match(ok.body.toast, /new version on their next read/);
  assert.equal((await seen()).fileId, f2); assert.equal((await seen()).title, 'Shared syllabus v2');
  assert.equal((await fetch(base + '/files/' + f2, { headers: { cookie: await cookie('inrstudent') } })).status, 200, 'the new file opens for the class');
  assert.ok(!((store.get('chartData')['INR-1'] || {}).b || []).some(t => /New beginning/.test(t)), 'the chart does not follow the syllabus');

  // the approver's own edit takes effect at once
  const f3 = await upload('tahera', 'third.docx', makeDocx([['Third version', '']]));
  assert.equal((await ap.act('matEdit', { id: m.id, title: 'Shared syllabus v3', type: 'Syllabus', course: 'INR', sem: 1, sub: 'b', share: 'true', fileId: f3 })).status, 200);
  assert.equal((await seen()).fileId, f3);
  assert.equal((await (await login('maryam')).act('matEdit', { id: m.id, title: 'X' })).status, 403, 'teachers cannot edit');
});

test('chapter papers come from uploaded questions; papers open as the class finishes each chapter and count half the mark', async () => {
  const cookie = async u => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: u === 'chstudent' ? 'password123' : PW }) })).headers.get('set-cookie').split(';')[0];
  const body = t => 'This chapter explains ' + t + '. ' + 'It gives reasons, narrations and examples for students to think about. '.repeat(6);
  const doc = makeDocx([['Chapter 1', 'b'], ['The Oneness of Allah', ''], [body('the oneness of Allah'), ''], ['Chapter 2', 'b'], ['Divine Justice', ''], [body('divine justice'), ''], ['Chapter 3', 'b'], ['Prophethood', ''], [body('prophethood'), '']]);
  const fileId = (await (await fetch(base + '/api/upload', { method: 'POST', headers: { cookie: await cookie('rubab'), 'X-Filename': 'Belief sem 4.docx', 'Content-Type': 'application/octet-stream' }, body: doc })).json()).id;
  const mk = await login('rubab'), ap = await login('tahera'), lr = await login('jafar');
  await mk.act('matAdd', { title: 'Basic Semester 4 syllabus: Belief', type: 'Syllabus', course: 'BAS', sem: 4, sub: 'b', share: 'true', fileId });
  const m = store.all('materials').find(x => x.title === 'Basic Semester 4 syllabus: Belief');
  assert.equal((await ap.act('review', { kind: 'mat', id: m.id, decision: 'approve' })).status, 200);
  assert.equal(store.all('questions').filter(q => q.source === m.id).length, 0, 'nothing is drafted from the document');
  // the content creator uploads 12 questions per chapter (as the MCQ Excel upload sends them)
  const items = [1, 2, 3].flatMap(n => Array.from({ length: 12 }, (_, i) => ({ course: 'BAS', sem: 4, sub: 'b', chapter: n, text: 'Chapter ' + n + ' question ' + (i + 1), options: ['w', 'x', 'y', 'z'], correct: i % 4 })));
  const imp = await mk.act('qImportRows', { items });
  assert.equal(imp.status, 200); assert.match(imp.body.toast, /36 questions imported/);
  const drafted = store.all('questions').filter(q => q.course === 'BAS' && q.sem === 4 && q.sub === 'b' && q.chapter);
  assert.equal(drafted.length, 36); assert.ok(drafted.every(q => q.status === 'pending'));
  for (const n of [1, 2, 3]) assert.equal((await ap.act('reviewMany', { ids: drafted.filter(q => q.chapter === n).map(q => q.id), decision: 'approve' })).status, 200);
  assert.equal((await mk.act('reviewMany', { ids: [drafted[0].id], decision: 'approve' })).status, 403);

  // a Basic Semester 4 class with a student; weeks 1 to 3 (chapter 1) are logged
  const cid = (await lr.act('classSave', { course: 'BAS', sem: 4, g: 'F', day: 1, time: '20:00', start: '2026-08-24', teacher: 't1' })).body.result.id;
  await enrol(lr, cid, 'Chapter Student');
  const sid = store.all('students').find(s => s.name === 'Chapter Student').id;
  store.tx(() => { const s = store.find('students', sid); s.joined = '2026-08-01'; store.put('students', s); });
  await lr.act('studentLogin', { sid, username: 'chstudent', password: 'password123' });
  ensureSessions(store, '2026-10-12');
  const ss = () => store.all('sessions').filter(x => x.classId === cid).sort((a, b) => a.date < b.date ? -1 : 1);
  for (const x of ss().slice(0, 3)) assert.equal((await lr.act('logSave', { sid: x.id, held: true, att: {} })).status, 200);
  const st = await login('chstudent', 'password123');
  assert.equal((await st.act('examStart', { id: 'CH-BAS-4-b-1' })).status, 400, 'a chapter paper opens only when the teacher or location responsible opens it');
  // the location responsible opens chapter 1's paper for this class; a chapter without questions cannot be opened
  assert.equal((await lr.act('chapterOpen', { cid, sub: 'l', n: 1, from: '2026-10-12', to: '2026-10-18' })).status, 400);
  assert.equal((await lr.act('chapterOpen', { cid, sub: 'b', n: 1, from: '2026-10-12', to: '2026-10-18' })).status, 200);
  assert.equal((await st.act('examStart', { id: 'CH-BAS-4-b-2' })).status, 400, 'chapter 2 is not opened yet');
  const s1 = await st.act('examStart', { id: 'CH-BAS-4-b-1' });
  assert.equal(s1.status, 200); assert.equal(s1.body.result.qs.length, 12);
  const att = store.find('attempts', s1.body.result.attemptId);
  const ans = answersFor(att);
  const sub1 = await st.act('examSubmit', { attemptId: att.id, ans });
  assert.equal(sub1.status, 200); assert.deepEqual(sub1.body.result, { pct: 100, passed: true, key: 'BAS|4|b|1' }, 'a chapter paper\'s mark is given at once');
  assert.equal(sub1.body.data.results.find(r => r.chapter === 1).pct, 100, 'and the student sees it before results are published');
  const res = store.all('results').find(x => x.sid === sid && x.chapter === 1);
  assert.equal(res.pct, 100);
  assert.equal((await st.act('examStart', { id: 'CH-BAS-4-b-1' })).status, 400, 'a passed paper cannot be sat again');
  // re-exam: below 50% the paper can be sat again while it is open, as often as needed; the best mark counts
  assert.equal((await lr.act('chapterOpen', { cid, sub: 'b', n: 2, from: '2026-10-12', to: '2026-10-18' })).status, 200);
  const answer = (a, right) => answersFor(a, !right);
  for (const right of [false, false, true]) {
    const sx = await st.act('examStart', { id: 'CH-BAS-4-b-2' }); assert.equal(sx.status, 200);
    const ax = store.find('attempts', sx.body.result.attemptId);
    const rx = await st.act('examSubmit', { attemptId: ax.id, ans: answer(ax, right) });
    assert.equal(rx.body.result.passed, right);
  }
  assert.equal((await st.act('examStart', { id: 'CH-BAS-4-b-2' })).status, 400, 'passed on the third attempt');
  assert.equal(store.all('results').filter(x => x.sid === sid && x.chapter === 2).length, 3);
  // the semester exam draws 30 of the approved chapter questions (the other subjects need a question too)
  store.tx(() => ['l', 'e'].forEach(sub => store.put('questions', { id: 'q4' + sub, course: 'BAS', sem: 4, sub, type: 'single', text: 'Q', options: ['a', 'b', 'c', 'd'], correct: 0, retired: false })));
  assert.equal((await lr.act('examOpen', { cid, from: '2026-10-12', to: '2026-10-18' })).status, 200);
  const se = await st.act('examStart', { id: 'BAS-4-b' });
  assert.equal(se.status, 200); assert.equal(se.body.result.qs.length, 30);
  // mark: chapters (100 + 0 + 0) / 3 = 33.3, exam 80 -> 57
  const { subjectMark } = await import('../public/shared/grading.js');
  assert.equal(subjectMark([{ pct: 100, chapter: 1 }, { pct: 80 }], [1, 2, 3]), 57);
  assert.equal(subjectMark([{ pct: 100, chapter: 1 }], [1, 2, 3]), null, 'no mark until the semester exam is taken');
  assert.equal(subjectMark([{ pct: 70 }], []), 70, 'without chapter papers the exam alone counts');
});

test('a teacher goes through the subject\'s training (syllabus and teacher\'s guide) and passes its quiz before being ready', async () => {
  const m = store.all('materials').find(x => x.title === 'Basic Semester 4 syllabus: Belief');
  const ap = await login('tahera'), t = await login('maryam'), lr = await login('jafar'), mk = await login('rubab');
  const mine = async () => (await t.get('/api/data')).body.data.readiness.find(r => r.mid === m.id);
  let r = await mine();
  assert.ok(r, 'the teacher of the Basic Semester 4 class must be ready for its syllabus');
  assert.equal(r.ready, false); assert.equal(r.items.length, 1); assert.equal(r.items[0].read, 0); assert.ok(r.items[0].units >= 1);
  assert.ok((await lr.get('/api/data')).body.data.readiness.some(x => x.mid === m.id && !x.ready), 'the location responsible sees it');
  // a teacher's guide for the subject joins the training
  const cookie = (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'rubab', password: PW }) })).headers.get('set-cookie').split(';')[0];
  const guideDoc = makeDocx([['Teaching the Oneness of Allah', 'b'], ['Begin the class with the story of Prophet Ibrahim and the stars, then ask the students what a true Lord must be like. '.repeat(4), '']]);
  const gid = (await (await fetch(base + '/api/upload', { method: 'POST', headers: { cookie, 'X-Filename': 'Belief sem 4 teacher guide.docx', 'Content-Type': 'application/octet-stream' }, body: guideDoc })).json()).id;
  await mk.act('matAdd', { title: 'Teacher guide: Belief, Basic Semester 4', type: 'Teacher guide', course: 'BAS', sem: 4, sub: 'b', share: 'false', fileId: gid });
  const g = store.all('materials').find(x => x.title === 'Teacher guide: Belief, Basic Semester 4');
  const ok1 = await ap.act('review', { kind: 'mat', id: g.id, decision: 'approve' });
  assert.equal(ok1.status, 200); assert.doesNotMatch(ok1.body.toast, /drafted/);
  // the content creator uploads the teacher quiz from Excel ("For: Teacher readiness quiz"); it attaches to the approved syllabus
  const tItems = Array.from({ length: 12 }, (_, i) => ({ course: 'BAS', sem: 4, sub: 'b', chapter: 2, aud: 'teacher', text: 'Teacher readiness question ' + (i + 1), options: ['p', 'q', 'r', 's'], correct: i % 4 }));
  const ti = await mk.act('qImportRows', { items: tItems });
  assert.equal(ti.status, 200);
  const tq = store.all('questions').filter(q => q.aud === 'teacher' && /^Teacher readiness question/.test(q.text));
  assert.equal(tq.length, 12); assert.ok(tq.every(q => q.source === m.id && q.status === 'pending' && !q.chapter), 'attached to the syllabus, never a chapter paper');
  // a teacher quiz needs an approved syllabus for its course, semester and subject
  const none = await mk.act('qImportRows', { items: [{ course: 'BAS', sem: 5, sub: 'l', aud: 'teacher', text: 'Orphan teacher question', options: ['a', 'b', 'c', 'd'], correct: 0 }] });
  assert.equal(none.status, 400); assert.match(none.body.error, /no approved syllabus/);
  r = await mine(); assert.deepEqual(r.items.map(i => i.mid), [m.id, g.id], 'the syllabus, then the guide');
  assert.equal((await t.act('tquizStart', { mid: m.id })).status, 400, 'the training comes first');
  // the reader reports time per page; short visits do not count, and each report is capped
  let rep = await t.act('readTrack', { mid: m.id, units: { 1: 10 }, total: r.items[0].units });
  assert.equal(rep.body.result.read, 0); assert.equal(rep.body.data, undefined, 'a short reply without the data set');
  const all = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 500]));
  rep = await t.act('readTrack', { mid: m.id, units: all(r.items[0].units), total: r.items[0].units });
  assert.equal(rep.body.result.done, true); assert.equal(rep.body.result.allDone, false); assert.equal(rep.body.result.left, 1);
  const q1 = await t.act('tquizStart', { mid: m.id }); assert.equal(q1.status, 400); assert.match(q1.body.error, /Teacher guide: Belief/);
  rep = await t.act('readTrack', { mid: g.id, units: all(r.items[1].units), total: r.items[1].units });
  assert.equal(rep.body.result.allDone, true);
  assert.equal((await t.act('tquizStart', { mid: m.id })).status, 400, 'no approved quiz yet');
  // the approver approves the teacher quiz; it is never used in students' papers
  const tqs = store.all('questions').filter(q => q.source === m.id && q.aud === 'teacher' && q.status === 'pending');
  assert.equal((await ap.act('reviewMany', { ids: tqs.map(q => q.id), decision: 'approve' })).status, 200);
  const st = await t.act('tquizStart', { mid: m.id });
  assert.equal(st.status, 200); assert.equal(st.body.result.qs.length, 12); assert.ok(!('correct' in st.body.result.qs[0]), 'answers stay on the server');
  const att = store.find('attempts', st.body.result.attemptId);
  const wrong = att.qids.map(() => 'zzz');
  const f = await t.act('tquizSubmit', { attemptId: att.id, ans: wrong });
  assert.equal(f.body.result.passed, false); assert.match(f.body.toast, /pass mark is 80%/);
  assert.equal((await t.act('tquizStart', { mid: m.id })).status, 400, 'retake from tomorrow');
  // next day (a fresh attempt is allowed once the date has moved on)
  store.tx(() => { const rec = store.find('readiness', att.rid); rec.quiz[0].on = '2026-10-10'; store.put('readiness', rec); });
  const s2 = await t.act('tquizStart', { mid: m.id }); const a2 = store.find('attempts', s2.body.result.attemptId);
  const ans = answersFor(a2);
  const ok = await t.act('tquizSubmit', { attemptId: a2.id, ans });
  assert.equal(ok.body.result.passed, true);
  r = await mine(); assert.equal(r.ready, true); assert.equal(r.best, 100);
  assert.equal((await t.act('tquizSubmit', { attemptId: a2.id, ans })).status, 400, 'one submission per attempt');
});

test('saving a syllabus again drafts nothing, and drafting cannot be asked for', async () => {
  const m = store.all('materials').find(x => x.title === 'Basic Semester 4 syllabus: Belief');
  const ap = await login('tahera'); const before = store.all('questions').length;
  const r = await ap.act('matEdit', { id: m.id, title: m.title, type: 'Syllabus', course: 'BAS', sem: 4, sub: 'b', share: 'true' });
  assert.equal(r.status, 200); assert.doesNotMatch(r.body.toast, /drafted/);
  for (const part of ['students', 'teacher', 'more']) assert.equal((await ap.act('qgenRetry', { id: m.id, part })).status, 400);
  assert.equal(store.all('questions').length, before);
});

test('sample data is shifted to the install date in whole weeks', async () => {
  const s = await SqliteStore.open(':memory:');
  await createApp({ store: s, dataDir: dir, today: () => '2026-11-04' });
  const loc = s.find('locations', 'MUM');
  assert.equal(loc.nextCall, '2026-11-02');
});

test('sample accounts follow a changed SEED_PASSWORD, and ADMIN_PASSWORD always opens the admin account', async () => {
  const { verifyPassword } = await import('../server/auth.js');
  const s = await SqliteStore.open(':memory:');
  const saved = { seed: process.env.SEED_PASSWORD, admin: process.env.ADMIN_PASSWORD };
  try {
    process.env.SEED_PASSWORD = 'first-password';
    await createApp({ store: s, dataDir: dir, today: () => '2026-10-12' });
    assert.ok(verifyPassword('first-password', s.all('users').find(u => u.username === 'abbas').password));

    /* the password was changed in the hosting settings, pasted with spaces and quotes */
    process.env.SEED_PASSWORD = '  "second-password" ';
    process.env.ADMIN_PASSWORD = ' admin-password-1 ';
    await createApp({ store: s, dataDir: dir, today: () => '2026-10-12' });
    const abbas = s.all('users').find(u => u.username === 'abbas');
    assert.ok(verifyPassword('second-password', abbas.password));
    const admin = s.all('users').find(u => u.username === 'admin');
    assert.ok(admin.roles.includes('super'));
    assert.ok(verifyPassword('admin-password-1', admin.password));
  } finally {
    if (saved.seed === undefined) delete process.env.SEED_PASSWORD; else process.env.SEED_PASSWORD = saved.seed;
    if (saved.admin === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = saved.admin;
  }
});
test('an allocated student records who allocated them and leaves the waiting list', async () => {
  const mgr = await login('jafar');
  const r = await enrol(mgr, 'MUM-BAS-003', 'Ruqayya Allocated');
  assert.equal(r.status, 200);
  const s = r.body.data.students.find(x => x.name === 'Ruqayya Allocated');
  assert.equal(s.classId, 'MUM-BAS-003');
  assert.equal(s.allocatedBy, 'Br. Jafar');
  assert.ok(!r.body.data.regs.some(x => x.name === 'Ruqayya Allocated'));
});


/* ---------- Excel uploads by the academic content creator ---------- */
async function xlsx(rows) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sheet1'); rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('a syllabus chart comes in from Excel, asking first when one already exists', async () => {
  const mk = await login('rubab'), ap = await login('tahera'), lr = await login('jafar');
  /* the template downloads, filled with the current chart, and reads back */
  const t = await mk.bytes('/api/excel/ssc-template?course=INT&sem=2');
  assert.equal(t.status, 200); assert.match(t.type, /spreadsheetml/);
  /* only the content creator uploads */
  assert.equal((await lr.raw('/api/excel/ssc-preview?course=INT&sem=2', t.buf)).status, 403);
  assert.equal((await ap.raw('/api/excel/ssc-preview?course=INT&sem=2', t.buf)).status, 403);
  /* a fresh chart for Intermediate Semester 2, Belief only: nothing exists, so no question */
  const file = await xlsx([['Week', 'Belief'], ...Array.from({ length: 13 }, (_, i) => [i + 1, 'Adl topic ' + (i + 1)]), [14, 'beyond the semester']]);
  const p = (await mk.raw('/api/excel/ssc-preview?course=INT&sem=2', file)).body;
  assert.deepEqual(p.subjects, ['b']); assert.equal(p.b[0], 'Adl topic 1'); assert.equal(p.l, null);
  assert.equal(p.approved, null); assert.equal(p.pending, null);
  assert.equal(p.problems.length, 1, 'week 14 is reported, not imported');
  assert.equal((await mk.act('chartImport', { key: p.key, b: p.b, l: p.l, e: p.e, file: 'int2.xlsx' })).status, 200);
  /* the approver approves it: it is now in use */
  assert.equal((await ap.act('review', { kind: 'chart', id: 'INT-2', decision: 'approve' })).status, 200);
  /* uploading Belief again finds the chart in use and needs the creator's confirmation */
  const again = await xlsx([['Week', 'Belief', 'Ethics'], [1, 'New Adl 1', 'Honesty'], [2, 'New Adl 2', '']]);
  const p2 = (await mk.raw('/api/excel/ssc-preview?course=INT&sem=2', again)).body;
  assert.deepEqual(p2.subjects, ['b', 'e']); assert.deepEqual(p2.approved.subjects, ['b']); assert.equal(p2.approved.approvedBy, 'Sr. Tahera');
  const args = { key: p2.key, b: p2.b, l: p2.l, e: p2.e, file: 'int2-new.xlsx' };
  assert.equal((await mk.act('chartImport', args)).status, 409, 'not without confirming');
  const ok = await mk.act('chartImport', { ...args, confirmNew: true });
  assert.equal(ok.status, 200); assert.match(ok.body.toast, /New syllabus chart/);
  const d = ok.body.data.chartDrafts['INT-2'];
  assert.equal(d.status, 'pending'); assert.equal(d.b[0], 'New Adl 1'); assert.equal(d.e[0], 'Honesty');
  /* the live chart is unchanged until approval */
  assert.equal(ok.body.data.chartData['INT-2'].b[0], 'Adl topic 1');
});

test('multiple-choice questions come in from Excel, checked row by row', async () => {
  const mk = await login('rubab');
  const t = await mk.bytes('/api/excel/mcq-template'); assert.equal(t.status, 200);
  const file = await xlsx([
    ['Course', 'Semester', 'Subject', 'Chapter', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct answer'],
    ['Basic', 3, 'Belief', 2, 'Which of these is Nabuwwat, in the uploaded paper?', 'Divine justice', 'Prophethood', 'Oneness', 'Resurrection', 'B'],
    ['BAS', '3', 'Ethics', '', 'Truthfulness is part of:', 'Akhlaq', 'Fiqh', 'Usul', 'Tafsir', 'akhlaq'],
    ['Basic', 9, 'Belief', '', 'Bad semester', 'a', 'b', 'c', 'd', 'A'],
    ['Basic', 3, 'Belief', '', 'Missing option', 'a', '', 'c', 'd', 'E'],
    ['Basic', 2, 'Belief', '', 'Adl, the subject of this semester, refers to which belief?', 'The oneness of God', 'Divine justice', 'Prophethood', 'The Day of Resurrection', 'B']
  ]);
  const { items } = (await mk.raw('/api/excel/mcq-preview', file)).body;
  assert.equal(items.length, 5);
  assert.deepEqual(items[0].q, { course: 'BAS', sem: 3, sub: 'b', chapter: 2, text: 'Which of these is Nabuwwat, in the uploaded paper?', options: ['Divine justice', 'Prophethood', 'Oneness', 'Resurrection'], correct: 1 });
  assert.equal(items[1].q.correct, 0, 'the answer can be given as the option text');
  assert.match(items[2].errors.join(), /Basic has 5 semesters, not 9/);
  assert.match(items[3].errors.join(), /option B missing/); assert.match(items[3].errors.join(), /not A, B, C or D/);
  assert.equal(items[4].dupe, true, 'already in the sample bank');
  const ready = items.filter(x => !x.errors.length && !x.dupe).map(x => x.q);
  const r = await mk.act('qImportRows', { items: ready });
  assert.equal(r.status, 200); assert.match(r.body.toast, /2 questions imported/);
  const q = r.body.data.questions.find(x => x.text === 'Which of these is Nabuwwat, in the uploaded paper?');
  assert.equal(q.status, 'pending'); assert.equal(q.chapter, 2); assert.equal(q.correct, 1);
  /* importing the same file again skips what is now in the bank */
  assert.equal((await mk.act('qImportRows', { items: ready })).status, 400);
});
