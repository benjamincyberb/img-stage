import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export interface ToySystem {
  world: CANNON.World;
  group: THREE.Group;
  update: (dt: number) => void;
  dispose: () => void;
}

interface ToyBody {
  mesh: THREE.Mesh;
  body: CANNON.Body;
}

export function createToys(sceneParent: THREE.Group): ToySystem {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.2, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.allowSleep = true;

  const ground = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
  });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  const group = new THREE.Group();
  group.name = 'toys';
  sceneParent.add(group);

  const toys: ToyBody[] = [];

  const addSphere = (color: string, r: number, x: number, z: number, mass = 0.35) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 })
    );
    mesh.castShadow = true;
    mesh.position.set(x, r + 0.02, z);
    group.add(mesh);
    const body = new CANNON.Body({
      mass,
      shape: new CANNON.Sphere(r),
      position: new CANNON.Vec3(x, r + 0.02, z),
      material: new CANNON.Material({ restitution: 0.55, friction: 0.4 }),
    });
    world.addBody(body);
    toys.push({ mesh, body });
  };

  const addBox = (color: string, s: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s, s, s),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 })
    );
    mesh.castShadow = true;
    mesh.position.set(x, s / 2 + 0.02, z);
    group.add(mesh);
    const body = new CANNON.Body({
      mass: 0.45,
      shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)),
      position: new CANNON.Vec3(x, s / 2 + 0.02, z),
    });
    world.addBody(body);
    toys.push({ mesh, body });
  };

  // Generic props — not cat-themed
  addSphere('#e76f51', 0.14, 1.35, 0.55);
  addSphere('#2a9d8f', 0.11, -1.4, 0.35);
  addSphere('#e9c46a', 0.09, 1.1, -0.9);
  addBox('#264653', 0.22, -1.15, -0.7);
  addBox('#f4a261', 0.16, 0.85, 1.2);

  // Soft impulse so the stage feels alive on load
  toys[0]?.body.applyImpulse(new CANNON.Vec3(-0.08, 0.15, 0.05));

  let pointer: { toy: ToyBody; offset: CANNON.Vec3 } | null = null;

  const onPointerDown = (ev: PointerEvent) => {
    // Simple: fling nearest toy toward click direction on ground
    if (ev.button !== 0 || !ev.shiftKey) return;
    const toy = toys[Math.floor(Math.random() * toys.length)];
    toy.body.wakeUp();
    toy.body.velocity.set((Math.random() - 0.5) * 3, 2.2, (Math.random() - 0.5) * 3);
  };
  window.addEventListener('pointerdown', onPointerDown);

  return {
    world,
    group,
    update: (dt) => {
      world.step(1 / 60, Math.min(dt, 0.05), 3);
      for (const t of toys) {
        t.mesh.position.copy(t.body.position as unknown as THREE.Vector3);
        t.mesh.quaternion.copy(t.body.quaternion as unknown as THREE.Quaternion);
      }
      void pointer;
    },
    dispose: () => {
      window.removeEventListener('pointerdown', onPointerDown);
      group.removeFromParent();
    },
  };
}
