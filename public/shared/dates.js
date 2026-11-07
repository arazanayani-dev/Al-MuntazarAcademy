/* Date helpers on ISO yyyy-mm-dd strings, used by the server and the browser. */
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const pd = i => { const a = i.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
export const iso = t => t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
export const addDays = (i, n) => { const t = pd(i); t.setDate(t.getDate() + n); return iso(t); };
export const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
export const fd = i => { const t = pd(i); return DOW[t.getDay()] + ' ' + t.getDate() + ' ' + MON[t.getMonth()]; };
export const fdl = i => { const t = pd(i); return DOWL[t.getDay()] + ', ' + t.getDate() + ' ' + MON[t.getMonth()]; };
export const ft = m => { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return ((h + 11) % 12 + 1) + ':' + String(mm).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); };
export const weekStart = d => { const t = pd(d); return addDays(d, -((t.getDay() + 6) % 7)); };
export const isIsoDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(pd(s)) === s;
