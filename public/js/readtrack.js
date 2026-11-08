/* Keeps the reading record for a syllabus a teacher must be ready to teach (see server/readiness.js). Each
   second, the page (or Word section) under the middle of the screen gets the time, but only while the tab is
   visible and the reader has scrolled, moved or typed in the last two minutes. The seconds are sent every 15
   seconds and when the reading page is left. Each page shows a marker ("12 s of 30", or "Read") and the
   reading bar has a button to jump to the next page still to read. */
const IDLE_MS = 120000, SEND_MS = 15000;
/* { mid, el, need: seconds a page needs (from the server), secs: { unit: seconds so far }, acc: { unit: seconds not yet sent }, active, tick, send } */
let cur = null;

export function trackReading(el) {
  const mid = el.dataset.track;
  if (cur && cur.mid === mid) { cur.el = el; paint(); return; }
  stop();
  let secs = {}; try { secs = JSON.parse(el.dataset.secs || '{}'); } catch { /* none yet */ }
  cur = { mid, el, need: +el.dataset.need || 30, secs, acc: {}, active: Date.now() };
  cur.tick = setInterval(tick, 1000); cur.send = setInterval(send, SEND_MS);
  paint();
}

const bump = () => { if (cur) cur.active = Date.now(); };
['scroll', 'wheel', 'mousemove', 'keydown', 'touchstart', 'pointerdown'].forEach(e => addEventListener(e, bump, { passive: true }));
addEventListener('pagehide', () => send());
/* "Next unread page": the first page after the one on screen (or from the start) with less than 30 seconds */
addEventListener('click', ev => {
  if (!cur || !ev.target.closest || !ev.target.closest('#read-next')) return;
  const units = [...cur.el.querySelectorAll('[data-unit]')]; const here = units.indexOf(atMiddle());
  const todo = u => (cur.secs[u.dataset.unit] || 0) < cur.need;
  const next = units.slice(here + 1).find(todo) || units.find(todo);
  if (next) { next.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); bump(); }
});

/* the page under the middle of the screen; a video or picture is a single unit, counted while it is open */
function atMiddle() {
  const units = cur.el.querySelectorAll('[data-unit]'); if (units.length === 1) return units[0];
  const y = innerHeight / 2;
  for (const u of units) { const r = u.getBoundingClientRect(); if (r.top <= y && r.bottom >= y) return u; }
  return null;
}

function mark(u) {
  const s = cur.secs[u.dataset.unit] || 0; const video = cur.need > 30;
  if (s >= cur.need) { u.dataset.mark = video ? '✓ Watched' : '✓ Read'; u.dataset.markDone = '1'; }
  else { u.dataset.mark = s ? s + ' s of ' + cur.need : video ? 'Not watched yet' : 'Not read yet'; delete u.dataset.markDone; }
}
/* markers on every page; done again when the page has been redrawn */
function paint() { cur.el.querySelectorAll('[data-unit]').forEach(mark); }

function tick() {
  if (!cur) return;
  if (!document.body.contains(cur.el)) {
    /* the page was redrawn: find the reader again, or stop if it has been left */
    const el = document.querySelector('[data-track="' + cur.mid + '"]'); if (!el) { stop(); return; } cur.el = el; paint();
  }
  if (cur.el.querySelector('[data-unit]:not([data-mark])')) paint(); /* PDF pages appear once the file has loaded */
  if (document.hidden || Date.now() - cur.active > IDLE_MS) return;
  const u = atMiddle(); if (!u) return;
  const n = u.dataset.unit; cur.acc[n] = (cur.acc[n] || 0) + 1; cur.secs[n] = (cur.secs[n] || 0) + 1;
  mark(u); if (cur.secs[n] === cur.need) local();
}

async function send() {
  if (!cur || !Object.keys(cur.acc).length) return;
  const units = cur.acc; cur.acc = {}; const total = cur.el.querySelectorAll('[data-unit]').length; const c = cur;
  try {
    const r = await fetch('/api/action/readTrack', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid: c.mid, units, total, as: 'teacher' }) });
    const j = await r.json(); if (!j.result) return;
    /* the saved record is the truth; keep any seconds counted here since it was sent */
    if (cur === c && j.result.pages) { for (const [n, s] of Object.entries(j.result.pages)) c.secs[n] = Math.max(c.secs[n] || 0, s); paint(); }
    show(j.result);
  } catch { /* offline: these seconds are lost, which only makes the record stricter */ }
}

/* sends what is left and stops; resolves once it is saved */
export function stopReading() { return stop(); }
function stop() {
  if (!cur) return Promise.resolve();
  const done = send(); clearInterval(cur.tick); clearInterval(cur.send); cur = null; return done;
}

/* the reading bar: from the saved record (which also says what is left of the training), or counted here between reports */
function show(p) {
  const el = document.getElementById('read-progress'); if (!el) return;
  const video = p.need > 30;
  el.textContent = 'Training record: ' + (p.done
    ? (video ? 'watched' : 'read in full') + ' (' + p.mins + ' min). ' + (p.allDone ? 'The whole training is done: the readiness quiz is open on your Training page.' : p.left != null ? p.left + ' more training ' + (p.left === 1 ? 'item' : 'items') + ' on your Training page.' : '')
    : p.units > 1 ? p.read + ' of ' + p.units + ' pages read · ' + p.mins + ' min so far' : Math.min(p.secs || 0, p.need) + ' of ' + p.need + ' seconds');
  const b = document.getElementById('read-next'); if (b && p.done) b.remove();
}
function local() {
  const all = [...cur.el.querySelectorAll('[data-unit]')]; const read = all.filter(u => (cur.secs[u.dataset.unit] || 0) >= cur.need).length;
  const secs = Object.values(cur.secs).reduce((a, s) => a + s, 0);
  show({ read, units: all.length, need: cur.need, secs, mins: Math.round(secs / 60), done: read >= all.length });
}
