/**
 * How many pages a PDF has, from its page objects. Chromium writes each as
 * a plain "/Type /Page" dictionary, as does render.ts when it joins pages (it saves
 * without object streams). A PDF whose pages can't be found counts as having
 * too many, never none, so a page fit keeps shortening rather than believing it fits.
 */
export function countPdfPages(pdf: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(pdf);
  const pages = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  return pages > 0 ? pages : Number.MAX_SAFE_INTEGER;
}
