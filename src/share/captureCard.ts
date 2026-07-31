export interface CardPayload {
  title: string;
  subtitle: string;
  passLabel: string;
  palette: string[];
  referenceUrl?: string;
  stageCanvas: HTMLCanvasElement;
  collectionNo: number;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

/** Meow-style collectible PNG — generic object card, not cat-themed. */
export async function captureCollectibleCard(payload: CardPayload): Promise<Blob> {
  const W = 1080;
  const H = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context missing');

  // Atmosphere wash
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1a222c');
  bg.addColorStop(0.45, '#243142');
  bg.addColorStop(1, '#3d2c29');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Noise-ish dots
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Brand
  ctx.fillStyle = '#f4a261';
  ctx.font = '700 42px "Bricolage Grotesque", system-ui';
  ctx.fillText('STAGE', 72, 90);
  ctx.fillStyle = 'rgba(241,231,212,0.55)';
  ctx.font = '500 22px Figtree, system-ui';
  ctx.fillText('参考图 → Three.js', 72, 126);

  // Collection meta
  const rarity = payload.collectionNo % 17 === 0 ? 'AR' : payload.collectionNo % 5 === 0 ? 'SR' : 'R';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e9c46a';
  ctx.font = '700 28px Figtree, system-ui';
  ctx.fillText(rarity, W - 72, 90);
  ctx.fillStyle = 'rgba(241,231,212,0.7)';
  ctx.font = '500 20px Figtree, system-ui';
  ctx.fillText(`No. ${String(payload.collectionNo).padStart(4, '0')} / 9999`, W - 72, 124);
  ctx.textAlign = 'left';

  // Stage frame
  const frameX = 72;
  const frameY = 170;
  const frameW = W - 144;
  const frameH = 780;
  roundRect(ctx, frameX, frameY, frameW, frameH, 28);
  ctx.fillStyle = '#0f1419';
  ctx.fill();

  // Draw 3D capture into frame
  const src = payload.stageCanvas;
  const srcAspect = src.width / src.height;
  const frameAspect = frameW / frameH;
  let dw = frameW;
  let dh = frameH;
  let dx = frameX;
  let dy = frameY;
  if (srcAspect > frameAspect) {
    dh = frameW / srcAspect;
    dy = frameY + (frameH - dh) / 2;
  } else {
    dw = frameH * srcAspect;
    dx = frameX + (frameW - dw) / 2;
  }
  ctx.save();
  roundRect(ctx, frameX, frameY, frameW, frameH, 28);
  ctx.clip();
  ctx.drawImage(src, dx, dy, dw, dh);
  ctx.restore();

  // Title block
  ctx.fillStyle = '#f1e7d4';
  ctx.font = '800 54px "Bricolage Grotesque", system-ui';
  wrapText(ctx, payload.title || 'Untitled object', 72, 1040, W - 200, 58);

  ctx.fillStyle = 'rgba(241,231,212,0.65)';
  ctx.font = '500 24px Figtree, system-ui';
  ctx.fillText(payload.subtitle, 72, 1110);
  ctx.fillText(`阶段 · ${payload.passLabel}`, 72, 1148);

  // Palette chips
  const chips = payload.palette.slice(0, 5);
  chips.forEach((c, i) => {
    const cx = 72 + i * 52;
    const cy = 1210;
    ctx.beginPath();
    ctx.arc(cx + 18, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
  });

  // Footer
  ctx.fillStyle = 'rgba(241,231,212,0.4)';
  ctx.font = '500 18px Figtree, system-ui';
  ctx.fillText('本地优先 · 无需账号 · img-stage', 72, H - 56);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG encode failed'));
    }, 'image/png');
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
