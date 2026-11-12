import * as THREE from 'three';
import { GAME_CONFIG } from './gameConfig.ts';

export interface SnackSharedAssets {
  dispose: () => void;
  createSnackGroup: (isGolden: boolean) => THREE.Group;
}

const BEAM_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPos.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

// Downward light tail: brightest just under snack (vUv.y ~ 0.92), fading smoothly to 0 at bottom (vUv.y = 0)
const BEAM_FRAGMENT_SHADER = `
  uniform vec3 beamColor;
  uniform float beamOpacity;
  uniform float pulse;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  void main() {
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(vViewPos);
    float fresnel = pow(abs(dot(n, v)), 1.65);
    float topSoft = smoothstep(1.0, 0.86, vUv.y);
    float bottomFade = smoothstep(0.0, 0.82, vUv.y);
    float alpha = fresnel * topSoft * bottomFade * beamOpacity * (0.85 + 0.15 * sin(pulse));
    gl_FragColor = vec4(beamColor, alpha);
  }
`;

const HALO_VERTEX_SHADER = `
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPos.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

// Soft volumetric halo sphere glowing brightly in center and vanishing smoothly at rim
const HALO_FRAGMENT_SHADER = `
  uniform vec3 haloColor;
  uniform float haloOpacity;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  void main() {
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(vViewPos);
    float centerGlow = pow(max(0.0, dot(n, v)), 2.2);
    gl_FragColor = vec4(haloColor, centerGlow * haloOpacity);
  }
`;

export function createSnackSharedAssets(): SnackSharedAssets {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // Ridged curved shrimp cracker profile made of 3 arched overlapping capsule segments
  const segmentGeo = track(new THREE.CapsuleGeometry(0.42, 0.72, 6, 12));
  const grooveRingGeo = track(new THREE.TorusGeometry(0.43, 0.065, 6, 16));

  // Soft glowing spherical halo surrounding each floating snack
  const normalHaloGeo = track(new THREE.SphereGeometry(GAME_CONFIG.normalHaloRadiusM, 18, 14));
  const goldenHaloGeo = track(new THREE.SphereGeometry(GAME_CONFIG.goldenHaloRadiusM, 18, 14));

  // Short downward light trail (20m below snack, tapering softly downward)
  const normalBeamHeight = GAME_CONFIG.normalBeamHeightM;
  const goldenBeamHeight = GAME_CONFIG.goldenBeamHeightM;

  const normalBeamGeo = track(
    new THREE.CylinderGeometry(1.15, 0.25, normalBeamHeight, 14, 1, true)
  );
  normalBeamGeo.translate(0, -normalBeamHeight * 0.5, 0);

  const goldenBeamGeo = track(
    new THREE.CylinderGeometry(1.45, 0.3, goldenBeamHeight, 16, 1, true)
  );
  goldenBeamGeo.translate(0, -goldenBeamHeight * 0.5, 0);

  const normalMat = track(
    new THREE.MeshStandardMaterial({
      color: '#ff8a24',
      emissive: new THREE.Color('#802c00'),
      emissiveIntensity: 0.45,
      roughness: 0.55,
      metalness: 0.05,
    })
  );

  const normalGrooveMat = track(
    new THREE.MeshStandardMaterial({
      color: '#cf480c',
      emissive: new THREE.Color('#4a1400'),
      emissiveIntensity: 0.28,
      roughness: 0.68,
      metalness: 0.04,
    })
  );

  const goldenMat = track(
    new THREE.MeshStandardMaterial({
      color: '#ffe052',
      emissive: new THREE.Color('#b87800'),
      emissiveIntensity: 0.7,
      roughness: 0.22,
      metalness: 0.78,
    })
  );

  const goldenGrooveMat = track(
    new THREE.MeshStandardMaterial({
      color: '#fff4a8',
      emissive: new THREE.Color('#ffd000'),
      emissiveIntensity: 0.85,
      roughness: 0.18,
      metalness: 0.85,
    })
  );

  const normalHaloMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        haloColor: { value: new THREE.Color('#ff9d3b') },
        haloOpacity: { value: 0.48 },
      },
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: HALO_FRAGMENT_SHADER,
    })
  );

  const goldenHaloMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        haloColor: { value: new THREE.Color('#ffe875') },
        haloOpacity: { value: 0.72 },
      },
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: HALO_FRAGMENT_SHADER,
    })
  );

  const normalBeamMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        beamColor: { value: new THREE.Color('#ff8f26') },
        beamOpacity: { value: 0.36 },
        pulse: { value: 0 },
      },
      vertexShader: BEAM_VERTEX_SHADER,
      fragmentShader: BEAM_FRAGMENT_SHADER,
    })
  );

  const goldenBeamMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        beamColor: { value: new THREE.Color('#ffe259') },
        beamOpacity: { value: 0.56 },
        pulse: { value: 0 },
      },
      vertexShader: BEAM_VERTEX_SHADER,
      fragmentShader: BEAM_FRAGMENT_SHADER,
    })
  );

  const buildCurvedSnackMesh = (isGolden: boolean): THREE.Group => {
    const bodyGroup = new THREE.Group();
    const matMain = isGolden ? goldenMat : normalMat;
    const matGroove = isGolden ? goldenGrooveMat : normalGrooveMat;

    const segSpecs: Array<{ x: number; y: number; rz: number }> = [
      { x: -0.78, y: -0.14, rz: 1.05 },
      { x: 0, y: 0.18, rz: Math.PI * 0.5 },
      { x: 0.78, y: -0.14, rz: -1.05 },
    ];

    for (const s of segSpecs) {
      const m = new THREE.Mesh(segmentGeo, matMain);
      m.position.set(s.x, s.y, 0);
      m.rotation.z = s.rz;
      bodyGroup.add(m);
    }

    const ringOffsets = [-0.88, -0.44, 0, 0.44, 0.88];
    for (const rx of ringOffsets) {
      const tNorm = rx / 0.88;
      const archY = 0.18 - Math.abs(tNorm) * 0.16;
      const g = new THREE.Mesh(grooveRingGeo, matGroove);
      g.position.set(rx, archY, 0);
      g.rotation.y = Math.PI * 0.5;
      g.rotation.x = 0.25;
      bodyGroup.add(g);
    }

    bodyGroup.scale.setScalar(
      isGolden ? GAME_CONFIG.goldenSnackScale : GAME_CONFIG.normalSnackScale
    );
    return bodyGroup;
  };

  return {
    createSnackGroup(isGolden: boolean): THREE.Group {
      const root = new THREE.Group();
      const body = buildCurvedSnackMesh(isGolden);
      body.name = 'snack-body';
      root.add(body);

      const halo = new THREE.Mesh(
        isGolden ? goldenHaloGeo : normalHaloGeo,
        isGolden ? goldenHaloMat : normalHaloMat
      );
      halo.name = 'snack-halo';
      root.add(halo);

      const beam = new THREE.Mesh(
        isGolden ? goldenBeamGeo : normalBeamGeo,
        isGolden ? goldenBeamMat : normalBeamMat
      );
      beam.name = 'snack-beam';
      beam.frustumCulled = false;
      root.add(beam);

      return root;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
