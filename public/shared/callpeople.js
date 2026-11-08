/* Who is on a location's weekly call: the people running it (primary, secondary, coordinator, chosen from the
   students) always, then the participants added. Each person once, with the post they hold if any. */
const POSTS = [['primary', 'Primary responsible'], ['secondary', 'Secondary responsible'], ['coordinator', 'Coordinator']];

export function callPeople(l) {
  const out = []; const seen = new Set();
  for (const [k, post] of POSTS) { const sid = l[k + 'Sid']; if (sid && !seen.has(sid)) { seen.add(sid); out.push({ sid, name: l[k], post }); } }
  for (const p of l.participants || []) if (!seen.has(p.sid)) { seen.add(p.sid); out.push({ sid: p.sid, name: p.name }); }
  return out;
}

/* A call's time in minutes from its text ("8:00 PM", "20:00"), or null when it cannot be read. */
export function callMinutes(t) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?\s*$/i.exec(t || '') || /^\s*(\d{1,2}):(\d{2})\s*$/.exec(t || '');
  if (!m) return null;
  let h = +m[1]; if (m[3]) h = h % 12 + (/p/i.test(m[3]) ? 12 : 0);
  return h * 60 + +(m[2] || 0);
}
/* Calls clash on the same day within an hour of each other (calls have no set length; an hour is assumed). */
export function callsClash(a, b) {
  if (a.callDay !== b.callDay) return false;
  const x = callMinutes(a.callTime), y = callMinutes(b.callTime);
  return x != null && y != null ? Math.abs(x - y) < 60 : String(a.callTime || '').trim().toLowerCase() === String(b.callTime || '').trim().toLowerCase();
}
/* The names of the other calls in use that clash with location l's and that this person is on. */
export const clashesOf = (locations, l, sid) => locations.filter(o => o.code !== l.code && !o.disabled && callsClash(l, o) && callPeople(o).some(p => p.sid === sid)).map(o => o.name);
