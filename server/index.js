/* HTTP server: JSON API, file uploads and the single-page app.
   Runs as a normal Node server (npm start) or as a Vercel function (api/index.js). */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStore, PgStore, databaseUrl } from './db.js';
import { seed, DEMO_USERS } from './seed.js';
import { currentUser, createSession, destroySession, verifyPassword, hashPassword } from './auth.js';
import { snapshot } from './snapshot.js';
import { runAction, ensureSessions, UserError, SAMPLE_PAPER } from './actions.js';
import { describeUser } from './access.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const HOSTED = !!process.env.VERCEL;

/* The academy works in India time; APP_TODAY pins the date for demos and tests. */
export function todayIso(tz = process.env.APP_TZ || 'Asia/Kolkata') {
  if (process.env.APP_TODAY) return process.env.APP_TODAY;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/* Where records are kept: a given store (tests), Postgres when a database URL is set, otherwise a SQLite file. */
async function storeProvider(opts, dataDir) {
  if (opts.store) return { kind: 'given', get: async () => opts.store };
  const url = opts.databaseUrl ?? databaseUrl();
  if (url) {
    const pool = await PgStore.connect(url);
    return { kind: 'postgres', pool, get: () => PgStore.open(pool) };
  }
  const s = await SqliteStore.open(opts.dbFile || path.join(dataDir, 'academy.db'));
  return { kind: 'sqlite', get: async () => s };
}

export async function createApp(opts = {}) {
  /* On Vercel without a database, only /tmp is writable and it is wiped often: the app still runs, with a warning. */
  const dataDir = opts.dataDir || process.env.DATA_DIR || (HOSTED ? path.join(os.tmpdir(), 'academy') : path.join(root, 'data'));
  const uploads = path.join(dataDir, 'uploads');
  const today = opts.today || todayIso;
  const demoEnv = opts.demo ?? process.env.DEMO;
  const demo = demoEnv !== '0' && demoEnv !== false;
  const provider = await storeProvider(opts, dataDir);
  const temporary = HOSTED && provider.kind === 'sqlite';
  const blob = !!process.env.BLOB_READ_WRITE_TOKEN;
  const maxUpload = HOSTED ? 4 * 1024 * 1024 : 50 * 1024 * 1024;
  let setupMessage = '';

  /* Passwords set in the hosting settings, without the spaces or quote marks that often come with copy and paste */
  const envPassword = name => String(process.env[name] || '').trim().replace(/^(["'])(.*)\1$/, '$2');
  const seedPassword = envPassword('SEED_PASSWORD');
  const adminPassword = envPassword('ADMIN_PASSWORD');
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();

  /* Every start: load the sample data or create the first admin if the database is empty, then make sure
     the passwords in the hosting settings work: sample accounts nobody has changed follow SEED_PASSWORD,
     and ADMIN_PASSWORD always opens the admin account (a way back in if a password is lost). */
  async function prepare() {
    const run = async () => {
      const s = await provider.get();
      if (s.isEmpty()) {
        const seedOn = opts.seed !== false && process.env.SEED !== '0';
        const pw = seedPassword || (HOSTED ? '' : 'almuntazar123');
        if (seedOn && pw) await seed(s, today(), pw);
        else if (!adminPassword) {
          setupMessage = seedOn
            ? 'Almost there: set SEED_PASSWORD in the hosting settings (the password for the sample accounts), then redeploy.'
            : 'Almost there: set ADMIN_PASSWORD in the hosting settings to create the first admin account, then redeploy.';
          return;
        }
      }
      if (seedPassword) {
        const stale = s.all('users').filter(u => u.demo);
        if (stale.length && !verifyPassword(seedPassword, stale[0].password)) {
          const hash = hashPassword(seedPassword);
          await s.tx(() => stale.forEach(u => { u.password = hash; s.put('users', u); }));
        }
      }
      if (adminPassword) {
        const a = s.all('users').find(u => u.username === adminUsername);
        if (!a) await s.tx(() => s.put('users', { id: 'u-admin', username: adminUsername, name: 'Administrator', role: 'super', password: hashPassword(adminPassword) }));
        else if (!verifyPassword(adminPassword, a.password) || a.disabled || a.role !== 'super') {
          await s.tx(() => { a.password = hashPassword(adminPassword); a.disabled = false; a.role = 'super'; s.put('users', a); });
        }
      }
      setupMessage = '';
      await ensureSessions(s, today());
    };
    if (provider.kind === 'postgres') await PgStore.withLock(provider.pool, run); else await run();
  }
  let ready = null;
  const whenReady = () => { if (!ready) ready = prepare().catch(e => { ready = null; throw e; }); return ready; };
  await whenReady();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', HOSTED || process.env.TRUST_PROXY === '1');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  /* Each API request works on its own copy of the records (fresh from Postgres when hosted) */
  const withStore = h(async (req, res, next) => { await whenReady(); req.store = await provider.get(); next(); });
  app.use('/api', withStore, express.json({ limit: '1mb' }));
  app.use('/files', withStore);

  /* Small in-memory limiter for sign-in attempts */
  const tries = new Map();
  const limited = key => {
    const now = Date.now(); const t = (tries.get(key) || []).filter(x => now - x < 15 * 60e3);
    tries.set(key, t); return t.length >= 10;
  };

  const auth = h(async (req, res, next) => {
    const u = await currentUser(req.store, req);
    if (!u) return res.status(401).json({ error: 'Please sign in.' });
    req.user = u; next();
  });

  app.get('/api/meta', h(async (req, res) => {
    const store = req.store;
    const demoUsers = demo ? DEMO_USERS.filter(u => { const x = store.all('users').find(y => y.username === u.username); return x && x.demo; }) : [];
    res.json({
      demo: demo && store.all('users').some(u => u.demo), today: today(), signedIn: !!(await currentUser(store, req)),
      demoUsers: demoUsers.map(u => ({ username: u.username, name: u.name, role: u.role })),
      samplePasswordHint: !HOSTED, temporary, setupMessage, maxUpload
    });
  }));

  app.post('/api/login', h(async (req, res) => {
    const store = req.store;
    const username = String(req.body && req.body.username || '').trim().toLowerCase();
    const key = req.ip + '|' + username;
    if (limited(key)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const u = store.all('users').find(x => x.username === username);
    if (!u || u.disabled || !verifyPassword(req.body && req.body.password, u.password)) {
      tries.get(key).push(Date.now());
      return res.status(401).json({ error: 'That username and password do not match.' });
    }
    tries.delete(key);
    await createSession(store, u, res, req.secure);
    res.json({ ok: true });
  }));

  app.post('/api/logout', h(async (req, res) => { await destroySession(req.store, req, res); res.json({ ok: true }); }));

  app.get('/api/data', auth, h(async (req, res) => {
    await ensureSessions(req.store, today());
    res.json({ me: describeUser(req.store, req.user), today: today(), data: snapshot(req.store, req.user) });
  }));

  app.post('/api/action/:name', auth, h(async (req, res) => {
    const out = await runAction(req.store, req.user, today(), req.params.name, req.body);
    res.json({ ok: true, toast: out.toast, result: out.result, me: describeUser(req.store, req.user), today: today(), data: snapshot(req.store, req.user) });
  }));

  app.get('/api/sample-paper', auth, (req, res) => {
    if (!['academic', 'super'].includes(req.user.role)) return res.status(403).json({ error: 'Not allowed.' });
    res.json(SAMPLE_PAPER);
  });

  /* Uploads: the browser sends the raw file body with its name in a header.
     Hosted, files go to Vercel Blob; on your own computer, to the data folder. */
  app.post('/api/upload', auth, express.raw({ type: () => true, limit: maxUpload }), h(async (req, res) => {
    if (!['academic', 'super'].includes(req.user.role)) return res.status(403).json({ error: 'Not allowed.' });
    if (HOSTED && !blob) return res.status(400).json({ error: 'File uploads need Vercel Blob storage to be connected. Paste a link instead for now.' });
    const name = path.basename(decodeURIComponent(String(req.headers['x-filename'] || 'file'))).slice(0, 200) || 'file';
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'The file is empty.' });
    const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
    const id = 'f' + crypto.randomBytes(12).toString('hex');
    let url = null;
    if (blob) {
      const { put } = await import('@vercel/blob');
      url = (await put('materials/' + id + '/' + name, req.body, { access: 'public', contentType: type, addRandomSuffix: true })).url;
    } else {
      fs.mkdirSync(uploads, { recursive: true });
      fs.writeFileSync(path.join(uploads, id), req.body);
    }
    await req.store.tx(() => req.store.put('files', { id, name, type, size: req.body.length, url, by: req.user.id, date: today() }));
    res.json({ id, name });
  }));

  app.get('/files/:id', auth, (req, res) => {
    const store = req.store;
    const f = store.find('files', req.params.id);
    if (!f) return res.status(404).send('Not found');
    const m = store.all('materials').find(x => x.fileId === f.id);
    const u = req.user;
    let ok = u.role === 'super' || u.role === 'academic';
    if (!ok && m) ok = snapshot(store, u).materials.some(x => x.id === m.id);
    if (!ok) return res.status(403).send('Not allowed');
    if (f.url) return res.redirect(302, f.url);
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', 'inline; filename="' + f.name.replace(/"/g, '') + '"');
    res.sendFile(path.join(uploads, f.id));
  });

  app.use(express.static(path.join(root, 'public')));
  app.get(/^\/(?!api\/|files\/).*/, (req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

  /* Errors: a refused action explains itself; anything else is logged and nothing is saved */
  app.use((err, req, res, next) => {
    if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large. Paste a link to it instead.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Nothing was saved.' });
  });

  app.locals.provider = provider;
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 3000;
  createApp().then(
    app => app.listen(port, () => console.log('Almuntazar Academy running on http://localhost:' + port)),
    e => { console.error('Could not start:', e.message); process.exit(1); }
  );
}
