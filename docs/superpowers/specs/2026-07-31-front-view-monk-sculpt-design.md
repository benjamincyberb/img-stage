# Front-view monk sculpt refinement

## Goal

Improve the procedural img2threejs monk for the supplied pixel-art reference. The front camera is the fidelity target; three-quarter and side views must remain coherent but are not expected to duplicate the 2D source exactly.

## Scope

- Keep the model code-only and procedural: no reference-image planes, projection overlays, cutout cards, or neural meshes.
- Preserve the current Three.js factory API: `createObjectModel(options?)` returns a `THREE.Group`.
- Keep named nodes, sockets, grouped meshes, and the subtle idle animation exposed through `root.userData.sculptRuntime`.

## Geometry

1. **Head and hair**
   - Reduce the head width from the current wide spherical read to an upright rounded-rectangle / squashed ellipsoid silhouette.
   - Reduce hair-cap height and depth; use a short fringe with three small, separated downward locks instead of one deep black dome.
   - Keep ears small and aligned to the eye-to-cheek band.

2. **Face**
   - Place eyes at the reference eye line with a narrower spacing.
   - Use shallow, front-facing eye discs, small highlight discs, oval blush discs, and a compact U-mouth.
   - Limit face feature depth to avoid an inflated toy expression in a three-quarter view.

3. **Robe, hands, and mala**
   - Lower shoulder masses and shorten sleeves so they terminate at the prayer hands.
   - Build a more visible V collar with two thin brown strips.
   - Use two small palms touching at the centre and a short, low U-shaped mala loop.

4. **Lotus base**
   - Replace detached spherical knees with two broad flattened, overlapping capsule/ellipsoid forms.
   - Add a narrow central fold and layered robe skirt to create the crossed-leg read from the reference camera.

## Materials and lighting

- Retain flat `MeshToonMaterial` colors and modest black silhouette outlines.
- Use reference-derived palette values: peach skin, mustard robe, warm-brown trim and beads, near-black hair.
- Avoid transparent projection layers and textured face overlays.

## Runtime behavior

- Keep the stage camera unchanged.
- Continue using a gentle body/head breath and mala swing.
- Preserve part names for the STAGE panel.

## Verification

1. Load `/?job=384745b3` from a fresh page.
2. Capture the default front/three-quarter stage camera.
3. Review these criteria:
   - The head no longer dominates the body.
   - Hair reads as a short cap rather than a helmet.
   - Hands and mala read as prayer, not a chest ornament.
   - Lotus legs form a single compact base rather than four disconnected bulbs.
   - No textured projection, ghosting, or billboard face appears.

## Known limitation

The source has only a frontal pixel-art view. Side and rear proportions are inferred; this pass optimizes the supplied camera view rather than claiming a photoreal or all-angle reconstruction.
