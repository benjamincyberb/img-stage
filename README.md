# STAGE (img-stage)

Meow-style **stage shell** + real **[img2threejs](https://github.com/img2threejs/img2threejs)** generation via Claude Code.

## Architecture

```
Browser (Vite) ──POST /api/generate──► Node server
                                      │
                                      ├─ save data/jobs/<id>/reference.*
                                      └─ spawn: claude -p  + vendor/img2threejs skill
                                              │
                                              ├─ status.json (polled by UI)
                                              ├─ spec.json
                                              └─ createModel.ts  ─esbuild─► createModel.js
                                                      ▲
Browser dynamic import ◄──────────────────────────────┘
```

1. Upload shows a **local relief preview** so the stage is never empty.
2. Claude Code runs the vendored img2threejs skill and writes a real procedural factory.
3. UI swaps the preview for the agent factory as soon as `createModel.ts` appears.

## Requirements

- Node 20+
- Python 3.10+（img2threejs forge 脚本）
- **Cursor**（默认）：上传后把任务提示词交给 Cursor Agent 执行
  - 可选：`AGENT=codex` 使用 Codex.app CLI
  - 可选：`AGENT=claude` 使用 Claude Code CLI

## Run

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:5179

### Cursor 用法

1. 上传参考图（会先出现预览）
2. 点「复制 Cursor 指令」
3. 在 Cursor Agent 对话粘贴并发送
4. Agent 写出 `data/jobs/<id>/createModel.ts` 后，舞台自动替换为真实模型

## Job artifacts

`data/jobs/<id>/`

| File | Role |
| --- | --- |
| `reference.*` | uploaded image |
| `status.json` | phase / pass / percent |
| `spec.json` | ObjectSculptSpec |
| `createModel.ts` | img2threejs factory |
| `agent.log` | Claude CLI transcript |

## Notes

- Skill is vendored at `vendor/img2threejs` and linked from `.claude/skills/img2threejs`.
- Generation can take several minutes; watch the bottom pass bar and `agent.log`.
- Preview relief is **not** the final model — wait for `engine: img2threejs` factory swap.
