export const CITY_CONFIG = {
  // Infinite procedural urban grid dimensions
  cellSizeM: 120,
  gridHalf: 11, // 23 x 23 cells = 2.76 km x 2.76 km scrolling window

  // Coastal ocean plane along the southern edge (+Z)
  seaDistanceZ: 2550,
  seaWidthM: 5000,
  seaDepthM: 2600,

  // Spawn posture over central city park (centered inside airborne snack band)
  startAltitudeM: 46,
  startHeadingRad: (-115 * Math.PI) / 180,
} as const;

export const FLIGHT_CONFIG = {
  glideSpeedMps: 12, // ~43 km/h at 1.0x
  glideSinkMps: -1.0,
  flapMaxSpeedMps: 22, // ~79 km/h at 1.0x
  flapMaxClimbMps: 7, // continuous flapPower * 7 m/s
  flapImpulseClimbMps: 6, // downstroke impulse * 6 m/s
  flapMinClimbMps: 2, // guarantee minimum +2 m/s climb on flap detection
  flapMaxPitchDeg: 25, // visual climb nose-up pitch up to +25 deg
  diveMaxSpeedMps: 32, // ~115 km/h at 1.0x
  speedLerpRate: 1.5, // gentle acceleration / deceleration curve
  diveMaxPitchDeg: 50,
  maxBankDeg: 45,
  maxTurnRateRadPerSec: 0.9,
  minAltitudeAglM: 8,
  maxAltitudeM: 500,
  forwardCollisionDistM: 12,
  collisionSpeedFactor: 0.6,
  collisionMinSpeedMps: 8,
} as const;

export const CAMERA_CONFIG = {
  distanceBackM: 11,
  heightUpM: 4,
  lookAheadM: 12,
  fovBaseDeg: 65,
  fovDiveDeg: 74,
  flapBobAmplitudeM: 0.24,
} as const;
