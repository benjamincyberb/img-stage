import { spawn } from 'node:child_process';
import { access, appendFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import path from 'node:path';

const CODEX_APP_BIN = '/Applications/Codex.app/Contents/Resources/codex';
const CURSOR_APP_BIN = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';

async function fileExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer Cursor handoff (user said they use Cursor).
 * Optional: AGENT=codex|claude|cursor to force.
 */
async function resolveAgent() {
  const forced = (process.env.AGENT || 'cursor').toLowerCase();
  if (forced === 'codex') {
    return {
      kind: 'codex',
      bin: process.env.CODEX_BIN || CODEX_APP_BIN,
    };
  }
  if (forced === 'claude') {
    return { kind: 'claude', bin: process.env.CLAUDE_BIN || 'claude' };
  }
  // default: cursor handoff
  const bin = process.env.CURSOR_BIN || CURSOR_APP_BIN;
  return { kind: 'cursor', bin };
}

export async function detectAgent() {
  const agent = await resolveAgent();
  let present = false;
  if (agent.kind === 'cursor') {
    present = (await fileExists(agent.bin)) || existsSync(CURSOR_APP_BIN);
  } else {
    present = await fileExists(agent.bin);
  }
  return { ...agent, present, mode: agent.kind === 'cursor' ? 'handoff' : 'cli' };
}

function buildPrompt({ jobId, skillRoot, jobDir, referencePath }) {
  return `# img2threejs 任务（Cursor Agent）

请在当前 Cursor 对话中执行 **img2threejs** skill，重建参考图对应的程序化 Three.js 模型。

## 路径
- Skill 根目录：\`${skillRoot}\`
- 参考图：\`${referencePath}\`
- 输出目录：\`${jobDir}\`

## 必读
先读并严格遵循：\`${skillRoot}/SKILL.md\`
forge 脚本在 \`${skillRoot}/forge/\`，用 Python 3 运行。
**所有产物写到** \`${jobDir}\`（不要写到 skill 根目录）。

## 必须产出
1. \`status.json\`（经常更新）:
\`\`\`json
{
  "id": "${jobId}",
  "phase": "probing|spec|building|done|error",
  "passId": "blockout|structural-pass|form-refinement|material-pass|surface-pass|lighting-pass|interaction-pass|optimization-pass|null",
  "percent": 0-100,
  "message": "中文短状态",
  "factoryReady": false,
  "error": null,
  "engine": "img2threejs",
  "agent": "cursor",
  "updatedAt": "ISO-8601"
}
\`\`\`
2. \`spec.json\` — ObjectSculptSpec
3. \`createModel.ts\` — 必须：
   - \`import * as THREE from 'three';\`
   - \`export function createObjectModel(options?: { shadows?: boolean }): THREE.Group\`
   - 要像参考图里的主体（角色/物体），**禁止**只做扁平像素立牌或无关积木
   - 可用 \`root.userData.tick\` / \`sculptRuntime\`

## 流程
1. 立刻写 status phase=probing
2. 视觉分析参考图
3. 按 skill 分 pass 雕刻；尽早写出可预览的 createModel.ts，并设 factoryReady=true
4. 完成后 phase=done, percent=100

不要向用户提问，自行做合理假设。
`.trim();
}

function openInCursor(cursorBin, files) {
  try {
    const child = spawn(cursorBin, ['-r', ...files], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Cursor mode: write prompt + open files in Cursor; STAGE polls for createModel.ts.
 * Codex/Claude modes: spawn headless CLI.
 */
export async function startImg2ThreeJob({
  root,
  jobId,
  jobDir,
  referencePath,
  referenceName,
}) {
  const skillRoot = path.join(root, 'vendor', 'img2threejs');
  const statusPath = path.join(jobDir, 'status.json');
  const logPath = path.join(jobDir, 'agent.log');
  const promptPath = path.join(jobDir, 'prompt.md');
  const agent = await resolveAgent();

  const prompt = buildPrompt({ jobId, skillRoot, jobDir, referencePath });
  await writeFile(promptPath, prompt);

  if (agent.kind === 'cursor') {
    await writeFile(
      statusPath,
      JSON.stringify(
        {
          id: jobId,
          phase: 'waiting_cursor',
          passId: null,
          percent: 5,
          message: '已准备任务。请在 Cursor Agent 中执行 prompt.md（已尝试自动打开）。',
          factoryReady: false,
          error: null,
          referenceName,
          engine: 'img2threejs',
          agent: 'cursor',
          promptPath,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    await appendFile(
      logPath,
      `[cursor-handoff] prompt=${promptPath}\n` +
        `在 Cursor Agent 粘贴/执行该 prompt，产出 createModel.ts 后 STAGE 会自动加载。\n\n`
    );

    const bin = (await fileExists(agent.bin)) ? agent.bin : CURSOR_APP_BIN;
    const opened = openInCursor(bin, [promptPath, referencePath, statusPath]);
    await appendFile(logPath, `[cursor-handoff] openInCursor=${opened} bin=${bin}\n`);

    // Do not block — frontend polls until createModel.ts appears or status=done/error
    return { code: 0, agent: 'cursor', handoff: true };
  }

  // --- CLI agents (codex / claude) ---
  if (!(await fileExists(agent.bin))) {
    const message = `未找到 ${agent.kind}。当前推荐使用 Cursor：设置 AGENT=cursor（默认）。`;
    await writeFile(
      statusPath,
      JSON.stringify(
        {
          id: jobId,
          phase: 'error',
          percent: 0,
          message,
          factoryReady: false,
          error: message,
          engine: 'img2threejs',
          agent: agent.kind,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    throw new Error(message);
  }

  await writeFile(
    statusPath,
    JSON.stringify(
      {
        id: jobId,
        phase: 'starting',
        passId: null,
        percent: 3,
        message: `正在启动 ${agent.kind} + img2threejs…`,
        factoryReady: false,
        error: null,
        referenceName,
        engine: 'img2threejs',
        agent: agent.kind,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  const shortPrompt = `Open and fully execute ${promptPath}. The reference image is attached and also at ${referencePath}. Follow the img2threejs skill at ${skillRoot}/SKILL.md. Write status.json / spec.json / createModel.ts into ${jobDir}. Do not ask questions.`;

  let args;
  if (agent.kind === 'codex') {
    args = [
      'exec',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      jobDir,
      '--add-dir',
      skillRoot,
      '--add-dir',
      jobDir,
      '-i',
      referencePath,
      shortPrompt,
    ];
  } else {
    args = [
      '-p',
      `${shortPrompt}\n\n---\n${prompt}`,
      '--dangerously-skip-permissions',
      '--add-dir',
      skillRoot,
      '--add-dir',
      jobDir,
      '--allowedTools',
      'Bash,Read,Write,Edit,Glob,Grep',
    ];
  }

  await appendFile(
    logPath,
    `$ ${agent.bin} ${args.map((a) => JSON.stringify(a)).join(' ')}\n\n`
  );

  return await new Promise((resolve, reject) => {
    const child = spawn(agent.bin, args, {
      cwd: jobDir,
      env: {
        ...process.env,
        CODEX_HOME: process.env.CODEX_HOME || path.join(process.env.HOME || '', '.codex'),
        CLAUDE_PROJECT_DIR: root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onChunk = async (buf) => {
      await appendFile(logPath, buf.toString('utf8')).catch(() => {});
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);

    child.on('error', async (err) => {
      await writeFile(
        statusPath,
        JSON.stringify(
          {
            id: jobId,
            phase: 'error',
            percent: 0,
            message: `无法启动 ${agent.kind}`,
            factoryReady: false,
            error: err.message,
            engine: 'img2threejs',
            agent: agent.kind,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
      reject(err);
    });

    child.on('close', async (code) => {
      await appendFile(logPath, `\n\n[exit ${code}]\n`);
      if (code === 0) {
        resolve({ code, agent: agent.kind });
        return;
      }
      try {
        await access(path.join(jobDir, 'createModel.ts'));
        resolve({ code, soft: true, agent: agent.kind });
      } catch {
        await writeFile(
          statusPath,
          JSON.stringify(
            {
              id: jobId,
              phase: 'error',
              percent: 0,
              message: `${agent.kind} 退出码 ${code}`,
              factoryReady: false,
              error: `${agent.kind} exit ${code} — 请查看 agent.log`,
              engine: 'img2threejs',
              agent: agent.kind,
              updatedAt: new Date().toISOString(),
            },
            null,
            2
          )
        );
        reject(new Error(`${agent.kind} exit ${code}`));
      }
    });
  });
}
