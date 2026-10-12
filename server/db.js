/* SQLite-backed store. Each collection is a table of JSON documents keyed by id,
   loaded into memory at start-up and written through on every change. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const COLLECTIONS = [
  'users', 'authSessions', 'locations', 'courses', 'subjects', 'teachers', 'classes', 'students',
  'sessions', 'results', 'exams', 'questions', 'traditions', 'calls', 'actions', 'regs',
  'materials', 'shares', 'trainings', 'reading', 'attempts', 'files', 'outbox'
];

export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    for (const c of COLLECTIONS) this.db.exec(`CREATE TABLE IF NOT EXISTS "${c}" (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, data TEXT NOT NULL)');
    this.stmts = {};
    for (const c of COLLECTIONS) {
      this.stmts[c] = {
        put: this.db.prepare(`INSERT INTO "${c}" (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`),
        del: this.db.prepare(`DELETE FROM "${c}" WHERE id = ?`)
      };
    }
    this.kvPut = this.db.prepare('INSERT INTO kv (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data');
    this.depth = 0;
    this.load();
  }

  load() {
    this.c = {};
    this.idx = {};
    for (const c of COLLECTIONS) {
      const rows = this.db.prepare(`SELECT data FROM "${c}" ORDER BY rowid`).all();
      this.c[c] = rows.map(r => JSON.parse(r.data));
      this.idx[c] = new Map(this.c[c].map(o => [o.id, o]));
    }
    this.kv = {};
    for (const r of this.db.prepare('SELECT key, data FROM kv').all()) this.kv[r.key] = JSON.parse(r.data);
  }

  isEmpty() { return this.c.users.length === 0; }
  all(c) { return this.c[c]; }
  find(c, id) { return this.idx[c].get(id); }

  put(c, obj) {
    if (!obj.id) throw new Error('Document in ' + c + ' has no id');
    const cur = this.idx[c].get(obj.id);
    if (!cur) { this.c[c].push(obj); this.idx[c].set(obj.id, obj); }
    else if (cur !== obj) { Object.keys(cur).forEach(k => delete cur[k]); Object.assign(cur, obj); }
    this.stmts[c].put.run(obj.id, JSON.stringify(cur || obj));
    return cur || obj;
  }

  del(c, id) {
    const cur = this.idx[c].get(id);
    if (!cur) return;
    this.idx[c].delete(id);
    this.c[c].splice(this.c[c].indexOf(cur), 1);
    this.stmts[c].del.run(id);
  }

  get(key, def) { return key in this.kv ? this.kv[key] : def; }
  set(key, val) { this.kv[key] = val; this.kvPut.run(key, JSON.stringify(val)); }

  /* Runs fn in a transaction; on any error the database rolls back and memory is reloaded from it. */
  tx(fn) {
    if (this.depth) return fn();
    this.depth++;
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.load();
      throw e;
    } finally {
      this.depth--;
    }
  }
}
