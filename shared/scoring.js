/* Automatic marking, used by the server when an exam is submitted and by the browser to count answered questions. */
export const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function isAns(q, a) {
  if (q.type === 'match') return !!a && a.length === q.left.length && a.every(x => x !== '' && x != null);
  if (q.type === 'fill') return !!(a && String(a).trim());
  return a !== undefined && a !== null && a !== '';
}

/* For match questions `a` holds, for each left item, the index of its chosen match in the original right-hand list. */
export function qScore(q, a) {
  if (!isAns(q, a)) return 0;
  if (q.type === 'match') return a.filter((x, i) => x !== '' && +x === i).length / q.left.length;
  if (q.type === 'fill') { const n = norm(a); return q.answers.some(x => norm(x) === n) ? 1 : 0; }
  return +a === q.correct ? 1 : 0;
}
