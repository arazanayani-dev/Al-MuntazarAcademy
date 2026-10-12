/* HTTP server: JSON API, file uploads and the single-page app. */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db.js';
import { seed, DEMO_USERS } from './seed.js';
import { currentUser, createSession, destroySession, verifyPassword } from './auth.js';
import { snapshot } from './snapshot.js';
import { runAction, ensureSessions, UserError, SAMPLE_PAPER } from './actions.js';
import { describeUser } from './access.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/* The academy works in India time; APP_TODAY pins the date for demos and tests. */
export function todayIso(tz = process.env.APP_TZ || 'Asia/Kolkata') {
  if (process.env.APP_TODAY) return process.env.APP_TODAY;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(root, 'data');
  const store = opts.store || new Store(opts.dbFile || path.join(dataDir, 'academy.db'));
  const uploads = path.join(dataDir, 'uploads');
  const today = opts.today || todayIso;
  const demo = (opts.demo ?? process.env.DEMO) !== '0' && (opts.demo ?? process.env.DEMO) !== false;

  if (store.isEmpty() && opts.seed !== false && process.env.SEED !== '0') {
    seed(store, today(), process.env.SEED_PASSWORD || 'almuntazar123');
  }
  ensureSessions(store, today());

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  /* Small in-memory limiter for sign-in attempts */
  const tries = new Map();
  const limited = key => {
    const now = Date.now(); const t = (tries.get(key) || []).filter(x => now - x < 15 * 60e3);
    tries.set(key, t); return t.length >= 10;
  };

  const auth = (req, res, next) => {
    const u = currentUser(store, req);
    if (!u) return res.status(401).json({ error: 'Please sign in.' });
    req.user = u; next();
  };

  app.get('/api/meta', (req, res) => {
    res.json({ demo: demo && store.all('users').some(u => u.demo), today: today(), signedIn: !!currentUser(store, req), demoUsers: demo ? DEMO_USERS.filter(u => { const x = store.all('users').find(y => y.username === u.username); return x && x.demo; }).map(u => ({ username: u.username, name: u.name, role: u.role })) : [] });
  });

  app.post('/api/login', (req, res) => {
    const username = String(req.body && req.body.username || '').trim().toLowerCase();
    const key = req.ip + '|' + username;
    if (limited(key)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const u = store.all('users').find(x => x.username === username);
    if (!u || u.disabled || !verifyPassword(req.body && req.body.password, u.password)) {
      tries.get(key).push(Date.now());
      return res.status(401).json({ error: 'That username and password do not match.' });
    }
    tries.delete(key);
    createSession(store, u, res, req.secure);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => { destroySession(store, req, res); res.json({ ok: true }); });

  app.get('/api/data', auth, (req, res) => {
    ensureSessions(store, today());
    res.json({ me: describeUser(store, req.user), today: today(), data: snapshot(store, req.user) });
  });

  app.post('/api/action/:name', auth, (req, res) => {
    try {
      const out = runAction(store, req.user, today(), req.params.name, req.body);
      res.json({ ok: true, toast: out.toast, result: out.result, me: describeUser(store, req.user), today: today(), data: snapshot(store, req.user) });
    } catch (e) {
      if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Something went wrong. Nothing was saved.' });
    }
  });

  app.get('/api/sample-paper', auth, (req, res) => {
    if (!['academic', 'super'].includes(req.user.role)) return res.status(403).json({ error: 'Not allowed.' });
    res.json(SAMPLE_PAPER);
  });

  /* Uploads: the browser sends the raw file body with its name in a header. */
  app.post('/api/upload', auth, express.raw({ type: () => true, limit: '50mb' }), (req, res) => {
    if (!['academic', 'super'].includes(req.user.role)) return res.status(403).json({ error: 'Not allowed.' });
    const name = path.basename(decodeURIComponent(String(req.headers['x-filename'] || 'file'))).slice(0, 200) || 'file';
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'The file is empty.' });
    const id = 'f' + crypto.randomBytes(12).toString('hex');
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, id), req.body);
    store.tx(() => store.put('files', { id, name, type: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100), size: req.body.length, by: req.user.id, date: today() }));
    res.json({ id, name });
  });

  app.get('/files/:id', auth, (req, res) => {
    const f = store.find('files', req.params.id);
    if (!f) return res.status(404).send('Not found');
    const m = store.all('materials').find(x => x.fileId === f.id);
    const u = req.user;
    let ok = u.role === 'super' || u.role === 'academic';
    if (!ok && m) {
      const snap = snapshot(store, u);
      ok = snap.materials.some(x => x.id === m.id);
    }
    if (!ok) return res.status(403).send('Not allowed');
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', 'inline; filename="' + f.name.replace(/"/g, '') + '"');
    res.sendFile(path.join(uploads, f.id));
  });

  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use(express.static(path.join(root, 'public')));
  app.get(/^\/(?!api\/|files\/).*/, (req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

  app.locals.store = store;
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 3000;
  createApp().listen(port, () => console.log('Almuntazar Academy running on http://localhost:' + port));
}
