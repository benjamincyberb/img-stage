export interface ImageProbe {
  width: number;
  height: number;
  aspect: number;
  palette: string[];
  brightness: number;
  silhouette: { x: number; y: number; w: number; h: number };
  /** 0 = background, 1 = foreground */
  maskGrid: Float32Array;
  /** RGB 0–1 packed as r,g,b per cell */
  colorGrid: Float32Array;
  /** 0–1 luminance */
  lumaGrid: Float32Array;
  gridW: number;
  gridH: number;
  /** Original object URL */
  objectUrl: string;
  /** Transparent-background cutout as object URL (PNG) */
  cutoutUrl: string;
  fileName: string;
  likelyCharacter: boolean;
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function quantizeBucket(r: number, g: number, b: number): string {
  const q = (v: number) => Math.round(v / 24) * 24;
  return `${q(r)},${q(g)},${q(b)}`;
}

function colorDist(r: number, g: number, b: number, br: number, bg: number, bb: number) {
  const dr = r - br;
  const dg = g - bg;
  const db = b - bb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export async function probeImage(file: File): Promise<ImageProbe> {
  const objectUrl = URL.createObjectURL(file);
  const img = await loadImage(objectUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // Working resolution for mask / voxels
  const maxSide = 128;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(img, 0, 0, cw, ch);
  const { data } = ctx.getImageData(0, 0, cw, ch);

  // Estimate background from corners
  const cornerSamples: Array<[number, number, number]> = [];
  const sampleCorner = (x: number, y: number) => {
    const i = (y * cw + x) * 4;
    cornerSamples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (const [cx, cy] of [
    [0, 0],
    [cw - 1, 0],
    [0, ch - 1],
    [cw - 1, ch - 1],
    [Math.floor(cw / 2), 0],
    [0, Math.floor(ch / 2)],
  ] as const) {
    sampleCorner(cx, cy);
  }
  const bgR = cornerSamples.reduce((s, c) => s + c[0], 0) / cornerSamples.length;
  const bgG = cornerSamples.reduce((s, c) => s + c[1], 0) / cornerSamples.length;
  const bgB = cornerSamples.reduce((s, c) => s + c[2], 0) / cornerSamples.length;
  const bgBright = (bgR + bgG + bgB) / 3;
  // White / light studio backgrounds need a looser threshold
  const bgThreshold = bgBright > 200 ? 42 : bgBright > 160 ? 36 : 28;

  const maskGrid = new Float32Array(cw * ch);
  const lumaGrid = new Float32Array(cw * ch);
  const colorGrid = new Float32Array(cw * ch * 3);

  const counts = new Map<string, { n: number; r: number; g: number; b: number }>();
  let brightSum = 0;
  let minX = cw;
  let minY = ch;
  let maxX = 0;
  let maxY = 0;
  let solid = 0;

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3] / 255;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lumaGrid[y * cw + x] = luma;
      brightSum += luma;

      const dist = colorDist(r, g, b, bgR, bgG, bgB);
      const isBg = a < 0.12 || dist < bgThreshold;
      const fg = !isBg && a > 0.15 ? 1 : 0;
      maskGrid[y * cw + x] = fg;
      const ci = (y * cw + x) * 3;
      colorGrid[ci] = r / 255;
      colorGrid[ci + 1] = g / 255;
      colorGrid[ci + 2] = b / 255;

      if (fg) {
        solid++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        // Skip near-black / near-white for palette (prefer mid tones like cloth/skin)
        if (luma > 0.08 && luma < 0.92) {
          const key = quantizeBucket(r, g, b);
          const prev = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
          prev.n += 1;
          prev.r += r;
          prev.g += g;
          prev.b += b;
          counts.set(key, prev);
        }
      }
    }
  }

  if (solid < 8) {
    minX = Math.floor(cw * 0.15);
    minY = Math.floor(ch * 0.1);
    maxX = Math.floor(cw * 0.85);
    maxY = Math.floor(ch * 0.9);
  }

  // Pad bbox slightly
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(cw - 1, maxX + pad);
  maxY = Math.min(ch - 1, maxY + pad);

  const sorted = [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 6)
    .map(([, v]) => rgbToHex(v.r / v.n, v.g / v.n, v.b / v.n));

  const palette =
    sorted.length >= 2
      ? sorted
      : ['#c4a484', '#6b4f3a', '#3d405b', '#e07a5f', '#f2cc8f'];

  const silW = (maxX - minX + 1) / cw;
  const silH = (maxY - minY + 1) / ch;
  const likelyCharacter = silH > 0.45 && silW < 0.95 && solid / (cw * ch) < 0.72;

  // High-res cutout with knocked-out background
  const cutoutUrl = await makeCutoutUrl(img, bgR, bgG, bgB, bgThreshold);

  return {
    width,
    height,
    aspect: width / height,
    palette,
    brightness: brightSum / (cw * ch),
    silhouette: {
      x: minX / cw,
      y: minY / ch,
      w: silW,
      h: silH,
    },
    maskGrid,
    colorGrid,
    lumaGrid,
    gridW: cw,
    gridH: ch,
    objectUrl,
    cutoutUrl,
    fileName: file.name,
    likelyCharacter,
  };
}

async function makeCutoutUrl(
  img: HTMLImageElement,
  bgR: number,
  bgG: number,
  bgB: number,
  bgThreshold: number
): Promise<string> {
  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  // Soft edge knockout
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const dist = colorDist(r, g, b, bgR, bgG, bgB);
    if (dist < bgThreshold) {
      d[i + 3] = 0;
    } else if (dist < bgThreshold + 18) {
      d[i + 3] = Math.round(((dist - bgThreshold) / 18) * d[i + 3]);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return '';
  return URL.createObjectURL(blob);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}
