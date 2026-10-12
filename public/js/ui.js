/* Small HTML builders used by every screen. */
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const chip = (k, t) => '<span class="chip ' + k + '">' + esc(t) + '</span>';
export const tile = (l, v, s, w) => '<div class="tile"><div class="t-l">' + l + '</div><div class="t-v">' + v + '</div><div class="t-s' + (w ? ' warn' : '') + '">' + (s || '') + '</div></div>';
export const pct = v => v === null || v === undefined ? 'No data yet' : v + '%';
export const opts = (arr, sel) => arr.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
export const act = (name, arg, label, cl) => '<button type="button" class="' + (cl || 'btn') + '" data-act="' + name + '" data-arg="' + esc(arg == null ? '' : arg) + '">' + label + '</button>';
export function tbl(head, rows) {
  return '<div class="scroll"><table><thead><tr>' + head.map(h => '<th scope="col"' + (h[1] ? ' class="r"' : '') + '>' + h[0] + '</th>').join('') + '</tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="' + head.length + '" class="sub">Nothing to show.</td></tr>') + '</tbody></table></div>';
}
export const pageHead = (title, sub) => '<div><h1>' + title + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
export const isAr = s => /[؀-ۿ]/.test(String(s));
export const tx = s => isAr(s) ? '<span class="ar-in" lang="ar" dir="rtl">' + esc(s) + '</span>' : esc(s);
export const stmtList = q => q.stmts && q.stmts.length ? '<ol type="i">' + q.stmts.map(x => '<li>' + tx(x) + '</li>').join('') + '</ol>' : '';

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  locations: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  masters: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  reports: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
  users: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  chart: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  bank: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.5h.01"/>',
  exams: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 13l2 2 4-4"/>',
  materials: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6"/>',
  training: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8M8 12l3-3 2 2 3-3"/>',
  traditions: '<path d="M6 4h11a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2zM9 9h6M9 13h4"/>',
  classes: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .6 3 2.2 3 5"/>',
  students: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
  coord: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>'
};
export const icon = k => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[k] || ICONS.home) + '</svg>';
