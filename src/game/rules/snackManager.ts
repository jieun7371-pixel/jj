import * as THREE from 'three';
import { getBuildingBoxAt } from '../city.ts';
import { GAME_CONFIG } from './gameConfig.ts';
import { createSnackSharedAssets, type SnackSharedAssets } from './snackMesh.ts';

export interface ActiveSnack {
  id: number;
  isGolden: boolean;
  basePosition: THREE.Vector3;
  surfaceY: number;
  mesh: THREE.Group;
  spinOffset: number;
}

interface SuckingSnackAnim {
  mesh: THREE.Group;
  startPos: THREE.Vector3;
  elapsedSec: number;
  durationSec: number;
  isGolden: boolean;
}

interface BurstParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  ageSec: number;
  lifeSec: number;
}

export interface ScreenSnackProjection {
  id: number;
  isGolden: boolean;
  screenX: number;
  screenY: number;
  inView: boolean;
  inFront: boolean;
  distanceM: number;
  deltaAltM: number; // snackY - birdY (positive = snack is higher -> fly up)
  edgeAngleDeg: number;
}

export interface SnackHudOverlayData {
  nearest: ScreenSnackProjection | null;
  visibleMarkers: ScreenSnackProjection[];
}

export interface CollectEvent {
  snackId: number;
  isGolden: boolean;
  worldPos: THREE.Vector3;
}

const TEMP_PROJ = new THREE.Vector3();
const TEMP_LOCAL = new THREE.Vector3();
const TEMP_INV_QUAT = new THREE.Quaternion();

/**
 * Pure altitude chooser for airborne snacks:
 * - Normal: [25, 60]m AGL, Golden: [60, 90]m AGL
 * - Prioritizes intersection with [birdAltM - 25, birdAltM + 25] when non-empty
 * - Always clears any underlying/nearby building roof by >= 15m
 * - Mixes height across slots so low (~25m) and high (~55m+) targets coexist
 */
export function pickAirborneSnackAltitude(params: {
  isGolden: boolean;
  birdAltM: number;
  buildingRoofM: number;
  existingAltitudes?: readonly number[];
  random?: () => number;
}): number {
  const rand = params.random ?? Math.random;
  const bandMin = params.isGolden ? GAME_CONFIG.goldenMinAltM : GAME_CONFIG.normalMinAltM;
  const bandMax = params.isGolden ? GAME_CONFIG.goldenMaxAltM : GAME_CONFIG.normalMaxAltM;
  const clearMin =
    params.buildingRoofM > 0 ? params.buildingRoofM + GAME_CONFIG.minBuildingClearanceM : bandMin;

  const proxMin = params.birdAltM - GAME_CONFIG.altProximityRangeM;
  const proxMax = params.birdAltM + GAME_CONFIG.altProximityRangeM;

  // Candidate sub-range combining global band, building clearance, and bird ±25m window
  const safeMin = Math.max(bandMin, clearMin);
  const effectiveMax = Math.max(safeMin, bandMax);

  const interLo = Math.max(safeMin, proxMin);
  const interHi = Math.min(effectiveMax, proxMax);

  let lo = safeMin;
  let hi = effectiveMax;
  if (interLo <= interHi && (interHi - interLo >= 6 || proxMax >= safeMin)) {
    // Use intersection ~85% of the time (or 100% if span >= 12m) so snacks always stay reachable
    const useProximity = interHi - interLo >= 12 || rand() < 0.85;
    if (useProximity) {
      lo = interLo;
      hi = interHi;
    }
  } else if (params.birdAltM > effectiveMax) {
    // Bird is above band -> skew toward upper third of band
    lo = Math.max(safeMin, effectiveMax - (effectiveMax - safeMin) * 0.45);
  } else if (params.birdAltM < safeMin) {
    // Bird is below band -> skew toward lower third of band
    hi = Math.min(effectiveMax, safeMin + (effectiveMax - safeMin) * 0.45);
  }

  // Bias altitude choice to diversify heights among active snacks (e.g. mix 25m low & 55m high)
  let t = rand();
  const existing = params.existingAltitudes ?? [];
  if (existing.length > 0 && hi - lo > 10) {
    const mid = (lo + hi) * 0.5;
    const lowCount = existing.filter((y) => y < mid).length;
    const highCount = existing.length - lowCount;
    if (lowCount > highCount + 1) {
      t = 0.5 + rand() * 0.5;
    } else if (highCount > lowCount + 1) {
      t = rand() * 0.5;
    }
  }

  const chosen = lo + t * Math.max(0, hi - lo);
  return Math.max(clearMin, chosen);
}

export class SnackManager {
  readonly group = new THREE.Group();
  private assets: SnackSharedAssets;
  private snacks: ActiveSnack[] = [];
  private suckingAnims: SuckingSnackAnim[] = [];
  private bursts: BurstParticle[] = [];
  private nextId = 1;
  private timeSec = 0;

  private particleGeo = new THREE.OctahedronGeometry(0.38, 0);
  private normalSparkMat = new THREE.MeshBasicMaterial({
    color: '#ffb347',
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private goldenSparkMat = new THREE.MeshBasicMaterial({
    color: '#fff07c',
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  constructor() {
    this.assets = createSnackSharedAssets();
  }

  resetAll(birdPos: THREE.Vector3, headingRad: number): void {
    this.clearVisuals();
    for (let i = 0; i < GAME_CONFIG.activeSnackCount; i++) {
      this.spawnOne(birdPos, headingRad);
    }
  }

  private clearVisuals(): void {
    for (const s of this.snacks) this.group.remove(s.mesh);
    for (const a of this.suckingAnims) this.group.remove(a.mesh);
    for (const b of this.bursts) this.group.remove(b.mesh);
    this.snacks = [];
    this.suckingAnims = [];
    this.bursts = [];
    this.nextId = 1;
    this.timeSec = 0;
  }

  private pickSpawnPosition(
    birdPos: THREE.Vector3,
    headingRad: number,
    isGolden: boolean
  ): { pos: THREE.Vector3; surfaceY: number } {
    const coneHalfRad = (GAME_CONFIG.spawnForwardConeDeg * Math.PI) / 180;
    const existingAlts = this.snacks.map((s) => s.basePosition.y);
    const maxBandY = isGolden ? GAME_CONFIG.goldenMaxAltM : GAME_CONFIG.normalMaxAltM;

    for (let attempt = 0; attempt < 28; attempt++) {
      const useForwardCone =
        attempt < 20 && Math.random() < GAME_CONFIG.spawnForwardBiasChance;
      const angleOffset = useForwardCone
        ? (Math.random() * 2 - 1) * coneHalfRad
        : (Math.random() * 2 - 1) * Math.PI;
      const yaw = headingRad + angleOffset;
      const dist =
        GAME_CONFIG.spawnMinDistM +
        Math.random() * (GAME_CONFIG.spawnMaxDistM - GAME_CONFIG.spawnMinDistM);

      const cx = birdPos.x + Math.sin(yaw) * dist;
      const cz = birdPos.z - Math.cos(yaw) * dist;

      // Minimum 40m horizontal spacing between snacks
      const tooClose = this.snacks.some(
        (other) =>
          Math.hypot(other.basePosition.x - cx, other.basePosition.z - cz) <
          GAME_CONFIG.minSnackSpacingM
      );
      if (tooClose) continue;

      // Check building box with 6m halo buffer so snack never touches or hides inside walls/roofs
      const nearbyBox = getBuildingBoxAt(cx, cz, 6);
      const roofH = nearbyBox ? nearbyBox.height : 0;

      // Avoid tall towers whose roof + 15m clearance exceeds this snack's altitude ceiling
      if (roofH > 0 && roofH + GAME_CONFIG.minBuildingClearanceM > maxBandY && attempt < 22) {
        continue;
      }

      const spawnY = pickAirborneSnackAltitude({
        isGolden,
        birdAltM: birdPos.y,
        buildingRoofM: roofH,
        existingAltitudes: existingAlts,
      });

      return {
        pos: new THREE.Vector3(cx, spawnY, cz),
        surfaceY: roofH,
      };
    }

    // Fallback ahead of bird guaranteed above any nearby roof
    const gx = birdPos.x + Math.sin(headingRad) * 165;
    const gz = birdPos.z - Math.cos(headingRad) * 165;
    const roof = getBuildingBoxAt(gx, gz, 6)?.height ?? 0;
    const fallbackY = pickAirborneSnackAltitude({
      isGolden,
      birdAltM: birdPos.y,
      buildingRoofM: roof,
      existingAltitudes: existingAlts,
    });
    return {
      pos: new THREE.Vector3(gx, fallbackY, gz),
      surfaceY: roof,
    };
  }

  private spawnOne(birdPos: THREE.Vector3, headingRad: number): void {
    const isGolden = Math.random() < GAME_CONFIG.goldenSpawnChance;
    const { pos, surfaceY } = this.pickSpawnPosition(birdPos, headingRad, isGolden);

    const mesh = this.assets.createSnackGroup(isGolden);
    mesh.position.copy(pos);
    this.group.add(mesh);

    this.snacks.push({
      id: this.nextId++,
      isGolden,
      basePosition: pos,
      surfaceY,
      mesh,
      spinOffset: Math.random() * Math.PI * 2,
    });
  }

  private spawnBurst(origin: THREE.Vector3, isGolden: boolean): void {
    const count = isGolden ? 16 : 12;
    const mat = isGolden ? this.goldenSparkMat : this.normalSparkMat;

    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.particleGeo, mat);
      m.position.copy(origin);
      const scale = (isGolden ? 1.4 : 1.05) * (0.6 + Math.random() * 0.7);
      m.scale.setScalar(scale);

      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.3) * Math.PI * 0.8;
      const speed = 10 + Math.random() * 14;
      const vel = new THREE.Vector3(
        Math.cos(theta) * Math.cos(phi) * speed,
        Math.sin(phi) * speed + 4.5,
        Math.sin(theta) * Math.cos(phi) * speed
      );

      this.group.add(m);
      this.bursts.push({
        mesh: m,
        vel,
        ageSec: 0,
        lifeSec: 0.55 + Math.random() * 0.2,
      });
    }
  }

  update(params: {
    dtSec: number;
    birdPos: THREE.Vector3;
    beakWorldPos: THREE.Vector3;
    headingRad: number;
    collectRadiusM: number;
    canCollect: boolean;
  }): CollectEvent[] {
    const { dtSec, birdPos, beakWorldPos, headingRad, collectRadiusM, canCollect } = params;
    this.timeSec += dtSec;

    const fwdX = Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);
    const collected: CollectEvent[] = [];

    for (let i = this.snacks.length - 1; i >= 0; i--) {
      const s = this.snacks[i];
      const bob = Math.sin(this.timeSec * 2.2 + s.spinOffset) * GAME_CONFIG.snackBobAmplitudeM;
      s.mesh.position.set(s.basePosition.x, s.basePosition.y + bob, s.basePosition.z);

      const body = s.mesh.getObjectByName('snack-body');
      if (body) {
        body.rotation.y = this.timeSec * (s.isGolden ? 2.4 : 1.6) + s.spinOffset;
        body.rotation.x = Math.sin(this.timeSec * 1.8 + s.spinOffset) * 0.16;
      }

      const distToBird = birdPos.distanceTo(s.mesh.position);
      const forwardProj =
        (s.basePosition.x - birdPos.x) * fwdX + (s.basePosition.z - birdPos.z) * fwdZ;

      // Respawn ahead if bird flew >200m past it or drifted very far away
      if (forwardProj < -GAME_CONFIG.recycleBehindDistM || distToBird > 500) {
        this.group.remove(s.mesh);
        this.snacks.splice(i, 1);
        continue;
      }

      // Pure 3D Euclidean distance pickup (no low-altitude cap)
      if (canCollect && distToBird <= collectRadiusM) {
        const hitPos = s.mesh.position.clone();
        this.snacks.splice(i, 1);

        const beam = s.mesh.getObjectByName('snack-beam');
        if (beam) beam.visible = false;
        const halo = s.mesh.getObjectByName('snack-halo');
        if (halo) halo.visible = false;

        this.suckingAnims.push({
          mesh: s.mesh,
          startPos: hitPos.clone(),
          elapsedSec: 0,
          durationSec: GAME_CONFIG.suctionAnimDurationSec,
          isGolden: s.isGolden,
        });

        collected.push({
          snackId: s.id,
          isGolden: s.isGolden,
          worldPos: hitPos,
        });
      }
    }

    while (this.snacks.length < GAME_CONFIG.activeSnackCount) {
      this.spawnOne(birdPos, headingRad);
    }

    for (let i = this.suckingAnims.length - 1; i >= 0; i--) {
      const a = this.suckingAnims[i];
      a.elapsedSec += dtSec;
      const t = Math.min(1, a.elapsedSec / a.durationSec);
      const eased = 1 - Math.pow(1 - t, 2);

      a.mesh.position.lerpVectors(a.startPos, beakWorldPos, eased);
      a.mesh.scale.setScalar(Math.max(0.12, 1 - eased * 0.86));
      a.mesh.rotation.y += dtSec * 14;

      if (t >= 1) {
        this.group.remove(a.mesh);
        this.suckingAnims.splice(i, 1);
        this.spawnBurst(beakWorldPos.clone(), a.isGolden);
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.ageSec += dtSec;
      if (b.ageSec >= b.lifeSec) {
        this.group.remove(b.mesh);
        this.bursts.splice(i, 1);
        continue;
      }
      b.vel.y -= 18 * dtSec;
      b.mesh.position.addScaledVector(b.vel, dtSec);
      b.mesh.rotation.x += dtSec * 8;
      b.mesh.rotation.y += dtSec * 6;
      const fade = Math.max(0.05, 1 - b.ageSec / b.lifeSec);
      b.mesh.scale.setScalar(fade * (b.mesh.material === this.goldenSparkMat ? 1.3 : 0.95));
    }

    return collected;
  }

  computeScreenProjections(
    camera: THREE.PerspectiveCamera,
    birdPos: THREE.Vector3
  ): SnackHudOverlayData {
    camera.updateMatrixWorld();
    TEMP_INV_QUAT.copy(camera.quaternion).invert();

    let nearest: ScreenSnackProjection | null = null;
    let bestDist = Infinity;
    const visibleMarkers: ScreenSnackProjection[] = [];

    for (const s of this.snacks) {
      const pos = s.mesh.position;
      const distanceM = birdPos.distanceTo(pos);
      const deltaAltM = Math.round(pos.y - birdPos.y);

      TEMP_LOCAL.copy(pos).sub(camera.position).applyQuaternion(TEMP_INV_QUAT);
      const inFront = TEMP_LOCAL.z < -0.5;

      TEMP_PROJ.copy(pos).project(camera);
      let sx = (TEMP_PROJ.x + 1) * 0.5;
      let sy = (1 - TEMP_PROJ.y) * 0.5;

      if (!inFront) {
        sx = 1 - sx;
        sy = 0.92;
      }

      const inView =
        inFront && sx >= 0.06 && sx <= 0.94 && sy >= 0.08 && sy <= 0.92;

      const clampedX = Math.max(0.06, Math.min(0.94, sx));
      const clampedY = Math.max(0.08, Math.min(0.92, sy));
      const angleDeg = (Math.atan2(clampedX - 0.5, 0.5 - clampedY) * 180) / Math.PI;

      const proj: ScreenSnackProjection = {
        id: s.id,
        isGolden: s.isGolden,
        screenX: clampedX,
        screenY: clampedY,
        inView,
        inFront,
        distanceM: Math.round(distanceM),
        deltaAltM,
        edgeAngleDeg: angleDeg,
      };

      if (inView) {
        visibleMarkers.push(proj);
      }

      if (distanceM < bestDist) {
        bestDist = distanceM;
        nearest = proj;
      }
    }

    return {
      nearest,
      visibleMarkers,
    };
  }

  dispose(): void {
    this.clearVisuals();
    this.particleGeo.dispose();
    this.normalSparkMat.dispose();
    this.goldenSparkMat.dispose();
    this.assets.dispose();
  }
}
