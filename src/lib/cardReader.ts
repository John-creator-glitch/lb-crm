// Reads text from an uploaded PDF (text layer) or image (OCR). Runs in the browser; nothing is uploaded anywhere.
export async function readCardText(file: File): Promise<string> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((i: any) => ('str' in i ? i.str : '') + (i.hasEOL ? '\n' : ' ')).join('') + '\n';
    }
    if (text.trim().length > 20) return text;
    throw new Error('This PDF has no readable text (scanned). Upload a photo or screenshot instead.');
  }
  const { createWorker } = await import('tesseract.js');
  const w = await createWorker('eng');
  try {
    const { data } = await w.recognize(file);
    return data.text;
  } finally {
    await w.terminate();
  }
}
