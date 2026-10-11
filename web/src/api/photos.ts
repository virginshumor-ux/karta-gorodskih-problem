/**
 * Photos are re-encoded on the device: max 1280 px on the long side, JPEG quality 0.8.
 * Re-encoding through a canvas drops all EXIF (location, camera); the orientation is applied first.
 */
export const MAX_SIDE = 1280;
export const MAX_BYTES = 2 * 1024 * 1024;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall back to <img> (e.g. HEIC on some browsers fails in both) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function compress(file: Blob, max = MAX_SIDE, quality = 0.8): Promise<Blob> {
  const img = await decode(file);
  const w = "naturalWidth" in img ? img.naturalWidth : img.width;
  const h = "naturalHeight" in img ? img.naturalHeight : img.height;
  const k = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  const g = cv.getContext("2d");
  if (!g) throw new Error("canvas");
  g.drawImage(img, 0, 0, cv.width, cv.height);
  if ("close" in img) img.close();
  let q = quality;
  let blob = await toBlob(cv, q);
  // Storage accepts up to 2 MB; very detailed photos get a lower quality instead of a failed upload.
  while (blob.size > MAX_BYTES && q > 0.4) {
    q -= 0.15;
    blob = await toBlob(cv, q);
  }
  return blob;
}

function toBlob(cv: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", q));
}

/** Placeholder picture for demonstrations without a camera (same drawing as the prototype). */
export function demoPhoto(): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = 800;
  cv.height = 600;
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  const grd = g.createLinearGradient(0, 0, 800, 600);
  grd.addColorStop(0, "#9fb3b5");
  grd.addColorStop(1, "#4d6466");
  g.fillStyle = grd;
  g.fillRect(0, 0, 800, 600);
  g.fillStyle = "#3a4a4b";
  g.fillRect(0, 380, 800, 220);
  g.fillStyle = "#26302f";
  g.beginPath();
  g.ellipse(400, 470, 170, 55, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,.9)";
  g.font = "600 34px Golos Text, sans-serif";
  g.textAlign = "center";
  g.fillText("Демо-иллюстрация", 400, 120);
  g.font = "24px Golos Text, sans-serif";
  g.fillText("вместо фото проблемы", 400, 160);
  return toBlob(cv, 0.8);
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}
