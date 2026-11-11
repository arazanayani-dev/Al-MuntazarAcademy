/* Screens reached from several roles: class detail, marksheet, session log and taking an exam. */
import { S, ME, TODAY } from '../state.js';
import { DOW, DOWL, fd, fdl, ft, pd, addDays } from '/shared/dates.js';
import { callPeople, clashesOf } from '/shared/callpeople.js';
import { isAns } from '/shared/scoring.js';
import { esc, chip, tile, pct, opts, act, tbl, tx, stmtList } from '../ui.js';
import {
  cls, stu, course, courseLabel, topicOf, group, teacherName, classStudents, classSessions, classAtt, weeksDone, weekLabel,
  stuStats, statChip, semResult, semReady, ended, examState, examSubs, paperCounts, readKind, matScope, levelRank, best, chaptersFor, markDetail, rd, lastWeek, TG, readAlert, lesson, verseRef, versesBefore, subName, QTYPE
} from '../logic.js';
import { editBtn } from './edit.js';
import { certsFor } from './student.js';
import { readUnits } from '/shared/readunits.js';
import { chapterWindow, chapterState, chapterDue } from '/shared/grading.js';

/* Syllabus readiness (see server/readiness.js): a teacher has gone through the subject's training in the app
   (the syllabus, then its teacher's guides, books and videos) and passed the readiness quiz. */
export const readinessOf = tid => (S.readiness || []).filter(r => r.tid === tid);
export const readyChip = r => r.ready ? chip('ok', 'Ready to teach') : r.readDone ? chip('gold', 'Training done; quiz not passed yet') : chip('warn', 'Not ready: ' + (r.itemsDone ? r.itemsDone + ' of ' + r.items.length + ' items done' : r.mins ? 'training started' : 'not started'));
export const readinessDetail = r => r.itemsDone + ' of ' + r.items.length + ' training items done · ' + r.mins + ' min · quiz ' +
  (r.passedOn ? 'passed with ' + r.best + '% on ' + fd(r.passedOn) : r.tries ? 'last ' + r.lastPct + '% on ' + fd(r.lastOn) + ' (pass mark 80%)' : 'not taken');
/* one training item: pages read, or time watched */
export const itemDetail = i => i.done ? (i.units > 1 ? 'All ' + i.units + ' pages read' : i.need > 30 ? 'Watched' : 'Read') + ' · ' + Math.round(i.secs / 60) + ' min'
  : i.units > 1 ? i.read + ' of ' + i.units + ' pages read · ' + Math.round(i.secs / 60) + ' min' : Math.min(i.secs, i.need) + ' of ' + i.need + ' seconds' + (i.need > 30 ? ' watched' : '');
/* the training item for this material, if the signed-in teacher needs it */
const trainingItem = m => { for (const r of readinessOf(ME.teacherId)) { const i = r.items.find(x => x.mid === m.id && x.fileId === (m.fileId || null)); if (i) return i; } return null; };

/* Every weekly coordination call this person should attend, running it or as a participant, at any location. */
export function myCallsCard() {
  if (!ME.studentId) return '';
  const calls = S.locations.filter(l => !l.disabled).map(l => ({ l, me: callPeople(l).find(p => p.sid === ME.studentId) })).filter(x => x.me).sort((a, b) => (a.me.post ? 0 : 1) - (b.me.post ? 0 : 1) || a.l.name.localeCompare(b.l.name));
  if (!calls.length) return '';
  const next = l => { let d = l.nextCall > TODAY ? l.nextCall : TODAY; while (DOWL[pd(d).getDay()] !== l.callDay) d = addDays(d, 1); return d; };
  return '<section class="card"><div class="card-h"><div class="eyebrow">My weekly calls</div>' + chip('mute', calls.length + (calls.length === 1 ? ' call' : ' calls')) + '</div><div class="rows">' + calls.map(({ l, me }) =>
    '<div class="row"><div><div class="b">' + esc(l.name) + '</div><div class="sub small">Every ' + esc(l.callDay) + ' · ' + esc(l.callTime) + ' · next ' + fd(next(l)) + '</div><div class="btns" style="margin-top:4px">' + chip(me.post ? 'ok' : 'mute', me.post ? me.post : 'Participant') + '</div>' +
      /* two of this person's own calls at the same time */
      (clashesOf(calls.map(x => x.l), l, ME.studentId).length ? '<div class="small warn-t" style="margin-top:4px">Clash: at the same time as the ' + esc(clashesOf(calls.map(x => x.l), l, ME.studentId).join(' and ')) + ' call</div>' : '') + '</div>' +
    (l.meet ? '<a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(l.meet) + '" target="_blank" rel="noopener">Join Meet</a>' : '<span class="sub small">Meet link not set yet</span>') + '</div>').join('') + '</div></section>';
}

/* The class's exam window for its current semester, with Open or Close for its teacher and the location responsible. */
export function examRow(c) {
  const st = examState(c); const e = c.exam; const ids = classStudents(c.id).map(s => s.id); const subs = examSubs();
  /* students who have sat each subject's exam (a student may sit it again after scoring below 50%) */
  const taken = k => new Set(S.results.filter(r => ids.includes(r.sid) && r.cid === c.id && r.course === c.course && r.sem === c.sem && r.sub === k.key && !r.chapter).map(r => r.sid)).size;
  const ready = paperCounts(c.course, c.sem).filter(x => !x.n).map(x => x.s.name);
  const can = (ME.role === 'teacher' || ME.role === 'locadmin') && c.status === 'active';
  const text = st === 'open' ? 'Open until ' + fd(e.to) + ' · taken so far: ' + subs.map(k => k.name + ' ' + taken(k)).join(', ')
    : st === 'upcoming' ? 'Opens ' + fd(e.from) + ', closes ' + fd(e.to)
    : st === 'over' ? 'Window ' + (e.closed ? 'closed early by ' + esc(e.closedBy || '') : 'ended ' + fd(e.to)) + ' · taken: ' + subs.map(k => k.name + ' ' + taken(k)).join(', ')
    : 'Not opened yet' + (ready.length ? ' · no approved questions yet for ' + esc(ready.join(', ')) : '');
  return '<div class="row"><div><div class="b">' + c.id + ' · Semester ' + c.sem + ' exams</div><div class="sub small">' + text + '</div></div>' +
    (can ? '<div class="btns">' + (st === 'open' || st === 'upcoming' ? act('examWinOpen', c.id, 'Change dates') + act('examCloseNow', c.id, 'Close window') : act('examWinOpen', c.id, st === 'over' ? 'Open again' : 'Open exam window', ready.length ? 'btn' : 'btn primary')) + '</div>' : '') + '</div>';
}

/* Chapter papers of a class's current semester, subject by subject, with Open / Change dates / Close for its
   teacher and the location responsible. The chart's week for each chapter tells them when it is due. */
const chapterInfo = (c, sub, n) => ({ w: chapterWindow(c, sub, n), due: chapterDue(c, sub, n, S.sessions, S.chartData) });
/* finished chapters (by the chart and the logged sessions) whose paper has not been opened yet */
export const chaptersToOpen = c => c.status !== 'active' ? [] : examSubs().flatMap(k => chaptersFor(c.course, c.sem, k.key).map(n => ({ k, n, ...chapterInfo(c, k.key, n) }))).filter(x => !x.w && x.due && x.due.on);
export function chapterRows(c) {
  const subs = examSubs().filter(k => chaptersFor(c.course, c.sem, k.key).length); if (!subs.length) return '';
  const can = (ME.role === 'teacher' || ME.role === 'locadmin') && c.status === 'active';
  const ids = classStudents(c.id).map(s => s.id);
  /* students who have sat the paper, and how many of them are still below the pass mark (best attempt) */
  const mine = (k, n) => S.results.filter(r => ids.includes(r.sid) && r.cid === c.id && r.course === c.course && r.sem === c.sem && r.sub === k && r.chapter === n);
  const taken = (k, n) => { const rs = mine(k, n); const sids = new Set(rs.map(r => r.sid)); const below = [...sids].filter(sid => !rs.some(r => r.sid === sid && r.pct >= 50)).length; return sids.size + (below ? ' (' + below + ' below 50%, can retake while open)' : ''); };
  return subs.map(k => {
    const list = chaptersFor(c.course, c.sem, k.key).map(n => ({ n, ...chapterInfo(c, k.key, n), st: chapterState(chapterWindow(c, k.key, n), TODAY) }));
    const open = list.filter(x => x.st === 'open').length, todo = list.filter(x => !x.w && x.due && x.due.on).length;
    const rows = list.map(x => {
      const title = (S.chapterTitles || {})[c.course + '-' + c.sem + '-' + k.key + '-' + x.n]; const arg = c.id + '|' + k.key + '|' + x.n;
      const when = x.due ? (x.due.on ? 'Finished in week ' + x.due.week + ' (' + fd(x.due.on) + ')' : 'Chart finishes it in week ' + x.due.week) : '';
      const text = x.st === 'open' ? 'Open until ' + fd(x.w.to) + ' · taken by ' + taken(k.key, x.n) + ' of ' + ids.length
        : x.st === 'upcoming' ? 'Opens ' + fd(x.w.from) + ', closes ' + fd(x.w.to)
        : x.st === 'over' ? (x.w.closed ? 'Closed early by ' + esc(x.w.closedBy || '') : 'Closed ' + fd(x.w.to)) + ' · taken by ' + taken(k.key, x.n) + ' of ' + ids.length
        : 'Not opened yet' + (when ? ' · ' + when : '');
      const btns = !can ? '' : x.st === 'open' || x.st === 'upcoming' ? act('chWinOpen', arg, 'Change dates') + act('chCloseNow', arg, 'Close')
        : act('chWinOpen', arg, x.st === 'over' ? 'Open again' : 'Open paper', !x.w && x.due && x.due.on ? 'btn primary' : 'btn');
      return '<div class="row"><div><div class="b small">Chapter ' + x.n + (title ? ': ' + esc(title) : '') + '</div><div class="small ' + (!x.w && x.due && x.due.on ? 'gold-t' : 'sub') + '">' + text + '</div></div>' + (btns ? '<div class="btns">' + btns + '</div>' : '') + '</div>';
    }).join('');
    return '<details class="chpapers"' + (open || todo ? ' open' : '') + '><summary><span class="b">' + c.id + ' · ' + esc(k.name) + ' chapter papers</span> <span class="sub small">' + list.length + ' chapters' + (open ? ' · ' + open + ' open' : '') + (todo ? ' · ' + todo + ' ready to open' : '') + '</span></summary><div class="rows">' + rows + '</div></details>';
  }).join('');
}

export function viewClass() {
  const c = cls(S.p.cid); if (!c) return '<div>' + act('back', '', 'Back', 'link') + '</div><p class="empty">This class is not available.</p>';
  const studs = classStudents(c.id); const ss = classSessions(c.id); const canLog = ME.role === 'locadmin' || ME.role === 'teacher';
  const sems = []; for (let s = 1; s <= c.sem; s++) if (studs.some(x => semResult(x.id, c.course, s) !== 'none')) sems.push(s);
  const assistant = c.assistantId && stu(c.assistantId);
  const canMove = (ME.role === 'locadmin' || ME.role === 'coord') && !ended(c);
  const loginCell = s => { const u = (S.logins || {})[s.id]; return '<td>' + (u ? esc(u) : act('stuLoginOpen', s.id, 'Create login')) + '</td>'; };
  const moveCell = s => canMove ? loginCell(s) + '<td class="acts"><div class="btns">' + editBtn('student', s.id) + act('moveOpen', s.id, 'Move') + act('removeOpen', s.id, 'Remove') + '</div></td>' : '';
  const canEdit = !ended(c) && (canMove || ME.role === 'super');
  /* phone and email reach only the location's staff and the super admin (see server/snapshot.js) */
  const asst = s => (c.assistantId === s.id ? ' ' + chip('ok', 'Class assistant') : '') + (s.phone || s.email ? '<div class="sub small" style="font-weight:500">' + [s.phone, s.email].filter(Boolean).map(esc).join(' · ') + '</div>' : '');
  const moveHead = canMove ? [['Login'], ['']] : [];
  return '<div>' + act('back', '', 'Back', 'link') + '</div><div class="head"><div><h1>' + c.id + '</h1><div class="sub">' + esc(courseLabel(c)) + ' · ' + esc(topicOf(c)) + ' · ' + group(c.g) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + ' India time' + (c.startOn > TODAY ? ' · starts ' + fd(c.startOn) : '') + '</div></div>' +
    '<div class="btns">' + (c.status === 'awaiting' && (ME.role === 'locadmin' || ME.role === 'super') ? act('assignOpen', c.id, 'Assign teacher', 'btn primary') : '') +
      (c.status === 'active' && (ME.role === 'locadmin' || ME.role === 'super') ? act('promoteOpen', c.id, c.sem >= course(c.course).sems ? 'Complete the course' : 'Move to Semester ' + (c.sem + 1), semReady(c).ready ? 'btn primary' : 'btn') : '') +
      /* a class that finished its course moves up a level, once */
      (c.promotedTo ? chip('ok', 'Moved up as ' + c.promotedTo) : c.status === 'completed' && (ME.role === 'locadmin' || ME.role === 'super') && S.courses[levelRank(c.course) + 1] ? act('nextOpen', c.id, 'Move up to ' + S.courses[levelRank(c.course) + 1].name, 'btn primary') : '') +
      (c.promotedFrom ? chip('mute', 'Moved up from ' + c.promotedFrom) : '') +
      (canMove ? act('addStuOpen', c.id, 'Add students') : '') +
      (canMove ? act('closeOpen', c.id, 'Close class') : '') +
      ((ME.role === 'teacher' || ME.role === 'locadmin') && !ended(c) ? act('assistOpen', c.id, assistant ? 'Change class assistant' : 'Choose class assistant') : '') +
      (canEdit ? editBtn('class', c.id, ME.role === 'super' ? 'Edit class and start date' : 'Edit class') : '') +
      (c.status === 'completed' ? chip('ok', 'Course completed') : '') +
      /* staff can view and print the certificates the class's students have earned */
      (ME.role !== 'student' && studs.some(x => certsFor(x).length) ? act('certsOpen', c.id, 'Certificates', c.status === 'completed' ? 'btn primary' : 'btn') : '') + (c.status === 'closed' ? chip('mute', 'Closed') : '') + sems.map(s => act('marks', c.id + '|' + s, 'Semester ' + s + ' marksheet')).join('') + '</div></div>' +
    (c.closed ? '<section class="card"><div class="b">Closed on ' + fd(c.closed.date) + ' by ' + esc(c.closed.by) + '</div><div class="sub">' + esc(c.closed.reason) + ' · ' + c.closed.moved + ' moved to other classes, ' + c.closed.back + ' sent back to registrations</div></section>' : '') +
    '<section class="tiles">' + tile('Teacher', esc(teacherName(c.teacherId) || 'Awaiting'), assistant ? 'Assistant: ' + esc(assistant.name) : 'No class assistant yet') + tile('Students', studs.length, '') + tile('Attendance', pct(classAtt(c.id)), 'This semester') + tile('Syllabus chart', weeksDone(c.id) ? weekLabel(c, weeksDone(c.id)) : 'Not started', c.startOn > TODAY ? 'Starts ' + fd(c.startOn) : '') + '</section>' +
    (!ended(c) ? '<section class="card"><div class="rows">' + examRow(c) + '</div>' + chapterRows(c) + '</section>' : '') +
    '<div class="cols"><section class="card main"><h2>Students</h2>' + (c.course === 'INR'
      ? tbl([['Student'], ['Status'], ['Missed', 1], ['Attendance', 1]].concat(moveHead), studs.map(s => { const st = stuStats(s); return '<tr><th scope="row">' + esc(s.name) + asst(s) + '</th><td>' + statChip(st.status) + '</td><td class="r">' + st.miss + '</td><td class="r">' + pct(st.pct) + '</td>' + moveCell(s) + '</tr>'; }))
      : tbl([['Student'], ['Status'], ['Missed', 1], ['Attendance', 1], ['Reading last week', 1]].concat(moveHead), studs.map(s => { const st = stuStats(s); const e = rd(s.id, lastWeek()); const tg = TG(); return '<tr><th scope="row">' + esc(s.name) + asst(s) + (readAlert(s) ? ' ' + chip('gold', 'Reading alert') : '') + '</th><td>' + statChip(st.status) + '</td><td class="r">' + st.miss + '</td><td class="r">' + pct(st.pct) + '</td><td class="r">' + (e ? '<span class="' + (e.ayat < tg.ayat ? 'warn-t' : '') + '">' + e.ayat + ' ayat</span> · <span class="' + (e.pages < tg.pages ? 'warn-t' : '') + '">' + e.pages + ' pages</span>' : '<span class="sub">Not logged</span>') + '</td>' + moveCell(s) + '</tr>'; }))) + '</section>' +
    '<section class="card side"><h2>Sessions</h2><div class="rows">' + (ss.slice().reverse().map(x => {
      const n = Object.keys(x.att).length; const p = Object.keys(x.att).filter(k => x.att[k] === 'p').length;
      return '<div class="row"><div><div class="b">' + fd(x.date) + (x.week ? ' · ' + (c.course === 'INR' ? 'Session ' : 'Week ') + x.week : '') + '</div><div class="sub small">' + (!x.held ? 'Cancelled: ' + esc(x.reason || 'no reason given') : x.logged ? p + ' of ' + n + ' present · logged by ' + esc(x.loggedBy) + (x.editedBy ? ' · edited by ' + esc(x.editedBy) : '') : 'Not logged yet') + '</div></div>' +
        (x.held && !x.logged ? (canLog ? act('logOpen', x.id, 'Log now', 'btn primary') : chip('warn', 'Not logged')) : '<div class="btns" style="align-items:center">' + (!x.held ? chip('mute', 'Cancelled') : chip('ok', 'Logged')) + (canLog && !ended(c) ? act('logEdit', x.id, 'Edit') : '') + '</div>') + '</div>';
    }).join('') || '<p class="empty">No sessions yet.</p>') + '</div></section></div>';
}

export function viewMarks() {
  const c = cls(S.p.cid); const sem = S.p.sem; const key = c.id + '|' + sem; const pub = !!S.published[key]; const studs = classStudents(c.id);
  const subs = S.subjects.filter(s => s.exam);
  /* a subject with chapter papers shows how its mark was made: 50% chapter average, 50% exam */
  const cell = (s, k) => { const v = best(s.id, c.course, sem, k.key); const ch = chaptersFor(c.course, sem, k.key); const d = ch.length ? markDetail(s.id, c.course, sem, k.key) : null;
    const how = d ? '<div class="sub small">chapters ' + (d.average == null ? '–' : d.average + '%') + ' · exam ' + (d.exam == null ? 'not taken' : d.exam + '%') + '</div>' : '';
    return v === null ? '<td class="r sub">' + (d ? 'Exam not taken' + how : 'Not taken') + '</td>' : '<td class="r">' + v + '% ' + (v >= 50 ? chip('ok', 'Pass') : chip('warn', 'Fail')) + how + '</td>'; };
  const lab = { pass: chip('ok', 'Passed'), fail: chip('warn', 'Re-exam due'), incomplete: chip('gold', 'Incomplete'), none: chip('mute', 'No marks') };
  const withChapters = subs.filter(k => chaptersFor(c.course, sem, k.key).length).map(k => k.name);
  return '<div>' + act('back', '', 'Back', 'link') + '</div><div class="head"><div><h1>' + c.id + ' · Semester ' + sem + ' marksheet</h1><div class="sub">Pass mark is 50% in each subject; the best attempt counts' + (withChapters.length ? '. ' + esc(withChapters.join(', ')) + ': 50% the average of the chapter papers (a paper not taken counts as 0) and 50% the semester exam' : '') + '</div></div>' +
    '<div class="btns">' + (pub ? chip('ok', 'Published to students') : ME.role === 'locadmin' ? act('publish', key, 'Publish results', 'btn primary') : chip('gold', 'Not published yet')) + '</div></div>' +
    '<section class="card">' + tbl([['Student']].concat(subs.map(s => [esc(s.name), 1])).concat([['Semester result']]), studs.map(s => '<tr><th scope="row">' + esc(s.name) + '</th>' + subs.map(k => cell(s, k)).join('') + '<td>' + lab[semResult(s.id, c.course, sem)] + '</td></tr>')) +
    (pub ? '' : '<p class="sub small">Students see nothing until results are published. Publishing also issues the semester certificate to everyone who passed every subject.</p>') + '</section>';
}

export function viewLog() {
  const d = S.draft; const x = S.sessions.find(s => s.id === d.sid); const c = cls(x.classId);
  /* students recorded as joining after this date start as "Not yet"; marking them counts them for this session */
  const all = classStudents(c.id).slice().sort((p, q) => p.name.localeCompare(q.name));
  const studs = all.filter(s => s.joined <= x.date); const later = all.filter(s => s.joined > x.date);
  const val = s => d.att[s.id] || (s.joined <= x.date ? 'p' : 'n');
  const l = lesson(c, x.week || weeksDone(c.id)); const who = ME.name + ', ' + (ME.role === 'teacher' ? 'teacher' : ME.role === 'student' ? 'class assistant' : 'on behalf of the teacher');
  const counts = { p: 0, a: 0, e: 0, n: 0 }; all.forEach(s => counts[val(s)]++);
  const counted = all.length - counts.n;
  const attRow = (s, choices) => { const v = val(s); return '<div class="att"><div class="nm">' + esc(s.name) + '</div><div class="three">' + choices.map(o => '<button type="button" class="pick' + (v === o[0] ? ' on ' + o[0] : '') + '" aria-pressed="' + (v === o[0]) + '" aria-label="' + esc(s.name) + ' ' + o[1].toLowerCase() + '" data-act="logAtt" data-arg="' + s.id + '|' + o[0] + '">' + o[1] + '</button>').join('') + '</div></div>'; };
  const PAE = [['p', 'Present'], ['a', 'Absent'], ['e', 'Excused']];
  return '<div>' + act('back', '', 'Back', 'link') + '</div><div><h1>' + (d.edit ? 'Edit session log' : 'Log session') + '</h1><div class="sub">' + c.id + ' · ' + esc(courseLabel(c)) + ' · ' + (c.course === 'INR' ? 'Session ' : 'Week ') + x.week + '</div><div class="sub">' + fdl(x.date) + '</div></div>' +
    '<section class="card"><div class="eyebrow">Was the class held?</div><div class="seg">' +
      '<button type="button" class="pick' + (d.held ? ' on' : '') + '" aria-pressed="' + d.held + '" data-act="logHeld" data-arg="1">Held</button>' +
      '<button type="button" class="pick' + (!d.held ? ' on a' : '') + '" aria-pressed="' + !d.held + '" data-act="logHeld" data-arg="0">Cancelled</button></div>' +
      (!d.held ? '<div class="field"><label for="lg-r">Reason</label><input id="lg-r" data-bind="draft.reason" value="' + esc(d.reason) + '" placeholder="For example: teacher unwell"></div>' : '') + '</section>' +
    (d.held ? '<section class="card"><div class="field"><label for="lg-v" class="eyebrow">Last Quran verse reached</label><input id="lg-v" data-bind="draft.verse" value="' + esc(d.verse) + '"></div><div class="sub small">The last session ended at ' + verseRef(versesBefore(c, x.week)) + '</div></section>' +
      '<section class="card"><div class="eyebrow">Covered from the syllabus chart</div>' +
        [['b', 'Belief', l.b], ['l', 'Islamic Laws', l.l], ['e', 'Ethics', l.e]].map(k => '<label class="check"><input type="checkbox" id="lg-c' + k[0] + '" data-bind="draft.covered.' + k[0] + '"' + (d.covered[k[0]] ? ' checked' : '') + '><span><span class="b">' + k[1] + '</span><br><span class="sub small">' + esc(k[2]) + '</span></span></label>').join('') + '</section>' +
      '<section class="card"><div class="card-h"><div class="eyebrow">Attendance</div><div class="b small">' + counts.p + ' of ' + counted + ' present' + (counts.e ? ' · ' + counts.e + ' excused' : '') + '</div></div>' +
        (studs.length ? '<div class="sub small">Everyone starts as present. Mark anyone absent or excused.</div><div>' + studs.map(s => attRow(s, PAE)).join('') + '</div>' : '') +
        (later.length ? '<div class="card-h" style="margin-top:' + (studs.length ? '8px' : '0') + '"><div class="b small">Joined the class after ' + fd(x.date) + ' according to their records</div>' + act('logAllIn', later.map(s => s.id).join(','), 'Mark all present') + '</div>' +
          '<div class="sub small">They start as Not yet and are left out of this session. If they were already attending, mark them; their joining date moves back to this session.</div><div>' + later.map(s => attRow(s, PAE.concat([['n', 'Not yet']]))).join('') + '</div>' : '') +
        (!all.length ? '<p class="empty">This class has no students yet.</p>' : '') + '</section>' : '') +
    '<section class="card"><div class="field"><label for="lg-n" class="eyebrow">Note (optional)</label><textarea id="lg-n" rows="2" data-bind="draft.note">' + esc(d.note) + '</textarea></div></section>' +
    '<div>' + act('logSave', '', d.edit ? 'Save changes' : 'Save session', 'btn primary wide') + '<p class="sub small" style="text-align:center;margin-top:8px">Logging as ' + esc(who) + '</p></div>';
}

/* Reading page: a material is read inside the app instead of being downloaded or opened elsewhere. PDFs show
   in the browser's viewer without its download and print buttons, Word files as text, Drive and YouTube
   links embedded. */
export function viewRead() {
  const base = S.materials.find(x => x.id === S.p.mid); const back = '<div>' + act('back', '', 'Back', 'link') + '</div>';
  if (!base) return back + '<p class="empty">This material is not available.</p>';
  const m = S.p.draft && base.draft ? Object.assign({}, base, base.draft) : base; /* an update being reviewed */
  const kind = readKind(m); const r = S.reader && S.reader.mid === m.id ? S.reader : {};
  /* an item of a training this teacher must complete keeps a reading record (see readtrack.js) */
  const need = !S.p.draft && ME.role === 'teacher' ? trainingItem(m) : null;
  const track = need ? ' data-track="' + esc(m.id) + '" data-need="' + need.need + '" data-secs="' + esc(JSON.stringify(need.pages || {})) + '"' : '';
  const paged = kind === 'pdf' || kind === 'word';
  let body;
  const ptrack = paged ? track : '';
  if (kind === 'pdf') body = '<div class="pdf-pages" data-pdf="/files/' + esc(m.fileId) + '" data-mid="' + esc(m.id) + '"' + ptrack + '><p class="sub">Opening the document…</p></div>';
  else if (kind === 'image') body = '<img class="reader-img" alt="' + esc(m.title) + '" src="/files/' + esc(m.fileId) + '">';
  else if (kind === 'word') body = r.err ? '<p class="err">' + esc(r.err) + '</p>' : '<article class="reader-text"' + ptrack + '>' + readUnits(r.paras || []).map((u, i) => '<div data-unit="' + (i + 1) + '">' + u.map(p => p.bold ? '<h3>' + esc(p.text) + '</h3>' : '<p>' + esc(p.text) + '</p>').join('') + '</div>').join('') + '</article>';
  else if (kind === 'youtube') { const id = (m.src.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/) || [])[1]; body = id ? '<iframe class="reader video" title="' + esc(m.title) + '" src="https://www.youtube-nocookie.com/embed/' + esc(id) + '" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>' : '<p class="empty">This video link could not be shown.</p>'; }
  else if (kind === 'drive') { const id = (m.src.match(/\/d\/([\w-]{10,})/) || m.src.match(/[?&]id=([\w-]{10,})/) || [])[1]; body = id ? '<iframe class="reader" title="' + esc(m.title) + '" src="https://drive.google.com/file/d/' + esc(id) + '/preview"></iframe>' : '<p class="empty">This Google Drive link could not be shown here. Share the file itself (not a folder) to show it inside the app.</p>'; }
  else if (kind === 'link') body = '<p>This item is a link to another website, so it opens there.</p><div class="btns"><a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(m.src) + '" target="_blank" rel="noopener">Open the website</a></div>';
  else if (kind === 'file') body = '<p class="empty">This kind of file cannot be shown inside the app. Upload it as a PDF to make it readable here.</p>';
  else body = '<p class="empty">No file is attached to this item yet.</p>';
  /* a picture or video is one item: it counts once it has been open long enough */
  if (track && !paged) body = '<div' + track + '><div data-unit="1">' + body + '</div></div>';
  /* the reading record stays at the top while scrolling; each page shows its own marker (see readtrack.js) */
  const record = track ? (need.done ? '' : '<p class="sub small">' + (paged ? 'A page counts once it has been in the middle of the screen for 30 seconds; the label on each page shows how far it has got.' : 'This counts once it has been open on this page for ' + need.need + ' seconds.') + ' Time adds up across visits.</p>') +
    '<div class="read-bar"><span class="small" id="read-progress">Training record: ' + itemDetail(need) + '</span>' +
    (need.done || !paged ? '' : '<button type="button" class="btn" id="read-next">Next unread page</button>') + '</div>' : '';
  return back + '<div><h1>' + esc(m.title) + '</h1><div class="sub">' + esc(matScope(m)) + ' · ' + esc(m.type) + '</div></div>' + record +
    '<section class="card reader-wrap" data-noctx="1">' + body + '</section>';
}

export function examCount() { const e = S.exam; return e.qs.filter((q, i) => isAns(q, e.ans[i])).length; }

export function viewExamTake() {
  const e = S.exam; const ch = e.examId.startsWith('CH-'); const p = e.examId.split('-').slice(ch ? 1 : 0); const ex = { course: p[0], sem: +p[1], sub: p[2], chapter: ch ? +p[3] : null }; const q = e.qs[e.i]; const a = e.ans[e.i]; const last = e.i === e.qs.length - 1;
  /* the teacher readiness quiz brings its own heading */
  const head = e.label ? '<div class="sub">' + esc(e.label.eyebrow) + '</div><h1>' + esc(e.label.title) + '</h1>' : '<div class="sub">' + esc(course(ex.course).name) + ' · Semester ' + ex.sem + (ex.chapter ? ' · Chapter ' + ex.chapter + ' paper' : ' exam') + '</div><h1>' + esc(subName(ex.sub)) + '</h1>';
  const answered = examCount();
  let body;
  if (q.type === 'fill') body = '<div class="field"><label for="ex-fill">Your answer for the blank</label><input id="ex-fill" autocomplete="off" autocapitalize="off" spellcheck="false" data-bind="exam.ans.' + e.i + '" value="' + esc(a || '') + '"></div>';
  else if (q.type === 'match') body = '<div style="display:flex;flex-direction:column;gap:12px">' + q.left.map((l, j) => '<div class="field"><label for="ex-m-' + j + '">' + esc(l) + '</label><select id="ex-m-' + j + '" data-bind="exam.ans.' + e.i + '.' + j + '">' + opts([['', 'Choose its match']].concat(q.right.map((r, idx) => [idx, r])), a[j]) + '</select></div>').join('') + '</div>';
  else body = (q.type === 'ayah' ? '<div class="ar big" lang="ar" dir="rtl">' + esc(q.ar) + '</div>' : '') + stmtList(q) +
    '<div style="display:flex;flex-direction:column;gap:10px">' + q.options.map((o, j) => '<button type="button" class="opt' + (a === j ? ' on' : '') + '" aria-pressed="' + (a === j) + '" data-act="examPick" data-arg="' + j + '"><b>' + 'ABCD'[j] + '</b><span>' + tx(o) + '</span></button>').join('') + '</div>' +
    '<p class="sub small">' + (a === undefined ? 'Choose one answer.' : 'Answer ' + 'ABCD'[a] + ' saved. You can change it until you submit.') + '</p>';
  return '<div>' + head + '<div class="sub">Question ' + (e.i + 1) + ' of ' + e.qs.length + ' · ' + QTYPE[q.type] + '</div><div class="meter" aria-hidden="true" style="margin-top:8px"><i style="width:' + Math.round((e.i + 1) / e.qs.length * 100) + '%"></i></div></div>' +
    '<h2 id="ex-q" style="font-size:19px;line-height:1.35">' + tx(q.text) + '</h2>' + body +
    '<div class="seg"><button type="button" class="btn" data-act="examGo" data-arg="-1"' + (e.i === 0 ? ' disabled' : '') + '>Previous</button>' +
      (last ? '<button type="button" class="btn primary" id="ex-submit" data-act="examSubmit"' + (answered < e.qs.length ? ' disabled' : '') + '>' + (e.label ? 'Submit quiz' : 'Submit exam') + '</button>' : '<button type="button" class="btn primary" data-act="examGo" data-arg="1">Next</button>') + '</div>' +
    '<p class="sub small" id="ex-count" style="text-align:center">' + answered + ' of ' + e.qs.length + ' answered.</p>';
}
