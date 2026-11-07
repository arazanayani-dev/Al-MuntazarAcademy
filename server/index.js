/* HTTP server: JSON API, file uploads and the single-page app. */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db.js';
import { seed } from './seed.js';
import { currentUser, createSession, destroySession, verifyPassword } from './auth.js';
import { snapshot } from './snapshot.js';
import { runAction, ensureSessions, UserError, SAMPLE_PAPER, configure } from './actions.js';
import { describeUser, ACADEMIC_ROLES, rolesOf } from './access.js';
import { readPaper, PaperError, docxText } from './docx.js';
import { draftQuestions } from './qgen.js';
import { configureReadiness } from './readiness.js';
import Anthropic from '@anthropic-ai/sdk';
import { suggestTasks, TRANSCRIPT_MAX } from './tasks.js';

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
  configure({ uploads }); configureReadiness({ uploads });
  const today = opts.today || todayIso;

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
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); /* the app's own pages may show its files in a frame */
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
    res.json({ today: today(), signedIn: !!currentUser(store, req) });
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

  /* question drafting runs in the background after a syllabus is saved; one run per material at a time */
  const drafting = new Set();
  const startDrafting = mid => {
    if (drafting.has(mid)) return; drafting.add(mid);
    draftQuestions(store, uploads, mid, opts.askQuestions).catch(e => console.error('Question drafting failed:', e)).finally(() => drafting.delete(mid));
  };
  app.locals.drafting = drafting;

  /* Suggested action items from a meeting's pasted transcript. It waits for Claude, so it is not an action (actions
     run in one quick transaction). Nothing is saved here. */
  app.post('/api/transcript', auth, async (req, res) => {
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

  app.post('/api/action/:name', auth, (req, res) => {
    try {
      const out = runAction(store, req.user, today(), req.params.name, req.body);
      /* frequent background reports (reading progress) get a short reply, without the whole data set */
      if (out.quiet) return res.json({ ok: true, result: out.result });
      if (out.draft) startDrafting(out.draft);
      /* say so at once when drafting cannot work, rather than "being drafted" */
      const toast = out.draft && !opts.askQuestions && !process.env.ANTHROPIC_API_KEY ? (out.toast.replace(/ (Questions are being drafted|Drafting questions)[^.]*\./, '').replace(/^Drafting (questions|more questions for each chapter of|the teacher readiness quiz) for [^.]*\. ?((Drafts nobody approved|The chapter papers keep)[^.]*\.)?/, '').replace(/^Drafting more questions for each chapter of [^.]*\. The chapter papers keep[^.]*\./, '') + ' Questions were NOT drafted: AI drafting is not set up on the server (no Anthropic API key). Add the key, restart the app and use Draft questions.').trim() : out.toast;
      res.json({ ok: true, toast, result: out.result, me: describeUser(store, req.user), today: today(), data: snapshot(store, req.user) });
    } catch (e) {
      if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Something went wrong. Nothing was saved.' });
    }
  });

  app.get('/api/sample-paper', auth, (req, res) => {
    if (!rolesOf(store, req.user).includes('acmaker')) return res.status(403).json({ error: 'Not allowed.' });
    res.json(SAMPLE_PAPER);
  });

  /* Reads an uploaded Word question paper and returns the questions found, for the creator to check.
     Nothing is saved until the checked questions are imported. */
  app.post('/api/paper', auth, express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
    if (!rolesOf(store, req.user).includes('acmaker')) return res.status(403).json({ error: 'Only the academic content creator imports question papers.' });
    const name = path.basename(decodeURIComponent(String(req.headers['x-filename'] || 'paper.docx'))).slice(0, 200);
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'The file is empty.' });
    if (/\.pdf$/i.test(name)) return res.status(400).json({ error: 'PDF papers cannot be read yet. Save the paper as a Word (.docx) document and upload that.' });
    try { res.json(readPaper(req.body, name)); }
    catch (e) { res.status(400).json({ error: e instanceof PaperError ? e.message : 'The Word file could not be read. Save it again as .docx and try once more.' }); }
  });

  /* Uploads: the browser sends the raw file body with its name in a header. */
  app.post('/api/upload', auth, express.raw({ type: () => true, limit: '50mb' }), (req, res) => {
    if (!rolesOf(store, req.user).some(r => ACADEMIC_ROLES.includes(r))) return res.status(403).json({ error: 'Only the academic team uploads files.' });
    const name = path.basename(decodeURIComponent(String(req.headers['x-filename'] || 'file'))).slice(0, 200) || 'file';
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'The file is empty.' });
    const id = 'f' + crypto.randomBytes(12).toString('hex');
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, id), req.body);
    store.tx(() => store.put('files', { id, name, type: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100), size: req.body.length, by: req.user.id, date: today() }));
    res.json({ id, name });
  });

  /* Files are shown inside the app (its reading page), not offered for download. Only people who can see the
     material may open its file. */
  const fileFor = (req, res) => {
    const f = store.find('files', req.params.id);
    if (!f) { res.status(404).send('Not found'); return null; }
    const m = store.all('materials').find(x => x.fileId === f.id);
    const u = req.user;
    let ok = rolesOf(store, u).some(r => ACADEMIC_ROLES.includes(r)); /* the approver must be able to open a file to review it */
    if (!ok && m) ok = snapshot(store, u).materials.some(x => x.id === m.id);
    if (!ok) { res.status(403).send('Not allowed'); return null; }
    res.setHeader('Cache-Control', 'private, no-store');
    return f;
  };
  app.get('/files/:id', auth, (req, res) => {
    const f = fileFor(req, res); if (!f) return;
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(path.join(uploads, f.id));
  });
  /* a Word file's text, so it can be read on the reading page */
  app.get('/files/:id/text', auth, (req, res) => {
    const f = fileFor(req, res); if (!f) return;
    try { res.json({ paragraphs: docxText(fs.readFileSync(path.join(uploads, f.id))) }); }
    catch { res.status(400).json({ error: 'This file cannot be shown as text.' }); }
  });

  app.use('/shared', express.static(path.join(root, 'shared')));
  /* PDF.js draws PDF pages inside the reading page, so a syllabus is read in the app, never downloaded */
  app.use('/vendor/pdfjs', express.static(path.join(root, 'node_modules', 'pdfjs-dist', 'build'), { index: false }));
  app.use(express.static(path.join(root, 'public')));
  app.get(/^\/(?!api\/|files\/).*/, (req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

  app.locals.store = store;
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 3000;
  createApp().listen(port, () => console.log('Almuntazar Academy running on http://localhost:' + port));
}
