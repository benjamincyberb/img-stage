import { authorSpecFromProbe } from './authorSpec';
import { createModelFromSpec, type BuiltModel } from './buildFactory';
import { probeImage, type ImageProbe } from './imageProbe';
import {
  getJob,
  loadFactoryModule,
  loadSpec,
  pollJob,
  startGenerate,
  type JobStatus,
} from '../api/img2three';
import {
  BUILD_PASS_ORDER,
  type BuildPassId,
  type ObjectSculptSpec,
  type PipelineProgress,
} from '../types/spec';
import type { Group } from 'three';

export type ProgressHandler = (p: PipelineProgress) => void;
export type ModelHandler = (model: BuiltModel, spec: ObjectSculptSpec) => void;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapPass(passId?: string | null): BuildPassId | undefined {
  if (!passId) return undefined;
  return BUILD_PASS_ORDER.includes(passId as BuildPassId)
    ? (passId as BuildPassId)
    : undefined;
}

/**
 * Primary path: Claude Code + vendored img2threejs skill via local API.
 * While waiting, optionally emits a relief preview so the stage is never empty.
 */
export class SculptPipeline {
  private aborted = false;
  private abortPoll: AbortController | null = null;
  private onProgress: ProgressHandler;
  private onModel: ModelHandler;
  spec: ObjectSculptSpec | null = null;
  probe: ImageProbe | null = null;
  jobId: string | null = null;
  lastFactoryReady = false;

  constructor(onProgress: ProgressHandler, onModel: ModelHandler) {
    this.onProgress = onProgress;
    this.onModel = onModel;
  }

  abort() {
    this.aborted = true;
    this.abortPoll?.abort();
  }

  /** Mount an already-finished job (reuse prior createModel.ts / spec.json). */
  async loadExistingJob(id: string) {
    this.aborted = false;
    this.lastFactoryReady = false;
    this.jobId = id;
    this.onProgress({
      phase: 'building',
      passIndex: 0,
      passTotal: BUILD_PASS_ORDER.length,
      message: `正在加载已有工厂 ${id}…`,
      percent: 40,
    });
    const status = await getJob(id);
    if (!(status.hasFactory || status.factoryReady)) {
      throw new Error(`任务 ${id} 还没有 createModel.ts`);
    }
    await this.loadRealFactory(id, status);
    this.onProgress({
      phase: 'done',
      passId: mapPass(status.passId) ?? 'optimization-pass',
      passIndex: BUILD_PASS_ORDER.length - 1,
      passTotal: BUILD_PASS_ORDER.length,
      message: status.message || '已加载已有工厂',
      percent: 100,
    });
  }

  async runFromFile(file: File) {
    this.aborted = false;
    this.lastFactoryReady = false;
    this.onProgress({
      phase: 'probing',
      passIndex: 0,
      passTotal: BUILD_PASS_ORDER.length,
      message: '正在上传到 img2threejs…',
      percent: 2,
    });

    // Fast local probe + relief preview (fill the wait)
    this.probe = await probeImage(file);
    if (this.aborted) return;
    this.spec = authorSpecFromProbe(this.probe);
    this.spec.schemaVersion = 'img-stage/preview-relief';
    const preview = await createModelFromSpec(this.spec, 'blockout', this.probe);
    if (!this.aborted) {
      this.onModel(preview, this.spec);
      this.onProgress({
        phase: 'building',
        passId: 'blockout',
        passIndex: 0,
        passTotal: BUILD_PASS_ORDER.length,
        message: '预览已上舞台 · 请在 Cursor Agent 执行任务（可点「复制 Cursor 指令」）',
        percent: 8,
      });
    }

    const { id } = await startGenerate(file);
    this.jobId = id;
    if (this.aborted) return;

    this.abortPoll = new AbortController();
    let sawFactory = false;

    try {
      await pollJob(
        id,
        (status) => {
          void this.handleStatus(status).then((ready) => {
            if (ready) sawFactory = true;
          });
        },
        { signal: this.abortPoll.signal, intervalMs: 2000 }
      );
    } catch (err) {
      if (this.aborted) return;
      // Final attempt to load factory even if status error
      const status = await getJob(id).catch(() => null);
      if (status?.hasFactory || status?.factoryReady) {
        await this.loadRealFactory(id, status);
        this.onProgress({
          phase: 'done',
          passId: 'optimization-pass',
          passIndex: BUILD_PASS_ORDER.length - 1,
          passTotal: BUILD_PASS_ORDER.length,
          message: '已加载 img2threejs 工厂（含警告）',
          percent: 100,
        });
        return;
      }
      throw err;
    }

    if (this.aborted) return;

    // Ensure latest factory is mounted
    const finalStatus = await getJob(id);
    if (finalStatus.hasFactory || finalStatus.factoryReady || sawFactory) {
      await this.loadRealFactory(id, finalStatus);
    }

    this.onProgress({
      phase: 'done',
      passId: mapPass(finalStatus.passId) ?? 'optimization-pass',
      passIndex: BUILD_PASS_ORDER.length - 1,
      passTotal: BUILD_PASS_ORDER.length,
      message: 'img2threejs 重建完成',
      percent: 100,
    });
  }

  private async handleStatus(status: JobStatus): Promise<boolean> {
    if (this.aborted) return false;
    const passId = mapPass(status.passId);
    const passIndex = passId ? BUILD_PASS_ORDER.indexOf(passId) : 0;
    this.onProgress({
      phase:
        status.phase === 'done'
          ? 'done'
          : status.phase === 'error'
            ? 'error'
            : status.phase === 'spec' || status.phase === 'probing'
              ? (status.phase as 'spec' | 'probing')
              : 'building',
      passId,
      passIndex,
      passTotal: BUILD_PASS_ORDER.length,
      message: status.message || `img2threejs · ${status.phase}`,
      percent: Math.max(8, Math.min(99, status.percent || 8)),
    });

    if (status.hasFactory || status.factoryReady) {
      // Reload whenever agent rewrites factory (or first time)
      const stamp = status.updatedAt || '';
      const key = `${status.factoryReady}:${stamp}:${status.passId}`;
      if (key !== (this as { _factoryKey?: string })._factoryKey) {
        (this as { _factoryKey?: string })._factoryKey = key;
        await this.loadRealFactory(status.id, status);
        return true;
      }
      return this.lastFactoryReady;
    }
    return false;
  }

  private async loadRealFactory(id: string, status: JobStatus) {
    const mod = (await loadFactoryModule(id)) as Record<string, unknown>;
    const factory =
      mod.createObjectModel ||
      mod.default ||
      Object.values(mod).find((v) => typeof v === 'function');

    if (typeof factory !== 'function') {
      throw new Error('createModel.ts 没有可导出的工厂函数');
    }

    const root = (factory as (o?: { shadows?: boolean }) => Group)({ shadows: true });
    const passId = mapPass(status.passId) ?? 'form-refinement';

    const remoteSpec = await loadSpec(id);
    if (remoteSpec && typeof remoteSpec === 'object') {
      const baseSpec = this.spec ?? {
        schemaVersion: 'img2threejs',
        name: 'Object',
        subjectClass: 'object' as const,
        palette: [],
        materials: [],
        root: { id: 'root', name: 'root', kind: 'assembly' as const, children: [] },
        sockets: [],
        buildPasses: [],
        reviewHistory: [],
        createdAt: new Date().toISOString(),
      };
      const forgeRoot =
        (remoteSpec.root as ObjectSculptSpec['root']) ??
        (remoteSpec.componentTree
          ? {
              id: 'root',
              name: String(remoteSpec.targetName ?? remoteSpec.name ?? 'Object'),
              kind: 'assembly' as const,
              children: [],
            }
          : baseSpec.root);
      this.spec = {
        ...baseSpec,
        ...(remoteSpec as Partial<ObjectSculptSpec>),
        schemaVersion: String(remoteSpec.schemaVersion ?? 'img2threejs'),
        name: String(remoteSpec.targetName ?? remoteSpec.name ?? baseSpec.name),
        subjectClass:
          remoteSpec.preSpecAssessment?.objectClass?.primaryDomain === 'character'
            ? 'character'
            : ((remoteSpec.subjectClass as ObjectSculptSpec['subjectClass']) ?? baseSpec.subjectClass),
        materials: (remoteSpec.materials as ObjectSculptSpec['materials']) ?? baseSpec.materials,
        palette: (remoteSpec.palette as string[]) ?? baseSpec.palette,
        root: forgeRoot,
        sockets: (remoteSpec.sockets as ObjectSculptSpec['sockets']) ?? baseSpec.sockets,
        buildPasses: (remoteSpec.buildPasses as ObjectSculptSpec['buildPasses']) ?? baseSpec.buildPasses,
        reviewHistory: (remoteSpec.reviewHistory as ObjectSculptSpec['reviewHistory']) ?? baseSpec.reviewHistory,
        createdAt: String(remoteSpec.createdAt ?? baseSpec.createdAt),
        buildMode: 'primitives',
      };
    } else if (this.spec) {
      this.spec.schemaVersion = 'img2threejs/factory';
      this.spec.buildMode = 'primitives';
    }

    const runtimeNodes = (
      root.userData as { sculptRuntime?: { nodes?: Record<string, import('three').Object3D> } }
    )?.sculptRuntime?.nodes;

    const model: BuiltModel = {
      root,
      nodes: runtimeNodes || { root },
      passId,
    };
    this.lastFactoryReady = true;
    this.onModel(model, this.spec!);
    await sleep(50);
  }
}
