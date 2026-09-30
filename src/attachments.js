// Images live in IndexedDB as blobs. Stored HTML uses "att:ID" as the src;
// in the editor they are swapped for object URLs and swapped back on save.
import { uid, getAttachment, putAttachment } from './db.js';

const MAX_SIDE = 2000;
const urlById = new Map();
const idByUrl = new Map();

async function urlFor(id) {
  if (urlById.has(id)) return urlById.get(id);
  const att = await getAttachment(id);
  if (!att) return '';
  const url = URL.createObjectURL(att.blob);
  urlById.set(id, url);
  idByUrl.set(url, id);
  return url;
}

export async function resolveHtml(html) {
  const ids = [...new Set([...html.matchAll(/att:([a-z0-9]+)/g)].map(m => m[1]))];
  await Promise.all(ids.map(urlFor));
  return html.replace(/att:([a-z0-9]+)/g, (_, id) => urlById.get(id) || '');
}

export function unresolveHtml(html) {
  return html.replace(/blob:[^"'\s)]+/g, url => (idByUrl.has(url) ? `att:${idByUrl.get(url)}` : url));
}

// Phone photos are huge; shrink anything over MAX_SIDE so storage and later sync stay light.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1) { bmp.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise(r => canvas.toBlob(b => r(b || file), 'image/webp', 0.85));
  } catch {
    return file;
  }
}

// Returns the attachment id; images are shrunk, other files kept as-is.
export async function storeBlob(file, name = '') {
  const blob = file.type.startsWith('image/') ? await shrink(file) : file;
  const id = uid();
  await putAttachment({ id, blob, type: blob.type, name, createdAt: Date.now() });
  return id;
}

export async function storeImage(file) {
  return urlFor(await storeBlob(file));
}
