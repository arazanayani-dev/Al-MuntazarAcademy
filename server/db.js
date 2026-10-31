/* Storage. Records are JSON documents grouped into collections. A Store holds them in memory for the
   app's code to read and change synchronously; store.tx() then writes the changes to the database.

   Two databases are supported:
   - SQLite, a file on disk (built into Node). Used when running on your own computer.
   - Postgres (for example Neon). Used when DATABASE_URL or POSTGRES_URL is set, as on Vercel.
     Serverless hosts run many short-lived copies of the app, so each request loads a fresh Store. */
import fs from 'node:fs';
import path from 'node:path';

export const COLLECTIONS = [
  'users', 'authSessions', 'locations', 'courses', 'subjects', 'teachers', 'classes', 'students',
  'sessions', 'results', 'exams', 'questions', 'traditions', 'calls', 'actions', 'regs',
  'materials', 'shares', 'trainings', 'reading', 'attempts', 'files', 'outbox'
];
/* Written but never read by the app, so not loaded on every request */
const WRITE_ONLY = new Set(['outbox']);

export class Store {
  constructor() { this.clear(); this.depth = 0; }

  clear() {
    this.c = {}; this.idx = {}; this.kv = {}; this.ops = new Map();
    for (const c of COLLECTIONS) { this.c[c] = []; this.idx[c] = new Map(); }
  }
  fill(coll, id, data) {
    if (coll === 'kv') { this.kv[id] = data; return; }
    if (!this.c[coll] || this.idx[coll].has(id)) return;
    this.c[coll].push(data); this.idx[coll].set(id, data);
  }

  isEmpty() { return this.c.users.length === 0; }
  all(c) { return this.c[c]; }
  find(c, id) { return this.idx[c].get(id); }

  put(c, obj) {
    if (!obj.id) throw new Error('Document in ' + c + ' has no id');
    let cur = this.idx[c].get(obj.id);
    if (!cur) { this.c[c].push(obj); this.idx[c].set(obj.id, obj); cur = obj; }
    else if (cur !== obj) { Object.keys(cur).forEach(k => delete cur[k]); Object.assign(cur, obj); }
    this.ops.set(c + '\u0000' + obj.id, { op: 'put', coll: c, id: obj.id, doc: cur });
    return cur;
  }
  del(c, id) {
    const cur = this.idx[c].get(id);
    if (!cur) return;
    this.idx[c].delete(id);
    this.c[c].splice(this.c[c].indexOf(cur), 1);
    this.ops.set(c + '\u0000' + id, { op: 'del', coll: c, id });
  }
  get(key, def) { return key in this.kv ? this.kv[key] : def; }
  set(key, val) { this.kv[key] = val; this.ops.set('kv\u0000' + key, { op: 'put', coll: 'kv', id: key, doc: val }); }

  /* Runs fn (synchronous) and saves what it changed. On any error nothing is saved and memory is reloaded. */
  async tx(fn) {
    if (this.depth) return fn();
    this.depth++;
    try {
      const r = fn();
      const ops = [...this.ops.values()]; this.ops = new Map();
      if (ops.length) await this.write(ops);
      return r;
    } catch (e) {
      this.ops = new Map();
      await this.reload();
      throw e;
    } finally {
      this.depth--;
    }
  }
}

/* ---------- SQLite: one long-lived store for the whole process ---------- */
export class SqliteStore extends Store {
  static async open(file) {
    const { DatabaseSync } = await import('node:sqlite');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const s = new SqliteStore();
    s.db = new DatabaseSync(file);
    s.db.exec('PRAGMA journal_mode=WAL;');
    for (const c of COLLECTIONS) s.db.exec(`CREATE TABLE IF NOT EXISTS "${c}" (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    s.db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, data TEXT NOT NULL)');
    s.stmts = { kv: { put: s.db.prepare('INSERT INTO kv (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data'), del: s.db.prepare('DELETE FROM kv WHERE key = ?') } };
    for (const c of COLLECTIONS) s.stmts[c] = { put: s.db.prepare(`INSERT INTO "${c}" (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`), del: s.db.prepare(`DELETE FROM "${c}" WHERE id = ?`) };
    await s.reload();
    return s;
  }
  async reload() {
    this.clear();
    for (const c of COLLECTIONS) for (const r of this.db.prepare(`SELECT id, data FROM "${c}" ORDER BY rowid`).all()) this.fill(c, r.id, JSON.parse(r.data));
    for (const r of this.db.prepare('SELECT key, data FROM kv').all()) this.fill('kv', r.key, JSON.parse(r.data));
  }
  async write(ops) {
    this.db.exec('BEGIN');
    try {
      for (const o of ops) o.op === 'put' ? this.stmts[o.coll].put.run(o.id, JSON.stringify(o.doc)) : this.stmts[o.coll].del.run(o.id);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}

/* ---------- Postgres: one table of documents; a fresh store per request ---------- */
export class PgStore extends Store {
  static async connect(url) {
    const { default: pg } = await import('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, ssl: local || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS docs (
      seq BIGSERIAL, coll TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (coll, id))`);
    return pool;
  }
  static async open(pool) {
    const s = new PgStore(); s.pool = pool; await s.reload(); return s;
  }
  async reload() {
    this.clear();
    const { rows } = await this.pool.query('SELECT coll, id, data FROM docs WHERE coll <> ALL($1) ORDER BY seq', [[...WRITE_ONLY]]);
    for (const r of rows) this.fill(r.coll, r.id, r.data);
  }
  async write(ops) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const puts = ops.filter(o => o.op === 'put'), dels = ops.filter(o => o.op === 'del');
      for (let i = 0; i < puts.length; i += 1000) {
        const b = puts.slice(i, i + 1000);
        await client.query(`INSERT INTO docs (coll, id, data) SELECT * FROM unnest($1::text[], $2::text[], $3::jsonb[])
          ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data`, [b.map(o => o.coll), b.map(o => o.id), b.map(o => JSON.stringify(o.doc))]);
      }
      if (dels.length) await client.query('DELETE FROM docs WHERE (coll, id) IN (SELECT * FROM unnest($1::text[], $2::text[]))', [dels.map(o => o.coll), dels.map(o => o.id)]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  /* Runs fn while holding a database-wide lock, so two starting copies of the app don't both load sample data */
  static async withLock(pool, fn) {
    const client = await pool.connect();
    try { await client.query('SELECT pg_advisory_lock(424242)'); return await fn(); }
    finally { await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {}); client.release(); }
  }
}

export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
