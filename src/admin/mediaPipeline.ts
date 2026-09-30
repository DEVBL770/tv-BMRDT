import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export type ImageDimensions = {
  width: number;
  height: number;
};

export type NormalizedImage = {
  blob: Blob;
  mime: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
};

export function fitImageDimensions(
  width: number,
  height: number,
  maxWidth = 3840,
  maxHeight = 2160,
): ImageDimensions {
  if (![width, height, maxWidth, maxHeight].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('invalid_image_dimensions');
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function normalizeImageFile(file: File): Promise<NormalizedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('image_decode_failed');
  }
  try {
    const dimensions = fitImageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('image_canvas_unavailable');
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const webp = await canvasBlob(canvas, 'image/webp', 0.85);
    if (webp?.type === 'image/webp') {
      return { blob: webp, mime: 'image/webp', ...dimensions };
    }
    const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.85);
    if (!jpeg) throw new Error('image_encode_failed');
    return { blob: jpeg, mime: 'image/jpeg', ...dimensions };
  } finally {
    bitmap.close();
  }
}

export async function renderPdfPages(file: File): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let pdfDocument: Awaited<typeof task.promise>;
  try {
    pdfDocument = await task.promise;
  } catch {
    await task.destroy();
    throw new Error('pdf_decode_failed');
  }
  if (pdfDocument.numPages > 6) {
    await task.destroy();
    throw new Error('pdf_too_many_pages');
  }
  const rendered: Blob[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const initialViewport = page.getViewport({ scale: 1 });
      const scale = 3840 / initialViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('pdf_canvas_unavailable');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const webp = await canvasBlob(canvas, 'image/webp', 0.85);
      const pageBlob =
        webp?.type === 'image/webp' ? webp : await canvasBlob(canvas, 'image/jpeg', 0.85);
      if (!pageBlob) throw new Error('pdf_encode_failed');
      rendered.push(pageBlob);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return rendered;
}
