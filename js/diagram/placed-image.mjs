// 配置した画像は埋め込みデータとして保存し、外部ファイルに依存しない。
export const isEmbeddedImage = src => typeof src === 'string' && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
export function imagePrimitive(item) {
  if (!isEmbeddedImage(item.src) || ![item.x,item.y,item.w,item.h].every(Number.isFinite) || item.w <= 0 || item.h <= 0) return null;
  return {k:'image', src:item.src, x:item.x, y:item.y, w:item.w, h:item.h};
}
export function resizeImage(fixed, pointer, ratio) {
  const dx = pointer.x - fixed.x, dy = pointer.y - fixed.y;
  const w = Math.max(20, 20 * ratio, Math.abs(dx), Math.abs(dy) * ratio), h = w / ratio;
  return {x:dx < 0 ? fixed.x-w : fixed.x, y:dy < 0 ? fixed.y-h : fixed.y, w, h};
}
export async function readPlacedImage(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('画像は20MB以下にしてください。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw new Error('PNGまたはJPEGの画像を選んでください。');
  const url = URL.createObjectURL(new Blob([bytes], {type:png ? 'image/png' : 'image/jpeg'}));
  try {
    const img = new Image();
    await new Promise((resolve,reject) => { img.onload=resolve; img.onerror=()=>reject(new Error('画像を読み込めませんでした。別のPNG・JPEGをお試しください。')); img.src=url; });
    const w=img.naturalWidth, h=img.naturalHeight;
    if (!w || !h || w*h > 40000000 || w > 16384 || h > 16384) throw new Error('画像が大きすぎます。縦横のサイズを小さくしてから読み込んでください。');
    // JPEGの回転情報も見た目に反映し、書き出したPDFで向きが変わらないようにする。
    const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
    canvas.getContext('2d').drawImage(img,0,0);
    const src=canvas.toDataURL(png ? 'image/png' : 'image/jpeg',0.98);
    if (!isEmbeddedImage(src)) throw new Error('画像を取り込めませんでした。');
    return {src,w,h};
  } finally { URL.revokeObjectURL(url); }
}
