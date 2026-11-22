// Sharing a quotation as a FILE (PDF or image), never as plain text.
// Phones: the native share sheet attaches the file straight into WhatsApp (Android Chrome, iPhone Safari, also Windows/Mac Chrome and Edge).
// Where the browser cannot share files (most desktop browsers): the file is downloaded and WhatsApp Web / the WhatsApp app is opened on the owner's chat to attach it.

export function normalizePkPhone(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0092')) return d.slice(2);
  if (d.startsWith('92') && d.length >= 12) return d;
  if (d.startsWith('0') && d.length === 11) return '92' + d.slice(1);
  if (d.length === 10 && d.startsWith('3')) return '92' + d;
  return d.length >= 11 ? d : null;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Renders page 1 of a PDF to a PNG (for "share as image"). */
export async function pdfToPng(pdf: Blob, scale = 2.2): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: await pdf.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas } as any).promise;
  return await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not create image'))), 'image/png'));
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/** Share a file. `phone` is only used by the desktop fallback to open the owner's WhatsApp chat. */
export async function shareFile(file: File, opts: { title: string; phone?: string | null }): Promise<{ outcome: ShareOutcome; message: string }> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.title });
      return { outcome: 'shared', message: 'Choose WhatsApp (or any app) in the share sheet to send the file.' };
    } catch (e: any) {
      if (e?.name === 'AbortError') return { outcome: 'cancelled', message: '' };
      // fall through to download
    }
  }
  downloadBlob(file, file.name);
  const phone = normalizePkPhone(opts.phone);
  // No message text on purpose: the document itself is the quotation.
  window.open(phone ? `https://wa.me/${phone}` : 'https://web.whatsapp.com/', '_blank', 'noopener');
  return { outcome: 'downloaded', message: `${file.name} was downloaded. In WhatsApp, tap the attach (paperclip) button, choose Document, and select that file.` };
}
