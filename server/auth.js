/* Password hashing with scrypt and cookie sessions stored in the database. */
import crypto from 'node:crypto';

const COOKIE = 'amsid';
const DAYS = 30;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

export function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const got = crypto.scryptSync(String(pw), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

export function createSession(store, user, res, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + DAYS * 864e5;
  store.tx(() => store.put('authSessions', { id: token, userId: user.id, expires }));
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure ? '; Secure' : ''}`);
}

export function destroySession(store, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token && store.find('authSessions', token)) store.tx(() => store.del('authSessions', token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function currentUser(store, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = store.find('authSessions', token);
  if (!s) return null;
  if (s.expires < Date.now()) { store.tx(() => store.del('authSessions', token)); return null; }
  const u = store.find('users', s.userId);
  return u && !u.disabled ? u : null;
}
