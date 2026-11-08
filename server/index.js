/* HTTP server: JSON API, file uploads and the single-page app.
   Runs as a normal Node server (npm start) or as a Vercel function (api/index.js). */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStore, PgStore, databaseUrl } from './db.js';
import { seed } from './seed.js';
import { currentUser, createSession, destroySession, verifyPassword, hashPassword } from './auth.js';
import { configureFiles, loadFile } from './files.js';
import { snapshot } from './snapshot.js';
import { runAction, ensureSessions, UserError, SAMPLE_PAPER, configure } from './actions.js';
import { describeUser, ACADEMIC_ROLES, rolesOf } from './access.js';
import { readPaper, PaperError, docxText } from './docx.js';
import { draftQuestions } from './qgen.js';
import { configureReadiness, countUnits } from './readiness.js';
import Anthropic from '@anthropic-ai/sdk';
import { suggestTasks, TRANSCRIPT_MAX } from './tasks.js';

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
  configure({ uploads }); configureReadiness({ uploads }); configureFiles({ uploads });
  const today = opts.today || todayIso;
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
        const isSuper = u => (u.roles || [u.role]).includes('super');
        if (!a) await s.tx(() => s.put('users', { id: 'u-admin', username: adminUsername, name: 'Administrator', roles: ['super'], password: hashPassword(adminPassword) }));
        else if (!verifyPassword(adminPassword, a.password) || a.disabled || !isSuper(a)) {
          await s.tx(() => { a.password = hashPassword(adminPassword); a.disabled = false; if (a.roles) { if (!a.roles.includes('super')) a.roles = ['super', ...a.roles]; } else a.role = 'super'; s.put('users', a); });
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
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); /* the app's own pages may show its files in a frame */
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

  /* OPEN_ACCESS=1 switches sign-in off: anyone who opens the site is treated as the first super admin.
     Only for trying out a site that holds sample data. Remove the setting to bring sign-in back. */
  const open = process.env.OPEN_ACCESS === '1';
  const isSuperUser = u => !u.disabled && (u.roles || [u.role]).includes('super');
  const userOf = async (store, req) => (await currentUser(store, req)) || (open ? store.all('users').find(isSuperUser) || null : null);

  const auth = h(async (req, res, next) => {
    const u = await userOf(req.store, req);
    if (!u) return res.status(401).json({ error: 'Please sign in.' });
    req.user = u; next();
  });

  /* The sign-in page never lists accounts */
  app.get('/api/meta', h(async (req, res) => {
    res.json({ today: today(), signedIn: !!(await userOf(req.store, req)), open, temporary, setupMessage, maxUpload });
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
    /* Hosted, a drafting run is stopped when the function's time runs out. One that has not moved for 6 minutes
       and is not running here is marked as stopped, so it can be started again. */
    const stuck = req.store.all('materials').filter(m => m.qgen && /queued|running/.test(m.qgen.status) && !drafting.has(m.id) &&
      Date.now() - (Date.parse(m.qgen.at || m.qgen.started || '') || Date.now()) > 6 * 60e3);
    if (stuck.length) await req.store.tx(() => stuck.forEach(m => { m.qgen = { ...m.qgen, status: 'failed', note: 'Drafting stopped before it finished (the server\'s time limit). Approve what was drafted and use Draft questions to continue, or Draft more questions to fill the remaining chapters.' }; req.store.put('materials', m); }));
    res.json({ me: describeUser(req.store, req.user), today: today(), data: snapshot(req.store, req.user) });
  }));

  /* Question drafting runs in the background after a syllabus is saved; one run per material at a time.
     It works on its own copy of the records (fresh from Postgres when hosted). On Vercel the function is
     kept running until drafting ends, within the time vercel.json allows. */
  const drafting = new Set(); const runs = new Set();
  let waitUntil = null;
  if (HOSTED) { try { ({ waitUntil } = await import('@vercel/functions')); } catch { waitUntil = null; } }
  const startDrafting = mid => {
    if (drafting.has(mid)) return; drafting.add(mid);
    const run = provider.get().then(s => draftQuestions(s, mid, opts.askQuestions))
      .catch(e => console.error('Question drafting failed:', e)).finally(() => { drafting.delete(mid); runs.delete(run); });
    runs.add(run);
    if (waitUntil) waitUntil(run);
  };
  app.locals.drafting = drafting;
  app.locals.draftsDone = () => Promise.all([...runs]);

  /* Suggested action items from a meeting's pasted transcript. It waits for Claude, so it is not an action (actions
     run in one quick transaction). Nothing is saved here. */
  app.post('/api/transcript', auth, async (req, res) => {
    const store = req.store;
    const call = store.find('calls', String(req.body && req.body.callId || '')); const roles = rolesOf(store, req.user);
    if (!call) return res.status(404).json({ error: 'Meeting not found.' });
    if (!roles.includes('super') && !((roles.includes('locadmin') || roles.includes('coord')) && req.user.loc === call.loc)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    const transcript = String(req.body.transcript || '').trim();
    if (transcript.length < 50) return res.status(400).json({ error: 'Paste the transcript of the call first.' });
    if (transcript.length > TRANSCRIPT_MAX) return res.status(400).json({ error: 'This transcript is too long to read in one go. Paste the part where the tasks were agreed.' });
    try { res.json(await suggestTasks(store, call, transcript, opts.askTasks)); }
    catch (e) {
      const key = e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || /api[_ ]?key|auth/i.test(String(e && e.message));
      if (!key) console.error('Reading a transcript failed:', e);
      res.status(502).json({ error: key ? 'AI reading is not set up on the server (no Anthropic API key).' : 'The transcript could not be read just now. Please try again, or add the action items by hand.' });
    }
  });

  /* Files an action may read (a syllabus to find its chapters), loaded beforehand because actions run synchronously */
  const preload = async (store, a) => {
    const ids = new Set();
    if (a && a.fileId) ids.add(String(a.fileId));
    const m = a && a.id && store.find('materials', String(a.id));
    if (m) { if (m.fileId) ids.add(m.fileId); if (m.draft && m.draft.fileId) ids.add(m.draft.fileId); }
    for (const id of ids) { const f = store.find('files', id); if (f) await loadFile(f).catch(() => {}); }
  };

  app.post('/api/action/:name', auth, h(async (req, res) => {
    const store = req.store;
    await preload(store, req.body);
    const out = await runAction(store, req.user, today(), req.params.name, req.body);
    /* frequent background reports (reading progress) get a short reply, without the whole data set */
    if (out.quiet) return res.json({ ok: true, result: out.result });
    if (out.draft) startDrafting(out.draft);
    /* say so at once when drafting cannot work, rather than "being drafted" */
    const toast = out.draft && !opts.askQuestions && !process.env.ANTHROPIC_API_KEY ? (out.toast.replace(/ (Questions are being drafted|Drafting questions)[^.]*\./, '').replace(/^Drafting (questions|more questions for each chapter of|the teacher readiness quiz) for [^.]*\. ?((Drafts nobody approved|The chapter papers keep)[^.]*\.)?/, '').replace(/^Drafting more questions for each chapter of [^.]*\. The chapter papers keep[^.]*\./, '') + ' Questions were NOT drafted: AI drafting is not set up on the server (no Anthropic API key). Add the key, restart the app and use Draft questions.').trim() : out.toast;
    res.json({ ok: true, toast, result: out.result, me: describeUser(store, req.user), today: today(), data: snapshot(store, req.user) });
  }));

  app.get('/api/sample-paper', auth, (req, res) => {
    if (!rolesOf(req.store, req.user).includes('acmaker')) return res.status(403).json({ error: 'Not allowed.' });
    res.json(SAMPLE_PAPER);
  });

  /* Reads an uploaded Word question paper and returns the questions found, for the creator to check.
     Nothing is saved until the checked questions are imported. */
  app.post('/api/paper', auth, express.raw({ type: () => true, limit: maxUpload }), (req, res) => {
    if (!rolesOf(req.store, req.user).includes('acmaker')) return res.status(403).json({ error: 'Only the academic content creator imports question papers.' });
    const name = path.basename(decodeURIComponent(String(req.headers['x-filename'] || 'paper.docx'))).slice(0, 200);
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'The file is empty.' });
    if (/\.pdf$/i.test(name)) return res.status(400).json({ error: 'PDF papers cannot be read yet. Save the paper as a Word (.docx) document and upload that.' });
    try { res.json(readPaper(req.body, name)); }
    catch (e) { res.status(400).json({ error: e instanceof PaperError ? e.message : 'The Word file could not be read. Save it again as .docx and try once more.' }); }
  });

  /* Uploads: the browser sends the raw file body with its name in a header.
     Hosted, files go to Vercel Blob; on your own computer, to the data folder. */
  app.post('/api/upload', auth, express.raw({ type: () => true, limit: maxUpload }), h(async (req, res) => {
    if (!rolesOf(req.store, req.user).some(r => ACADEMIC_ROLES.includes(r))) return res.status(403).json({ error: 'Only the academic team uploads files.' });
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
    const units = countUnits(req.body, name); /* pages to read, for training progress */
    await req.store.tx(() => req.store.put('files', { id, name, type, size: req.body.length, url, ...(units ? { units } : {}), by: req.user.id, date: today() }));
    res.json({ id, name });
  }));

  /* Files are shown inside the app (its reading page), not offered for download. Only people who can see the
     material may open its file. Files kept in Vercel Blob are passed through, so the reading page can draw them. */
  const fileFor = (req, res) => {
    const store = req.store;
    const f = store.find('files', req.params.id);
    if (!f) { res.status(404).send('Not found'); return null; }
    const m = store.all('materials').find(x => x.fileId === f.id); /* an update waiting for approval is for the academic team only */
    const u = req.user;
    let ok = rolesOf(store, u).some(r => ACADEMIC_ROLES.includes(r)); /* the approver must be able to open a file to review it */
    if (!ok && m) ok = snapshot(store, u).materials.some(x => x.id === m.id);
    if (!ok) { res.status(403).send('Not allowed'); return null; }
    res.setHeader('Cache-Control', 'private, no-store');
    return f;
  };
  app.get('/files/:id', auth, h(async (req, res) => {
    const f = fileFor(req, res); if (!f) return;
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', 'inline');
    if (f.url) return res.end(await loadFile(f));
    res.sendFile(path.join(uploads, f.id));
  }));
  /* a Word file's text, so it can be read on the reading page */
  app.get('/files/:id/text', auth, h(async (req, res) => {
    const f = fileFor(req, res); if (!f) return;
    try { res.json({ paragraphs: docxText(await loadFile(f)) }); }
    catch { res.status(400).json({ error: 'This file cannot be shown as text.' }); }
  }));

  /* PDF.js draws PDF pages inside the reading page, so a syllabus is read in the app, never downloaded */
  app.use('/vendor/pdfjs', express.static(path.join(root, 'node_modules', 'pdfjs-dist', 'build'), { index: false }));
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
