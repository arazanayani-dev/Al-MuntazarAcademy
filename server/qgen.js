/* Drafts exam questions from an uploaded syllabus with Claude, 12 per chapter. Drafts are saved as questions
   waiting for approval, like anything the content creator adds; nothing reaches students until the approver
   approves it. In every subject, each chapter's questions form that chapter's paper. A harder readiness quiz for
   the teachers of the syllabus (aud: 'teacher', see readiness.js) is drafted from the whole syllabus and the
   subject's teacher's guide, with some questions only the guide answers (basis: 'guide').

   Runs in the background after the upload is saved (the request does not wait). Needs Anthropic credentials
   on the server (ANTHROPIC_API_KEY); without them the material shows that AI drafting is not set up. */
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { chaptersOf } from './syllabus.js';
import { guidesOf, fileText } from './readiness.js';
import { loadFile } from './files.js';

/* each chapter's pool; a chapter paper draws 12 of them for each attempt (CHAPTER_PAPER in actions.js) */
export const PER_CHAPTER = 24;
/* questions added to a chapter whose pool is smaller (drafted before pools were 24) */
export const TOP_UP = 12;
export const TEACHER_QUIZ = 20;
export const TEACHER_QUIZ_TITLE = 'Teacher readiness quiz';
const MODEL = 'claude-opus-5-5';
const uid = p => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

/* One object shape for every question type (structured outputs need a fixed schema); fields that do not
   apply to a type are left empty and checked afterwards. */
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['point', 'evidence', 'type', 'basis', 'text', 'options', 'correct', 'statements', 'answers', 'left', 'right'],
        properties: {
          /* the teaching the question tests, and a passage copied word for word from the text that settles the answer */
          point: { type: 'string' },
          evidence: { type: 'string' },
          type: { type: 'string', enum: ['single', 'combo', 'fill', 'match'] },
          /* which document the answer comes from: the syllabus, or the teacher's guide (teacher quiz only) */
          basis: { type: 'string', enum: ['syllabus', 'guide'] },
          text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correct: { type: 'integer' },
          statements: { type: 'array', items: { type: 'string' } },
          answers: { type: 'array', items: { type: 'string' } },
          left: { type: 'array', items: { type: 'string' } },
          right: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
};

const SYSTEM = [
  'You write exam questions for an Islamic studies academy whose adult students take weekly online classes in English. A teacher teaches each chapter of the academy\'s syllabus in class; the questions check whether the student has understood what was taught, so that the marks tell the teacher who has learnt the chapter and who has not.',
  'Work in this order. First read the whole text and list for yourself its key teachings: the beliefs it establishes, the reasoning and proofs it gives for them, the terms it defines, the positions of the groups it compares, and the Quranic verses and narrations it uses to make its points. Then write each question to test one of those teachings, spread across the whole text. Most questions should ask what a teaching means, why it is true, how it differs from a wrong view, or what follows from it. Story details (who did what, where, in what order) are only worth asking when the detail is itself the lesson; ask at most two such questions.',
  'Stay inside the text. Every fact in a question, its right answer and its wrong options must come from the text, agree with it exactly, and be phrased as it phrases the teaching; keep names, honorifics such as (a.s.) and (s.a.w.a), and terms as it writes them. Never add facts, rulings, narrations or opinions that are not in it. In "point", name the teaching tested in a few words. In "evidence", copy word for word the sentence or phrase of the text (at most 40 words) that settles the right answer; it is checked against the text, and a question whose evidence is not found there is thrown away.',
  'Make the wrong options realistic, so that only a student who learnt the teaching can choose the right one. Take them from the text itself: the view of another group it discusses, a neighbouring term, person, verse or narration from the same text, a reason it gives for something else, or the wrong idea it corrects. A wrong option must be something a student who half-remembers the lesson could believe, and must be clearly wrong to one who learnt it. Never write an option that is silly, comic, obviously false to anyone (for example "because it was written in gold" or "to become rich"), or wrong only because it is extreme. All four options must be the same kind of answer, in the same grammatical form and of similar length and detail; the right option must not be the longest, the most detailed or the only one using the text\'s wording. Vary which option is right.',
  'In statement questions ("combo"), the false statements must be plausible distortions of the text (a view assigned to the wrong group, a reason swapped, a detail changed), not trivial or absurd ones.',
  'Ask about the subject directly, as a plain statement of it (for example "Why is Allah called Just?" or "Which group held that man has absolute free will?"). Never refer to the source: do not write "according to the chapter", "the book", "the text", "the passage", "the author", "the lesson", "this syllabus", "as mentioned", "as stated" or anything similar, in questions, statements or options.',
  'Write clear, unambiguous English with exactly one defensible right answer; avoid "all of the above", "none of the above", negatives such as "Which is NOT" and trick wording.',
  'Before giving your answer, check every question: is it answerable from the text alone, does the evidence settle it, and could a careful student who has not studied the text find the right option from its length, wording or tone, or by ruling out absurd options? Rewrite any question that fails.'
].join('\n\n');
/* a question that points at the document rather than the subject, which the prompt forbids */
/* ("According to Imam Sadiq (a.s.)" is a proper attribution; "according to the chapter" is not) */
const SOURCE_REF = /\b(according to (?:the |this )?(?:chapter|lesson|passage|text|book|syllabus|author|guide|teacher's guide)|as (?:mentioned|stated|described|explained|discussed) in|in (?:this|the) (?:chapter|lesson|passage|text|book|syllabus))\b|\bthe (?:chapter|text|passage|author|lesson|syllabus)\b|\bthe book\b(?! of)/i;

const TEACHER_NOTE = 'This set is not for students: it is a readiness quiz for the teachers who will teach this whole syllabus. ' +
  'Test a teacher\'s thorough command of it: the reasoning and proofs behind each belief, how ideas in different chapters connect, the distinctions between similar terms, groups and positions, ' +
  'the right answers to doubts and questions students commonly raise, and misunderstandings a teacher must be able to correct. Make it harder than a student paper, still answerable only from the syllabus text.';

function instructions(meta) {
  if (meta.teacher) return 'Write ' + TEACHER_QUIZ + ' questions for the teachers of ' + meta.course + ', Semester ' + meta.sem + ', ' + meta.subject + ': "' + meta.title + '", covering every chapter.\n' +
    'Mix of types, in this order:\n' +
    '- 11 "single": a question in "text", exactly 4 "options", "correct" = index 0-3 of the right option.\n' +
    '- 3 "fill": a sentence in "text" with ____ where one word or short phrase is missing; "answers" = the accepted answers (the word as the syllabus spells it, plus common spellings).\n' +
    '- 4 "combo": a question in "text", 3 to 6 numbered statements in "statements", and exactly 4 "options" naming combinations by roman numerals (for example "i, ii and iv"); "correct" = index of the right combination.\n' +
    '- 2 "match": an instruction in "text", 3 or 4 terms in "left" and their matching meanings in "right", in the same order.\n' +
    'Leave fields that do not apply to a type empty ([] or 0).\n' +
    (meta.guide
      ? 'The teacher\'s guide for this subject is given after the syllabus. Draw 8 of the ' + TEACHER_QUIZ + ' questions from the teacher\'s guide (how to teach and explain each topic, the examples and activities it gives, and its answers to students\' questions), so that only a teacher who has studied the guide can answer them, and the rest from the syllabus; spread both kinds through the types. ' +
        'Set "basis" to "guide" for a question answered from the teacher\'s guide and "syllabus" for the others. As everywhere, never refer to the guide or syllabus in the wording.\n\n'
      : 'Set "basis" to "syllabus" for every question.\n\n') +
    'Syllabus text:\n"""\n' + meta.text + '\n"""' + (meta.guide ? '\n\nTeacher\'s guide text:\n"""\n' + meta.guide + '\n"""' : '');
  /* a full pool of 24, or a top-up of 12 that must not repeat the chapter's existing questions */
  const n = meta.count || PER_CHAPTER; const k = x => Math.max(1, Math.round(x * n / 12));
  return 'Write ' + n + ' questions for ' + meta.course + ', Semester ' + meta.sem + ', ' + meta.subject + ', Chapter ' + meta.n + ': "' + meta.title + '". ' +
    'A paper of 12 is drawn from them at random for each attempt, so each question must stand on its own, and no two may test the same point or give away each other\'s answers.\n' +
    'Mix of types, in this order:\n' +
    '- ' + (n - k(2) - k(2) - k(1)) + ' "single": a question in "text", exactly 4 "options", "correct" = index 0-3 of the right option.\n' +
    '- ' + k(2) + ' "fill": a sentence in "text" with ____ where one word or short phrase is missing; "answers" = the accepted answers (the word as the book spells it, plus common spellings).\n' +
    '- ' + k(2) + ' "combo": a question in "text", 3 to 6 numbered statements in "statements", and exactly 4 "options" naming combinations by roman numerals (for example "i, ii and iv"); "correct" = index of the right combination. The options are shown in a shuffled order, so never refer to an option by its position.\n' +
    '- ' + k(1) + ' "match": an instruction in "text", 3 or 4 terms in "left" and their matching meanings in "right", in the same order.\n' +
    'Leave fields that do not apply to a type empty ([] or 0). Set "basis" to "syllabus". Cover the whole chapter, not only its beginning. Never write an option such as "Both A and B" that depends on the order of the options.\n' +
    (meta.avoid && meta.avoid.length ? 'These questions already exist for this chapter. Write new ones that test other points; do not repeat or rephrase any of them:\n' + meta.avoid.map(t => '- ' + t).join('\n') + '\n' : '') +
    '\nChapter text:\n"""\n' + meta.text + '\n"""';
}

/* Asks Claude for one chapter's questions. Returns the raw list; check() keeps only well-formed ones. */
export async function askClaude(meta) {
  const client = new Anthropic();
  /* streamed, since thinking through a whole chapter and writing 24 questions takes a while */
  const response = await client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    /* if a safety classifier declines, the API re-runs the request on Anthropic's recommended fallback model */
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM + (meta.teacher ? '\n\n' + TEACHER_NOTE : ''),
    messages: [{ role: 'user', content: instructions(meta) }]
  }).finalMessage();
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to write questions for this chapter.');
  if (response.stop_reason === 'max_tokens') throw new Error('The answer was cut off before it finished.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text).questions;
}

/* words of a text, lower case and without punctuation, for comparing a quoted passage with the source */
const words = t => String(t || '').toLowerCase().replace(/[‘’ʼ`]/g, "'").split(/[^\p{L}\p{N}']+/u).map(w => w.replace(/'/g, '')).filter(Boolean);
/* is the quoted evidence really in the source? Allows for line breaks, punctuation, hyphenation, a footnote
   printed in the middle of a sentence and the odd changed word: most runs of five words in the quote must
   appear in the source */
export function quoted(evidence, source) {
  const ev = words(evidence); if (ev.length < 3) return false;
  const src = ' ' + words(source).join(' ') + ' ';
  if (ev.length < 6) return src.includes(' ' + ev.join(' ') + ' ');
  let hit = 0, all = 0; for (let i = 0; i + 5 <= ev.length; i++) { all++; if (src.includes(' ' + ev.slice(i, i + 5).join(' ') + ' ')) hit++; }
  return hit / all >= 0.7;
}

/* Turns drafted questions into question-bank records, keeping only well-formed ones grounded in the source
   text. Returns { good, dropped } where dropped counts why questions were left out. */
function vet(raw, source) {
  const dropped = { form: 0, evidence: 0, tell: 0 }; const good = [];
  for (const q of Array.isArray(raw) ? raw : []) {
    const out = check(q); if (!out) { dropped.form++; continue; }
    if (source && !quoted(q.evidence, source)) { dropped.evidence++; continue; }
    if (out.type === 'single' && standsOut(out)) { dropped.tell++; continue; }
    good.push(out);
  }
  return { good, dropped };
}
/* the right option gives itself away by being much longer than the others */
function standsOut(q) {
  const len = q.options.map(o => o.length); const right = len[q.correct]; const others = len.filter((_, i) => i !== q.correct);
  const mean = others.reduce((a, b) => a + b, 0) / others.length;
  return right > 1.7 * mean && right - mean > 25 && right > Math.max(...others) * 1.3;
}
const why = d => [d.evidence ? d.evidence + ' not found in the text' : '', d.tell ? d.tell + ' with an answer that stood out' : '', d.form ? d.form + ' badly formed' : ''].filter(Boolean).join(', ');

/* turns a drafted question into a question-bank record, or null if it is not usable */
function check(q) {
  const out = check1(q); if (!out) return null;
  if (q.basis === 'guide') out.basis = 'guide';
  const s = v => String(v == null ? '' : v).trim().slice(0, 300);
  if (s(q.point)) out.point = s(q.point); if (s(q.evidence)) out.evidence = s(q.evidence);
  return out;
}
function check1(q) {
  const s = v => String(v == null ? '' : v).trim().slice(0, 1000); const arr = a => (Array.isArray(a) ? a : []).map(s).filter(Boolean);
  let text = s(q && q.text); if (!text) return null;
  if ([text, ...arr(q.statements), ...arr(q.options)].some(t => SOURCE_REF.test(t))) return null;
  if (q.type === 'single' || q.type === 'combo') {
    const options = arr(q.options); const correct = Number(q.correct);
    if (options.length !== 4 || !(correct >= 0 && correct <= 3) || new Set(options.map(o => o.toLowerCase())).size < 4) return null;
    if (q.type === 'combo') {
      const stmts = arr(q.statements).map(t => t.replace(/^\(?[ivx]+[.)]\s*/i, '')); if (stmts.length < 3) return null;
      /* the statements are shown as a list, so they are not repeated in the question */
      text = text.split('\n').filter(l => !/^\s*\(?[ivx]+[.)]\s/i.test(l)).join('\n').trim();
      return { type: 'combo', text, stmts, options, correct };
    }
    return { type: 'single', text, options, correct };
  }
  if (q.type === 'fill') { const answers = arr(q.answers); return answers.length && text.includes('__') ? { type: 'fill', text, answers, options: [], correct: 0 } : null; }
  if (q.type === 'match') { const left = arr(q.left), right = arr(q.right); return left.length >= 2 && left.length <= 4 && left.length === right.length ? { type: 'match', text, left, right, options: [], correct: 0 } : null; }
  return null;
}

const notSetUp = e => e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || /api[_ ]?key|auth/i.test(String(e && e.message));

/* Drafts questions for a syllabus material, chapter by chapter, and records progress on the material
   (m.qgen) so the creator can see it. Drafts from an earlier version of the syllabus that were never
   approved are replaced; approved ones stay in use until a chapter's new questions are approved (see
   supersede in actions.js), each drafting being one "round". ask can be swapped out (tests). */
export async function draftQuestions(store, mid, ask = askClaude) {
  const m = store.find('materials', mid); if (!m || !m.fileId) return;
  const f = store.find('files', m.fileId); const k = store.find('courses', m.course); const subj = store.find('subjects', m.sub);
  const set = q => store.tx(() => { const cur = store.find('materials', mid); if (cur) { cur.qgen = { ...(cur.qgen || {}), ...q, at: new Date().toISOString() }; store.put('materials', cur); } });
  let chapters;
  try { ({ chapters } = chaptersOf(await loadFile(f), f.name)); } catch { chapters = []; }
  chapters = (chapters || []).filter(c => c.text && c.text.trim().length > 200);
  if (!chapters.length) { await set({ status: 'failed', note: 'No chapter text could be read from the syllabus, so no questions were drafted.' }); return; }
  /* part 'teacher' drafts only the teachers' quiz (for a syllabus whose chapter papers already exist); part
     'more' tops up chapters whose pool is under PER_CHAPTER with new questions that join the existing paper */
  const part = m.qgen && ['teacher', 'more'].includes(m.qgen.part) ? m.qgen.part : '';
  const gone = q => q.source === mid && q.status !== 'approved' && (part === 'teacher' ? q.aud === 'teacher' : part === 'more' ? q.extra && !q.aud : true);
  await store.tx(() => store.all('questions').filter(gone).forEach(q => store.del('questions', q.id)));
  const have = c => store.all('questions').filter(q => q.source === mid && !q.aud && !q.retired && q.status !== 'rejected' && q.chapter === c.n);
  const todo = part === 'teacher' ? [] : part === 'more' ? chapters.filter(c => have(c).length < PER_CHAPTER) : chapters;
  const round = new Date().toISOString(); const steps = todo.length + (part === 'more' ? 0 : 1);
  await set({ status: 'running', total: steps, done: 0, made: 0, note: '', started: round, part: part || undefined });
  let made = 0; const failed = [];
  for (const c of todo) {
    try {
      /* a top-up must not repeat the chapter's questions, and joins their round so approving it retires nothing */
      const old = part === 'more' ? have(c) : []; const count = part === 'more' ? Math.min(TOP_UP, PER_CHAPTER - old.length) : PER_CHAPTER;
      const text = c.text.slice(0, 60000);
      const raw = await ask({ course: k ? k.name : m.course, sem: m.sem, subject: subj ? subj.name : m.sub, n: c.n, title: c.title, text, count, avoid: old.map(q => q.text) });
      const v = vet(raw, text); const good = v.good.slice(0, count);
      const joins = old.filter(q => q.status === 'approved').map(q => q.round).filter(Boolean).sort().pop();
      await store.tx(() => good.forEach(q => store.put('questions', {
        id: uid('q'), course: m.course, sem: m.sem, sub: m.sub, retired: false, ...q,
        chapter: c.n, chapterTitle: c.title, source: mid, ai: true, round: part === 'more' ? joins : round, ...(part === 'more' ? { extra: true } : {}),
        status: 'pending', submittedBy: (m.submittedBy || 'the content creator') + ' (drafted by AI)', submittedById: m.submittedById, submittedOn: new Date().toISOString().slice(0, 10), reviewNote: ''
      })));
      made += good.length;
      if (good.length < count) failed.push('Chapter ' + c.n + ': ' + good.length + ' of ' + count + ' kept' + (why(v.dropped) ? ' (left out: ' + why(v.dropped) + ')' : ''));
    } catch (e) {
      if (notSetUp(e)) { await set({ status: 'failed', note: 'AI drafting is not set up on the server (no Anthropic API key). Add one and use Draft questions again.', made }); return; }
      failed.push('Chapter ' + c.n + ': ' + (e && e.message ? e.message.slice(0, 120) : 'failed'));
    }
    await set({ done: todo.indexOf(c) + 1, made });
  }
  if (part === 'more') { await set({ status: 'done', made, note: todo.length ? failed.join('; ') : 'Every chapter already has ' + PER_CHAPTER + ' questions.', finished: new Date().toISOString() }); return; }
  /* the teachers' readiness quiz, from the whole syllabus and the subject's teacher's guides */
  try {
    const guide = (await Promise.all(guidesOf(store, m).map(g => fileText(store, g.fileId)))).filter(t => t.trim()).join('\n\n').slice(0, 100000);
    const text = chapters.map(c => 'Chapter ' + c.n + ': ' + c.title + '\n' + c.text).join('\n\n').slice(0, 120000);
    const raw = await ask({ teacher: true, course: k ? k.name : m.course, sem: m.sem, subject: subj ? subj.name : m.sub, n: 0, title: m.title, text, guide });
    const v = vet(raw, text + '\n' + guide); const good = v.good.slice(0, TEACHER_QUIZ);
    await store.tx(() => good.forEach(q => store.put('questions', {
      id: uid('q'), course: m.course, sem: m.sem, sub: m.sub, retired: false, ...q, aud: 'teacher',
      chapterTitle: TEACHER_QUIZ_TITLE, source: mid, ai: true, round,
      status: 'pending', submittedBy: (m.submittedBy || 'the content creator') + ' (drafted by AI)', submittedById: m.submittedById, submittedOn: new Date().toISOString().slice(0, 10), reviewNote: ''
    })));
    made += good.length;
    if (good.length < TEACHER_QUIZ) failed.push('Teacher quiz: ' + good.length + ' of ' + TEACHER_QUIZ + ' kept' + (why(v.dropped) ? ' (left out: ' + why(v.dropped) + ')' : ''));
  } catch (e) {
    if (notSetUp(e)) { await set({ status: 'failed', note: 'AI drafting is not set up on the server (no Anthropic API key). Add one and use Draft questions again.', made }); return; }
    failed.push('Teacher quiz: ' + (e && e.message ? e.message.slice(0, 120) : 'failed'));
  }
  await set({ done: steps, made });
  await set({ status: made ? 'done' : 'failed', made, note: failed.length ? failed.join('; ') : '', finished: new Date().toISOString() });
}
