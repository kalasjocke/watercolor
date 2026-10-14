import type { Asset } from './graph';

export const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];

export async function readImageFile(file: File): Promise<Asset> {
  if (!acceptedTypes.includes(file.type)) {
    const heic = /\.hei[cf]$/i.test(file.name) || /hei[cf]/.test(file.type);
    throw new Error(heic ? `${file.name} is a HEIC photo. Export it as JPEG first; HEIC support is planned.` : `${file.name} isn't supported. Use JPEG, PNG or WebP.`);
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error(`${file.name} couldn't be read. The file may be damaged.`); }
  const asset = { id: crypto.randomUUID(), blob: file, filename: file.name, width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return asset;
}
