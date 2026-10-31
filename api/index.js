/* Vercel runs the whole app as this one function; vercel.json sends every request that is not a static file here. */
import { createApp } from '../server/index.js';

export default await createApp();
