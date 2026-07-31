import * as THREE from 'three';
import type { ImageProbe } from './imageProbe';
import type { BuildPassId } from '../types/spec';
import { BUILD_PASS_ORDER } from '../types/spec';

function passIndex(id: BuildPassId): number {
  return BUILD_PASS_ORDER.indexOf(id);
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

/** Distance-to-edge transform on binary mask (chessboard approx). */
function distanceTransform(mask: Float32Array, w: number, h: number): Float32Array {
  const dist = new Float32Array(w * h);
  const INF = w + h;
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] > 0.5 ? INF : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1);
    }
  }
  return dist;
}

export interface ReliefOptions {
  probe: ImageProbe;
  passId: BuildPassId;
  worldHeight?: number;
}

/**
 * Build a likeness-first model:
 * - front cutout plane textured with the reference (crisp face / details)
 * - colored voxel volume behind it for real depth
 * Passes increase voxel density and depth sculpting.
 */
export async function createReliefModel(options: ReliefOptions): Promise<{
  root: THREE.Group;
  nodes: Record<string, THREE.Object3D>;
}> {
  const { probe, passId } = options;
  const idx = passIndex(passId);
  const worldHeight = options.worldHeight ?? 1.55;

  const sil = probe.silhouette;
  const x0 = Math.floor(sil.x * probe.gridW);
  const y0 = Math.floor(sil.y * probe.gridH);
  const x1 = Math.min(probe.gridW - 1, Math.ceil((sil.x + sil.w) * probe.gridW));
  const y1 = Math.min(probe.gridH - 1, Math.ceil((sil.y + sil.h) * probe.gridH));
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);

  const aspect = bw / bh;
  const height = worldHeight;
  const width = height * aspect;

  // Voxel step grows finer with passes
  const step = idx <= 0 ? 3 : idx <= 2 ? 2 : 1;
  const cellW = width / (bw / step);
  const cellH = height / (bh / step);

  // Cropped mask for distance transform
  const cropMask = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      cropMask[y * bw + x] = probe.maskGrid[(y0 + y) * probe.gridW + (x0 + x)];
    }
  }
  const dist = distanceTransform(cropMask, bw, bh);
  let maxDist = 1;
  for (let i = 0; i < dist.length; i++) maxDist = Math.max(maxDist, dist[i]);

  const baseDepth = idx <= 0 ? 0.12 : idx <= 2 ? 0.18 : 0.26;
  const depthBoost = idx <= 0 ? 0.1 : idx <= 3 ? 0.22 : 0.34;

  const root = new THREE.Group();
  root.name = 'relief-root';
  const nodes: Record<string, THREE.Object3D> = {};

  // --- Volume: colored voxels from image ---
  const volume = new THREE.Group();
  volume.name = 'Volume';
  volume.userData.componentId = 'volume';

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertCount = 0;

  const pushBox = (
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    g: number,
    b: number
  ) => {
    const hx = sx * 0.5;
    const hy = sy * 0.5;
    const hz = sz * 0.5;
    const faces: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
      {
        n: [0, 0, 1],
        v: [
          [cx - hx, cy - hy, cz + hz],
          [cx + hx, cy - hy, cz + hz],
          [cx + hx, cy + hy, cz + hz],
          [cx - hx, cy + hy, cz + hz],
        ],
      },
      {
        n: [0, 0, -1],
        v: [
          [cx + hx, cy - hy, cz - hz],
          [cx - hx, cy - hy, cz - hz],
          [cx - hx, cy + hy, cz - hz],
          [cx + hx, cy + hy, cz - hz],
        ],
      },
      {
        n: [0, 1, 0],
        v: [
          [cx - hx, cy + hy, cz + hz],
          [cx + hx, cy + hy, cz + hz],
          [cx + hx, cy + hy, cz - hz],
          [cx - hx, cy + hy, cz - hz],
        ],
      },
      {
        n: [0, -1, 0],
        v: [
          [cx - hx, cy - hy, cz - hz],
          [cx + hx, cy - hy, cz - hz],
          [cx + hx, cy - hy, cz + hz],
          [cx - hx, cy - hy, cz + hz],
        ],
      },
      {
        n: [1, 0, 0],
        v: [
          [cx + hx, cy - hy, cz + hz],
          [cx + hx, cy - hy, cz - hz],
          [cx + hx, cy + hy, cz - hz],
          [cx + hx, cy + hy, cz + hz],
        ],
      },
      {
        n: [-1, 0, 0],
        v: [
          [cx - hx, cy - hy, cz - hz],
          [cx - hx, cy - hy, cz + hz],
          [cx - hx, cy + hy, cz + hz],
          [cx - hx, cy + hy, cz - hz],
        ],
      },
    ];

    for (const face of faces) {
      const base = vertCount;
      for (const [px, py, pz] of face.v) {
        positions.push(px, py, pz);
        normals.push(face.n[0], face.n[1], face.n[2]);
        colors.push(r, g, b);
        vertCount++;
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };

  for (let y = 0; y < bh; y += step) {
    for (let x = 0; x < bw; x += step) {
      // Require majority of the block to be foreground
      let fg = 0;
      let samples = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let dMax = 0;
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= bw || yy >= bh) continue;
          samples++;
          const mi = yy * bw + xx;
          if (cropMask[mi] > 0.5) {
            fg++;
            const gi = ((y0 + yy) * probe.gridW + (x0 + xx)) * 3;
            rSum += probe.colorGrid[gi];
            gSum += probe.colorGrid[gi + 1];
            bSum += probe.colorGrid[gi + 2];
            dMax = Math.max(dMax, dist[mi]);
          }
        }
      }
      if (fg < samples * 0.35 || fg === 0) continue;

      const r = rSum / fg;
      const g = gSum / fg;
      const b = bSum / fg;
      const nd = dMax / maxDist;
      const depth = baseDepth + nd * depthBoost;

      // Image y is top-down; world y is up
      const wx = ((x + step * 0.5) / bw - 0.5) * width;
      const wy = (1 - (y + step * 0.5) / bh) * height;
      const wz = -depth * 0.5;

      pushBox(wx, wy, wz, cellW * 1.02, cellH * 1.02, depth, r, g, b);
    }
  }

  const volumeGeo = new THREE.BufferGeometry();
  volumeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  volumeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  volumeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  volumeGeo.setIndex(indices);
  volumeGeo.computeBoundingSphere();

  const volumeMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: idx < 3 ? 0.85 : 0.55,
    metalness: 0.02,
    flatShading: idx < 2,
  });
  const volumeMesh = new THREE.Mesh(volumeGeo, volumeMat);
  volumeMesh.castShadow = true;
  volumeMesh.receiveShadow = true;
  volumeMesh.userData.componentId = 'volume';
  volumeMesh.userData.materialId = 'mat-0';
  volume.add(volumeMesh);
  root.add(volume);
  nodes.volume = volume;

  // --- Front cutout: full-res textured plane for likeness ---
  if (probe.cutoutUrl) {
    const tex = await loadTexture(probe.cutoutUrl);
    const cutout = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.08,
        roughness: 0.62,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: true,
      })
    );
    cutout.name = 'Cutout';
    cutout.position.set(0, height * 0.5, 0.02);
    cutout.castShadow = idx >= 1;
    cutout.userData.componentId = 'cutout';
    cutout.userData.materialId = 'mat-cutout';
    // Early passes: slight opacity blend so voxels read as structure
    if (idx === 0) {
      (cutout.material as THREE.MeshStandardMaterial).opacity = 0.92;
      (cutout.material as THREE.MeshStandardMaterial).transparent = true;
    }
    root.add(cutout);
    nodes.cutout = cutout;

    // Thin back card for thickness read
    if (idx >= 1) {
      const back = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.98, height * 0.98),
        new THREE.MeshStandardMaterial({
          color: probe.palette[1] ?? '#5c4033',
          roughness: 0.9,
          metalness: 0,
          side: THREE.BackSide,
        })
      );
      back.position.set(0, height * 0.5, -baseDepth - depthBoost * 0.35);
      back.userData.componentId = 'backing';
      back.userData.materialId = 'mat-1';
      root.add(back);
      nodes.backing = back;
    }
  }

  // Ground contact disc (subtle)
  if (idx >= 2) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.min(width, height) * 0.22, Math.min(width, height) * 0.28, 0.03, 24),
      new THREE.MeshStandardMaterial({
        color: probe.palette[2] ?? '#8d7b68',
        roughness: 0.95,
        metalness: 0,
      })
    );
    pad.position.y = 0.015;
    pad.receiveShadow = true;
    pad.userData.componentId = 'stand';
    pad.userData.materialId = 'mat-2';
    root.add(pad);
    nodes.stand = pad;
  }

  // Place feet on ground
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;

  return { root, nodes };
}
