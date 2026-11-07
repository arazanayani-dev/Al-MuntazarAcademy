/* Shows a PDF inside the reading page with PDF.js (served by the app itself), so a syllabus is read in the
   app rather than downloaded, on phones as well as computers. Pages are drawn as they scroll into view and
   kept as compressed images, so long documents stay light. Rendered pages are kept per document, so the page
   can be redrawn without drawing them again. */
const cache = new Map(); /* src -> { holder: element with the page boxes, ready } */

export function showPdf(el) {
  const src = el.dataset.pdf; const have = cache.get(src);
  if (have) { el.replaceChildren(have.holder); return; }
  const entry = { holder: document.createElement('div') }; entry.holder.className = 'pdf-holder';
  cache.set(src, entry); el.replaceChildren(entry.holder);
  entry.holder.innerHTML = '<p class="sub">Opening the document…</p>';
  load(src, entry).catch(() => { cache.delete(src); entry.holder.innerHTML = '<p class="err">This document could not be shown.</p>'; });
}

async function load(src, entry) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ url: src, withCredentials: true }).promise;
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  entry.holder.replaceChildren();
  const boxes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const box = document.createElement('div'); box.className = 'pdf-page'; box.dataset.page = i; box.dataset.unit = i; /* a unit of the reading record */
    box.style.aspectRatio = first.width + ' / ' + first.height; box.setAttribute('aria-label', 'Page ' + i + ' of ' + doc.numPages);
    entry.holder.appendChild(box); boxes.push(box);
  }
  const draw = async box => {
    if (box.dataset.done) return; box.dataset.done = '1';
    const page = await doc.getPage(+box.dataset.page);
    const base = page.getViewport({ scale: 1 }); const width = Math.min(1100, Math.max(600, box.clientWidth || 800));
    const vp = page.getViewport({ scale: width / base.width * Math.min(window.devicePixelRatio || 1, 1.5) });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    const img = new Image(); img.alt = 'Page ' + box.dataset.page; img.draggable = false; img.src = URL.createObjectURL(blob);
    box.style.aspectRatio = base.width + ' / ' + base.height; box.replaceChildren(img);
  };
  const seen = new IntersectionObserver(items => items.forEach(it => { if (it.isIntersecting) { seen.unobserve(it.target); draw(it.target); } }), { rootMargin: '1200px 0px' });
  boxes.forEach(b => seen.observe(b));
}
