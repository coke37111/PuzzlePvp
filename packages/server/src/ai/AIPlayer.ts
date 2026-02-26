import { BattleSimulator, BallSimulator, ReflectorType, Direction, MonsterType, DropItemType } from '@puzzle-pvp/shared';
import type { PlayerZone } from '@puzzle-pvp/shared';

/**
 * 스코어링 기반 AI — 모든 가능한 반사판 배치를 점수로 평가하여 최적해 선택.
 *
 * 방어/성장/공격을 분리된 우선순위 계층 대신 하나의 점수 공간에서 통합 평가.
 * 같은 (x, y, type)이 여러 목적에 기여하면 점수가 합산되어
 * 다목적 배치가 자연스럽게 최고 순위를 차지한다.
 *
 * 점수 대역:
 *   방어 (적 공 차단)    : ~80–270  (직접 위협 시 최대)
 *   성장 (몬스터/아이템)  : ~45–105
 *   공격 (적 코어 방향)   : ~40–70
 *
 * 게임 상태 배율:
 *   내 코어 HP < 30% → 방어 ×2.0
 *   내 코어 HP < 60% → 방어 ×1.3
 *   적 코어 HP < 30% → 공격 ×1.5
 */

interface Candidate {
  x: number;
  y: number;
  type: ReflectorType;
  score: number;
}

export class AIPlayer {
  readonly playerId: number;
  private simulator: BattleSimulator;
  private zone: PlayerZone;
  private decisionTimer: number = -BattleSimulator.PRE_GAME_DELAY;
  private readonly DECISION_INTERVAL = 0.5;

  constructor(playerId: number, simulator: BattleSimulator, zone: PlayerZone) {
    this.playerId = playerId;
    this.simulator = simulator;
    this.zone = zone;
  }

  update(delta: number): void {
    if (this.zone.eliminated) return;
    this.decisionTimer += delta;
    if (this.decisionTimer < this.DECISION_INTERVAL) return;
    this.decisionTimer = 0;
    this.makeDecision();
  }

  // ── 핵심 의사결정 엔진 ──────────────────────────────────

  private makeDecision(): void {
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock <= 0) return;

    const scoreMap = new Map<string, Candidate>();
    const mult = this.getMultipliers();

    this.scoreDefenseCandidates(scoreMap, mult.defense);
    this.scoreGrowthCandidates(scoreMap, mult.growth);
    this.scoreAttackCandidates(scoreMap, mult.attack);

    if (scoreMap.size === 0) {
      this.placeStrategicFallback();
      return;
    }

    // 최고 점수 배치 선택
    let best: Candidate | null = null;
    for (const c of scoreMap.values()) {
      if (!best || c.score > best.score) best = c;
    }

    if (best) {
      this.simulator.placeReflector(this.playerId, best.x, best.y, best.type);
    }
  }

  /** 같은 (x,y,type) 배치에 점수 누적 — 다목적 배치에 보너스 효과 */
  private addScore(
    map: Map<string, Candidate>,
    x: number, y: number,
    type: ReflectorType,
    score: number,
  ): void {
    const key = `${x},${y},${type}`;
    const existing = map.get(key);
    if (existing) {
      existing.score += score;
    } else {
      map.set(key, { x, y, type, score });
    }
  }

  // ── 게임 상태 평가 ──────────────────────────────────────

  private getMultipliers(): { defense: number; growth: number; attack: number } {
    const myCore = this.simulator.cores.find(c => c.ownerId === this.playerId && c.active);
    const enemyCores = this.simulator.cores.filter(c => c.ownerId !== this.playerId && c.active);

    let defense = 1.0;
    const growth = 1.0;
    let attack = 1.0;

    if (myCore) {
      const ratio = myCore.hp / myCore.maxHp;
      if (ratio < 0.3) defense = 2.0;
      else if (ratio < 0.6) defense = 1.3;
    } else {
      defense = 0; // 코어 없음 → 방어 불필요
    }

    if (enemyCores.length > 0) {
      const weakest = enemyCores.reduce((a, b) => (a.hp / a.maxHp) < (b.hp / b.maxHp) ? a : b);
      if (weakest.hp / weakest.maxHp < 0.3) attack = 1.5;
    } else {
      attack = 0; // 적 코어 없음 → 공격 불필요
    }

    return { defense, growth, attack };
  }

  // ── 방어 스코어링 ───────────────────────────────────────
  //
  // 적 공의 진행 경로를 최대 10칸 추적 (존 밖 접근 공 포함).
  // 내 존 안의 유효 배치 지점마다 Slash/Backslash를 시도하여
  // 코어에서 멀어지는 방향으로 꺾는 배치에 점수 부여.
  //
  // 점수 구성:
  //   기본 100 + 코어 근접도 보너스(~80) + 편향 품질(~40)
  //   + 직접 위협 보너스(50) × 긴급도 감쇠(0.3–1.0) × 배율

  private scoreDefenseCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    const myCore = this.simulator.cores.find(c => c.ownerId === this.playerId && c.active);
    if (!myCore) return;
    const cx = myCore.tile.x;
    const cy = myCore.tile.y;
    const maxDist = this.zone.width + this.zone.height;

    const enemyBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd && inst.ball.ownerId !== this.playerId,
    );

    for (const ball of enemyBalls) {
      const delta = AIPlayer.dirDelta(ball.direction);
      if (!delta) continue;

      let tx = ball.currentTile.x;
      let ty = ball.currentTile.y;
      const directThreat = AIPlayer.isDirectThreat(tx, ty, ball.direction, cx, cy);

      for (let d = 0; d < 10; d++) {
        tx += delta.dx;
        ty += delta.dy;

        // 장애물이면 경로 종료
        const tile = this.simulator.map.getTile(tx, ty);
        if (!tile || tile.isBlock) break;
        if (this.simulator.getWall(tx, ty)) break;

        // 내 존 안의 유효 배치만 평가
        if (!this.isInMyZone(tx, ty)) continue;
        if (!this.simulator.canPlaceReflector(this.playerId, tx, ty)) continue;

        // 가까울수록 긴급 (1.0→0.3 감쇠)
        const urgency = Math.max(0.3, 1 - (d + 1) * 0.08);

        for (const rType of [ReflectorType.Slash, ReflectorType.Backslash]) {
          const newDir = BallSimulator.getReflectedDirection(ball.direction, rType);
          const afterPos = AIPlayer.stepInDir(tx, ty, newDir, 5);

          const distBefore = Math.abs(tx - cx) + Math.abs(ty - cy);
          const distAfter = Math.abs(afterPos.x - cx) + Math.abs(afterPos.y - cy);

          // 코어에서 멀어지는 방향만 유효
          if (distAfter <= distBefore) continue;

          const proximityToCore = Math.max(0, 1 - distBefore / maxDist);
          const deflectionQuality = Math.min(1, (distAfter - distBefore) / maxDist);

          let score = 100 + (80 * proximityToCore) + (40 * deflectionQuality);
          if (directThreat) score += 50;
          score *= urgency;

          this.addScore(map, tx, ty, rType, score * multiplier);
        }
      }
    }
  }

  /** 공이 코어와 같은 행/열에서 코어를 향해 직진 중인지 */
  private static isDirectThreat(
    bx: number, by: number, dir: Direction, cx: number, cy: number,
  ): boolean {
    return (dir === Direction.Right && by === cy && bx < cx) ||
           (dir === Direction.Left  && by === cy && bx > cx) ||
           (dir === Direction.Down  && bx === cx && by < cy) ||
           (dir === Direction.Up    && bx === cx && by > cy);
  }

  // ── 성장 스코어링 ───────────────────────────────────────
  //
  // 내 공을 몬스터/아이템으로 유도하는 1-바운스 배치를 평가.
  // 몬스터 타입별 가치: Purple(85) > Orange(70) > White(60) > LightBlue(50)
  // 아이템 타입별 가치: ReflectorExpand(75) > PowerUp(65) > BallCount(60) > SpeedUp(45)
  // 근접 보너스: 가까운 대상일수록 적중 확률 높음.

  private scoreGrowthCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    const myBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd &&
        inst.ball.ownerId === this.playerId &&
        this.isInMyZone(inst.currentTile.x, inst.currentTile.y),
    );
    if (myBalls.length === 0) return;

    const monsters = this.simulator.getMonsters().filter(
      m => m.active && this.isInMyZone(m.x, m.y),
    );
    const items = this.simulator.getDroppedItems().filter(
      i => this.isInMyZone(i.x, i.y),
    );

    for (const ball of myBalls) {
      const bx = ball.currentTile.x;
      const by = ball.currentTile.y;

      // 몬스터 타겟 평가
      for (const m of monsters) {
        const result = this.findReflectorForTarget(bx, by, ball.direction, m.x, m.y);
        if (!result) continue;

        let baseScore: number;
        switch (m.type) {
          case MonsterType.Purple:    baseScore = 85; break;
          case MonsterType.Orange:    baseScore = 70; break;
          case MonsterType.White:     baseScore = 60; break;
          case MonsterType.LightBlue: baseScore = 50; break;
          default: baseScore = 50;
        }
        const dist = Math.abs(bx - m.x) + Math.abs(by - m.y);
        const proximityBonus = Math.max(0, 20 - dist);
        this.addScore(map, result.x, result.y, result.type, (baseScore + proximityBonus) * multiplier);
      }

      // 아이템 타겟 평가
      for (const item of items) {
        const result = this.findReflectorForTarget(bx, by, ball.direction, item.x, item.y);
        if (!result) continue;

        let baseScore: number;
        switch (item.itemType) {
          case DropItemType.ReflectorExpand: baseScore = 75; break;
          case DropItemType.PowerUp:        baseScore = 65; break;
          case DropItemType.BallCount:      baseScore = 60; break;
          case DropItemType.SpeedUp:        baseScore = 45; break;
          default: baseScore = 50;
        }
        const dist = Math.abs(bx - item.x) + Math.abs(by - item.y);
        const proximityBonus = Math.max(0, 15 - dist);
        this.addScore(map, result.x, result.y, result.type, (baseScore + proximityBonus) * multiplier);
      }
    }
  }

  // ── 공격 스코어링 ───────────────────────────────────────
  //
  // 내 공 진행 경로의 각 지점에서 Slash/Backslash를 시도하여
  // 적 코어에 가까워지는 배치에 점수 부여.
  // N인 게임에서는 가장 가까운 적 코어를 타겟.

  private scoreAttackCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    // 가장 가까운 적 코어 타겟 선택
    const enemyCores = this.simulator.cores.filter(c => c.ownerId !== this.playerId && c.active);
    if (enemyCores.length === 0) return;

    const myCenter = {
      x: this.zone.originX + this.zone.width / 2,
      y: this.zone.originY + this.zone.height / 2,
    };
    let targetCore = enemyCores[0];
    let minCoreDist = Math.abs(targetCore.tile.x - myCenter.x) + Math.abs(targetCore.tile.y - myCenter.y);
    for (let i = 1; i < enemyCores.length; i++) {
      const d = Math.abs(enemyCores[i].tile.x - myCenter.x) + Math.abs(enemyCores[i].tile.y - myCenter.y);
      if (d < minCoreDist) { minCoreDist = d; targetCore = enemyCores[i]; }
    }
    const ex = targetCore.tile.x;
    const ey = targetCore.tile.y;

    const myBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd &&
        inst.ball.ownerId === this.playerId &&
        this.isInMyZone(inst.currentTile.x, inst.currentTile.y),
    );

    for (const ball of myBalls) {
      const delta = AIPlayer.dirDelta(ball.direction);
      if (!delta) continue;

      let tx = ball.currentTile.x;
      let ty = ball.currentTile.y;

      for (let d = 0; d < 5; d++) {
        tx += delta.dx;
        ty += delta.dy;
        if (!this.isInMyZone(tx, ty)) break;
        const tile = this.simulator.map.getTile(tx, ty);
        if (!tile || tile.isBlock) break;
        if (!this.simulator.canPlaceReflector(this.playerId, tx, ty)) continue;

        for (const rType of [ReflectorType.Slash, ReflectorType.Backslash]) {
          const newDir = BallSimulator.getReflectedDirection(ball.direction, rType);
          const afterPos = AIPlayer.stepInDir(tx, ty, newDir, 5);

          const distBefore = Math.abs(tx - ex) + Math.abs(ty - ey);
          const distAfter = Math.abs(afterPos.x - ex) + Math.abs(afterPos.y - ey);
          if (distAfter >= distBefore) continue; // 개선 없으면 스킵

          const improvement = (distBefore - distAfter) / Math.max(1, distBefore);
          const score = 40 + (30 * improvement);
          this.addScore(map, tx, ty, rType, score * multiplier);
        }
      }
    }
  }

  // ── 전략적 폴백 ─────────────────────────────────────────
  //
  // 스코어링에서 후보가 없을 때만 실행.
  // 코어 근처 (1–3칸)에 반사판을 놓아 수동적 방어 형성.

  private placeStrategicFallback(): void {
    const myCore = this.simulator.cores.find(c => c.ownerId === this.playerId && c.active);
    const centerX = myCore?.tile.x ?? (this.zone.originX + Math.floor(this.zone.width / 2));
    const centerY = myCore?.tile.y ?? (this.zone.originY + Math.floor(this.zone.height / 2));

    const candidates: { x: number; y: number; dist: number }[] = [];
    for (let lx = 0; lx < this.zone.width; lx++) {
      for (let ly = 0; ly < this.zone.height; ly++) {
        const wx = this.zone.originX + lx;
        const wy = this.zone.originY + ly;
        if (!this.simulator.canPlaceReflector(this.playerId, wx, wy)) continue;
        candidates.push({ x: wx, y: wy, dist: Math.abs(wx - centerX) + Math.abs(wy - centerY) });
      }
    }
    if (candidates.length === 0) return;

    // 코어 근처 1–3칸 우선, 없으면 전체에서 선택
    const nearCore = candidates.filter(c => c.dist >= 1 && c.dist <= 3);
    const pool = nearCore.length > 0 ? nearCore : candidates;
    const tile = pool[Math.floor(Math.random() * pool.length)];
    const type = Math.random() < 0.5 ? ReflectorType.Slash : ReflectorType.Backslash;
    this.simulator.placeReflector(this.playerId, tile.x, tile.y, type);
  }

  // ── 기하 헬퍼 ───────────────────────────────────────────

  /**
   * 1-바운스 경로로 (bx,by,dir) → (tx,ty) 유도 반사판 위치/타입 계산.
   *
   * 수평 이동: (tx, by)에 반사판 → 수직으로 꺾어 ty 도달
   * 수직 이동: (bx, ty)에 반사판 → 수평으로 꺾어 tx 도달
   */
  private findReflectorForTarget(
    bx: number, by: number, dir: Direction,
    tx: number, ty: number,
  ): { x: number; y: number; type: ReflectorType } | null {

    if (dir === Direction.Right || dir === Direction.Left) {
      if (ty === by) return null; // 직선 → 반사판 불필요
      const isAhead = dir === Direction.Right ? tx > bx : tx < bx;
      if (!isAhead) return null;

      const rx = tx, ry = by;
      if (!this.isInMyZone(rx, ry)) return null;
      if (!this.simulator.canPlaceReflector(this.playerId, rx, ry)) return null;

      const goUp = ty < by;
      const type = goUp
        ? (dir === Direction.Right ? ReflectorType.Slash      : ReflectorType.Backslash)
        : (dir === Direction.Right ? ReflectorType.Backslash  : ReflectorType.Slash);
      return { x: rx, y: ry, type };
    }

    if (dir === Direction.Up || dir === Direction.Down) {
      if (tx === bx) return null;
      const isAhead = dir === Direction.Up ? ty < by : ty > by;
      if (!isAhead) return null;

      const rx = bx, ry = ty;
      if (!this.isInMyZone(rx, ry)) return null;
      if (!this.simulator.canPlaceReflector(this.playerId, rx, ry)) return null;

      const goLeft = tx < bx;
      const type = goLeft
        ? (dir === Direction.Up ? ReflectorType.Backslash : ReflectorType.Slash)
        : (dir === Direction.Up ? ReflectorType.Slash     : ReflectorType.Backslash);
      return { x: rx, y: ry, type };
    }

    return null;
  }

  private isInMyZone(x: number, y: number): boolean {
    return x >= this.zone.originX && x < this.zone.originX + this.zone.width &&
           y >= this.zone.originY && y < this.zone.originY + this.zone.height;
  }

  /** 방향 → (dx, dy). Direction.None이면 null 반환 */
  private static dirDelta(dir: Direction): { dx: number; dy: number } | null {
    if (dir === Direction.Right) return { dx: 1, dy: 0 };
    if (dir === Direction.Left)  return { dx: -1, dy: 0 };
    if (dir === Direction.Down)  return { dx: 0, dy: 1 };
    if (dir === Direction.Up)    return { dx: 0, dy: -1 };
    return null;
  }

  /** (x,y)에서 dir 방향으로 dist칸 이동한 좌표 */
  private static stepInDir(x: number, y: number, dir: Direction, dist: number): { x: number; y: number } {
    const d = AIPlayer.dirDelta(dir);
    if (!d) return { x, y };
    return { x: x + d.dx * dist, y: y + d.dy * dist };
  }
}
