import './styles.css';
import { Mesh } from 'three';
import {
  applyMaterialOverrides,
  setPartVisible,
  type BuiltModel,
} from './generation/buildFactory';
import { SculptPipeline } from './generation/pipeline';
import { captureCollectibleCard } from './share/captureCard';
import { createStage, type AtmosphereId } from './stage/createStage';
import { listProjects, nextCollectionNo, saveProject } from './storage/localStore';
import { createToys } from './toys/createToys';
import {
  BUILD_PASS_ORDER,
  PASS_LABELS,
  type ObjectSculptSpec,
  type PipelineProgress,
} from './types/spec';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app missing');

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">STAGE</div>
        <div class="brand-sub">参考图 → 程序化 Three.js</div>
      </div>
      <div class="top-actions">
        <button class="btn" id="btn-toys" type="button" title="按住 Shift 点击舞台可弹玩具">弹玩具</button>
        <button class="btn" id="btn-copy-prompt" type="button" hidden>复制 Cursor 指令</button>
        <button class="btn" id="btn-open-cursor" type="button" hidden>在 Cursor 打开</button>
        <button class="btn" id="btn-capture" type="button">留影 PNG</button>
        <label class="btn btn-primary" for="file-input">上传参考图</label>
        <input id="file-input" type="file" accept="image/*" hidden />
      </div>
    </header>

    <aside class="panel panel-left">
      <h2>参考图</h2>
      <p class="hint" id="engine-hint">引擎：<b>img2threejs</b>（Cursor Agent）。上传后生成任务提示词，请在 Cursor 中执行，完成后自动加载模型。</p>
      <div class="dropzone" id="dropzone">
        <strong>拖入图片</strong>
        <span class="hint" style="margin:0">或点击右上角上传</span>
        <img class="ref-thumb" id="ref-thumb" alt="" hidden />
      </div>

      <h3>氛围</h3>
      <div class="atm-grid" id="atm-grid"></div>

      <h3>最近项目（本地）</h3>
      <div id="recent-list" class="hint">尚未保存项目</div>
    </aside>

    <main class="stage-wrap" id="stage-wrap">
      <div class="stage-overlay">
        <div class="pill" id="stage-pill">拖拽旋转 · 滚轮缩放 · Shift+点击弹玩具</div>
      </div>
      <div class="empty-hero" id="empty-hero">
        <div>
          <p class="title">拖入一张参考图</p>
          <p class="sub">STAGE 舞台 + img2threejs。你使用 Cursor：上传后复制指令到 Cursor Agent 执行，预览会先占位，工厂代码写好后自动替换。</p>
        </div>
      </div>
    </main>

    <aside class="panel panel-right">
      <h2>部件与材质</h2>
      <p class="hint" id="spec-name">生成后可开关部件、调节材质。</p>
      <h3>部件</h3>
      <div class="part-list" id="part-list"></div>
      <h3>材质</h3>
      <div id="mat-list"></div>
    </aside>

    <footer class="bottombar">
      <div class="pass-row" id="pass-row"></div>
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <div class="progress-meta">
        <span id="progress-msg">等待参考图</span>
        <span id="progress-pct">0%</span>
      </div>
    </footer>
  </div>
  <div class="toast" id="toast"></div>
`;

const stageWrap = must('#stage-wrap');
const stage = createStage(stageWrap);
const toys = createToys(stage.propRoot);

let currentModel: BuiltModel | null = null;
let currentSpec: ObjectSculptSpec | null = null;
let collectionNo = nextCollectionNo();
let pipeline: SculptPipeline | null = null;
let pipelineDone = false;
let elapsed = 0;
let last = performance.now();

const atmospheres: { id: AtmosphereId; label: string }[] = [
  { id: 'day', label: '白天' },
  { id: 'overcast', label: '阴天' },
  { id: 'golden', label: '金色时刻' },
  { id: 'studio', label: '影棚' },
  { id: 'night', label: '夜晚' },
];

const atmGrid = must('#atm-grid');
atmospheres.forEach((a, i) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `atm-btn${i === 0 ? ' active' : ''}`;
  btn.textContent = a.label;
  btn.addEventListener('click', () => {
    stage.setAtmosphere(a.id);
    atmGrid.querySelectorAll('.atm-btn').forEach((el) => el.classList.remove('active'));
    btn.classList.add('active');
  });
  atmGrid.appendChild(btn);
});

renderPassChips();
refreshRecent();

function tick(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  elapsed += dt;
  toys.update(dt);
  const tickFn = currentModel?.root.userData?.tick;
  if (typeof tickFn === 'function') {
    tickFn(dt, elapsed);
  } else if (pipelineDone && currentModel && currentSpec?.schemaVersion?.includes('preview')) {
    currentModel.root.rotation.y += dt * 0.08;
  }
  stage.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

void bootstrapHealth();

async function bootstrapHealth() {
  try {
    const { healthCheck } = await import('./api/img2three');
    const h = await healthCheck();
    if (!h.skill) {
      must('#engine-hint').innerHTML = '引擎：找不到 vendor/img2threejs，请检查仓库。';
      return;
    }
    if (h.agent === 'cursor' || h.mode === 'handoff') {
      must('#engine-hint').innerHTML =
        '引擎：<b>img2threejs</b>（<b>Cursor Agent</b> 交接）。上传 → 复制指令到 Cursor 执行 → 自动加载工厂代码。';
      return;
    }
    if (!h.agentPresent) {
      must('#engine-hint').innerHTML =
        '引擎：未检测到 Agent。默认使用 Cursor：上传后按提示在 Cursor 中执行任务。';
      return;
    }
    must('#engine-hint').innerHTML =
      `引擎：<b>img2threejs</b>（经由 <b>${h.agent}</b>）。`;
  } catch {
    must('#engine-hint').innerHTML =
      '引擎 API 未启动。请运行 <code>npm run dev</code>（同时启动网页与接口）。';
    toast('接口未启动，请运行 npm run dev');
  }
}

window.addEventListener('resize', () => stage.resize());

must<HTMLInputElement>('#file-input').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void startPipeline(file);
});

const dropzone = must('#dropzone');
for (const ev of ['dragenter', 'dragover'] as const) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('active');
  });
}
for (const ev of ['dragleave', 'drop'] as const) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('active');
  });
}
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) void startPipeline(file);
});

must('#btn-capture').addEventListener('click', () => void onCapture());
must('#btn-toys').addEventListener('click', () => {
  toast('按住 Shift，再点击舞台即可弹玩具');
});
must('#btn-copy-prompt').addEventListener('click', () => void onCopyPrompt());
must('#btn-open-cursor').addEventListener('click', () => void onOpenCursor());

function setCursorActionsVisible(visible: boolean) {
  must('#btn-copy-prompt').hidden = !visible;
  must('#btn-open-cursor').hidden = !visible;
}

async function onCopyPrompt() {
  if (!pipeline?.jobId) {
    toast('请先上传参考图');
    return;
  }
  try {
    const { fetchPrompt } = await import('./api/img2three');
    const text = await fetchPrompt(pipeline.jobId);
    await navigator.clipboard.writeText(text);
    toast('已复制：请粘贴到 Cursor Agent 并发送');
  } catch (err) {
    toast(err instanceof Error ? err.message : '复制失败');
  }
}

async function onOpenCursor() {
  if (!pipeline?.jobId) {
    toast('请先上传参考图');
    return;
  }
  try {
    const { openJobInCursor } = await import('./api/img2three');
    await openJobInCursor(pipeline.jobId);
    toast('已在 Cursor 中打开任务文件');
  } catch (err) {
    toast(err instanceof Error ? err.message : '打开失败');
  }
}

async function startPipeline(file: File) {
  pipeline?.abort();
  pipelineDone = false;
  collectionNo = nextCollectionNo();

  const thumb = must<HTMLImageElement>('#ref-thumb');
  thumb.hidden = false;
  thumb.src = URL.createObjectURL(file);

  must('#empty-hero').style.display = 'none';
  must('#stage-pill').textContent = `生成中 · ${file.name}`;
  setCursorActionsVisible(true);

  pipeline = new SculptPipeline(onProgress, onModel);
  try {
    await pipeline.runFromFile(file);
    pipelineDone = true;
    if (currentSpec) {
      saveProject({
        name: currentSpec.name,
        collectionNo,
        specJson: JSON.stringify(currentSpec),
        referenceName: currentSpec.referenceImageName,
      });
      refreshRecent();
      toast(`已保存到本地 · 编号 ${String(collectionNo).padStart(4, '0')}`);
    }
  } catch (err) {
    console.error(err);
    onProgress({
      phase: 'error',
      passIndex: 0,
      passTotal: BUILD_PASS_ORDER.length,
      message: err instanceof Error ? err.message : '流水线失败',
      percent: 0,
    });
  }
}

function onProgress(p: PipelineProgress) {
  must('#progress-fill').style.width = `${p.percent}%`;
  must('#progress-msg').textContent = p.message;
  must('#progress-pct').textContent = `${Math.round(p.percent)}%`;
  renderPassChips(p.passId, p.phase === 'done');
}

function onModel(model: BuiltModel, spec: ObjectSculptSpec) {
  while (stage.modelRoot.children.length) {
    const child = stage.modelRoot.children[0];
    stage.modelRoot.remove(child);
    child.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  currentModel = model;
  currentSpec = spec;
  model.root.rotation.y = 0;
  stage.modelRoot.add(model.root);
  stage.controls.target.set(0, 0.7, 0);
  renderPartsPanel(spec);
}

function renderPartsPanel(spec: ObjectSculptSpec) {
  const engine =
    spec.schemaVersion?.includes('img2threejs') || spec.buildMode === 'primitives'
      ? 'img2threejs'
      : '预览';
  const classLabel =
    spec.subjectClass === 'character' ? '角色' : spec.subjectClass === 'hybrid' ? '混合' : '物体';
  must('#spec-name').textContent = `${spec.name} · ${classLabel} · ${engine}`;

  const partList = must('#part-list');
  partList.innerHTML = '';
  const parts = flattenParts(spec.root);
  if (!parts.length && currentModel) {
    const ids = Object.keys(currentModel.nodes);
    for (const id of ids) {
      const row = document.createElement('div');
      row.className = 'part-item';
      row.innerHTML = `<span>${id}</span>`;
      partList.appendChild(row);
    }
  }
  for (const part of parts) {
    const row = document.createElement('div');
    row.className = 'part-item';
    row.innerHTML = `<span>${part.name}</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle on';
    btn.textContent = '显示';
    let visible = true;
    btn.addEventListener('click', () => {
      visible = !visible;
      btn.classList.toggle('on', visible);
      btn.textContent = visible ? '显示' : '隐藏';
      if (currentModel) setPartVisible(currentModel.root, part.id, visible);
    });
    row.appendChild(btn);
    partList.appendChild(row);
  }

  const matList = must('#mat-list');
  matList.innerHTML = '';
  for (const mat of spec.materials ?? []) {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${mat.name}</label>`;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = normalizeHex(mat.color);
    color.addEventListener('input', () => {
      mat.color = color.value;
      if (currentModel) applyMaterialOverrides(currentModel.root, mat.id, { color: color.value });
    });
    field.appendChild(color);

    const rough = document.createElement('input');
    rough.type = 'range';
    rough.min = '0';
    rough.max = '1';
    rough.step = '0.01';
    rough.value = String(mat.roughness ?? 0.5);
    rough.addEventListener('input', () => {
      mat.roughness = Number(rough.value);
      if (currentModel) {
        applyMaterialOverrides(currentModel.root, mat.id, { roughness: mat.roughness });
      }
    });
    field.appendChild(rough);
    matList.appendChild(field);
  }
}

function flattenParts(node: ObjectSculptSpec['root'] | undefined): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  if (!node) return out;
  const walk = (n: NonNullable<typeof node>) => {
    if (n.kind === 'part') out.push({ id: n.id, name: n.name });
    n.children?.forEach(walk);
  };
  walk(node);
  return out;
}

function renderPassChips(active?: string, done = false) {
  const row = must('#pass-row');
  row.innerHTML = '';
  const activeIndex = active
    ? BUILD_PASS_ORDER.indexOf(active as (typeof BUILD_PASS_ORDER)[number])
    : -1;
  BUILD_PASS_ORDER.forEach((id, i) => {
    const chip = document.createElement('div');
    chip.className = 'pass-chip';
    chip.textContent = PASS_LABELS[id];
    if (done || (activeIndex >= 0 && i < activeIndex)) chip.classList.add('done');
    else if (i === activeIndex) chip.classList.add('active');
    else chip.classList.add('locked');
    row.appendChild(chip);
  });
}

async function onCapture() {
  if (!currentSpec || !currentModel) {
    toast('请先上传参考图并完成生成');
    return;
  }
  stage.render();
  const blob = await captureCollectibleCard({
    title: currentSpec.name,
    subtitle: currentSpec.referenceImageName ?? '本地参考图',
    passLabel: PASS_LABELS[currentModel.passId],
    palette: currentSpec.palette,
    stageCanvas: stage.renderer.domElement,
    collectionNo,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentSpec.name.replace(/\s+/g, '-').toLowerCase()}-card.png`;
  a.click();
  URL.revokeObjectURL(url);
  toast('收藏卡已下载');
}

function refreshRecent() {
  const el = must('#recent-list');
  const items = listProjects();
  if (!items.length) {
    el.className = 'hint';
    el.textContent = '尚未保存项目';
    return;
  }
  el.className = 'part-list';
  el.innerHTML = items
    .slice(0, 5)
    .map(
      (p) =>
        `<div class="part-item"><span>${p.name}</span><span class="hint" style="margin:0">#${String(p.collectionNo).padStart(4, '0')}</span></div>`
    )
    .join('');
}

function toast(msg: string) {
  const el = must('#toast');
  el.textContent = msg;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 2200);
}

function normalizeHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return '#c4a484';
}

function must<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
}

/** Resume a finished job from ?job=<id> (reuse prior factory without re-upload). */
async function bootFromQueryJob() {
  const jobId = new URLSearchParams(location.search).get('job');
  if (!jobId) return;
  pipeline?.abort();
  pipeline = new SculptPipeline(onProgress, onModel);
  must('#empty-hero').style.display = 'none';
  must('#stage-pill').textContent = `加载任务 · ${jobId}`;
  setCursorActionsVisible(true);
  const thumb = must<HTMLImageElement>('#ref-thumb');
  thumb.hidden = false;
  thumb.src = `/api/jobs/${jobId}/reference`;
  try {
    await pipeline.loadExistingJob(jobId);
    pipelineDone = true;
    toast(`已加载任务 ${jobId}`);
  } catch (err) {
    console.error(err);
    toast(err instanceof Error ? err.message : '加载任务失败');
  }
}

void bootFromQueryJob();
