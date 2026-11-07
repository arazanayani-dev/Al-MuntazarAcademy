/* Uploaded files live in the data folder on your own computer, or in Vercel Blob when hosted (f.url).
   Code that reads a file's contents asks here. Actions run synchronously, so the server loads the files an
   action may read beforehand (loadFile) and the action then reads them from memory (fileBytes). */
import fs from 'node:fs';
import path from 'node:path';

let uploads = null;
export function configureFiles(o) { uploads = o.uploads; }

const cache = new Map(); /* id -> Buffer, a few recent files only */
const remember = (id, buf) => { cache.delete(id); cache.set(id, buf); while (cache.size > 8) cache.delete(cache.keys().next().value); return buf; };

export async function loadFile(f) {
  if (!f) return null;
  if (cache.has(f.id)) return cache.get(f.id);
  if (f.url) {
    const r = await fetch(f.url);
    if (!r.ok) throw new Error('The file could not be fetched from storage (' + r.status + ').');
    return remember(f.id, Buffer.from(await r.arrayBuffer()));
  }
  return remember(f.id, fs.readFileSync(path.join(uploads, f.id)));
}

/* Synchronous read: from memory if loaded, otherwise from the data folder. Throws when it is not available. */
export function fileBytes(f) {
  if (cache.has(f.id)) return cache.get(f.id);
  if (f.url) throw new Error('File not loaded');
  return fs.readFileSync(path.join(uploads, f.id));
}
