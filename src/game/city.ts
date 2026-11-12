import * as THREE from 'three';
import { CITY_CONFIG } from '../config.ts';
import type { TimeOfDay } from './scene.ts';

export interface CityInstance {
  group: THREE.Group;
  setTimeOfDay: (mode: TimeOfDay) => void;
  updateCenter: (worldPos: THREE.Vector3) => void;
  dispose: () => void;
}

export interface CityBuildingBox {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  height: number;
}

const CELL_SIZE = CITY_CONFIG.cellSizeM;
const GRID_HALF = CITY_CONFIG.gridHalf;

// Downtown high-rise core positioned ahead along initial flight heading (~720m)
const DOWNTOWN_DIST = 720;
const DOWNTOWN_X = Math.sin(CITY_CONFIG.startHeadingRad) * DOWNTOWN_DIST;
const DOWNTOWN_Z = -Math.cos(CITY_CONFIG.startHeadingRad) * DOWNTOWN_DIST;

// Central civic landmarks: park pavilion buildings near (0,0) & downtown high-rise towers
const DOWNTOWN_TOWERS: ReadonlyArray<[number, number, number, number, number]> = [
  [-82, -62, 42, 108, 38],
  [82, -68, 46, 122, 42],
  [-86, 68, 38, 94, 44],
  [86, 70, 48, 134, 40],
  [0, -104, 34, 86, 32],
];

const PARK_BUILDINGS: ReadonlyArray<CityBuildingBox> = [
  { cx: 0, cz: -28, halfW: 37, halfD: 8, height: 18 },
  { cx: 32, cz: -6, halfW: 8, halfD: 17, height: 14 },
  { cx: -34, cz: -4, halfW: 14, halfD: 11, height: 12 },
];

const SUB_CELL_OFFSETS: ReadonlyArray<[number, number]> = [
  [-23, -23],
  [23, -23],
  [-23, 23],
  [23, 23],
];

function hash2D(ix: number, iz: number, salt = 0): number {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(salt, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function getBlockBuildings(gx: number, gz: number): CityBuildingBox[] {
  const worldBlockX = gx * CELL_SIZE;
  const worldBlockZ = gz * CELL_SIZE;

  const distPark = Math.hypot(worldBlockX, worldBlockZ);
  const distDowntown = Math.hypot(worldBlockX - DOWNTOWN_X, worldBlockZ - DOWNTOWN_Z);
  if (distPark < 110 || distDowntown < 145) {
    return [];
  }

  const corridorBoost = Math.exp(-Math.pow(distDowntown / 520, 2));
  const list: CityBuildingBox[] = [];

  for (let s = 0; s < SUB_CELL_OFFSETS.length; s++) {
    const [ox, oz] = SUB_CELL_OFFSETS[s];
    const r1 = hash2D(gx, gz, s * 17 + 1);
    if (r1 < 0.14) continue;

    const r2 = hash2D(gx, gz, s * 31 + 2);
    const r3 = hash2D(gx, gz, s * 47 + 3);
    const r4 = hash2D(gx, gz, s * 61 + 4);

    const width = 18 + r2 * 22;
    const depth = 18 + r3 * 22;
    const isHighRise = r1 + corridorBoost * 0.45 > 0.84;
    const baseHeight = isHighRise ? 46 + r4 * 62 : 12 + r4 * 30 + corridorBoost * 18;
    const roofBonus = r2 > 0.3 ? 2.6 + r1 * 4.2 : 0;

    list.push({
      cx: worldBlockX + ox + (r2 - 0.5) * 6,
      cz: worldBlockZ + oz + (r3 - 0.5) * 6,
      halfW: width * 0.5,
      halfD: depth * 0.5,
      height: baseHeight + roofBonus,
    });
  }

  return list;
}

/**
 * Finds any procedural city building overlapping (x, z) expanded by marginM.
 */
export function getBuildingBoxAt(x: number, z: number, marginM = 0): CityBuildingBox | null {
  for (const pb of PARK_BUILDINGS) {
    if (Math.abs(x - pb.cx) <= pb.halfW + marginM && Math.abs(z - pb.cz) <= pb.halfD + marginM) {
      return pb;
    }
  }

  for (const [lx, lz, w, h, d] of DOWNTOWN_TOWERS) {
    const cx = DOWNTOWN_X + lx;
    const cz = DOWNTOWN_Z + lz;
    const halfW = w * 0.5;
    const halfD = d * 0.5;
    if (Math.abs(x - cx) <= halfW + marginM && Math.abs(z - cz) <= halfD + marginM) {
      return { cx, cz, halfW, halfD, height: h };
    }
  }

  const baseCx = Math.round(x / CELL_SIZE);
  const baseCz = Math.round(z / CELL_SIZE);

  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const boxes = getBlockBuildings(baseCx + dcx, baseCz + dcz);
      for (const box of boxes) {
        if (
          Math.abs(x - box.cx) <= box.halfW + marginM &&
          Math.abs(z - box.cz) <= box.halfD + marginM
        ) {
          return box;
        }
      }
    }
  }

  return null;
}

export function isInsideCityBuilding(x: number, z: number, marginM = 6): boolean {
  return getBuildingBoxAt(x, z, marginM) !== null;
}

/**
 * Pure O(1) flat-ground (0m) + building rooftop height lookup replacing terrain raycasting.
 */
export function getSurfaceHeightAt(x: number, z: number): number {
  const b = getBuildingBoxAt(x, z, 0);
  return b ? b.height : 0;
}

/**
 * Finds the nearest generated building center around (x, z) for golden rooftop snack placement.
 */
export function pickCityRooftopNear(
  x: number,
  z: number
): { x: number; z: number; roofHeight: number } | null {
  const baseCx = Math.round(x / CELL_SIZE);
  const baseCz = Math.round(z / CELL_SIZE);

  let best: CityBuildingBox | null = null;
  let bestDist = Infinity;

  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      for (const box of getBlockBuildings(baseCx + dcx, baseCz + dcz)) {
        const d = Math.hypot(box.cx - x, box.cz - z);
        if (d < bestDist) {
          bestDist = d;
          best = box;
        }
      }
    }
  }

  if (best) {
    return { x: best.cx, z: best.cz, roofHeight: best.height };
  }

  return null;
}

function createRoadTileTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#737982';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#5c636c';
  ctx.fillRect(34, 34, size - 68, size - 68);

  ctx.strokeStyle = '#9aa1aa';
  ctx.lineWidth = 4;
  ctx.strokeRect(32, 32, size - 64, size - 64);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let p = 64; p < size - 40; p += 48) {
    ctx.beginPath();
    ctx.moveTo(36, p);
    ctx.lineTo(size - 36, p);
    ctx.moveTo(p, 36);
    ctx.lineTo(p, size - 36);
    ctx.stroke();
  }

  const roadW = 28;
  ctx.fillStyle = '#2d3239';
  ctx.fillRect(0, 0, size, roadW);
  ctx.fillRect(0, size - roadW, size, roadW);
  ctx.fillRect(0, 0, roadW, size);
  ctx.fillRect(size - roadW, 0, roadW, size);

  ctx.strokeStyle = 'rgba(241, 245, 249, 0.72)';
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 14]);
  ctx.beginPath();
  ctx.moveTo(36, roadW * 0.5);
  ctx.lineTo(size - 36, roadW * 0.5);
  ctx.moveTo(36, size - roadW * 0.5);
  ctx.lineTo(size - 36, size - roadW * 0.5);
  ctx.moveTo(roadW * 0.5, 36);
  ctx.lineTo(roadW * 0.5, size - 36);
  ctx.moveTo(size - roadW * 0.5, 36);
  ctx.lineTo(size - roadW * 0.5, size - roadW * 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(248, 250, 252, 0.78)';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(36 + i * 7, 4, 4, 20);
    ctx.fillRect(size - 62 + i * 7, 4, 4, 20);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(34, 34);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

function createBuildingFacadeTextures(
  variant: 'tower' | 'apt',
  maxAnisotropy: number
): { albedoMap: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const emCanvas = document.createElement('canvas');
  emCanvas.width = w;
  emCanvas.height = h;
  const emCtx = emCanvas.getContext('2d')!;

  ctx.fillStyle = variant === 'tower' ? '#7b92a8' : '#b4b9c0';
  ctx.fillRect(0, 0, w, h);

  emCtx.fillStyle = '#000000';
  emCtx.fillRect(0, 0, w, h);

  const cols = variant === 'tower' ? 8 : 6;
  const rows = variant === 'tower' ? 20 : 16;
  const padX = w / cols;
  const padY = h / rows;

  for (let r = 0; r < rows; r++) {
    const isLobby = r === rows - 1;
    for (let c = 0; c < cols; c++) {
      const lit = hash2D(c + r * 31, variant === 'tower' ? 11 : 7);
      if (variant === 'tower') {
        ctx.fillStyle = isLobby
          ? '#334155'
          : lit > 0.65
          ? '#a8d3f0'
          : lit > 0.28
          ? '#4b6b88'
          : '#2f455a';
      } else {
        ctx.fillStyle = isLobby
          ? '#475569'
          : lit > 0.72
          ? '#e8e2c8'
          : '#424b57';
      }
      const x = c * padX + 4;
      const y = r * padY + 4;
      const ww = padX - 8;
      const wh = padY - (variant === 'tower' ? 6 : 9);
      ctx.fillRect(x, y, ww, wh);

      if (isLobby) {
        emCtx.fillStyle = '#ffd59a';
        emCtx.fillRect(x, y, ww, wh);
      } else if (lit > 0.56) {
        emCtx.fillStyle = variant === 'tower' && lit > 0.78 ? '#7fd6ff' : '#ffd88a';
        emCtx.fillRect(x, y, ww, wh);
      }
    }

    ctx.fillStyle =
      variant === 'tower' ? 'rgba(220, 232, 245, 0.35)' : 'rgba(235, 238, 242, 0.5)';
    ctx.fillRect(0, r * padY, w, 3);
  }

  const albedoMap = new THREE.CanvasTexture(canvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.wrapT = THREE.RepeatWrapping;
  albedoMap.anisotropy = Math.min(8, maxAnisotropy);
  albedoMap.needsUpdate = true;

  const emissiveMap = new THREE.CanvasTexture(emCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.needsUpdate = true;

  return { albedoMap, emissiveMap };
}

export function createCity(maxAnisotropy = 4): CityInstance {
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

  const group = new THREE.Group();

  // 1. Infinite Urban Ground Plane (flat y = 0)
  const groundTex = createRoadTileTexture(maxAnisotropy);
  textures.push(groundTex);

  const groundSize = CELL_SIZE * 34;
  const groundGeo = trackGeo(new THREE.PlaneGeometry(groundSize, groundSize));
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.92,
      metalness: 0.04,
    })
  );
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.position.y = 0;
  group.add(groundMesh);

  // 2. Central Starting Park Courtyard at (0, 0)
  const parkGroup = new THREE.Group();
  group.add(parkGroup);

  const fieldMat = trackMat(new THREE.MeshStandardMaterial({ color: '#c48f60', roughness: 0.95 }));
  const turfMat = trackMat(new THREE.MeshStandardMaterial({ color: '#4d7c4f', roughness: 0.9 }));
  const hallWallMat = trackMat(new THREE.MeshStandardMaterial({ color: '#e6ded0', roughness: 0.85 }));
  const hallRoofMat = trackMat(new THREE.MeshStandardMaterial({ color: '#6b7885', roughness: 0.88 }));

  const yard = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(108, 0.35, 92)), fieldMat);
  yard.position.set(0, 0.18, 0);
  parkGroup.add(yard);

  const infield = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(64, 0.42, 40)), turfMat);
  infield.position.set(-10, 0.21, 8);
  parkGroup.add(infield);

  const mainWing = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(74, 17, 16)), hallWallMat);
  mainWing.position.set(0, 8.5, -28);
  parkGroup.add(mainWing);

  const mainRoof = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(76, 1.2, 18)), hallRoofMat);
  mainRoof.position.set(0, 17.5, -28);
  parkGroup.add(mainRoof);

  const eastWing = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(16, 14, 34)), hallWallMat);
  eastWing.position.set(32, 7, -6);
  parkGroup.add(eastWing);

  const pavilionHall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(28, 12, 22)), hallRoofMat);
  pavilionHall.position.set(-34, 6, -4);
  parkGroup.add(pavilionHall);

  // 3. Central Downtown Plaza & High-Rise Landmark Towers
  const downtownGroup = new THREE.Group();
  downtownGroup.position.set(DOWNTOWN_X, 0, DOWNTOWN_Z);
  group.add(downtownGroup);

  const plaza = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(58, 60, 0.5, 36)),
    trackMat(new THREE.MeshStandardMaterial({ color: '#343a44', roughness: 0.9 }))
  );
  plaza.position.y = 0.25;
  downtownGroup.add(plaza);

  const centerIsland = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(20, 21, 0.9, 32)),
    turfMat
  );
  centerIsland.position.y = 0.45;
  downtownGroup.add(centerIsland);

  const towerTextures = createBuildingFacadeTextures('tower', maxAnisotropy);
  textures.push(towerTextures.albedoMap, towerTextures.emissiveMap);

  const glassTowerMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: towerTextures.albedoMap,
      emissiveMap: towerTextures.emissiveMap,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0,
      roughness: 0.35,
      metalness: 0.45,
    })
  );

  for (const [lx, lz, w, h, d] of DOWNTOWN_TOWERS) {
    const tower = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, h, d)), glassTowerMat);
    tower.position.set(lx, h * 0.5, lz);
    downtownGroup.add(tower);
  }

  // 4. Distant Coastal Ridge Silhouettes & Ocean Plane
  const horizonGroup = new THREE.Group();
  group.add(horizonGroup);

  const mountainMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#4c6158',
      roughness: 0.95,
      metalness: 0.0,
    })
  );
  const mountainData: Array<[number, number, number, number]> = [
    [1350, 720, 420, 240],
    [1480, -340, 480, 210],
    [-1420, -960, 520, 270],
    [-1120, -1350, 460, 220],
    [450, -1480, 500, 195],
  ];
  for (const [mx, mz, radius, height] of mountainData) {
    const ridge = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(radius, height, 9)), mountainMat);
    ridge.position.set(mx, height * 0.45, mz);
    horizonGroup.add(ridge);
  }

  const seaMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#2e6f95',
      roughness: 0.3,
      metalness: 0.25,
    })
  );
  const seaPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(CITY_CONFIG.seaWidthM, CITY_CONFIG.seaDepthM)),
    seaMat
  );
  seaPlane.rotation.x = -Math.PI / 2;
  seaPlane.position.set(0, -0.3, CITY_CONFIG.seaDistanceZ);
  horizonGroup.add(seaPlane);

  // 5. InstancedMesh Infinite Urban Grid
  const cellSpan = GRID_HALF * 2 + 1;
  const subPerCell = SUB_CELL_OFFSETS.length;
  const maxBuildings = cellSpan * cellSpan * subPerCell;
  const maxRoofs = maxBuildings;
  const maxTrees = cellSpan * cellSpan * 2;

  const aptTextures = createBuildingFacadeTextures('apt', maxAnisotropy);
  textures.push(aptTextures.albedoMap, aptTextures.emissiveMap);

  const buildingGeo = trackGeo(new THREE.BoxGeometry(1, 1, 1));
  const buildingMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: aptTextures.albedoMap,
      emissiveMap: aptTextures.emissiveMap,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0,
      roughness: 0.72,
      metalness: 0.12,
    })
  );
  const buildingsMesh = new THREE.InstancedMesh(buildingGeo, buildingMat, maxBuildings);
  buildingsMesh.frustumCulled = false;
  group.add(buildingsMesh);

  const roofGeo = trackGeo(new THREE.BoxGeometry(1, 1, 1));
  const roofMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#5a6470',
      roughness: 0.85,
      metalness: 0.15,
    })
  );
  const roofsMesh = new THREE.InstancedMesh(roofGeo, roofMat, maxRoofs);
  roofsMesh.frustumCulled = false;
  group.add(roofsMesh);

  const treeGeo = trackGeo(new THREE.DodecahedronGeometry(3.2, 1));
  const treeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#3f7646',
      roughness: 0.88,
      metalness: 0.0,
    })
  );
  const treesMesh = new THREE.InstancedMesh(treeGeo, treeMat, maxTrees);
  treesMesh.frustumCulled = false;
  group.add(treesMesh);

  const dummy = new THREE.Object3D();
  const colorTmp = new THREE.Color();
  const palette = [
    new THREE.Color('#dfe4ea'),
    new THREE.Color('#cbd5e1'),
    new THREE.Color('#d6cfc4'),
    new THREE.Color('#b6c8d8'),
    new THREE.Color('#d9c2b2'),
    new THREE.Color('#9fb7c9'),
  ];

  let lastCellX = Number.NaN;
  let lastCellZ = Number.NaN;

  const rebuildInfiniteGrid = (centerCellX: number, centerCellZ: number) => {
    lastCellX = centerCellX;
    lastCellZ = centerCellZ;

    groundMesh.position.set(centerCellX * CELL_SIZE, 0, centerCellZ * CELL_SIZE);
    horizonGroup.position.set(centerCellX * CELL_SIZE, 0, centerCellZ * CELL_SIZE);

    let bIdx = 0;
    let rIdx = 0;
    let tIdx = 0;

    for (let dx = -GRID_HALF; dx <= GRID_HALF; dx++) {
      const gx = centerCellX + dx;
      for (let dz = -GRID_HALF; dz <= GRID_HALF; dz++) {
        const gz = centerCellZ + dz;
        const worldBlockX = gx * CELL_SIZE;
        const worldBlockZ = gz * CELL_SIZE;

        const distPark = Math.hypot(worldBlockX, worldBlockZ);
        const distDowntown = Math.hypot(worldBlockX - DOWNTOWN_X, worldBlockZ - DOWNTOWN_Z);
        const keepClear = distPark < 110 || distDowntown < 145;
        const corridorBoost = Math.exp(-Math.pow(distDowntown / 520, 2));

        for (let s = 0; s < subPerCell; s++) {
          const [ox, oz] = SUB_CELL_OFFSETS[s];
          const r1 = hash2D(gx, gz, s * 17 + 1);
          const r2 = hash2D(gx, gz, s * 31 + 2);
          const r3 = hash2D(gx, gz, s * 47 + 3);
          const r4 = hash2D(gx, gz, s * 61 + 4);

          if (keepClear || r1 < 0.14) {
            dummy.position.set(worldBlockX + ox, -100, worldBlockZ + oz);
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            buildingsMesh.setMatrixAt(bIdx, dummy.matrix);
            roofsMesh.setMatrixAt(rIdx, dummy.matrix);
            bIdx++;
            rIdx++;
            continue;
          }

          const width = 18 + r2 * 22;
          const depth = 18 + r3 * 22;
          const isHighRise = r1 + corridorBoost * 0.45 > 0.84;
          const height = isHighRise ? 46 + r4 * 62 : 12 + r4 * 30 + corridorBoost * 18;

          const px = worldBlockX + ox + (r2 - 0.5) * 6;
          const pz = worldBlockZ + oz + (r3 - 0.5) * 6;

          dummy.position.set(px, height * 0.5, pz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(width, height, depth);
          dummy.updateMatrix();
          buildingsMesh.setMatrixAt(bIdx, dummy.matrix);

          colorTmp.copy(palette[Math.floor(r4 * palette.length) % palette.length]);
          if (isHighRise) colorTmp.lerp(palette[5], 0.45);
          buildingsMesh.setColorAt(bIdx, colorTmp);

          if (r2 > 0.3) {
            const rw = width * (0.28 + r3 * 0.2);
            const rd = depth * (0.28 + r4 * 0.2);
            const rh = 2.6 + r1 * 4.2;
            dummy.position.set(px + (r1 - 0.5) * 4, height + rh * 0.5, pz + (r2 - 0.5) * 4);
            dummy.scale.set(rw, rh, rd);
          } else {
            dummy.position.set(px, -100, pz);
            dummy.scale.set(0, 0, 0);
          }
          dummy.updateMatrix();
          roofsMesh.setMatrixAt(rIdx, dummy.matrix);

          bIdx++;
          rIdx++;
        }

        for (let t = 0; t < 2; t++) {
          const rt = hash2D(gx, gz, 90 + t * 13);
          if (keepClear && distDowntown < 80) {
            dummy.position.set(0, -100, 0);
            dummy.scale.set(0, 0, 0);
          } else {
            const tx = worldBlockX + (t === 0 ? -48 : 48) + (rt - 0.5) * 6;
            const tz = worldBlockZ + (rt - 0.5) * 76;
            const s = 0.85 + rt * 0.65;
            dummy.position.set(tx, 3.2 * s, tz);
            dummy.scale.set(s, s * 1.15, s);
          }
          dummy.updateMatrix();
          treesMesh.setMatrixAt(tIdx, dummy.matrix);
          tIdx++;
        }
      }
    }

    buildingsMesh.count = bIdx;
    roofsMesh.count = rIdx;
    treesMesh.count = tIdx;
    buildingsMesh.instanceMatrix.needsUpdate = true;
    if (buildingsMesh.instanceColor) buildingsMesh.instanceColor.needsUpdate = true;
    roofsMesh.instanceMatrix.needsUpdate = true;
    treesMesh.instanceMatrix.needsUpdate = true;
    buildingsMesh.computeBoundingSphere();
    roofsMesh.computeBoundingSphere();
    treesMesh.computeBoundingSphere();
  };

  rebuildInfiniteGrid(0, 0);

  return {
    group,
    setTimeOfDay(mode: TimeOfDay) {
      const em = mode === '밤' ? 0.92 : mode === '노을' ? 0.28 : 0;
      buildingMat.emissiveIntensity = em;
      glassTowerMat.emissiveIntensity = em * 1.1;
      seaMat.color.set(mode === '밤' ? '#10243d' : mode === '노을' ? '#584f6e' : '#2e6f95');
    },
    updateCenter(worldPos: THREE.Vector3) {
      const cx = Math.round(worldPos.x / CELL_SIZE);
      const cz = Math.round(worldPos.z / CELL_SIZE);
      if (cx !== lastCellX || cz !== lastCellZ) {
        rebuildInfiniteGrid(cx, cz);
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
