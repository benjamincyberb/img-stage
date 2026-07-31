/** Subset of img2threejs ObjectSculptSpec — enough for browser pass builds. */

export type PrimitiveKind =
  | 'box'
  | 'sphere'
  | 'ellipsoid'
  | 'cylinder'
  | 'cone'
  | 'capsule'
  | 'torus';

export type BuildPassId =
  | 'blockout'
  | 'structural-pass'
  | 'form-refinement'
  | 'material-pass'
  | 'surface-pass'
  | 'lighting-pass'
  | 'interaction-pass'
  | 'optimization-pass';

export const BUILD_PASS_ORDER: BuildPassId[] = [
  'blockout',
  'structural-pass',
  'form-refinement',
  'material-pass',
  'surface-pass',
  'lighting-pass',
  'interaction-pass',
  'optimization-pass',
];

export const PASS_LABELS: Record<BuildPassId, string> = {
  blockout: '体块',
  'structural-pass': '结构',
  'form-refinement': '形体',
  'material-pass': '材质',
  'surface-pass': '表面',
  'lighting-pass': '灯光',
  'interaction-pass': '交互',
  'optimization-pass': '优化',
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MaterialSpec {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
}

export interface ComponentSpec {
  id: string;
  name: string;
  kind: 'assembly' | 'part';
  primitive?: PrimitiveKind;
  size?: Vec3;
  position?: Vec3;
  rotation?: Vec3;
  materialId?: string;
  children?: ComponentSpec[];
  visible?: boolean;
  /** Detail level unlocked by pass */
  level?: 'macro' | 'meso' | 'micro';
}

export interface SocketSpec {
  id: string;
  name: string;
  parentId: string;
  position: Vec3;
}

export interface BuildPassState {
  id: BuildPassId;
  status: 'locked' | 'active' | 'continue' | 'pending';
  score?: number;
  note?: string;
}

export interface ObjectSculptSpec {
  schemaVersion: string;
  name: string;
  subjectClass: 'object' | 'character' | 'hybrid';
  /** relief = textured silhouette volume (default for image likeness) */
  buildMode?: 'relief' | 'primitives';
  referenceImageName?: string;
  palette: string[];
  materials: MaterialSpec[];
  root: ComponentSpec;
  sockets: SocketSpec[];
  buildPasses: BuildPassState[];
  reviewHistory: Array<{
    passId: BuildPassId;
    action: 'continue' | 'refine-spec' | 'refine-code';
    score: number;
    at: string;
  }>;
  createdAt: string;
}

export interface PipelineProgress {
  phase: 'idle' | 'probing' | 'spec' | 'building' | 'done' | 'error';
  passId?: BuildPassId;
  passIndex: number;
  passTotal: number;
  message: string;
  percent: number;
}
