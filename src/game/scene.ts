import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type TimeOfDay = '낮' | '노을' | '밤';

export interface SceneEnvironmentHandles {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  isSoftwareGl: boolean;
  sunLight: THREE.DirectionalLight;
  skyDome: THREE.Mesh;
  windStreaks: WindStreaks;
  setTimeOfDay: (mode: TimeOfDay) => void;
  resize: (width: number, height: number) => void;
  updateAtmosphere: (
    birdPos: THREE.Vector3,
    forward: THREE.Vector3,
    speedMps: number,
    dt: number
  ) => void;
  dispose: () => void;
}

export interface WindStreaks {
  group: THREE.Group;
  update: (birdPos: THREE.Vector3, forward: THREE.Vector3, speedMps: number, dt: number) => void;
  dispose: () => void;
}

interface AtmospherePreset {
  topColor: THREE.Color;
  midColor: THREE.Color;
  horizonColor: THREE.Color;
  bottomColor: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunGlowColor: THREE.Color;
  hemiSkyColor: THREE.Color;
  hemiGroundColor: THREE.Color;
  hemiIntensity: number;
  exposure: number;
  starIntensity: number;
}

const ATMOSPHERE_PRESETS: Record<TimeOfDay, AtmospherePreset> = {
  낮: {
    topColor: new THREE.Color('#2364c7'),
    midColor: new THREE.Color('#6caae8'),
    horizonColor: new THREE.Color('#c8e4f9'),
    bottomColor: new THREE.Color('#dbe8f2'),
    fogColor: new THREE.Color('#c3ddf2'),
    fogNear: 100,
    fogFar: 1180,
    sunDir: new THREE.Vector3(-0.45, 0.52, -0.72).normalize(),
    sunColor: new THREE.Color('#fff2da'),
    sunIntensity: 2.25,
    sunGlowColor: new THREE.Color('#fff4d6'),
    hemiSkyColor: new THREE.Color('#c4e3ff'),
    hemiGroundColor: new THREE.Color('#7d7368'),
    hemiIntensity: 1.15,
    exposure: 1.06,
    starIntensity: 0,
  },
  노을: {
    topColor: new THREE.Color('#26285a'),
    midColor: new THREE.Color('#c45b68'),
    horizonColor: new THREE.Color('#ff9d5c'),
    bottomColor: new THREE.Color('#5a3e54'),
    fogColor: new THREE.Color('#df8966'),
    fogNear: 100,
    fogFar: 1140,
    sunDir: new THREE.Vector3(-0.75, 0.14, -0.64).normalize(),
    sunColor: new THREE.Color('#ff9a4c'),
    sunIntensity: 2.1,
    sunGlowColor: new THREE.Color('#ff7b3b'),
    hemiSkyColor: new THREE.Color('#ffaa7a'),
    hemiGroundColor: new THREE.Color('#473348'),
    hemiIntensity: 0.92,
    exposure: 1.0,
    starIntensity: 0.15,
  },
  밤: {
    topColor: new THREE.Color('#050b18'),
    midColor: new THREE.Color('#0d1c38'),
    horizonColor: new THREE.Color('#1a3358'),
    bottomColor: new THREE.Color('#0a1220'),
    fogColor: new THREE.Color('#0d192c'),
    fogNear: 100,
    fogFar: 1080,
    sunDir: new THREE.Vector3(0.42, 0.58, -0.69).normalize(),
    sunColor: new THREE.Color('#9ec4ff'),
    sunIntensity: 0.95,
    sunGlowColor: new THREE.Color('#cde0ff'),
    hemiSkyColor: new THREE.Color('#385b92'),
    hemiGroundColor: new THREE.Color('#131b2b'),
    hemiIntensity: 0.68,
    exposure: 0.95,
    starIntensity: 1.0,
  },
};

function detectSoftwareWebGL(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const str = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(str)) {
        return true;
      }
    }
  } catch {
    // Default false if debug extension restricted
  }
  return false;
}

function createSkyDome(): {
  mesh: THREE.Mesh;
  uniforms: {
    topColor: { value: THREE.Color };
    midColor: { value: THREE.Color };
    horizonColor: { value: THREE.Color };
    bottomColor: { value: THREE.Color };
    sunDir: { value: THREE.Vector3 };
    sunGlowColor: { value: THREE.Color };
    starIntensity: { value: number };
  };
  dispose: () => void;
} {
  const geo = new THREE.SphereGeometry(4200, 32, 20);
  const day = ATMOSPHERE_PRESETS['낮'];
  const uniforms = {
    topColor: { value: day.topColor.clone() },
    midColor: { value: day.midColor.clone() },
    horizonColor: { value: day.horizonColor.clone() },
    bottomColor: { value: day.bottomColor.clone() },
    sunDir: { value: day.sunDir.clone() },
    sunGlowColor: { value: day.sunGlowColor.clone() },
    starIntensity: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDir;
      uniform vec3 sunGlowColor;
      uniform float starIntensity;
      varying vec3 vWorldDir;

      float hash31(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = dir.y;
        vec3 col;
        if (h >= 0.0) {
          float tMid = smoothstep(0.0, 0.28, h);
          float tTop = smoothstep(0.18, 0.85, h);
          col = mix(horizonColor, midColor, tMid);
          col = mix(col, topColor, tTop);
        } else {
          col = mix(horizonColor, bottomColor, smoothstep(0.0, -0.35, h));
        }

        // Subtle crisp star field when night/sunset active
        if (starIntensity > 0.01 && h > 0.04) {
          vec3 grid = floor(dir * 210.0);
          float starHash = hash31(grid);
          float starSpark = smoothstep(0.992, 0.999, starHash) * smoothstep(0.04, 0.35, h);
          col += vec3(0.85, 0.92, 1.0) * starSpark * starIntensity * 1.1;
        }

        // Sun / Moon disc + atmospheric scattering bloom
        float sunDot = max(dot(dir, normalize(sunDir)), 0.0);
        col += sunGlowColor * pow(sunDot, 10.0) * 0.28;
        col += mix(sunGlowColor, vec3(1.0), 0.55) * smoothstep(0.9982, 0.9994, sunDot) * 0.95;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    uniforms,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

function createWindStreaks(): WindStreaks {
  const count = 36;
  const positions = new Float32Array(count * 6);
  const offsets: Array<{ r: number; angle: number; z: number; len: number; speedMult: number }> =
    [];

  for (let i = 0; i < count; i++) {
    offsets.push({
      r: 3.5 + Math.random() * 14,
      angle: Math.random() * Math.PI * 2,
      z: (Math.random() - 0.5) * 44,
      len: 1.5 + Math.random() * 2.5,
      speedMult: 0.8 + Math.random() * 0.5,
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  const group = new THREE.Group();
  group.add(lines);

  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const localUp = new THREE.Vector3();

  return {
    group,
    update(birdPos: THREE.Vector3, forward: THREE.Vector3, speedMps: number, dt: number) {
      const intensity = THREE.MathUtils.clamp((speedMps - 18) / 18, 0, 1);
      mat.opacity = intensity * 0.34;
      group.visible = mat.opacity > 0.01;
      if (!group.visible) return;

      right.crossVectors(forward, up).normalize();
      localUp.crossVectors(right, forward).normalize();

      const attr = geo.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;

      for (let i = 0; i < count; i++) {
        const o = offsets[i];
        o.z += speedMps * o.speedMult * dt * 1.15;
        if (o.z > 22) {
          o.z = -24 - Math.random() * 12;
          o.r = 3.2 + Math.random() * 13;
          o.angle = Math.random() * Math.PI * 2;
        }

        const cx = Math.cos(o.angle) * o.r;
        const cy = Math.sin(o.angle) * o.r;
        const tailZ = o.z;
        const headZ = o.z - o.len * (1 + intensity * 2.4);

        const baseX = birdPos.x + right.x * cx + localUp.x * cy;
        const baseY = birdPos.y + right.y * cx + localUp.y * cy;
        const baseZ = birdPos.z + right.z * cx + localUp.z * cy;

        const idx = i * 6;
        arr[idx] = baseX - forward.x * headZ;
        arr[idx + 1] = baseY - forward.y * headZ;
        arr[idx + 2] = baseZ - forward.z * headZ;

        arr[idx + 3] = baseX - forward.x * tailZ;
        arr[idx + 4] = baseY - forward.y * tailZ;
        arr[idx + 5] = baseZ - forward.z * tailZ;
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export function createSceneEnvironment(canvas: HTMLCanvasElement): SceneEnvironmentHandles {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: false,
  });

  const isSoftwareGl = detectSoftwareWebGL(renderer);
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  const fog = new THREE.Fog('#c3ddf2', 100, 1180);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(65, 1, 0.4, 9000);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envTarget = pmrem.fromScene(envScene, 0.04);
  scene.environment = envTarget.texture;
  envScene.dispose();
  pmrem.dispose();

  const hemiLight = new THREE.HemisphereLight('#c4e3ff', '#7d7368', 1.15);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight('#fff2da', 2.25);
  sunLight.position.set(-450, 520, -720);
  scene.add(sunLight);

  const skyDome = createSkyDome();
  scene.add(skyDome.mesh);

  const windStreaks = createWindStreaks();
  scene.add(windStreaks.group);

  let targetMode: TimeOfDay = '낮';
  const tempSunPos = new THREE.Vector3();

  return {
    renderer,
    scene,
    camera,
    isSoftwareGl,
    sunLight,
    skyDome: skyDome.mesh,
    windStreaks,
    setTimeOfDay(mode: TimeOfDay) {
      targetMode = mode;
    },
    resize(width: number, height: number) {
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    updateAtmosphere(
      birdPos: THREE.Vector3,
      forward: THREE.Vector3,
      speedMps: number,
      dt: number
    ) {
      const preset = ATMOSPHERE_PRESETS[targetMode];
      const blend = 1 - Math.exp(-3.2 * Math.min(0.05, dt));

      skyDome.uniforms.topColor.value.lerp(preset.topColor, blend);
      skyDome.uniforms.midColor.value.lerp(preset.midColor, blend);
      skyDome.uniforms.horizonColor.value.lerp(preset.horizonColor, blend);
      skyDome.uniforms.bottomColor.value.lerp(preset.bottomColor, blend);
      skyDome.uniforms.sunGlowColor.value.lerp(preset.sunGlowColor, blend);
      skyDome.uniforms.sunDir.value.lerp(preset.sunDir, blend).normalize();
      skyDome.uniforms.starIntensity.value +=
        (preset.starIntensity - skyDome.uniforms.starIntensity.value) * blend;

      fog.color.lerp(preset.fogColor, blend);
      fog.near += (preset.fogNear - fog.near) * blend;
      fog.far += (preset.fogFar - fog.far) * blend;

      hemiLight.color.lerp(preset.hemiSkyColor, blend);
      hemiLight.groundColor.lerp(preset.hemiGroundColor, blend);
      hemiLight.intensity += (preset.hemiIntensity - hemiLight.intensity) * blend;

      sunLight.color.lerp(preset.sunColor, blend);
      sunLight.intensity += (preset.sunIntensity - sunLight.intensity) * blend;
      tempSunPos.copy(skyDome.uniforms.sunDir.value).multiplyScalar(1000);
      sunLight.position.copy(tempSunPos);

      renderer.toneMappingExposure += (preset.exposure - renderer.toneMappingExposure) * blend;

      skyDome.mesh.position.copy(birdPos);
      windStreaks.update(birdPos, forward, speedMps, dt);
    },
    dispose() {
      skyDome.dispose();
      windStreaks.dispose();
      envTarget.dispose();
      renderer.dispose();
    },
  };
}
