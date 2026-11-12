import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  bindExternalBones,
  updateSeagullRig,
  type SeagullAnimationState,
  type SeagullRigHandles,
  type WingJointGroup,
} from './birdRig.ts';

export interface SeagullInstance {
  group: THREE.Group;
  update: (state: SeagullAnimationState, dt: number) => void;
  setInvulnerableBlink: (active: boolean, timeSec: number) => void;
  dispose: () => void;
}

interface FeatherTextures {
  alphaMap: THREE.CanvasTexture;
  whiteMap: THREE.CanvasTexture;
  greyMap: THREE.CanvasTexture;
  primaryMap: THREE.CanvasTexture;
}

// Vite compile-time check avoids issuing a 404 fetch when public/models/seagull.glb is absent
const OPTIONAL_GLB_FILES = import.meta.glob('/public/models/seagull.glb');

function createFeatherTextures(): FeatherTextures {
  const width = 128;
  const height = 256;

  // Alpha mask: rounded quill tip + smooth edge taper along feather vane
  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = width;
  alphaCanvas.height = height;
  const aCtx = alphaCanvas.getContext('2d')!;
  aCtx.fillStyle = '#000000';
  aCtx.fillRect(0, 0, width, height);

  aCtx.beginPath();
  aCtx.moveTo(width * 0.24, 6);
  aCtx.lineTo(width * 0.78, 6);
  aCtx.quadraticCurveTo(width * 0.94, height * 0.56, width * 0.66, height * 0.91);
  aCtx.quadraticCurveTo(width * 0.5, height * 0.99, width * 0.3, height * 0.92);
  aCtx.quadraticCurveTo(width * 0.1, height * 0.6, width * 0.24, 6);
  aCtx.closePath();
  aCtx.fillStyle = '#ffffff';
  aCtx.fill();

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.needsUpdate = true;

  const drawColorFeather = (
    topColor: string,
    midColor: string,
    tipColor: string,
    addBlackTip = false
  ): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, topColor);
    grad.addColorStop(0.58, midColor);
    grad.addColorStop(1, tipColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    if (addBlackTip) {
      const tipGrad = ctx.createLinearGradient(0, height * 0.44, 0, height * 0.94);
      tipGrad.addColorStop(0, 'rgba(22, 26, 33, 0)');
      tipGrad.addColorStop(0.28, 'rgba(22, 26, 33, 0.95)');
      tipGrad.addColorStop(0.86, 'rgba(18, 22, 28, 1)');
      tipGrad.addColorStop(0.95, '#f8fafc'); // Subtle white gull apical mirror near tip
      tipGrad.addColorStop(1, '#f8fafc');
      ctx.fillStyle = tipGrad;
      ctx.fillRect(0, 0, width, height);
    }

    // Subtle feather barb lines radiating outward from central rachis
    ctx.strokeStyle = addBlackTip ? 'rgba(255, 255, 255, 0.08)' : 'rgba(90, 102, 118, 0.14)';
    ctx.lineWidth = 1.2;
    const spineX = width * 0.48;
    for (let y = 16; y < height - 18; y += 6) {
      ctx.beginPath();
      ctx.moveTo(spineX, y);
      ctx.lineTo(width * 0.1, y + 15);
      ctx.moveTo(spineX, y);
      ctx.lineTo(width * 0.9, y + 18);
      ctx.stroke();
    }

    // Central feather shaft (rachis)
    ctx.strokeStyle = addBlackTip ? 'rgba(232, 238, 245, 0.55)' : 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(spineX, 4);
    ctx.lineTo(spineX + 2, height * 0.91);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    alphaMap,
    whiteMap: drawColorFeather('#ffffff', '#f8fafc', '#f1f5f9', false),
    greyMap: drawColorFeather('#98a6b5', '#b5c1ce', '#f3f6fa', false),
    primaryMap: drawColorFeather('#a3b0bf', '#8f9dae', '#1c2028', true),
  };
}

function createStreamlinedBodyGeometry(): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(1, 36, 26);
  const pos = geom.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const bellyColor = new THREE.Color('#fbfcfe');
  const mantleColor = new THREE.Color('#9aa8b8');
  const neckColor = new THREE.Color('#ffffff');
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i);
    const uy = pos.getY(i);
    const uz = pos.getZ(i); // -1 nose/chest -> +1 tail base

    // Streamlined gull fuselage taper: full chest around uz = -0.35, tapered rump at uz > 0.2
    const tailTaper = uz > 0 ? Math.pow(1 - uz * 0.72, 1.25) : 1 - Math.abs(uz) * 0.22;
    const chestBulge = Math.exp(-Math.pow((uz + 0.32) * 1.8, 2)) * 0.18;

    const x = ux * (0.24 + chestBulge * 0.35) * tailTaper;
    const y =
      uy * (0.21 + chestBulge * 0.3) * tailTaper +
      (uz < 0 ? 0.045 * -uz : 0.025 * uz) -
      (uy < 0 ? chestBulge * 0.16 * -uy : 0);
    const z = uz * 0.72;

    pos.setXYZ(i, x, y, z);

    // Vertex coloration: grey mantle over dorsal mid-back, bright white throat, chest & belly
    const mantleMask =
      THREE.MathUtils.smoothstep(uy, -0.05, 0.36) *
      THREE.MathUtils.smoothstep(uz, -0.45, -0.05) *
      (1 - THREE.MathUtils.smoothstep(uz, 0.68, 0.96));

    c.copy(bellyColor).lerp(mantleColor, mantleMask);
    if (uz < -0.45) {
      c.lerp(neckColor, THREE.MathUtils.smoothstep(-uz, 0.45, 0.85));
    }

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

function buildProceduralSeagull(): {
  root: THREE.Group;
  rig: SeagullRigHandles;
  disposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] };
} {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const fTex = createFeatherTextures();
  textures.push(fTex.alphaMap, fTex.whiteMap, fTex.greyMap, fTex.primaryMap);

  const bodyMat = trackMat(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.02,
    })
  );
  const headMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#fbfcfe',
      roughness: 0.8,
      metalness: 0.02,
    })
  );
  const mantleSolidMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#9caab9',
      roughness: 0.8,
      metalness: 0.02,
    })
  );
  const beakMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#f2b718',
      roughness: 0.55,
      metalness: 0.04,
    })
  );
  const redSpotMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#d92828',
      roughness: 0.55,
      metalness: 0.02,
    })
  );
  const eyeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#11161d',
      roughness: 0.2,
      metalness: 0.1,
    })
  );
  const eyeHighlightMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#ffffff',
    })
  );
  const footMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#ec7c1d',
      roughness: 0.72,
      metalness: 0.02,
    })
  );

  const whiteFeatherMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: fTex.whiteMap,
      alphaMap: fTex.alphaMap,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.02,
    })
  );
  const greyFeatherMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: fTex.greyMap,
      alphaMap: fTex.alphaMap,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.02,
    })
  );
  const primaryFeatherMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: fTex.primaryMap,
      alphaMap: fTex.alphaMap,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.02,
    })
  );

  const root = new THREE.Group();
  root.scale.setScalar(1.85); // Crisp visibility in aerial 3rd-person view

  const bodyRoot = new THREE.Group();
  root.add(bodyRoot);

  // 1. Torso
  const torsoMesh = new THREE.Mesh(trackGeo(createStreamlinedBodyGeometry()), bodyMat);
  bodyRoot.add(torsoMesh);

  // 2. Neck & Head + Curved Yellow Beak with Red Spot + Eyes with Specular Highlights
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.08, -0.62);
  bodyRoot.add(headPivot);

  const neck = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.155, 0.24, 16)), headMat);
  neck.rotation.x = Math.PI * 0.42;
  neck.position.set(0, 0.02, -0.02);
  headPivot.add(neck);

  const skull = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.145, 22, 18)), headMat);
  skull.scale.set(0.92, 0.94, 1.16);
  skull.position.set(0, 0.055, -0.14);
  headPivot.add(skull);

  // Two-piece tapered beak with curved culmen tip & red gonys spot
  const upperBeak = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.042, 0.25, 14)), beakMat);
  upperBeak.rotation.x = -Math.PI / 2 - 0.06;
  upperBeak.scale.set(0.75, 1.0, 0.65);
  upperBeak.position.set(0, 0.036, -0.35);
  headPivot.add(upperBeak);

  const hookTip = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.017, 0.06, 10)), beakMat);
  hookTip.rotation.x = -Math.PI * 0.66;
  hookTip.position.set(0, 0.022, -0.465);
  headPivot.add(hookTip);

  const lowerMandible = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.032, 0.21, 12)), beakMat);
  lowerMandible.rotation.x = -Math.PI / 2 + 0.02;
  lowerMandible.scale.set(0.72, 1.0, 0.52);
  lowerMandible.position.set(0, 0.016, -0.325);
  headPivot.add(lowerMandible);

  const redSpot = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.02, 10, 10)), redSpotMat);
  redSpot.scale.set(0.72, 0.85, 1.3);
  redSpot.position.set(0, 0.012, -0.405);
  headPivot.add(redSpot);

  const eyeGeo = trackGeo(new THREE.SphereGeometry(0.024, 12, 12));
  const highlightGeo = trackGeo(new THREE.SphereGeometry(0.0085, 8, 8));
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(s * 0.108, 0.078, -0.175);
    headPivot.add(eye);

    const spec = new THREE.Mesh(highlightGeo, eyeHighlightMat);
    spec.position.set(s * 0.123, 0.088, -0.19);
    headPivot.add(spec);
  }

  // 3. Tucked Orange Legs & Webbed Feet trailing beneath tail base
  const legGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.012, 0.3, 8));
  const webGeo = trackGeo(new THREE.CircleGeometry(0.065, 6, 0, Math.PI * 0.62));
  for (const s of [-1, 1]) {
    const legGroup = new THREE.Group();
    legGroup.position.set(s * 0.08, -0.105, 0.36);
    const legMesh = new THREE.Mesh(legGeo, footMat);
    legMesh.rotation.x = Math.PI * 0.48;
    legMesh.position.set(0, -0.01, 0.15);
    legGroup.add(legMesh);

    const webMesh = new THREE.Mesh(webGeo, footMat);
    webMesh.material = trackMat(
      new THREE.MeshStandardMaterial({
        color: '#ec7c1d',
        roughness: 0.75,
        side: THREE.DoubleSide,
      })
    );
    webMesh.rotation.x = Math.PI / 2;
    webMesh.rotation.z = Math.PI * 0.19;
    webMesh.position.set(0, -0.022, 0.29);
    legGroup.add(webMesh);
    bodyRoot.add(legGroup);
  }

  // 4. Fanned White Tail (9 overlapping rounded tail feathers)
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.02, 0.62);
  bodyRoot.add(tailPivot);

  const tailFeatherGeo = trackGeo(new THREE.PlaneGeometry(0.16, 0.44));
  // Pivot at proximal quill base (+0 -> +0.44 toward +Z tail edge)
  tailFeatherGeo.rotateX(-Math.PI / 2);
  tailFeatherGeo.translate(0, 0, 0.22);

  const tailFeathers: THREE.Object3D[] = [];
  const tailCount = 9;
  for (let i = 0; i < tailCount; i++) {
    const featherPivot = new THREE.Group();
    const norm = (i - (tailCount - 1) * 0.5) / ((tailCount - 1) * 0.5);
    featherPivot.position.y = (1 - Math.abs(norm)) * 0.012;
    const fMesh = new THREE.Mesh(tailFeatherGeo, whiteFeatherMat);
    featherPivot.add(fMesh);
    tailPivot.add(featherPivot);
    tailFeathers.push(featherPivot);
  }

  // 5. Shared Feather Plane Geometry for Wings (extends along +Z trailing edge cleanly)
  const makeWingFeatherGeo = (chordWidth: number, length: number) => {
    const g = new THREE.PlaneGeometry(chordWidth, length, 2, 4);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, length * 0.48); // Attach proximal shaft at wing bone line, extend backward (+Z)
    // Gentle aerodynamic airfoil camber along trailing edge
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const frac = clampRatio(z / length);
      p.setY(i, Math.sin(frac * Math.PI) * 0.014 - frac * frac * 0.02);
    }
    g.computeVertexNormals();
    return trackGeo(g);
  };

  const covertGeo = makeWingFeatherGeo(0.11, 0.22);
  const secondaryGeo = makeWingFeatherGeo(0.115, 0.46);
  const primaryBaseGeo = makeWingFeatherGeo(0.095, 0.54);

  const buildWing = (sideSign: -1 | 1): WingJointGroup => {
    const shoulder = new THREE.Group();
    shoulder.position.set(sideSign * 0.16, 0.06, -0.14);
    bodyRoot.add(shoulder);

    // --- Upper Arm Segment (Shoulder -> Elbow: 0.42m) ---
    const upperSpan = 0.42;
    const upperBone = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.042, 0.056, upperSpan, 10)),
      mantleSolidMat
    );
    upperBone.rotation.z = sideSign * (Math.PI / 2);
    upperBone.scale.set(1.0, 1.0, 1.85);
    upperBone.position.set(sideSign * upperSpan * 0.5, 0, 0.02);
    shoulder.add(upperBone);

    // 1 row of small anterior coverts on upper arm
    for (let i = 0; i < 5; i++) {
      const x = sideSign * (0.04 + (i / 4) * (upperSpan - 0.06));
      const cMesh = new THREE.Mesh(covertGeo, greyFeatherMat);
      cMesh.position.set(x, 0.016, -0.02);
      cMesh.rotation.y = sideSign * -0.05;
      shoulder.add(cMesh);
    }

    // Inner secondary flight feathers attached to upper arm (5 feathers)
    for (let i = 0; i < 5; i++) {
      const x = sideSign * (0.03 + (i / 4) * (upperSpan - 0.04));
      const sMesh = new THREE.Mesh(secondaryGeo, greyFeatherMat);
      sMesh.position.set(x, 0.005, 0.02);
      sMesh.rotation.y = sideSign * -0.08;
      shoulder.add(sMesh);
    }

    // --- Forearm Segment (Elbow -> Wrist: 0.46m) ---
    const forearmSpan = 0.46;
    const elbow = new THREE.Group();
    elbow.position.set(sideSign * upperSpan, 0, 0);
    shoulder.add(elbow);

    const forearmBone = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.03, 0.042, forearmSpan, 10)),
      mantleSolidMat
    );
    forearmBone.rotation.z = sideSign * (Math.PI / 2);
    forearmBone.scale.set(0.95, 1.0, 1.7);
    forearmBone.position.set(sideSign * forearmSpan * 0.5, 0, 0.015);
    elbow.add(forearmBone);

    // Small anterior coverts along forearm
    for (let i = 0; i < 6; i++) {
      const x = sideSign * (0.03 + (i / 5) * (forearmSpan - 0.05));
      const cMesh = new THREE.Mesh(covertGeo, greyFeatherMat);
      cMesh.position.set(x, 0.014, -0.018);
      cMesh.rotation.y = sideSign * -0.06;
      elbow.add(cMesh);
    }

    // Outer secondary flight feathers along forearm (7 feathers -> total 12 secondaries)
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const x = sideSign * (0.02 + t * (forearmSpan - 0.03));
      const sMesh = new THREE.Mesh(secondaryGeo, greyFeatherMat);
      sMesh.scale.set(0.95, 1, 0.98 - t * 0.06);
      sMesh.position.set(x, 0.004, 0.015);
      sMesh.rotation.y = sideSign * -(0.09 + t * 0.06);
      elbow.add(sMesh);
    }

    // --- Hand Segment (Wrist -> Wingtip: ~0.48m + angled primaries) ---
    const handSpan = 0.34;
    const wrist = new THREE.Group();
    wrist.position.set(sideSign * forearmSpan, 0, 0);
    elbow.add(wrist);

    const handBone = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.018, 0.03, handSpan, 8)),
      mantleSolidMat
    );
    handBone.rotation.z = sideSign * (Math.PI / 2);
    handBone.scale.set(0.85, 1, 1.5);
    handBone.position.set(sideSign * handSpan * 0.5, 0, 0.02);
    wrist.add(handBone);

    // Alula / small carpal coverts
    for (let i = 0; i < 3; i++) {
      const x = sideSign * (0.02 + i * 0.09);
      const cMesh = new THREE.Mesh(covertGeo, greyFeatherMat);
      cMesh.scale.set(0.82, 1, 0.78);
      cMesh.position.set(x, 0.012, -0.012);
      cMesh.rotation.y = sideSign * -0.18;
      wrist.add(cMesh);
    }

    // Primary fan pivot holds 9 primary flight feathers (outer ones black-tipped)
    const primaryFanPivot = new THREE.Group();
    wrist.add(primaryFanPivot);

    const primaryCount = 9;
    for (let i = 0; i < primaryCount; i++) {
      const t = i / (primaryCount - 1); // 0 = inner primary -> 1 = wingtip P10
      const pMesh = new THREE.Mesh(primaryBaseGeo, i >= 2 ? primaryFeatherMat : greyFeatherMat);
      const lengthScale = 0.88 + Math.sin(t * Math.PI * 0.85) * 0.36;
      const widthScale = 0.96 - t * 0.25;
      pMesh.scale.set(widthScale, 1, lengthScale);

      pMesh.position.set(sideSign * (0.02 + t * handSpan), 0.002 - t * 0.005, 0.015 + t * 0.04);
      // Fan primaries radially outward toward wingtip (-sideSign negative rotates tip outward!)
      // Remember for right (+X), rotation.y < 0 turns +Z tail backward? No:
      // Let's check: feather extends along +Z.
      // For Right wing (+X), outer primaries want to sweep OUTWARD (+X) AND backward (+Z).
      // Rotating +Z by +alpha around +Y moves (0,0,1) -> (+sin alpha, 0, +cos alpha) (+X & +Z)!
      // For Left wing (-X), rotating +Z by -alpha around +Y moves (0,0,1) -> (-sin alpha, 0, +cos alpha) (-X & +Z)!
      pMesh.rotation.y = sideSign * (0.14 + t * 0.84);
      primaryFanPivot.add(pMesh);
    }

    return { shoulder, elbow, wrist, primaryFanPivot };
  };

  const leftWing = buildWing(-1);
  const rightWing = buildWing(1);

  return {
    root,
    rig: {
      bodyRoot,
      headPivot,
      tailPivot,
      tailFeathers,
      leftWing,
      rightWing,
    },
    disposables: { geometries, materials, textures },
  };
}

function clampRatio(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function createSeagull(): SeagullInstance {
  const container = new THREE.Group();
  const procedural = buildProceduralSeagull();
  container.add(procedural.root);

  let activeRig: SeagullRigHandles = procedural.rig;
  let glbScene: THREE.Object3D | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let dracoLoader: DRACOLoader | null = null;
  let disposed = false;
  let isBlinking = false;
  const originalMaterialStates = new Map<
    THREE.Material,
    { transparent: boolean; opacity: number }
  >();

  const applyBlinkOpacity = (active: boolean, timeSec: number) => {
    if (!active && !isBlinking) return;
    const pulse = active ? 0.5 + 0.5 * Math.sin(timeSec * Math.PI * 14) : 1;
    const blinkOpacity = 0.28 + pulse * 0.58;

    container.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        let base = originalMaterialStates.get(mat);
        if (!base) {
          base = { transparent: mat.transparent, opacity: mat.opacity };
          originalMaterialStates.set(mat, base);
        }

        if (active) {
          if (!mat.transparent) {
            mat.transparent = true;
            mat.needsUpdate = true;
          }
          mat.opacity = Math.min(base.opacity, blinkOpacity);
        } else {
          if (mat.transparent !== base.transparent) {
            mat.transparent = base.transparent;
            mat.needsUpdate = true;
          }
          mat.opacity = base.opacity;
        }
      }
    });

    isBlinking = active;
  };

  const hasOptionalGlb = Object.keys(OPTIONAL_GLB_FILES).length > 0;
  if (hasOptionalGlb) {
    const loader = new GLTFLoader();
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      '/models/seagull.glb',
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        model.scale.setScalar(1.85);

        const bones = bindExternalBones(model);
        const hasWingBones = Boolean(bones?.leftUpperArm && bones?.rightUpperArm);

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          const action = mixer.clipAction(gltf.animations[0]);
          action.play();
        }

        if (hasWingBones || gltf.animations.length > 0) {
          procedural.root.visible = false;
          glbScene = model;
          container.add(model);
          activeRig = {
            ...procedural.rig,
            bodyRoot: model,
            mixer: mixer ?? undefined,
            externalBones: bones,
          };
        }
      },
      undefined,
      () => {
        // Keep procedural seagull silently if external GLB fails
      }
    );
  }

  return {
    group: container,
    update(state: SeagullAnimationState, dt: number) {
      if (mixer) {
        const animSpeed = 0.6 + ((state.leftFlapPower + state.rightFlapPower) * 0.5) * 1.4;
        mixer.update(dt * animSpeed);
      }
      updateSeagullRig(activeRig, state);
    },
    setInvulnerableBlink(active: boolean, timeSec: number) {
      applyBlinkOpacity(active, timeSec);
    },
    dispose() {
      disposed = true;
      applyBlinkOpacity(false, 0);
      originalMaterialStates.clear();
      if (mixer && glbScene) {
        mixer.stopAllAction();
        mixer.uncacheRoot(glbScene);
      }
      dracoLoader?.dispose();
      for (const g of procedural.disposables.geometries) g.dispose();
      for (const m of procedural.disposables.materials) m.dispose();
      for (const t of procedural.disposables.textures) t.dispose();
    },
  };
}
