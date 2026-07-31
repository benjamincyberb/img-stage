import * as THREE from 'three';
import type { ImageProbe } from './imageProbe';
import { createReliefModel } from './buildRelief';
import type {
  BuildPassId,
  ComponentSpec,
  MaterialSpec,
  ObjectSculptSpec,
  PrimitiveKind,
} from '../types/spec';
import { BUILD_PASS_ORDER } from '../types/spec';

const PASS_LEVEL: Record<BuildPassId, Set<'macro' | 'meso' | 'micro'>> = {
  blockout: new Set(['macro']),
  'structural-pass': new Set(['macro', 'meso']),
  'form-refinement': new Set(['macro', 'meso', 'micro']),
  'material-pass': new Set(['macro', 'meso', 'micro']),
  'surface-pass': new Set(['macro', 'meso', 'micro']),
  'lighting-pass': new Set(['macro', 'meso', 'micro']),
  'interaction-pass': new Set(['macro', 'meso', 'micro']),
  'optimization-pass': new Set(['macro', 'meso', 'micro']),
};

function passIndex(id: BuildPassId): number {
  return BUILD_PASS_ORDER.indexOf(id);
}

function createGeometry(kind: PrimitiveKind, size: { x: number; y: number; z: number }) {
  switch (kind) {
    case 'sphere':
      return new THREE.SphereGeometry(Math.max(size.x, size.y, size.z) * 0.5, 24, 16);
    case 'ellipsoid': {
      const g = new THREE.SphereGeometry(0.5, 24, 16);
      g.scale(size.x, size.y, size.z);
      return g;
    }
    case 'cylinder':
      return new THREE.CylinderGeometry(size.x * 0.5, size.z * 0.5, size.y, 24);
    case 'cone':
      return new THREE.ConeGeometry(size.x * 0.5, size.y, 24);
    case 'capsule':
      return new THREE.CapsuleGeometry(
        Math.min(size.x, size.z) * 0.5,
        Math.max(0.01, size.y - size.x),
        6,
        12
      );
    case 'torus':
      return new THREE.TorusGeometry(size.x * 0.35, size.y * 0.12, 12, 32);
    case 'box':
    default:
      return new THREE.BoxGeometry(size.x, size.y, size.z);
  }
}

function materialFor(
  mat: MaterialSpec | undefined,
  passId: BuildPassId,
  fallback: string
): THREE.Material {
  const color = mat?.color ?? fallback;
  const idx = passIndex(passId);
  if (idx <= 0) {
    return new THREE.MeshStandardMaterial({
      color: '#b7a99a',
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: mat?.roughness ?? 0.5,
    metalness: mat?.metalness ?? 0.05,
    flatShading: idx < 2,
  });
}

function matMap(spec: ObjectSculptSpec): Map<string, MaterialSpec> {
  return new Map(spec.materials.map((m) => [m.id, m]));
}

function shouldInclude(part: ComponentSpec, passId: BuildPassId): boolean {
  if (part.visible === false) return false;
  const level = part.level ?? 'macro';
  return PASS_LEVEL[passId].has(level);
}

function buildPart(
  part: ComponentSpec,
  materials: Map<string, MaterialSpec>,
  passId: BuildPassId,
  nodes: Record<string, THREE.Object3D>
): THREE.Object3D | null {
  if (part.kind === 'assembly') {
    const group = new THREE.Group();
    group.name = part.name;
    group.userData.componentId = part.id;
    for (const child of part.children ?? []) {
      const built = buildPart(child, materials, passId, nodes);
      if (built) group.add(built);
    }
    nodes[part.id] = group;
    return group;
  }

  if (!shouldInclude(part, passId)) return null;
  if (!part.primitive || !part.size) return null;

  const geo = createGeometry(part.primitive, part.size);
  const mat = materialFor(materials.get(part.materialId ?? ''), passId, '#9a8f82');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = part.name;
  mesh.castShadow = passIndex(passId) >= 1;
  mesh.receiveShadow = true;
  mesh.userData.componentId = part.id;
  mesh.userData.materialId = part.materialId;
  if (part.position) mesh.position.set(part.position.x, part.position.y, part.position.z);
  if (part.rotation) mesh.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
  nodes[part.id] = mesh;
  return mesh;
}

export interface BuiltModel {
  root: THREE.Group;
  nodes: Record<string, THREE.Object3D>;
  passId: BuildPassId;
}

export async function createModelFromSpec(
  spec: ObjectSculptSpec,
  passId: BuildPassId,
  probe?: ImageProbe | null
): Promise<BuiltModel> {
  if ((spec.buildMode ?? 'relief') === 'relief' && probe) {
    const relief = await createReliefModel({ probe, passId });
    relief.root.userData.sculptRuntime = {
      nodes: relief.nodes,
      sockets: {},
      passId,
      specName: spec.name,
      buildMode: 'relief',
    };
    return { root: relief.root, nodes: relief.nodes, passId };
  }

  const materials = matMap(spec);
  const nodes: Record<string, THREE.Object3D> = {};
  const root = new THREE.Group();
  root.name = spec.name;
  const built = buildPart(spec.root, materials, passId, nodes);
  if (built) root.add(built);

  root.userData.sculptRuntime = {
    nodes,
    sockets: {},
    passId,
    specName: spec.name,
  };

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  return { root, nodes, passId };
}

export function applyMaterialOverrides(
  root: THREE.Object3D,
  materialId: string,
  patch: Partial<MaterialSpec>
) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.userData.materialId !== materialId) return;
    const mat = obj.material as THREE.MeshStandardMaterial;
    // Don't wipe textured cutout with a flat color unless user forces it
    if (patch.color && !mat.map) mat.color.set(patch.color);
    if (patch.color && mat.map && materialId !== 'mat-cutout') mat.color.set(patch.color);
    if (patch.roughness != null) mat.roughness = patch.roughness;
    if (patch.metalness != null) mat.metalness = patch.metalness;
    mat.needsUpdate = true;
  });
}

export function setPartVisible(root: THREE.Object3D, componentId: string, visible: boolean) {
  root.traverse((obj) => {
    if (obj.userData.componentId === componentId) obj.visible = visible;
  });
}
