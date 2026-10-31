/* npm run seed -- --reset : wipes the database and loads the sample data again.
   Works on the local SQLite file, or on Postgres when DATABASE_URL (or POSTGRES_URL) is set. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStore, PgStore, databaseUrl } from './db.js';
import { seed } from './seed.js';
import { todayIso } from './index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const reset = process.argv.includes('--reset');
const password = process.env.SEED_PASSWORD || 'almuntazar123';
const url = databaseUrl();
let store, pool, where;

if (url) {
  pool = await PgStore.connect(url);
  if (reset) await pool.query('TRUNCATE docs');
  store = await PgStore.open(pool);
  where = 'Postgres';
} else {
  const file = path.join(process.env.DATA_DIR || path.join(root, 'data'), 'academy.db');
  if (reset) for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
  store = await SqliteStore.open(file);
  where = file;
}
if (!store.isEmpty()) {
  console.log('The database already has data. Run with --reset to wipe it and load the sample data again.');
  process.exit(1);
}
await seed(store, todayIso(), password);
console.log('Sample data loaded into ' + where);
if (pool) await pool.end();
