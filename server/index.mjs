import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as esbuild from 'esbuild';
import { detectAgent, startImg2ThreeJob } from './agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JOBS = path.join(ROOT, 'data', 'jobs');
const PORT = Number(process.env.PORT || 8787);

await mkdir(JOBS, { recursive: true });

const jobs = new Map();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

async function readStatus(jobDir) {
  const statusPath = path.join(jobDir, 'status.json');
  try {
    const raw = await readFile(statusPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function compileFactory(jobDir) {
  const entryTs = path.join(jobDir, 'createModel.ts');
  const outJs = path.join(jobDir, 'createModel.js');
  await access(entryTs);
  // Rewrite bare "three" to a Vite-servable URL so dynamic import() from /api works in browser.
  const threeUrl = '/node_modules/three/build/three.module.js';
  await esbuild.build({
    entryPoints: [entryTs],
    outfile: outJs,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'three-browser-path',
        setup(build) {
          build.onResolve({ filter: /^three$/ }, () => ({
            path: threeUrl,
            external: true,
          }));
        },
      },
    ],
  });
  return outJs;
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const ctype = req.headers['content-type'] || '';
        const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
        if (!m) {
          reject(new Error('multipart boundary missing'));
          return;
        }
        const boundary = m[1] || m[2];
        const parts = splitMultipart(buf, boundary);
        const file = parts.find((p) => p.name === 'file' || p.filename);
        if (!file) {
          reject(new Error('file field missing'));
          return;
        }
        resolve(file);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function splitMultipart(buf, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buf.indexOf(sep) + sep.length;
  while (start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break; // --
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    const next = buf.indexOf(sep, start);
    const end = next === -1 ? buf.length : next - 2; // trim \r\n
    const slice = buf.subarray(start, end);
    const headerEnd = slice.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = slice.subarray(0, headerEnd).toString('utf8');
      const body = slice.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]+)"/i.exec(header);
      const fileMatch = /filename="([^"]*)"/i.exec(header);
      parts.push({
        name: nameMatch?.[1] || '',
        filename: fileMatch?.[1] || '',
        data: body,
        contentType: /Content-Type:\s*([^\r\n]+)/i.exec(header)?.[1] || '',
      });
    }
    start = next === -1 ? buf.length : next + sep.length;
  }
  return parts;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const agent = await detectAgent();
      sendJson(res, 200, {
        ok: true,
        skill: existsSync(path.join(ROOT, 'vendor/img2threejs/SKILL.md')),
        agent: agent.kind,
        agentBin: agent.bin,
        agentPresent: agent.present,
        mode: agent.mode || (agent.kind === 'cursor' ? 'handoff' : 'cli'),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const file = await parseMultipart(req);
      const id = randomUUID().slice(0, 8);
      const jobDir = path.join(JOBS, id);
      await mkdir(jobDir, { recursive: true });

      const ext = path.extname(file.filename || '').toLowerCase() || '.png';
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? ext : '.png';
      const referencePath = path.join(jobDir, `reference${safeExt}`);
      await writeFile(referencePath, file.data);

      const status = {
        id,
        phase: 'queued',
        passId: null,
        percent: 1,
        message: '已加入队列，等待 img2threejs（Codex）…',
        factoryReady: false,
        error: null,
        referenceName: file.filename || `reference${safeExt}`,
        engine: 'img2threejs',
        updatedAt: new Date().toISOString(),
      };
      await writeFile(path.join(jobDir, 'status.json'), JSON.stringify(status, null, 2));
      jobs.set(id, { dir: jobDir, startedAt: Date.now() });

      // Fire and forget agent
      startImg2ThreeJob({
        root: ROOT,
        jobId: id,
        jobDir,
        referencePath,
        referenceName: status.referenceName,
      }).catch(async (err) => {
        const failed = {
          ...(await readStatus(jobDir)),
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
          message: 'img2threejs Agent 启动失败',
          updatedAt: new Date().toISOString(),
        };
        await writeFile(path.join(jobDir, 'status.json'), JSON.stringify(failed, null, 2));
      });

      sendJson(res, 200, { id, status });
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(.*))?$/);
    if (jobMatch) {
      const id = jobMatch[1];
      const rest = jobMatch[2] || '';
      const jobDir = path.join(JOBS, id);
      if (!existsSync(jobDir)) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }

      if (req.method === 'GET' && rest === '') {
        const status = (await readStatus(jobDir)) || { id, phase: 'unknown' };
        const hasTs = existsSync(path.join(jobDir, 'createModel.ts'));
        const hasSpec = existsSync(path.join(jobDir, 'spec.json'));
        if (hasTs && !status.factoryReady) {
          try {
            await compileFactory(jobDir);
            status.factoryReady = true;
          } catch (err) {
            status.compileError = err instanceof Error ? err.message : String(err);
          }
        }
        sendJson(res, 200, { ...status, hasFactory: hasTs, hasSpec });
        return;
      }

      if (req.method === 'GET' && rest === 'createModel.js') {
        try {
          const outJs = await compileFactory(jobDir);
          res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          });
          createReadStream(outJs).pipe(res);
        } catch (err) {
          sendJson(res, 404, {
            error: 'factory not ready',
            detail: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (req.method === 'GET' && rest === 'spec.json') {
        const specPath = path.join(jobDir, 'spec.json');
        if (!existsSync(specPath)) {
          sendJson(res, 404, { error: 'spec not ready' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        createReadStream(specPath).pipe(res);
        return;
      }

      if (req.method === 'GET' && rest === 'reference') {
        const candidates = ['reference.png', 'reference.jpg', 'reference.jpeg', 'reference.webp'];
        const hit = candidates.map((n) => path.join(jobDir, n)).find((p) => existsSync(p));
        if (!hit) {
          sendJson(res, 404, { error: 'reference missing' });
          return;
        }
        const type = hit.endsWith('.png')
          ? 'image/png'
          : hit.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
        createReadStream(hit).pipe(res);
        return;
      }

      if (req.method === 'GET' && rest === 'prompt.md') {
        const promptPath = path.join(jobDir, 'prompt.md');
        if (!existsSync(promptPath)) {
          sendJson(res, 404, { error: 'prompt not ready' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        createReadStream(promptPath).pipe(res);
        return;
      }

      if (req.method === 'POST' && rest === 'open-cursor') {
        const promptPath = path.join(jobDir, 'prompt.md');
        const refCandidates = ['reference.png', 'reference.jpg', 'reference.jpeg', 'reference.webp'];
        const refPath = refCandidates.map((n) => path.join(jobDir, n)).find((p) => existsSync(p));
        const cursorBin =
          process.env.CURSOR_BIN ||
          '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
        if (!existsSync(promptPath)) {
          sendJson(res, 404, { error: 'prompt not ready' });
          return;
        }
        const { spawn } = await import('node:child_process');
        const args = ['-r', promptPath];
        if (refPath) args.push(refPath);
        const child = spawn(cursorBin, args, {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && rest === 'log') {
        const logPath = path.join(jobDir, 'agent.log');
        if (!existsSync(logPath)) {
          sendText(res, 200, '');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        createReadStream(logPath).pipe(res);
        return;
      }
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[img-stage server] http://127.0.0.1:${PORT}`);
  console.log(`[img-stage server] skill: ${path.join(ROOT, 'vendor/img2threejs')}`);
});
