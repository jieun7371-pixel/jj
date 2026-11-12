export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Exponential smoothing with fixed alpha (e.g. alpha = 0.2 per frame).
 */
export function ema(prev: number, target: number, alpha: number): number {
  return prev + clamp(alpha, 0, 1) * (target - prev);
}

/**
 * Frame-rate independent exponential damping.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  const factor = 1 - Math.exp(-lambda * Math.max(0, dt));
  return current + (target - current) * factor;
}

export function wrapAngleRad(angleRad: number): number {
  let a = angleRad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Time-bounded ring buffer storing recent samples within windowSec.
 */
export class TimeWindowRingBuffer<T extends { timeSec: number }> {
  private items: T[] = [];
  private readonly maxCapacity: number;

  constructor(maxCapacity = 90) {
    this.maxCapacity = maxCapacity;
  }

  push(sample: T, windowSec: number): T[] {
    this.items.push(sample);
    const cutoff = sample.timeSec - windowSec;
    while (this.items.length > 0 && this.items[0].timeSec < cutoff) {
      this.items.shift();
    }
    while (this.items.length > this.maxCapacity) {
      this.items.shift();
    }
    return this.items;
  }

  getAll(): readonly T[] {
    return this.items;
  }

  clear(): void {
    this.items.length = 0;
  }
}
