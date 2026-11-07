import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { SqliteStore, PgStore } from '../server/db.js';
import { ensureSessions } from '../server/actions.js';

const PW = 'almuntazar123';
let server, base, dir, provider;
/* Set TEST_DATABASE_URL to run the same tests against Postgres (the table is emptied first). */
const PG = process.env.TEST_DATABASE_URL || '';
const db = () => provider.get();

before(async () => {
  process.env.SEED_PASSWORD = PW;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-test-'));
  let app;
  if (PG) {
    const pool = await PgStore.connect(PG); await pool.query('TRUNCATE docs'); await pool.end();
    app = await createApp({ databaseUrl: PG, dataDir: dir, today: () => '2026-10-12' });
  } else {
    app = await createApp({ store: await SqliteStore.open(':memory:'), dataDir: dir, today: () => '2026-10-12' });
  }
  provider = app.locals.provider;
  await new Promise(r => { server = app.listen(0, r); });
  base = 'http://localhost:' + server.address().port;
});
after(async () => { server.close(); if (provider.pool) await provider.pool.end(); fs.rmSync(dir, { recursive: true, force: true }); });

async function login(username, password = PW) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!r.ok) return { status: r.status };
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const req = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { status: 200, get: url => req('GET', url), act: (name, args) => req('POST', '/api/action/' + name, args || {}) };
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
  const store = await db();
  const other = store.all('sessions').find(x => x.classId === 'MUM-INR-002' && !x.logged);
  assert.equal((await t.act('logSave', { sid: other.id, held: true, att: {} })).status, 403);
  const co = await login('sabiha');
  assert.equal((await co.act('assignSave', { cid: 'MUM-BAS-005', teacher: 't3' })).status, 403);
});

test('a teacher logs a session once, with attendance', async () => {
  const t = await login('maryam');
  let store = await db();
  const x = store.all('sessions').find(s => s.classId === 'MUM-BAS-003' && !s.logged);
  const r = await t.act('logSave', { sid: x.id, held: true, att: { fatimar: 'a', sakinam: 'e' }, covered: { b: true } });
  assert.equal(r.status, 200);
  store = await db();
  const saved = store.find('sessions', x.id);
  assert.equal(saved.logged, true);
  assert.equal(saved.att.fatimar, 'a');
  assert.equal(saved.att.zainab, 'p');
  assert.equal((await t.act('logSave', { sid: x.id, held: true })).status, 400);
});

test('exams are marked on the server and can be taken once', async () => {
  const ac = await login('tahera');
  assert.equal((await ac.act('examToggle', { id: 'BAS-2-b' })).status, 200);
  const z = await login('zainab');
  const st = await z.act('examStart', { id: 'BAS-2-b' });
  assert.equal(st.status, 200);
  const { attemptId, qs } = st.body.result;
  let store = await db();
  for (const q of qs) { assert.equal(q.correct, undefined); assert.equal(q.answers, undefined); }
  const att = store.find('attempts', attemptId);
  const ans = att.qids.map((id, i) => {
    const q = store.find('questions', id);
    if (q.type === 'fill') return q.answers[0];
    if (q.type === 'match') return q.left.map((_, j) => String(att.perms[i].indexOf(j)));
    return q.correct;
  });
  assert.equal((await z.act('examSubmit', { attemptId, ans })).status, 200);
  store = await db();
  const res = store.all('results').find(r => r.sid === 'zainab' && r.sem === 2 && r.sub === 'b');
  assert.equal(res.pct, 100);
  assert.equal((await z.act('examStart', { id: 'BAS-2-b' })).status, 400);
  const d = (await z.get('/api/data')).body.data;
  assert.equal(d.results.find(r => r.sem === 2 && r.sub === 'b').pct, null, 'unpublished marks stay hidden');
});

test('scheduled sessions appear once their date has passed', async () => {
  let store = await db();
  const before = store.all('sessions').filter(x => x.classId === 'MUM-BAS-003').length;
  await ensureSessions(store, '2026-10-30');
  store = await db();
  const after = store.all('sessions').filter(x => x.classId === 'MUM-BAS-003');
  assert.equal(after.length, before + 3);
  assert.ok(after.slice(-3).every(x => !x.logged && x.held));
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
    assert.equal(admin.role, 'super');
    assert.ok(verifyPassword('admin-password-1', admin.password));
  } finally {
    if (saved.seed === undefined) delete process.env.SEED_PASSWORD; else process.env.SEED_PASSWORD = saved.seed;
    if (saved.admin === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = saved.admin;
  }
});

test('students join only by registration, and only the location manager allocates them', async () => {
  const co = await login('sabiha');
  const r = await co.act('regAdd', { name: 'Test Student', g: 'F', course: 'BAS', city: 'Pune', phone: '+91 90000 00000', email: 'test@example.com' });
  assert.equal(r.status, 200);
  const reg = r.body.data.regs.find(x => x.name === 'Test Student');
  assert.ok(reg);
  assert.equal((await co.act('allocSave', { rid: reg.id, cid: 'MUM-BAS-003' })).status, 403, 'a coordinator cannot allocate');
  const mgr = await login('jafar');
  assert.equal((await mgr.act('allocSave', { rid: reg.id, cid: 'BAH-BAS-001' })).status, 403, 'not a class in another location');
  assert.equal((await mgr.act('allocSave', { rid: reg.id, cid: 'MUM-BAS-004' })).status, 400, 'not a brothers class');
  const ok = await mgr.act('allocSave', { rid: reg.id, cid: 'MUM-BAS-003' });
  assert.equal(ok.status, 200);
  const s = ok.body.data.students.find(x => x.name === 'Test Student');
  assert.equal(s.classId, 'MUM-BAS-003');
  assert.equal(s.phone, '+91 90000 00000');
  assert.ok(!ok.body.data.regs.some(x => x.id === reg.id));
});

test('a class can be edited, and a student moved, within the rules', async () => {
  const mgr = await login('jafar');
  /* the course cannot change once a class has students */
  assert.equal((await mgr.act('classEdit', { cid: 'MUM-BAS-003', course: 'INT', sem: 1, time: '19:30', day: 4 })).status, 400);
  /* moving up a semester starts the weeks again */
  const up = await mgr.act('classEdit', { cid: 'MUM-INT-001', course: 'INT', sem: 2, time: '21:00', day: 6, meet: 'https://meet.google.com/abc-defg-hij' });
  assert.equal(up.status, 200);
  const c = up.body.data.classes.find(x => x.id === 'MUM-INT-001');
  assert.equal(c.sem, 2); assert.equal(c.time, 21 * 60); assert.ok(c.semStart);
  /* the coordinator can edit the schedule but not the teacher */
  const co = await login('sabiha');
  const e = await co.act('classEdit', { cid: 'MUM-INT-001', course: 'INT', sem: 2, time: '20:30', day: 6, teacher: '' });
  assert.equal(e.status, 200);
  assert.equal(e.body.data.classes.find(x => x.id === 'MUM-INT-001').teacherId, 't4');
  assert.equal((await co.act('studentMove', { sid: 'sakinam', cid: 'MUM-ADV-001' })).status, 403);
  /* the manager moves a student to another sisters class in the location */
  assert.equal((await mgr.act('studentMove', { sid: 'sakinam', cid: 'MUM-BAS-004' })).status, 400, 'not a brothers class');
  const mv = await mgr.act('studentMove', { sid: 'sakinam', cid: 'MUM-ADV-001' });
  assert.equal(mv.status, 200);
  const s = mv.body.data.students.find(x => x.id === 'sakinam');
  assert.equal(s.classId, 'MUM-ADV-001'); assert.equal(s.since, '2026-10-12');
});
