import type { ImageProbe } from './imageProbe';
import {
  BUILD_PASS_ORDER,
  type ComponentSpec,
  type MaterialSpec,
  type ObjectSculptSpec,
  type Vec3,
} from '../types/spec';

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'object'
  );
}

/**
 * Author a draft ObjectSculptSpec from image probe evidence.
 * Spec describes the relief assembly; geometry comes from createReliefModel.
 */
export function authorSpecFromProbe(probe: ImageProbe): ObjectSculptSpec {
  const baseName = slug(probe.fileName);
  const displayName = baseName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const materials: MaterialSpec[] = [
    {
      id: 'mat-0',
      name: '体积',
      color: probe.palette[0] ?? '#c4a484',
      roughness: 0.7,
      metalness: 0.02,
    },
    {
      id: 'mat-cutout',
      name: '剪影贴图',
      color: '#ffffff',
      roughness: 0.55,
      metalness: 0,
    },
    {
      id: 'mat-1',
      name: '背板',
      color: probe.palette[1] ?? '#6b4f3a',
      roughness: 0.9,
      metalness: 0,
    },
    {
      id: 'mat-2',
      name: '底座',
      color: probe.palette[2] ?? '#8d7b68',
      roughness: 0.95,
      metalness: 0,
    },
    ...probe.palette.slice(0, 4).map((color, i) => ({
      id: `mat-accent-${i}`,
      name: `色板 ${i + 1}`,
      color,
      roughness: 0.6,
      metalness: 0.05,
    })),
  ];

  const sil = probe.silhouette;
  const height = 1.55;
  const width = height * (sil.w / Math.max(sil.h, 0.01));

  const cutout: ComponentSpec = {
    id: 'cutout',
    name: '参考剪影',
    kind: 'part',
    primitive: 'box',
    size: v(width, height, 0.02),
    position: v(0, height * 0.5, 0.02),
    materialId: 'mat-cutout',
    level: 'macro',
  };

  const volume: ComponentSpec = {
    id: 'volume',
    name: '彩色体积',
    kind: 'part',
    primitive: 'box',
    size: v(width, height, 0.28),
    position: v(0, height * 0.5, -0.12),
    materialId: 'mat-0',
    level: 'macro',
  };

  const backing: ComponentSpec = {
    id: 'backing',
    name: '背板',
    kind: 'part',
    primitive: 'box',
    size: v(width * 0.98, height * 0.98, 0.01),
    position: v(0, height * 0.5, -0.3),
    materialId: 'mat-1',
    level: 'meso',
  };

  const stand: ComponentSpec = {
    id: 'stand',
    name: '底座',
    kind: 'part',
    primitive: 'cylinder',
    size: v(width * 0.25, 0.03, width * 0.25),
    position: v(0, 0.015, 0),
    materialId: 'mat-2',
    level: 'micro',
  };

  const root: ComponentSpec = {
    id: 'root',
    name: displayName,
    kind: 'assembly',
    children: [cutout, volume, backing, stand],
  };

  return {
    schemaVersion: 'img-stage/2-relief',
    name: displayName,
    subjectClass: probe.likelyCharacter ? 'character' : 'object',
    referenceImageName: probe.fileName,
    palette: probe.palette,
    materials,
    root,
    buildMode: 'relief',
    sockets: [
      {
        id: 'socket-front',
        name: '正面',
        parentId: 'cutout',
        position: v(0, 0, 0.05),
      },
    ],
    buildPasses: BUILD_PASS_ORDER.map((id, i) => ({
      id,
      status: i === 0 ? 'active' : 'locked',
    })),
    reviewHistory: [],
    createdAt: new Date().toISOString(),
  };
}
