export class SoundManager {
  private ctx: AudioContext | null = null;
  private lastPlayed: Map<string, number> = new Map();

  private getCtx(): AudioContext | null {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private canPlay(key: string, cooldownMs: number = 50): boolean {
    const now = Date.now();
    const last = this.lastPlayed.get(key) ?? 0;
    if (now - last < cooldownMs) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private tone(
    ctx: AudioContext,
    freq: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay: number = 0,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    const t = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) osc.frequency.linearRampToValueAtTime(freqEnd, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  }

  private noise(
    ctx: AudioContext,
    duration: number,
    volume: number,
    cutoff: number = 2000,
    delay: number = 0,
  ): void {
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;

    const gain = ctx.createGain();
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
  }

  /** 페이즈 변경 (공 발사 타이밍) */
  phaseChange(): void {
    if (!this.canPlay('phase', 200)) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    this.tone(ctx, 440, 660, 0.1, 'square', 0.08);
  }

  /** 공 소멸 */
  ballEnd(): void {
    if (!this.canPlay('ballEnd', 30)) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    this.noise(ctx, 0.06, 0.06, 1000);
  }

  /** 내 스폰 피격 */
  spawnHitMine(): void {
    if (!this.canPlay('spawnHitMine', 80)) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    this.tone(ctx, 160, 80, 0.2, 'sawtooth', 0.18);
    this.noise(ctx, 0.15, 0.1, 500);
  }

  /** 상대 스폰 피격 */
  spawnHitEnemy(): void {
    if (!this.canPlay('spawnHitEnemy', 80)) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    this.tone(ctx, 440, 660, 0.1, 'square', 0.1);
  }

  /** 스폰 파괴 */
  spawnDestroy(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    this.noise(ctx, 0.5, 0.25, 800);
    this.tone(ctx, 100, 30, 0.5, 'sawtooth', 0.22);
  }

  /** 스폰 리스폰 */
  spawnRespawn(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    [330, 440, 550].forEach((freq, i) => {
      this.tone(ctx, freq, freq, 0.15, 'sine', 0.13, i * 0.08);
    });
  }

  /** 반사판 설치 */
  reflectorPlace(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    this.tone(ctx, 700, 700, 0.06, 'sine', 0.1);
  }

  /** 반사판 제거 */
  reflectorRemove(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    this.tone(ctx, 500, 250, 0.08, 'sine', 0.09);
  }

  /** 스톡 부족 경고 */
  stockWarning(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    this.tone(ctx, 280, 200, 0.18, 'sawtooth', 0.18);
  }

  /** 코어 피격 */
  coreHit(): void {
    if (!this.canPlay('coreHit', 100)) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    this.tone(ctx, 180, 90, 0.3, 'sawtooth', 0.22);
    this.noise(ctx, 0.2, 0.15, 600);
  }

  /** 코어 파괴 */
  coreDestroy(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    this.noise(ctx, 0.8, 0.35, 1000);
    this.tone(ctx, 80, 25, 0.8, 'sawtooth', 0.28);
  }

  /** 성벽 파괴 */
  wallDestroy(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    this.noise(ctx, 0.3, 0.18, 700);
    this.tone(ctx, 280, 140, 0.25, 'sawtooth', 0.13);
  }

  /** 게임 승리 */
  gameWin(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    [523, 659, 784, 1047].forEach((freq, i) => {
      this.tone(ctx, freq, freq, 0.25, 'square', 0.13, i * 0.13);
    });
  }

  /** 게임 패배 */
  gameLose(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    [523, 415, 330].forEach((freq, i) => {
      this.tone(ctx, freq, freq, 0.3, 'sine', 0.17, i * 0.2);
    });
  }
}
