/* Teacher: home, classes, materials, training and profile. Shared cards for the next class and the lesson are here too. */
import { S, TODAY, ME } from '../state.js';
import { fd, fdl, addDays } from '/shared/dates.js';
import { esc, chip, pct, act, pageHead } from '../ui.js';
import {
  course, classStudents, classAtt, weeksDone, weekLabel, courseLabel, group, topicOf, lesson, nextDate, whenFor, stuStats,
  semResult, best, subName, readAlert, classReading, lastWeek, TG, canSee, matScope, sharesOf, scopes, invited, trWhen, ACCESS,
  myTeacher, matHref
} from '../logic.js';

const meetBtn = c => c.meet
  ? '<a class="btn primary wide" href="' + esc(c.meet) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none">Join Meet</a>'
  : act('toast', 'No Meet link is set for this class yet.', 'Join Meet', 'btn primary wide');

export function nextCard(c, off, place, extra) {
  const d = nextDate(c); const w = whenFor(c, d, off);
  return '<section class="card"><div class="eyebrow">Next class</div><div><div class="b" style="font-size:20px">' + fdl(w.date) + ' · ' + w.time + '</div><div class="sub small">Your time (' + esc(place) + ')</div></div>' + extra + meetBtn(c) + '</section>';
}
export function lessonCard(c, week, title) {
  const k = course(c.course); if (week > k.weeks) return '<section class="card"><div class="eyebrow">' + title + '</div><p>All ' + k.weeks + ' sessions are complete. The next step is the exam.</p></section>';
  const l = lesson(c, week); const m = s => (S.subjects.find(x => x.key === s) || {}).min;
  return '<section class="card"><div class="eyebrow">' + title + '</div><div class="lesson">' +
    '<div class="min">' + (m('q') || 5) + ' min</div><div><div class="b">Quran recitation</div><div class="sub small">' + esc(l.q) + '</div></div>' +
    '<div class="min">' + (m('b') || 30) + ' min</div><div><div class="b">Belief</div><div class="sub small">' + esc(l.b) + '</div></div>' +
    '<div class="min">' + (m('l') || 15) + ' min</div><div><div class="b">Islamic Laws</div><div class="sub small">' + esc(l.l) + '</div></div>' +
    '<div class="min">' + (m('e') || 10) + ' min</div><div><div class="b">Ethics</div><div class="sub small">' + esc(l.e) + '</div></div></div></section>';
}
const openBtn = m => { const h = matHref(m); return h ? '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(h) + '" target="_blank" rel="noopener">Open</a>' : act('toast', 'This item has no file attached yet: ' + m.src, 'Open'); };

function teacherMaterialsCard() {
  const t = myTeacher(); const list = S.materials.filter(m => canSee(t, m)); const mine = scopes(t.id);
  return '<section class="card"><div class="card-h"><div class="eyebrow">Materials</div>' + chip('mute', 'Access: ' + ACCESS[t.access]) + '</div><div class="rows">' +
    (list.map(m => {
      const sh = sharesOf(m.id).filter(s => mine.some(x => x.cid === s.cid));
      return '<div class="row"><div><div class="b">' + esc(m.title) + '</div><div class="sub small">' + esc(matScope(m)) + '</div>' +
        (sh.length ? '<div class="small" style="color:var(--ok-ink)">Shared with ' + sh.map(s => s.cid + ' on ' + fd(s.date)).join(', ') + '</div>' : '') + '</div>' +
        '<div class="btns">' + openBtn(m) + (!m.share ? chip('gold', 'Teachers only') : mine.some(c => m.course === 'ALL' || (c.course === m.course && (!m.sem || c.sem === m.sem))) ? act('shareOpen', m.id, 'Share with class', 'btn primary') : chip('mute', 'Not for your current classes')) + '</div></div>';
    }).join('') || '<p class="empty">No material is available for your classes yet.</p>') + '</div></section>';
}
function lessonMaterial(c, week) {
  const t = myTeacher(); const ms = S.materials.filter(m => m.course === c.course && m.sem === c.sem && m.week === week && canSee(t, m));
  return ms.length ? '<section class="card"><div class="eyebrow">Material for this lesson</div><div class="rows">' + ms.map(m => '<div class="row"><div><div class="b">' + esc(m.title) + '</div></div>' + (m.share ? act('shareOpen', m.id, 'Share with class', 'btn primary') : openBtn(m)) + '</div>').join('') + '</div></section>' : '';
}
function teacherTrainingCard() {
  const tid = ME.teacherId;
  const list = S.trainings.filter(tr => tr.date >= TODAY && invited(tid, tr)).sort((a, b) => a.date < b.date ? -1 : 1); const done = S.trainings.filter(tr => tr.attended && tr.attended[tid]);
  return '<section class="card"><div class="eyebrow">Training</div><div class="rows">' + (list.map(tr => {
    const r = tr.rsvp[tid]; const link = /^https?:\/\//.test(tr.mode) ? tr.mode : '';
    return '<div class="row"><div><div class="b">' + esc(tr.title) + '</div><div class="sub small">' + trWhen(tr) + ' · ' + esc(tr.facilitator) + '</div><div class="btns" style="margin-top:6px">' + (tr.req ? chip('gold', 'Required') : chip('mute', 'Optional')) + (r === 'yes' ? chip('ok', 'You are attending') : r === 'no' ? chip('warn', 'Not attending') : '') + '</div></div>' +
      '<div class="btns">' + (r === 'yes' ? (link ? '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(link) + '" target="_blank" rel="noopener">Join</a>' : '') : act('rsvp', tr.id + '|yes', 'Attending', 'btn primary')) + (r !== 'no' ? act('rsvp', tr.id + '|no', "Can't attend") : '') + '</div></div>';
  }).join('') || '<p class="empty">No training scheduled for you.</p>') + '</div>' +
    (done.length ? '<p class="sub small">Completed: ' + done.map(d => esc(d.title) + ' (' + fd(d.date) + ')').join(', ') + '</p>' : '') + '</section>';
}
function teacherReadingCard(mine) {
  const lw = lastWeek(); mine = mine.filter(c => c.course !== 'INR'); if (!mine.length) return '';
  return '<section class="card"><div class="card-h"><div class="eyebrow">Weekly reading</div>' + chip('mute', 'Week of ' + fd(lw)) + '</div><div class="rows">' + mine.map(c => {
    const r = classReading(c, lw);
    return '<div class="row"><div><div class="b">' + c.id + '</div><div class="sub small">' + (r.logged ? 'Logged by ' + r.logged + ' of ' + r.n + ' · both targets met by ' + r.met + ' · average ' + r.ayat + ' ayat and ' + r.pages + ' pages' : 'No entries yet') + '</div></div>' + act('openClass', c.id, 'Students') + '</div>';
  }).join('') + '</div>' +
    '<p class="sub small">Students log their own reading each week. Targets are ' + TG().ayat + ' ayat and ' + TG().pages + ' pages, set by the academic team.</p></section>';
}
function teacherData() {
  const mine = S.classes.filter(c => c.teacherId === ME.teacherId && c.status === 'active'); const next = mine.slice().sort((a, b) => nextDate(a) < nextDate(b) ? -1 : 1)[0];
  const tolog = S.sessions.filter(x => x.held && !x.logged && mine.some(c => c.id === x.classId)).sort((a, b) => a.date < b.date ? -1 : 1);
  const attn = []; mine.forEach(c => classStudents(c.id).forEach(s => {
    const st = stuStats(s);
    if (st.status === 'risk') attn.push('<div class="row"><div><div class="b">' + esc(s.name) + '</div><div class="small warn-t">Absent ' + st.miss + ' sessions running · ' + c.id + '</div></div></div>');
    if (st.status === 'followup') attn.push('<div class="row"><div><div class="b">' + esc(s.name) + '</div><div class="small warn-t">Absent ' + st.miss + ' sessions running · escalated to the location admins · ' + c.id + '</div></div></div>');
    for (let sem = 1; sem <= c.sem; sem++) if (S.published[c.id + '|' + sem] && semResult(s.id, c.course, sem) === 'fail') { const f = ['b', 'l', 'e'].filter(k => best(s.id, c.course, sem, k) < 50).map(subName).join(', '); attn.push('<div class="row"><div><div class="b">' + esc(s.name) + '</div><div class="small gold-t">Re-exam due: ' + esc(f) + ', Semester ' + sem + ' · ' + c.id + '</div></div></div>'); }
  }));
  mine.forEach(c => {
    const list = classStudents(c.id).filter(s => { const st = stuStats(s).status; return st !== 'risk' && st !== 'followup' && readAlert(s); });
    if (list.length) attn.push('<div class="row"><div><div class="b">Reading: ' + list.length + (list.length === 1 ? ' student' : ' students') + ' below target or not logged for 2 weeks</div><div class="small gold-t">' + list.map(s => esc(s.name)).join(', ') + ' · ' + c.id + '</div></div>' + act('openClass', c.id, 'See figures') + '</div>');
  });
  return { mine, next, tolog, attn };
}

export function viewTeacherHome() {
  const d = teacherData(); const next = d.next; const t = myTeacher();
  const req = S.trainings.filter(tr => tr.req && tr.date >= TODAY && invited(ME.teacherId, tr) && tr.rsvp[ME.teacherId] !== 'yes').sort((a, b) => a.date < b.date ? -1 : 1)[0];
  return '<div><div class="sub">Salaamun alaykum</div><h1>' + esc(ME.name) + '</h1></div>' +
    (req ? '<section class="card" style="background:var(--gold-tint);border-color:var(--gold-ink)"><div class="eyebrow" style="color:var(--gold-ink)">Required training</div><div class="row" style="border-top:0;padding:0"><div><div class="b">' + esc(req.title) + '</div><div class="small gold-t">' + trWhen(req) + ' · not replied yet</div></div>' + act('nav', 'training', 'Open Training', 'btn primary') + '</div></section>' : '') +
    (next ? nextCard(next, t.tzOff ?? 5.5, t.tzName || 'India', '<div class="btns">' + chip('ok', next.id) + chip('ok', courseLabel(next) + ' · ' + group(next.g)) + '</div><div>' + esc(topicOf(next)) + ' · ' + weekLabel(next, Math.min(weeksDone(next.id) + 1, course(next.course).weeks)) + '</div>') +
      lessonCard(next, weeksDone(next.id) + 1, "This week's lesson") + lessonMaterial(next, weeksDone(next.id) + 1) : '<section class="card"><p class="empty">You have no active classes yet.</p></section>') +
    '<section class="card"><div class="card-h"><div class="eyebrow">To log</div>' + (d.tolog.length ? chip('warn', d.tolog.length + ' waiting') : chip('ok', 'All logged')) + '</div><div class="rows">' +
      (d.tolog.map(x => '<div class="row"><div><div class="b">' + x.classId + ' · Week ' + x.week + '</div><div class="sub small">' + fdl(x.date) + ' · not logged yet</div></div>' + act('logOpen', x.id, 'Log now', 'btn primary') + '</div>').join('') || '<p class="empty">Every session is logged.</p>') + '</div></section>' +
    '<section class="card"><div class="eyebrow">Students needing attention</div><div class="rows">' + (d.attn.join('') || '<p class="empty">Nobody needs follow-up.</p>') + '</div></section>' +
    '<section class="card"><div class="eyebrow">Notices</div><div><div class="b">From coordination</div><div class="sub">Please log each session within two days of the class.</div></div></section>';
}
export function viewTeacherClasses() {
  const d = teacherData();
  return pageHead('My classes', d.mine.length + (d.mine.length === 1 ? ' class' : ' classes')) +
    '<section class="card"><div class="eyebrow">Classes</div><div class="rows">' + (d.mine.map(c => { const w = weeksDone(c.id); const k = course(c.course); return '<div class="row"><div><div class="b">' + act('openClass', c.id, c.id, 'link') + '</div><div class="sub small">' + classStudents(c.id).length + ' students · ' + pct(classAtt(c.id, addDays(TODAY, -28))) + ' attendance, last 4 weeks</div><div class="meter" aria-hidden="true"><i style="width:' + Math.round(w / k.weeks * 100) + '%"></i></div><div class="small">Syllabus chart: ' + (w ? weekLabel(c, w) : 'Not started') + '</div></div></div>'; }).join('') || '<p class="empty">No classes yet.</p>') + '</div></section>' +
    '<section class="card"><div class="eyebrow">Exams and results</div><div class="rows">' + d.mine.map(c => {
      const ex = S.exams.filter(e => e.course === c.course && e.sem === c.sem); const open = ex.some(e => e.open); const ids = classStudents(c.id).map(s => s.id);
      const n = ex.map(e => S.results.filter(r => ids.includes(r.sid) && r.course === e.course && r.sem === e.sem && r.sub === e.sub).length);
      return '<div class="row"><div><div class="b">' + c.id + ' · Semester ' + c.sem + ' exams</div><div class="sub small">' + (ex.length ? (open ? 'Open now · taken so far: ' + ex.map((e, i) => subName(e.sub) + ' ' + n[i]).join(', ') : 'Window opens ' + fd(ex[0].from) + ', closes ' + fd(ex[0].to)) : 'Not scheduled yet') + '</div></div></div>' +
        (c.sem > 1 ? '<div class="row"><div><div class="b">' + c.id + ' · Semester ' + (c.sem - 1) + ' marksheet</div></div>' + act('marks', c.id + '|' + (c.sem - 1), 'View') + '</div>' : '');
    }).join('') + '</div></section>' + teacherReadingCard(d.mine);
}
export function viewTeacherMaterials() { return pageHead('Materials', 'From the academy library, by your access level') + teacherMaterialsCard(); }
export function viewTeacherTraining() { return pageHead('Training', 'Programmes and refreshers from the academic team') + teacherTrainingCard(); }
export function viewTeacherProfile() {
  const t = myTeacher(); const mine = S.classes.filter(c => c.teacherId === t.id);
  const past = S.trainings.filter(tr => tr.date < TODAY && invited(t.id, tr)); const att = past.filter(tr => tr.attended && tr.attended[t.id]);
  const reqPast = past.filter(tr => tr.req); const reqAtt = reqPast.filter(tr => tr.attended && tr.attended[t.id]);
  const r = (l, v) => '<div class="row"><div class="sub">' + l + '</div><div class="b">' + v + '</div></div>';
  const locs = [...new Set(mine.map(c => c.loc))].map(code => (S.locations.find(l => l.code === code) || {}).name || code).join(', ');
  return pageHead(esc(ME.name), 'Teacher' + (locs ? ' · ' + esc(locs) : '')) +
    '<section class="card"><div class="eyebrow">Details</div><div class="rows">' + r('Location', esc(locs || 'Not assigned yet')) + r('Teaches', group(t.g)) + r('Classes', mine.map(c => c.id).join(', ') || 'None yet') + r('Time zone', esc(t.tzName || 'India')) + r('Material access', esc(ACCESS[t.access])) + '</div><p class="sub small">Access is set by the academic team or the super admin.</p></section>' +
    '<section class="card"><div class="eyebrow">Training record</div><div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><div class="t-v">' + att.length + ' of ' + past.length + '</div><div class="t-s">Programmes attended</div></div><div><div class="t-v">' + reqAtt.length + ' of ' + reqPast.length + '</div><div class="t-s">Required refreshers attended</div></div></div>' +
      '<p class="sub small">This record counts in the teacher performance report.</p></section>' +
    '<section class="card"><div class="eyebrow">Account</div><div class="btns">' + act('pwOpen', '', 'Change password') + '</div></section>';
}
