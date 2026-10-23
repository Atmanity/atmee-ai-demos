// The outfit photo, prepared in the browser: a dropped or uploaded file (or
// the bundled sample) is decoded, scaled so its longer side is at most 1280
// px, and re-encoded as JPEG. The original downscaled to 1024 px on the server
// before every read (Pillow); here it happens once, before upload, which also
// keeps the request small. The camera is never opened: the photo is a file.
export const MAX_SIDE = 1280;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** The size that fits within `max` on its longer side, keeping the aspect ratio (never upscaled). */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!longest || longest <= max) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface PreparedPhoto { mime: 'image/jpeg'; data: string; preview: string }

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('That is not an image: a JPEG, PNG or WebP photo works.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That photo is too large (25 MB at most).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That photo couldn't be read here: a JPEG, PNG or WebP works.");
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.88));
  return { mime: 'image/jpeg', data: await toBase64(jpeg), preview: URL.createObjectURL(jpeg) };
}
