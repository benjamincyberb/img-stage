# Front-view Monk Sculpt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the code-only Three.js monk so the supplied frontal pixel-art view reads as a compact prayer pose with correct chibi proportions, without texture planes or image projection.

**Architecture:** Keep the one-file factory at `data/jobs/384745b3/createModel.ts`. Replace only the construction values and helper composition inside `createObjectModel`: shallow face discs are positioned from a front-view coordinate system, while the head, hair, robe, lotus base, hands, and mala remain named groups exposed through `root.userData.sculptRuntime`.

**Tech Stack:** TypeScript, Three.js `r185`, `MeshToonMaterial`, Vite, Node/esbuild job factory endpoint.

## Global Constraints

- Do not use reference-image texture maps, image projection, cutout cards, or neural meshes.
- Keep `export function createObjectModel(options?: { shadows?: boolean }): THREE.Group`.
- Keep the factory fully procedural and preserve `sculptRuntime.nodes`, `sculptRuntime.meshes`, sockets, and idle animation.
- Optimize the supplied frontal view; side/rear forms are inferred.
- Use `MeshToonMaterial` with opaque color materials and restrained black outline shells.

---

### Task 1: Add front-view parameter tests

**Files:**
- Create: `scripts/verify-monk-factory.mjs`
- Test: `scripts/verify-monk-factory.mjs`

**Interfaces:**
- Consumes: `data/jobs/384745b3/createModel.ts` source text.
- Produces: process exit code `0` when the factory remains code-only, preserves the public export, and has the required named systems.

- [ ] **Step 1: Write the failing verification script**

```js
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await readFile(
  new URL('../data/jobs/384745b3/createModel.ts', import.meta.url),
  'utf8',
);

assert.match(source, /export function createObjectModel/);
assert.doesNotMatch(source, /TextureLoader|CanvasTexture|PlaneGeometry|reference\.png|\/reference/);
for (const id of ['head', 'hair', 'hands', 'mala', 'legs', 'face']) {
  assert.match(source, new RegExp(`nodes\\.${id}|nodes\\['${id}'\\]`));
}
console.log('monk factory structural checks passed');
```

- [ ] **Step 2: Run the script to establish the current failure**

Run: `node scripts/verify-monk-factory.mjs`

Expected: failure if the current factory still includes a forbidden texture/cutout reference, or if any required named system is absent.

- [ ] **Step 3: Keep the script as the regression contract**

Do not alter its assertions during geometry edits. It protects the confirmed code-only img2threejs requirement.

- [ ] **Step 4: Run the script after the factory changes**

Run: `node scripts/verify-monk-factory.mjs`

Expected: `monk factory structural checks passed`.

### Task 2: Rebuild the frontal silhouette and pose

**Files:**
- Modify: `data/jobs/384745b3/createModel.ts`
- Test: `scripts/verify-monk-factory.mjs`

**Interfaces:**
- Consumes: `part(geometry, material, name, shadows, outline)` and the `nodes`/`meshes` registries.
- Produces: named `head`, `hair`, `torso`, `legs`, `armL`, `armR`, `hands`, and `mala` objects.

- [ ] **Step 1: Adjust head, hair, and ear geometry**

Replace the broad helmet read with these authored dimensions:

```ts
const skull = part(new THREE.SphereGeometry(0.40, 32, 24), M.skin, 'skull', shadows);
skull.scale.set(0.98, 1.06, 0.86);

hairDome.scale.set(0.98, 0.72, 0.80);
hairDome.position.set(0, 0.04, -0.01);

bangs.scale.set(0.90, 0.85, 0.55);
bangs.position.set(0, 0.13, 0.275);
```

Add three narrow rounded fringe locks at X coordinates `-0.13`, `0`, and `0.13`, each with a `SphereGeometry(0.055, 10, 8)` flattened in Z. Name them `fringeL`, `fringeC`, and `fringeR`.

- [ ] **Step 2: Make the lotus base a compact overlapping mass**

Use two shallow ellipsoids centered at X `-0.27` and `0.27`, plus one central skirt fold:

```ts
kneeL.scale.set(1.35, 0.58, 0.92);
kneeL.position.set(-0.29, 0.16, 0.16);
kneeR.scale.set(1.35, 0.58, 0.92);
kneeR.position.set(0.29, 0.16, 0.16);
```

Create `centerFold` from `new THREE.SphereGeometry(0.13, 14, 10)`, scale it to `(0.75, 1.35, 0.45)`, set its position to `(0, 0.17, 0.25)`, use `M.robeDeep`, and parent it to `legs`.

- [ ] **Step 3: Lower and narrow robe shoulders**

Apply:

```ts
armL.position.set(-0.24, -0.01, 0.13);
armR.position.set(0.24, -0.01, 0.13);
armL.scale.set(0.88, 0.92, 0.88);
armR.scale.set(0.88, 0.92, 0.88);
```

Keep both sleeves terminating beside the hands rather than extending to the head-width boundary.

- [ ] **Step 4: Verify the structural contract**

Run: `node scripts/verify-monk-factory.mjs`

Expected: `monk factory structural checks passed`.

### Task 3: Refine frontal face, hands, and mala

**Files:**
- Modify: `data/jobs/384745b3/createModel.ts`
- Test: `scripts/verify-monk-factory.mjs`

**Interfaces:**
- Consumes: the `face` and `hands` groups created in Task 2.
- Produces: shallow named eye systems, prayer hands, and a short named mala loop.

- [ ] **Step 1: Place face details from the reference coordinate system**

Use frontal placements relative to the head group:

```ts
addEye(-0.115, 'eyeL');
addEye(0.115, 'eyeR');
addBrow(-0.115, 'browL', 0.16);
addBrow(0.115, 'browR', -0.16);
addBlush(-0.225, 'blushL');
addBlush(0.225, 'blushR');
mouth.position.set(0, -0.19, 0.025);
```

Set the eye white and iris radii to `0.078` and `0.061` respectively. Keep every face feature at Z values from `0.01` to `0.025`; do not add spherical eyeball depth.

- [ ] **Step 2: Reduce hands and move the prayer pose upward**

Apply:

```ts
hands.position.set(0, 0.01, 0.34);
handL.position.set(-0.025, 0, 0.02);
handR.position.set(0.025, 0, 0.02);
handL.scale.set(0.78, 1.12, 0.72);
handR.scale.set(0.78, 1.12, 0.72);
```

- [ ] **Step 3: Shorten the mala loop**

Set `mala.position` to `(0, -0.025, 0.035)`, create 10 beads rather than 12, and use:

```ts
const t = i / 9;
const a = Math.PI * (0.21 + t * 0.58);
b.position.set(
  Math.cos(a) * 0.04,
  -Math.sin(a) * 0.08 - 0.008,
  Math.sin(a) * 0.05 + 0.02,
);
```

- [ ] **Step 4: Verify the structural contract**

Run: `node scripts/verify-monk-factory.mjs`

Expected: `monk factory structural checks passed`.

### Task 4: Compile and review in STAGE

**Files:**
- Modify: `data/jobs/384745b3/status.json`
- Test: `http://127.0.0.1:5179/?job=384745b3`

**Interfaces:**
- Consumes: `createObjectModel` from the refined factory.
- Produces: compiled `createModel.js`, updated job status, and a browser-rendered result.

- [ ] **Step 1: Update job status**

Write:

```json
{
  "phase": "done",
  "passId": "optimization-pass",
  "percent": 100,
  "factoryReady": true,
  "message": "正面优先 refine：比例、袍袖、盘腿、五官、念珠已更新"
}
```

Preserve the existing `id`, `engine`, `agent`, `error`, and `updatedAt` fields.

- [ ] **Step 2: Compile through the job endpoint**

Run:

```bash
curl -s -o /dev/null -w 'factory:%{http_code}\n' \
  "http://127.0.0.1:8787/api/jobs/384745b3/createModel.js?t=$(date +%s)"
```

Expected: `factory:200`.

- [ ] **Step 3: Render the fresh STAGE job**

Open: `http://127.0.0.1:5179/?job=384745b3`

Expected: visible procedural monk, a compact head, short hair cap, narrow sleeve silhouette, readable prayer hands/mala, and one compact lotus base. No image textures, ghosting, projection overlay, or planar cutout is visible.

- [ ] **Step 4: Run the regression script**

Run: `node scripts/verify-monk-factory.mjs`

Expected: `monk factory structural checks passed`.
