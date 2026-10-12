/* Screens reached from several roles: class detail, marksheet, session log and taking an exam. */
import { S, ME } from '../state.js';
import { DOW, fd, fdl, ft } from '/shared/dates.js';
import { isAns } from '/shared/scoring.js';
import { esc, chip, tile, pct, opts, act, tbl, tx, stmtList } from '../ui.js';
import {
  cls, stu, course, courseLabel, topicOf, group, teacherName, classStudents, classSessions, classAtt, weeksDone, weekLabel,
  stuStats, statChip, semResult, best, rd, lastWeek, TG, readAlert, lesson, verseRef, versesBefore, subName, QTYPE
} from '../logic.js';

export function viewClass() {
  const c = cls(S.p.cid); if (!c) return '<div>' + act('back', '', 'Back', 'link') + '</div><p class="empty">This class is not available.</p>';
  const studs = classStudents(c.id); const ss = classSessions(c.id); const canLog = ME.role === 'locadmin' || ME.role === 'teacher';
  const sems = []; for (let s = 1; s <= c.sem; s++) if (studs.some(x => semResult(x.id, c.course, s) !== 'none')) sems.push(s);
  const assistant = c.assistantId && stu(c.assistantId);
  return '<div>' + act('back', '', 'Back', 'link') + '</div><div class="head"><div><h1>' + c.id + '</h1><div class="sub">' + esc(courseLabel(c)) + ' · ' + esc(topicOf(c)) + ' · ' + group(c.g) + ' · ' + DOW[c.day] + ' ' + ft(c.time) + ' India time</div></div>' +
    '<div class="btns">' + (c.status === 'awaiting' && ME.role === 'locadmin' ? act('assignOpen', c.id, 'Assign teacher', 'btn primary') : '') + sems.map(s => act('marks', c.id + '|' + s, 'Semester ' + s + ' marksheet')).join('') + '</div></div>' +
    '<section class="tiles">' + tile('Teacher', esc(teacherName(c.teacherId) || 'Awaiting'), assistant ? 'Assistant: ' + esc(assistant.name) : 'No class assistant yet') + tile('Students', studs.length, '') + tile('Attendance', pct(classAtt(c.id)), 'This semester') + tile('Syllabus chart', weeksDone(c.id) ? weekLabel(c, weeksDone(c.id)) : 'Not started', '') + '</section>' +
    '<div class="cols"><section class="card main"><h2>Students</h2>' + (c.course === 'INR'
      ? tbl([['Student'], ['Status'], ['Missed in a row', 1], ['Attendance', 1]], studs.map(s => { const st = stuStats(s); return '<tr><th scope="row">' + esc(s.name) + '</th><td>' + statChip(st.status) + '</td><td class="r">' + st.miss + '</td><td class="r">' + pct(st.pct) + '</td></tr>'; }))
      : tbl([['Student'], ['Status'], ['Missed in a row', 1], ['Attendance', 1], ['Ayat last week', 1], ['Pages last week', 1]], studs.map(s => { const st = stuStats(s); const e = rd(s.id, lastWeek()); const tg = TG(); return '<tr><th scope="row">' + esc(s.name) + (readAlert(s) ? ' ' + chip('gold', 'Reading alert') : '') + '</th><td>' + statChip(st.status) + '</td><td class="r">' + st.miss + '</td><td class="r">' + pct(st.pct) + '</td><td class="r' + (e && e.ayat < tg.ayat ? ' warn-t' : '') + '">' + (e ? e.ayat : '<span class="sub">Not logged</span>') + '</td><td class="r' + (e && e.pages < tg.pages ? ' warn-t' : '') + '">' + (e ? e.pages : '<span class="sub">Not logged</span>') + '</td></tr>'; }))) + '</section>' +
    '<section class="card side"><h2>Sessions</h2><div class="rows">' + (ss.slice().reverse().map(x => {
      const n = Object.keys(x.att).length; const p = Object.keys(x.att).filter(k => x.att[k] === 'p').length;
      return '<div class="row"><div><div class="b">' + fd(x.date) + (x.week ? ' · ' + (c.course === 'INR' ? 'Session ' : 'Week ') + x.week : '') + '</div><div class="sub small">' + (!x.held ? 'Cancelled: ' + esc(x.reason || 'no reason given') : x.logged ? p + ' of ' + n + ' present · logged by ' + esc(x.loggedBy) : 'Not logged yet') + '</div></div>' + (x.held && !x.logged ? (canLog ? act('logOpen', x.id, 'Log now', 'btn primary') : chip('warn', 'Not logged')) : !x.held ? chip('mute', 'Cancelled') : chip('ok', 'Logged')) + '</div>';
    }).join('') || '<p class="empty">No sessions yet.</p>') + '</div></section></div>';
}

export function viewMarks() {
  const c = cls(S.p.cid); const sem = S.p.sem; const key = c.id + '|' + sem; const pub = !!S.published[key]; const studs = classStudents(c.id);
  const subs = S.subjects.filter(s => s.exam);
  const cell = v => v === null ? '<td class="r sub">Not taken</td>' : '<td class="r">' + v + '% ' + (v >= 50 ? chip('ok', 'Pass') : chip('warn', 'Fail')) + '</td>';
  const lab = { pass: chip('ok', 'Passed'), fail: chip('warn', 'Re-exam due'), incomplete: chip('gold', 'Incomplete'), none: chip('mute', 'No marks') };
  return '<div>' + act('back', '', 'Back', 'link') + '</div><div class="head"><div><h1>' + c.id + ' · Semester ' + sem + ' marksheet</h1><div class="sub">Pass mark is 50% in each subject; the best attempt counts</div></div>' +
    '<div class="btns">' + (pub ? chip('ok', 'Published to students') : ME.role === 'locadmin' ? act('publish', key, 'Publish results', 'btn primary') : chip('gold', 'Not published yet')) + '</div></div>' +
    '<section class="card">' + tbl([['Student']].concat(subs.map(s => [esc(s.name), 1])).concat([['Semester result']]), studs.map(s => '<tr><th scope="row">' + esc(s.name) + '</th>' + subs.map(k => cell(best(s.id, c.course, sem, k.key))).join('') + '<td>' + lab[semResult(s.id, c.course, sem)] + '</td></tr>')) +
    (pub ? '' : '<p class="sub small">Students see nothing until results are published. Publishing also issues the semester certificate to everyone who passed every subject.</p>') + '</section>';
}

export function viewLog() {
  const d = S.draft; const x = S.sessions.find(s => s.id === d.sid); const c = cls(x.classId); const studs = classStudents(c.id).filter(s => s.joined <= x.date);
  const l = lesson(c, x.week || weeksDone(c.id)); const who = ME.name + ', ' + (ME.role === 'teacher' ? 'teacher' : ME.role === 'student' ? 'class assistant' : 'on behalf of the teacher');
  const counts = { p: 0, a: 0, e: 0 }; studs.forEach(s => counts[d.att[s.id] || 'p']++);
  return '<div>' + act('back', '', 'Back', 'link') + '</div><div><h1>Log session</h1><div class="sub">' + c.id + ' · ' + esc(courseLabel(c)) + ' · ' + (c.course === 'INR' ? 'Session ' : 'Week ') + x.week + '</div><div class="sub">' + fdl(x.date) + '</div></div>' +
    '<section class="card"><div class="eyebrow">Was the class held?</div><div class="seg">' +
      '<button type="button" class="pick' + (d.held ? ' on' : '') + '" aria-pressed="' + d.held + '" data-act="logHeld" data-arg="1">Held</button>' +
      '<button type="button" class="pick' + (!d.held ? ' on a' : '') + '" aria-pressed="' + !d.held + '" data-act="logHeld" data-arg="0">Cancelled</button></div>' +
      (!d.held ? '<div class="field"><label for="lg-r">Reason</label><input id="lg-r" data-bind="draft.reason" value="' + esc(d.reason) + '" placeholder="For example: teacher unwell"></div>' : '') + '</section>' +
    (d.held ? '<section class="card"><div class="field"><label for="lg-v" class="eyebrow">Last Quran verse reached</label><input id="lg-v" data-bind="draft.verse" value="' + esc(d.verse) + '"></div><div class="sub small">The last session ended at ' + verseRef(versesBefore(c, x.week)) + '</div></section>' +
      '<section class="card"><div class="eyebrow">Covered from the syllabus chart</div>' +
        [['b', 'Belief', l.b], ['l', 'Islamic Laws', l.l], ['e', 'Ethics', l.e]].map(k => '<label class="check"><input type="checkbox" id="lg-c' + k[0] + '" data-bind="draft.covered.' + k[0] + '"' + (d.covered[k[0]] ? ' checked' : '') + '><span><span class="b">' + k[1] + '</span><br><span class="sub small">' + esc(k[2]) + '</span></span></label>').join('') + '</section>' +
      '<section class="card"><div class="card-h"><div class="eyebrow">Attendance</div><div class="b small">' + counts.p + ' of ' + studs.length + ' present' + (counts.e ? ' · ' + counts.e + ' excused' : '') + '</div></div><div class="sub small">Everyone starts as present. Mark anyone absent or excused.</div><div>' +
        studs.map(s => { const v = d.att[s.id] || 'p'; return '<div class="att"><div class="nm">' + esc(s.name) + '</div><div class="three">' + [['p', 'Present'], ['a', 'Absent'], ['e', 'Excused']].map(o => '<button type="button" class="pick' + (v === o[0] ? ' on ' + o[0] : '') + '" aria-pressed="' + (v === o[0]) + '" aria-label="' + esc(s.name) + ' ' + o[1].toLowerCase() + '" data-act="logAtt" data-arg="' + s.id + '|' + o[0] + '">' + o[1] + '</button>').join('') + '</div></div>'; }).join('') + '</div></section>' : '') +
    '<section class="card"><div class="field"><label for="lg-n" class="eyebrow">Note (optional)</label><textarea id="lg-n" rows="2" data-bind="draft.note">' + esc(d.note) + '</textarea></div></section>' +
    '<div>' + act('logSave', '', 'Save session', 'btn primary wide') + '<p class="sub small" style="text-align:center;margin-top:8px">Logging as ' + esc(who) + '</p></div>';
}

export function examCount() { const e = S.exam; return e.qs.filter((q, i) => isAns(q, e.ans[i])).length; }

export function viewExamTake() {
  const e = S.exam; const ex = S.exams.find(x => x.id === e.examId); const q = e.qs[e.i]; const a = e.ans[e.i]; const last = e.i === e.qs.length - 1;
  const answered = examCount();
  let body;
  if (q.type === 'fill') body = '<div class="field"><label for="ex-fill">Your answer for the blank</label><input id="ex-fill" autocomplete="off" autocapitalize="off" spellcheck="false" data-bind="exam.ans.' + e.i + '" value="' + esc(a || '') + '"></div>';
  else if (q.type === 'match') body = '<div style="display:flex;flex-direction:column;gap:12px">' + q.left.map((l, j) => '<div class="field"><label for="ex-m-' + j + '">' + esc(l) + '</label><select id="ex-m-' + j + '" data-bind="exam.ans.' + e.i + '.' + j + '">' + opts([['', 'Choose its match']].concat(q.right.map((r, idx) => [idx, r])), a[j]) + '</select></div>').join('') + '</div>';
  else body = (q.type === 'ayah' ? '<div class="ar big" lang="ar" dir="rtl">' + esc(q.ar) + '</div>' : '') + stmtList(q) +
    '<div style="display:flex;flex-direction:column;gap:10px">' + q.options.map((o, j) => '<button type="button" class="opt' + (a === j ? ' on' : '') + '" aria-pressed="' + (a === j) + '" data-act="examPick" data-arg="' + j + '"><b>' + 'ABCD'[j] + '</b><span>' + tx(o) + '</span></button>').join('') + '</div>' +
    '<p class="sub small">' + (a === undefined ? 'Choose one answer.' : 'Answer ' + 'ABCD'[a] + ' saved. You can change it until you submit.') + '</p>';
  return '<div><div class="sub">' + esc(course(ex.course).name) + ' · Semester ' + ex.sem + ' exam</div><h1>' + esc(subName(ex.sub)) + '</h1><div class="sub">Question ' + (e.i + 1) + ' of ' + e.qs.length + ' · ' + QTYPE[q.type] + '</div><div class="meter" aria-hidden="true" style="margin-top:8px"><i style="width:' + Math.round((e.i + 1) / e.qs.length * 100) + '%"></i></div></div>' +
    '<h2 id="ex-q" style="font-size:19px;line-height:1.35">' + tx(q.text) + '</h2>' + body +
    '<div class="seg"><button type="button" class="btn" data-act="examGo" data-arg="-1"' + (e.i === 0 ? ' disabled' : '') + '>Previous</button>' +
      (last ? '<button type="button" class="btn primary" id="ex-submit" data-act="examSubmit"' + (answered < e.qs.length ? ' disabled' : '') + '>Submit exam</button>' : '<button type="button" class="btn primary" data-act="examGo" data-arg="1">Next</button>') + '</div>' +
    '<p class="sub small" id="ex-count" style="text-align:center">One attempt. ' + answered + ' of ' + e.qs.length + ' answered.</p>';
}
