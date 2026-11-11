/* Excel files for the content creator: templates to fill in, and reading filled-in files back.
   Two kinds: a Standard Syllabus Chart (one row per week, a column per subject) and multiple-choice
   questions (one row per question). Reading is forgiving about column order and header wording. */
import ExcelJS from 'exceljs';

const TEAL = 'FF134845', GOLD = 'FFC99E66', CREAM = 'FFF9F8F4';

/* a cell's value as plain text, whatever Excel stored: rich text, formula results, links, numbers, dates */
function text(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
    if ('result' in v) return text(v.result);
    if ('text' in v) return text(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}
const clean = v => text(v).replace(/\s+/g, ' ').trim();
const norm = v => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* the first worksheet with content, as rows of cell texts */
export async function readRows(buf) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw new Error('That file could not be read as an Excel workbook. Save it as .xlsx and try again.'); }
  const ws = wb.worksheets.find(w => w.actualRowCount > 0 && w.state !== 'hidden' && !/^instructions?$/i.test(w.name)) || wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets.');
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const cells = []; row.eachCell({ includeEmpty: true }, (c, col) => { cells[col - 1] = clean(c.value); });
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
    if (cells.some(Boolean)) rows.push({ n, cells });
  });
  if (!rows.length) throw new Error('The sheet is empty.');
  if (rows.length > 2000) throw new Error('The sheet has more than 2,000 rows. Split it into smaller files.');
  return rows;
}

/* finds the header row (within the first 10 rows) and which column holds each wanted field */
function headers(rows, fields) {
  for (const r of rows.slice(0, 10)) {
    const map = {};
    r.cells.forEach((h, i) => { const t = norm(h); for (const [key, words] of Object.entries(fields)) if (map[key] == null && words.some(w => t === w || t.startsWith(w + ' '))) map[key] = i; });
    if (Object.keys(map).length >= 2) return { at: r.n, map };
  }
  return null;
}

/* ---------- Standard Syllabus Chart ---------- */
const SUBJECT_COLS = { b: ['belief', 'beliefs', 'aqaid', 'usul'], l: ['islamic laws', 'laws', 'law', 'fiqh', 'ahkam'], e: ['ethics', 'akhlaq', 'morals'] };

export async function sscTemplate(k, sem, existing) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Almuntazar Canada';
  const tag = k.code === 'INR' ? 'Session' : 'Week';
  const ws = wb.addWorksheet('Syllabus chart', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ header: tag, key: 'w', width: 9 }, { header: 'Belief', key: 'b', width: 48 }, { header: 'Islamic Laws', key: 'l', width: 48 }, { header: 'Ethics', key: 'e', width: 48 }];
  for (let i = 0; i < k.weeks; i++) ws.addRow({ w: i + 1, b: existing ? existing.b[i] || '' : '', l: existing ? existing.l[i] || '' : '', e: existing ? existing.e[i] || '' : '' });
  ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: CREAM } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }; c.alignment = { vertical: 'middle' }; });
  ws.getRow(1).height = 22;
  ws.eachRow((r, n) => { if (n > 1) { r.alignment = { wrapText: true, vertical: 'top' }; r.getCell(1).font = { bold: true, color: { argb: TEAL } }; } });
  const info = wb.addWorksheet('Instructions');
  info.columns = [{ width: 110 }];
  [
    'Standard Syllabus Chart: ' + k.name + ', Semester ' + sem + ' (' + k.weeks + ' ' + tag.toLowerCase() + 's)',
    '',
    'Write each ' + tag.toLowerCase() + '\'s topic in the Belief, Islamic Laws and Ethics columns, one row per ' + tag.toLowerCase() + '.',
    'Keep the ' + tag + ' numbers in the first column. Rows beyond ' + tag.toLowerCase() + ' ' + k.weeks + ' are ignored.',
    'You can fill in just one subject: delete the other subjects\' columns, and their current topics stay as they are.',
    'An empty cell means the chart does not cover that ' + tag.toLowerCase() + ' for that subject yet.',
    'Upload the file on the Syllabus chart page. It goes to the approver, and teachers see it once it is approved.'
  ].forEach((t, i) => { const r = info.addRow([t]); if (i === 0) r.font = { bold: true, size: 13, color: { argb: TEAL } }; r.alignment = { wrapText: true }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* reads a filled-in chart: for each subject column found, its topic for each week (null = column not in file) */
export async function readSsc(buf, weeks) {
  const rows = await readRows(buf);
  const h = headers(rows, { w: ['week', 'session', 'wk', 'no', 'number'], ...SUBJECT_COLS });
  if (!h || !['b', 'l', 'e'].some(s => h.map[s] != null)) throw new Error('No subject columns found. The first row needs headings such as Week, Belief, Islamic Laws and Ethics. Download the template to start from.');
  const out = { b: null, l: null, e: null }; const problems = [];
  ['b', 'l', 'e'].forEach(s => { if (h.map[s] != null) out[s] = Array(weeks).fill(''); });
  let order = 0;
  rows.filter(r => r.n > h.at).forEach(r => {
    let w;
    if (h.map.w != null && r.cells[h.map.w]) {
      const m = r.cells[h.map.w].match(/\d+/); w = m ? +m[0] : NaN;
      if (!(w >= 1)) { problems.push('Row ' + r.n + ': "' + r.cells[h.map.w] + '" is not a week number, so the row was skipped.'); return; }
    } else w = ++order;
    if (w > weeks) { if (['b', 'l', 'e'].some(s => h.map[s] != null && r.cells[h.map[s]])) problems.push('Row ' + r.n + ': week ' + w + ' is beyond the ' + weeks + ' weeks of this semester, so it was skipped.'); return; }
    ['b', 'l', 'e'].forEach(s => { if (h.map[s] != null) { const t = (r.cells[h.map[s]] || '').slice(0, 300); if (t) out[s][w - 1] = t; } });
  });
  const filled = ['b', 'l', 'e'].filter(s => out[s] && out[s].some(Boolean));
  if (!filled.length) throw new Error('The subject columns are all empty. Write at least one week\'s topic.');
  return { ...out, subjects: filled, problems };
}

/* ---------- multiple-choice questions ---------- */
const MCQ_COLS = {
  course: ['course', 'course type', 'level'], sem: ['semester', 'sem'], sub: ['subject'], chapter: ['chapter', 'ch'],
  text: ['question', 'question text'], o0: ['option a', 'a'], o1: ['option b', 'b'], o2: ['option c', 'c'], o3: ['option d', 'd'],
  correct: ['correct answer', 'correct', 'answer', 'correct option', 'key']
};

export async function mcqTemplate(courses, subjects) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Almuntazar Canada';
  const ws = wb.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Course', key: 'course', width: 14 }, { header: 'Semester', key: 'sem', width: 10 }, { header: 'Subject', key: 'sub', width: 16 }, { header: 'Chapter', key: 'chapter', width: 9 },
    { header: 'Question', key: 'text', width: 60 }, { header: 'Option A', key: 'o0', width: 28 }, { header: 'Option B', key: 'o1', width: 28 }, { header: 'Option C', key: 'o2', width: 28 }, { header: 'Option D', key: 'o3', width: 28 },
    { header: 'Correct answer', key: 'correct', width: 15 }
  ];
  const ex = courses.find(c => c.code === 'BAS') || courses[0]; const sub = subjects.find(s => s.key === 'b') || subjects[0];
  ws.addRow({ course: ex.name, sem: Math.min(2, ex.sems), sub: sub.name, chapter: 1, text: 'Adl refers to which belief?', o0: 'The oneness of God', o1: 'Divine justice', o2: 'Prophethood', o3: 'The Day of Resurrection', correct: 'B' });
  ws.addRow({ course: ex.name, sem: Math.min(2, ex.sems), sub: sub.name, chapter: '', text: 'Which of these is one of the roots of religion?', o0: 'Salat', o1: 'Sawm', o2: 'Imamat', o3: 'Hajj', correct: 'C' });
  ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: CREAM } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }; });
  ws.getRow(1).height = 22;
  [2, 3].forEach(n => ws.getRow(n).eachCell(c => { c.font = { italic: true, color: { argb: 'FF7C5A28' } }; }));
  ws.eachRow((r, n) => { if (n > 1) r.alignment = { wrapText: true, vertical: 'top' }; });
  /* keep entries valid: drop-down lists for course, subject and correct answer */
  const list = (col, values) => { for (let r = 2; r <= 501; r++) ws.getCell(col + r).dataValidation = { type: 'list', allowBlank: true, formulae: ['"' + values.join(',') + '"'] }; };
  list('A', courses.map(c => c.name)); list('C', subjects.map(s => s.name)); list('J', ['A', 'B', 'C', 'D']);
  const info = wb.addWorksheet('Instructions'); info.columns = [{ width: 110 }];
  [
    'Multiple-choice questions for the question bank',
    '',
    'One row per question. The two rows in italics are examples: replace or delete them.',
    'Course: one of ' + courses.map(c => c.name + ' (' + c.code + ')').join(', ') + '.',
    'Semester: a number. Subject: one of ' + subjects.map(s => s.name).join(', ') + '.',
    'Chapter: optional. A number puts the question in that chapter\'s paper; leave it empty for the semester exam.',
    'Write all four options, and the correct one as A, B, C or D.',
    'Upload the file in the Question bank. Every row is checked first; the questions go to the approver and are used once approved.',
    'A question already in the bank (same course, semester, subject and wording) is skipped.'
  ].forEach((t, i) => { const r = info.addRow([t]); if (i === 0) r.font = { bold: true, size: 13, color: { argb: TEAL } }; r.alignment = { wrapText: true }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* reads filled-in questions; each item says which row it came from and what, if anything, is wrong with it */
export async function readMcq(buf, courses, subjects, defaults = {}) {
  const rows = await readRows(buf);
  const h = headers(rows, MCQ_COLS);
  if (!h || h.map.text == null) throw new Error('No Question column found. The first row needs headings such as Course, Semester, Subject, Question, Option A to Option D and Correct answer. Download the template to start from.');
  const findCourse = v => { const t = norm(v); return courses.find(c => norm(c.code) === t || norm(c.name) === t); };
  const findSub = v => { const t = norm(v); return subjects.find(s => s.exam && (norm(s.key) === t || norm(s.name) === t || norm(s.name).startsWith(t + ' '))); };
  const get = (r, k) => h.map[k] != null ? (r.cells[h.map[k]] || '') : '';
  return rows.filter(r => r.n > h.at).map(r => {
    const errors = [];
    const k = get(r, 'course') ? findCourse(get(r, 'course')) : courses.find(c => c.code === defaults.course);
    if (!k) errors.push(get(r, 'course') ? 'unknown course "' + get(r, 'course') + '"' : 'no course');
    const semRaw = get(r, 'sem') || (defaults.sem ? String(defaults.sem) : ''); const sem = parseInt((semRaw.match(/\d+/) || [''])[0], 10);
    if (!sem) errors.push('no semester'); else if (k && (sem < 1 || sem > k.sems)) errors.push(k.name + ' has ' + k.sems + (k.sems === 1 ? ' semester' : ' semesters') + ', not ' + sem);
    const sub = get(r, 'sub') ? findSub(get(r, 'sub')) : subjects.find(s => s.key === defaults.sub && s.exam);
    if (!sub) errors.push(get(r, 'sub') ? 'unknown or unexamined subject "' + get(r, 'sub') + '"' : 'no subject');
    const chRaw = get(r, 'chapter'); const chapter = chRaw ? parseInt((chRaw.match(/\d+/) || [''])[0], 10) : null;
    if (chRaw && !(chapter >= 1 && chapter <= 60)) errors.push('chapter "' + chRaw + '" is not a number');
    const qtext = get(r, 'text').slice(0, 2000); if (!qtext) errors.push('no question');
    const options = [0, 1, 2, 3].map(i => get(r, 'o' + i).slice(0, 500));
    const missing = options.map((o, i) => o ? '' : 'ABCD'[i]).filter(Boolean); if (missing.length) errors.push('option ' + missing.join(', ') + ' missing');
    const cRaw = get(r, 'correct').trim();
    let correct = /^[a-d]$/i.test(cRaw) ? 'abcd'.indexOf(cRaw.toLowerCase()) : /^[1-4]$/.test(cRaw) ? +cRaw - 1 : /^option\s+[a-d]$/i.test(cRaw) ? 'abcd'.indexOf(cRaw.slice(-1).toLowerCase()) : options.findIndex(o => o && norm(o) === norm(cRaw));
    if (!cRaw) errors.push('no correct answer'); else if (correct < 0) errors.push('correct answer "' + cRaw + '" is not A, B, C or D');
    return { row: r.n, errors, q: errors.length ? { text: qtext } : { course: k.code, sem, sub: sub.key, chapter: chapter || null, text: qtext, options, correct } };
  });
}
