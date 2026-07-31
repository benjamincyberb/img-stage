export interface JobStatus {
  id: string;
  phase: string;
  passId?: string | null;
  percent: number;
  message: string;
  factoryReady?: boolean;
  hasFactory?: boolean;
  hasSpec?: boolean;
  error?: string | null;
  compileError?: string;
  referenceName?: string;
  engine?: string;
  agent?: string;
  promptPath?: string;
  updatedAt?: string;
}

export async function healthCheck(): Promise<{
  ok: boolean;
  skill: boolean;
  agent?: string;
  agentPresent?: boolean;
  mode?: string;
}> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error('接口未启动 — 请运行 npm run dev');
  return res.json();
}

export async function startGenerate(file: File): Promise<{ id: string; status: JobStatus }> {
  const body = new FormData();
  body.append('file', file, file.name);
  const res = await fetch('/api/generate', { method: 'POST', body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `生成失败（${res.status}）`);
  }
  return res.json();
}

export async function getJob(id: string): Promise<JobStatus> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error(`找不到任务 ${id}`);
  return res.json();
}

export async function loadFactoryModule(id: string): Promise<Record<string, unknown>> {
  const url = `/api/jobs/${id}/createModel.js?t=${Date.now()}`;
  return import(/* @vite-ignore */ url);
}

export async function loadSpec(id: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`/api/jobs/${id}/spec.json`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchPrompt(id: string): Promise<string> {
  const res = await fetch(`/api/jobs/${id}/prompt.md`);
  if (!res.ok) throw new Error('任务提示词尚未就绪');
  return res.text();
}

export async function openJobInCursor(id: string): Promise<void> {
  const res = await fetch(`/api/jobs/${id}/open-cursor`, { method: 'POST' });
  if (!res.ok) throw new Error('无法在 Cursor 中打开任务');
}

/** Keep polling until done / error. waiting_cursor is normal for Cursor handoff. */
export function pollJob(
  id: string,
  onUpdate: (s: JobStatus) => void,
  opts: { intervalMs?: number; signal?: AbortSignal } = {}
): Promise<JobStatus> {
  const intervalMs = opts.intervalMs ?? 2000;
  return new Promise((resolve, reject) => {
    let timer = 0;
    const tick = async () => {
      if (opts.signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      try {
        const status = await getJob(id);
        onUpdate(status);
        if (status.phase === 'done') {
          window.clearInterval(timer);
          resolve(status);
          return;
        }
        if (status.phase === 'error') {
          window.clearInterval(timer);
          reject(new Error(status.error || status.message));
        }
      } catch (err) {
        window.clearInterval(timer);
        reject(err);
      }
    };
    void tick();
    timer = window.setInterval(() => void tick(), intervalMs);
    opts.signal?.addEventListener('abort', () => {
      window.clearInterval(timer);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}
