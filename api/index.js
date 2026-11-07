/* Vercel runs the whole app as this one function; vercel.json sends every request that is not a static file here.
   The app starts on the first request. If it cannot start (for example the database is unreachable),
   pages still load and show the reason, API requests get it as an error, and the next request tries again. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.js';

const indexHtml = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html');
let starting = null;

export default async function handler(req, res) {
  try {
    if (!starting) starting = createApp().catch(e => { starting = null; throw e; });
    const app = await starting;
    return app(req, res);
  } catch (e) {
    console.error('Could not start the app:', e);
    if (req.method === 'GET' && !/^\/(api|files)\//.test(req.url)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(fs.readFileSync(indexHtml));
    }
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The app could not start: ' + (e && e.message || e) + '. Check the database settings in Vercel, then redeploy.' }));
  }
}
