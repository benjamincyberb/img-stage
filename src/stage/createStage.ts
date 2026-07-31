import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface StageHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  modelRoot: THREE.Group;
  propRoot: THREE.Group;
  lights: {
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
  };
  setAtmosphere: (id: AtmosphereId) => void;
  resize: () => void;
  render: () => void;
  dispose: () => void;
}

export type AtmosphereId = 'day' | 'overcast' | 'golden' | 'studio' | 'night';

const ATMOSPHERES: Record<
  AtmosphereId,
  { hemiSky: string; hemiGround: string; key: string; fog: string; bgTop: string; bgBot: string }
> = {
  day: {
    hemiSky: '#9ec9e0',
    hemiGround: '#cbb89a',
    key: '#fff1d6',
    fog: '#d7e6ef',
    bgTop: '#8ecae6',
    bgBot: '#f1e7d4',
  },
  overcast: {
    hemiSky: '#9aa7b2',
    hemiGround: '#a89b8c',
    key: '#dfe6ea',
    fog: '#c5ced6',
    bgTop: '#a8b4be',
    bgBot: '#d9d2c5',
  },
  golden: {
    hemiSky: '#f0b36a',
    hemiGround: '#8d6a4a',
    key: '#ffd59a',
    fog: '#e8c9a0',
    bgTop: '#e09f3e',
    bgBot: '#f6e7d0',
  },
  studio: {
    hemiSky: '#e8eef5',
    hemiGround: '#d0d4da',
    key: '#ffffff',
    fog: '#e6ebf0',
    bgTop: '#edf2f7',
    bgBot: '#d5dde6',
  },
  night: {
    hemiSky: '#1b2a41',
    hemiGround: '#2f2a26',
    key: '#b6c7ff',
    fog: '#121820',
    bgTop: '#0d1520',
    bgBot: '#243044',
  },
};

export function createStage(container: HTMLElement): StageHandle {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#d7e6ef', 8, 28);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  camera.position.set(2.8, 1.9, 3.4);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.2;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0.7, 0);

  // Ground disc
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(7, 64),
    new THREE.MeshStandardMaterial({
      color: '#c4a882',
      roughness: 0.92,
      metalness: 0.02,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Soft rug ring
  const rug = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 2.05, 64),
    new THREE.MeshStandardMaterial({
      color: '#6d8b74',
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.004;
  rug.receiveShadow = true;
  scene.add(rug);

  const hemi = new THREE.HemisphereLight('#9ec9e0', '#cbb89a', 0.85);
  scene.add(hemi);

  const key = new THREE.DirectionalLight('#fff1d6', 2.1);
  key.position.set(4, 7, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 24;
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  scene.add(key);

  const fill = new THREE.DirectionalLight('#a9c7e8', 0.55);
  fill.position.set(-4, 3, -2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight('#ffd6a5', 0.45);
  rim.position.set(-2, 4, 5);
  scene.add(rim);

  const modelRoot = new THREE.Group();
  modelRoot.name = 'modelRoot';
  scene.add(modelRoot);

  const propRoot = new THREE.Group();
  propRoot.name = 'propRoot';
  scene.add(propRoot);

  // Backdrop gradient plane
  const bg = makeGradientBackdrop('#8ecae6', '#f1e7d4');
  scene.add(bg);

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  resize();

  const setAtmosphere = (id: AtmosphereId) => {
    const a = ATMOSPHERES[id];
    hemi.color.set(a.hemiSky);
    hemi.groundColor.set(a.hemiGround);
    key.color.set(a.key);
    scene.fog = new THREE.Fog(a.fog, id === 'night' ? 6 : 8, id === 'night' ? 22 : 28);
    const mat = bg.material as THREE.ShaderMaterial;
    mat.uniforms.topColor.value.set(a.bgTop);
    mat.uniforms.bottomColor.value.set(a.bgBot);
    renderer.toneMappingExposure = id === 'night' ? 0.85 : id === 'golden' ? 1.15 : 1.05;
  };

  return {
    scene,
    camera,
    renderer,
    controls,
    modelRoot,
    propRoot,
    lights: { key, fill, rim, hemi },
    setAtmosphere,
    resize,
    render: () => {
      controls.update();
      renderer.render(scene, camera);
    },
    dispose: () => {
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function makeGradientBackdrop(top: string, bottom: string) {
  const uniforms = {
    topColor: { value: new THREE.Color(top) },
    bottomColor: { value: new THREE.Color(bottom) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying vec2 vUv;
      void main() {
        vec3 c = mix(bottomColor, topColor, smoothstep(0.0, 1.0, vUv.y));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), mat);
  mesh.name = 'backdrop';
  return mesh;
}
