import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { Store } from '../server/db.js';
import { ensureSessions } from '../server/actions.js';

const PW = 'almuntazar123';
let server, base, store, dir;

before(async () => {
  process.env.SEED_PASSWORD = PW;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-test-'));
  store = new Store(':memory:');
  const app = createApp({ store, dataDir: dir, today: () => '2026-10-12' });
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
  const other = store.all('sessions').find(x => x.classId === 'MUM-INR-002' && !x.logged);
  assert.equal((await t.act('logSave', { sid: other.id, held: true, att: {} })).status, 403);
  const co = await login('sabiha');
  assert.equal((await co.act('assignSave', { cid: 'MUM-BAS-005', teacher: 't3' })).status, 403);
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
  const ac = await login('tahera');
  assert.equal((await ac.act('examToggle', { id: 'BAS-2-b' })).status, 200);
  const z = await login('zainab');
  const st = await z.act('examStart', { id: 'BAS-2-b' });
  assert.equal(st.status, 200);
  const { attemptId, qs } = st.body.result;
  for (const q of qs) { assert.equal(q.correct, undefined); assert.equal(q.answers, undefined); }
  const att = store.find('attempts', attemptId);
  const ans = att.qids.map((id, i) => {
    const q = store.find('questions', id);
    if (q.type === 'fill') return q.answers[0];
    if (q.type === 'match') return q.left.map((_, j) => String(att.perms[i].indexOf(j)));
    return q.correct;
  });
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

test('sample data is shifted to the install date in whole weeks', async () => {
  const s = new Store(':memory:');
  createApp({ store: s, dataDir: dir, today: () => '2026-11-04' });
  const loc = s.find('locations', 'MUM');
  assert.equal(loc.nextCall, '2026-11-02');
});
