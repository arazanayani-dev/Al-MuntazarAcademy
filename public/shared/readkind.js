/* How a material is shown on the in-app reading page, from its file name or link. Used by the reader and by
   syllabus readiness on the server (which items can be tracked, and how). */
export function readKind(m) {
  const name = String(m.src || '').toLowerCase();
  if (m.fileId) return /\.pdf$/.test(name) ? 'pdf' : /\.(png|jpe?g|gif|webp)$/.test(name) ? 'image' : /\.docx$/.test(name) ? 'word' : 'file';
  if (/youtube\.com|youtu\.be/.test(name)) return 'youtube';
  if (/drive\.google\.com|docs\.google\.com/.test(name)) return 'drive';
  return /^https?:\/\//.test(name) ? 'link' : 'none';
}
