// A photo the user picked or dropped, made small enough to send: the app reads
// it with its own model on the server. Never the camera: the file picker and
// drag-and-drop are the ways in (a phone's picker may offer its camera, which
// is the user's choice, not the app's).

/** The longest side sent: enough to read a nutrition label's small print. */
export const MAX_SIDE = 1600;

/** The size to draw a photo at so its longest side is at most `max`, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface Picked {
  mimeType: 'image/jpeg';
  base64: string;
  /** A data URL, to show the photo while it is read. */
  preview: string;
}

/** The photo as a JPEG of at most MAX_SIDE pixels. Rejects with a reason a person can read. */
export async function imageFrom(file: File): Promise<Picked> {
  if (!file.type.startsWith('image/')) throw new Error('that file is not a photo');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('this browser cannot open that kind of photo; try a JPEG or PNG');
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser cannot draw the photo');
  ctx.fillStyle = '#fff'; // a transparent PNG would otherwise turn black as a JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const preview = canvas.toDataURL('image/jpeg', 0.85);
  return { mimeType: 'image/jpeg', base64: preview.slice(preview.indexOf(',') + 1), preview };
}
