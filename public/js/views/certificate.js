/* The certificate a student receives: landscape A4, drawn in the Almuntazar brand.
   Every size is a share of the certificate's width, so it looks the same on a phone, a laptop and on paper. */
import { S } from '../state.js';
import { pd } from '/shared/dates.js';
import { esc } from '../ui.js';
import { cls } from '../logic.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = iso => { const t = pd(iso); return t.getDate() + ' ' + MONTHS[t.getMonth()] + ' ' + t.getFullYear(); };

/* corner ornament: an eight-pointed star in gold, with a small star inside it */
const corner = pos => '<svg class="cc-corner cc-' + pos + '" viewBox="0 0 60 60" aria-hidden="true"><g transform="translate(30 30)" stroke="currentColor" stroke-linejoin="round">' +
  '<rect x="-17" y="-17" width="34" height="34" fill="#F9F8F4" stroke-width="1.6"/><rect x="-17" y="-17" width="34" height="34" transform="rotate(45)" fill="#F9F8F4" stroke-width="1.6"/>' +
  '<rect x="-9" y="-9" width="18" height="18" fill="none" stroke-width="1"/><rect x="-9" y="-9" width="18" height="18" transform="rotate(45)" fill="none" stroke-width="1"/>' +
  '<circle r="3.4" fill="currentColor" stroke="none"/></g></svg>';

/* the seal: a scalloped gold medallion with the mark at its centre and the name around it */
function seal() {
  const pts = []; for (let i = 0; i < 48; i++) { const r = i % 2 ? 46 : 50; const a = Math.PI * 2 * i / 48; pts.push((60 + r * Math.cos(a)).toFixed(2) + ',' + (60 + r * Math.sin(a)).toFixed(2)); }
  return '<svg class="cc-seal" viewBox="0 0 120 120" aria-hidden="true"><defs>' +
    '<radialGradient id="ccg" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#E9CF9F"/><stop offset=".55" stop-color="#C99E66"/><stop offset="1" stop-color="#9C7440"/></radialGradient>' +
    '<path id="cct" d="M60 60m-33 0a33 33 0 1 1 66 0a33 33 0 1 1-66 0"/><clipPath id="ccc"><circle cx="60" cy="60" r="25"/></clipPath></defs>' +
    '<polygon points="' + pts.join(' ') + '" fill="url(#ccg)"/>' +
    '<circle cx="60" cy="60" r="41" fill="none" stroke="#F9F8F4" stroke-width="1" opacity=".8"/>' +
    '<circle cx="60" cy="60" r="27" fill="#134845"/><circle cx="60" cy="60" r="27" fill="none" stroke="#E9CF9F" stroke-width="1"/>' +
    '<text font-family="Montserrat, sans-serif" font-weight="700" font-size="6.6" letter-spacing="1.2" fill="#134845"><textPath href="#cct" startOffset="0" textLength="200" lengthAdjust="spacing">ALMUNTAZAR ◆ CANADA ◆ CERTIFIED ◆</textPath></text>' +
    '<image href="/img/mark-reverse.svg" x="40" y="47.4" width="40" height="25.1" preserveAspectRatio="xMidYMid meet" clip-path="url(#ccc)"/></svg>';
}

export function certificateHtml(s, x, issued) {
  const c = cls(s.classId); const loc = c && (S.locations.find(l => l.code === c.loc) || null);
  const done = /\|done$/.test(x.key);
  const signer = loc && (loc.primary || loc.secondary);
  return '<div class="cc-wrap"><article class="cc" aria-label="Certificate for ' + esc(s.name) + '">' +
    '<div class="cc-frame"></div>' + corner('tl') + corner('tr') + corner('bl') + corner('br') +
    '<img class="cc-water" src="/img/mark.svg" alt="" aria-hidden="true">' +
    '<div class="cc-body">' +
      '<div class="cc-bism" lang="ar" dir="rtl">بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>' +
      '<img class="cc-logo" src="/img/logo.svg" alt="Almuntazar Canada">' +
      '<div class="cc-title">CERTIFICATE</div>' +
      '<div class="cc-kind">' + (done ? 'of Completion' : 'of Achievement') + '</div>' +
      '<div class="cc-intro">This is to certify that</div>' +
      '<div class="cc-name">' + esc(s.name) + '</div>' +
      '<svg class="cc-flourish" viewBox="0 0 400 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M10 10h150M240 10h150" stroke-width="1.2"/><path d="M160 10c12-9 28-9 40 0s28 9 40 0" stroke-width="1.4"/></g><g fill="currentColor"><rect x="196" y="6" width="8" height="8" transform="rotate(45 200 10)"/><circle cx="10" cy="10" r="2"/><circle cx="390" cy="10" r="2"/></g></svg>' +
      '<div class="cc-line">' + esc(x.line) + (loc ? ' at Almuntazar Canada, ' + esc(loc.name) : '') + '.</div>' +
      '<div class="cc-foot">' +
        '<div class="cc-sig"><div class="cc-sigline"></div><div class="cc-signame">' + esc(signer || 'Location responsible') + '</div><div class="cc-sigrole">' + (loc ? 'Responsible, ' + esc(loc.name) : 'Location responsible') + '</div></div>' +
        seal() +
        '<div class="cc-sig"><div class="cc-sigline"></div><div class="cc-signame">Dean</div><div class="cc-sigrole">Almuntazar Canada</div></div>' +
      '</div>' +
      '<div class="cc-meta">Issued ' + esc(longDate(issued)) + '<span>◆</span>Certificate No. ' + esc(x.no) + '</div>' +
    '</div></article></div>';
}
