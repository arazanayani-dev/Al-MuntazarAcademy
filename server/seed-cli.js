/* npm run seed -- --reset : wipes the database and loads the sample data again. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db.js';
import { seed } from './seed.js';
import { todayIso } from './index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const file = path.join(dataDir, 'academy.db');

if (process.argv.includes('--reset')) for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
const store = new Store(file);
if (!store.isEmpty()) {
  console.log('The database already has data. Run with --reset to wipe it and load the sample data again.');
  process.exit(1);
}
seed(store, todayIso(), process.env.SEED_PASSWORD || 'almuntazar123');
console.log('Sample data loaded into ' + file);
