class SfxController {
  private ctx: AudioContext | null = null;
  private muted = false;
  private lastLowBeepMs = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  unlock(): void {
    this.ensureContext();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  vibrate(pattern: number | number[]): void {
    try {
      if (!this.muted && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore vibration API restrictions
    }
  }

  playSnackCollect(combo: number, isGolden: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const semitoneBoost = Math.min(12, Math.max(0, combo - 1));
    const baseFreq = (isGolden ? 660 : 523.25) * Math.pow(2, semitoneBoost / 12);

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = isGolden ? 'triangle' : 'sine';
    osc1.frequency.setValueAtTime(baseFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.48, now + 0.14);

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(isGolden ? 0.22 : 0.16, now + 0.018);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + (isGolden ? 0.34 : 0.2));

    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + (isGolden ? 0.36 : 0.22));

    if (isGolden) {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(baseFreq * 1.5, now + 0.05);
      osc2.frequency.exponentialRampToValueAtTime(baseFreq * 2.0, now + 0.28);

      gain2.gain.setValueAtTime(0.001, now + 0.05);
      gain2.gain.linearRampToValueAtTime(0.18, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      osc2.connect(gain2).connect(ctx.destination);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.4);
      this.vibrate([25, 30, 45]);
    } else {
      this.vibrate(20);
    }
  }

  playBuildingHit(): void {
    this.vibrate(120);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Deep low "둥" impact thud
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(118, now);
    subOsc.frequency.exponentialRampToValueAtTime(42, now + 0.28);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.34, now + 0.012);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    subOsc.connect(subGain).connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.36);

    // Muted warm body transient
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(165, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(58, now + 0.14);

    bodyGain.gain.setValueAtTime(0.001, now);
    bodyGain.gain.linearRampToValueAtTime(0.14, now + 0.008);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    bodyOsc.connect(bodyGain).connect(ctx.destination);
    bodyOsc.start(now);
    bodyOsc.stop(now + 0.18);
  }

  playLowEnergyBeep(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastLowBeepMs < 1400) return;
    this.lastLowBeepMs = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.setValueAtTime(340, now + 0.09);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  playCountdownBeep(step: 3 | 2 | 1 | 'go'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (step === 'go') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(783.99, now);
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.18);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
      return;
    }

    const freq = step === 3 ? 440 : step === 2 ? 493.88 : 587.33;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playTimerTickBeep(secondsLeft: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freq = secondsLeft <= 3 ? 987.77 : 783.99;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(secondsLeft <= 3 ? 0.14 : 0.1, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  playTimeUpJingle(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  playNewRecordFanfare(): void {
    this.vibrate([30, 35, 65]);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(idx === notes.length - 1 ? 0.22 : 0.16, t + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (idx === notes.length - 1 ? 0.55 : 0.32));

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.58);
    });
  }
}

export const sfx = new SfxController();
