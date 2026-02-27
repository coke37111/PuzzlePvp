import {
  BattleSimulator, BallSimulator, ReflectorType, Direction,
  MonsterType, DropItemType,
  CoreModel, SpawnPointModel, BallModel, TileModel,
} from '@puzzle-pvp/shared';
import type { PlayerZone } from '@puzzle-pvp/shared';

// ── 타입 정의 ────────────────────────────────────────────────────────────────

interface ThreatInfo {
  ballId: number;
  targetType: 'core' | 'spawn';
  targetId: number;
  estimatedDistance: number;
  direction: Direction;
  x: number;
  y: number;
}

interface Candidate {
  x: number;
  y: number;
  type: ReflectorType;
  score: number;
}

interface Multipliers {
  defense: number;
  healing: number;
  attack: number;
  growth: number;
  retention: number;  // 공 존 내 유지 보너스
  unlock: number;     // 잠긴 타워 해금
}

enum AIState {
  IDLE,       // 스톡 부족, 축적 대기
  DEFENDING,  // 위협 감지 — 방어 우선
  ATTACKING,  // 스톡 충분, 공세 — 공격 + 공 유지
  FARMING,    // 몬스터/아이템 — 성장 + 공 유지
}

// ── AI 플레이어 ──────────────────────────────────────────────────────────────

export class AIPlayer {
  readonly playerId: number;
  private simulator: BattleSimulator;
  private zone: PlayerZone;

  // 상태 머신
  private state: AIState = AIState.IDLE;
  private stateTimer: number = 0;
  private readonly STATE_MIN_DURATION = 0.5;

  // 타이머
  private decisionTimer: number = -BattleSimulator.PRE_GAME_DELAY;
  private gameTime: number = 0;

  // 위협 추적
  private activeThreats: Map<number, ThreatInfo> = new Map();
  private immediateActionPending: boolean = false;

  // 스톡 추적
  private lastStockLevel: number = 3;

  // 캐시
  private cachedMyCore: CoreModel | null = null;
  private cachedEnemyCores: CoreModel[] = [];
  private cachedMySpawns: SpawnPointModel[] = [];

  constructor(playerId: number, simulator: BattleSimulator, zone: PlayerZone) {
    this.playerId = playerId;
    this.simulator = simulator;
    this.zone = zone;
  }

  // ── 퍼블릭 API ────────────────────────────────────────────────────────────

  notify(event: string, data?: unknown): void {
    switch (event) {
      case 'ballMoved': {
        const { ball, to } = data as { ball: BallModel; from: TileModel; to: TileModel };
        this.onBallMovedHandler(ball, to);
        break;
      }
      case 'ballEnded': {
        const { ball } = data as { ball: BallModel };
        this.onBallEndedHandler(ball);
        break;
      }
      case 'ballCreated':
        break;
      case 'coreHpChanged': {
        const evt = data as { coreId: number; hp: number; ownerId: number };
        this.onCoreHpChangedHandler(evt);
        break;
      }
      case 'spawnDestroyed': {
        const { spawnId } = data as { spawnId: number };
        this.onSpawnDestroyedHandler(spawnId);
        break;
      }
      case 'spawnRespawned':
        this.evaluateStateTransition();
        break;
      case 'itemDropped': {
        const { x, y } = data as { itemId: number; x: number; y: number };
        this.onItemDroppedHandler(x, y);
        break;
      }
      case 'stockChanged': {
        const { playerId, stock } = data as { playerId: number; stock: number };
        if (playerId === this.playerId) this.onStockChangedHandler(stock);
        break;
      }
      case 'timeStopEnded':
        this.rescanThreats();
        this.evaluateStateTransition();
        break;
      case 'ownershipTransferred':
        this.refreshCaches();
        this.evaluateStateTransition();
        break;
    }
  }

  update(delta: number): void {
    if (this.zone.eliminated) return;
    this.gameTime += delta;
    this.stateTimer += delta;

    // 즉시 반응 (트리거 설정됨)
    if (this.immediateActionPending) {
      this.immediateActionPending = false;
      const closestThreat = this.getClosestThreat();
      if (closestThreat) this.tryImmediateDefense(closestThreat);
    }

    // 정기 폴링
    this.decisionTimer += delta;
    if (this.decisionTimer < this.getDecisionInterval()) return;
    this.decisionTimer = 0;

    this.refreshCaches();
    this.rescanThreats();

    switch (this.state) {
      case AIState.IDLE:      this.updateIdle(); break;
      case AIState.DEFENDING: this.updateDefending(); break;
      case AIState.ATTACKING: this.updateAttacking(); break;
      case AIState.FARMING:   this.updateFarming(); break;
    }

    this.evaluateStateTransition();
  }

  // ── 상태 전이 ─────────────────────────────────────────────────────────────

  private evaluateStateTransition(): void {
    if (this.stateTimer < this.STATE_MIN_DURATION) return;
    const newState = this.determineOptimalState();
    if (newState !== this.state) this.transitionTo(newState);
  }

  private determineOptimalState(): AIState {
    const stock = this.simulator.getReflectorStock(this.playerId);

    // 위협 있으면 방어
    const hasThreats = [...this.activeThreats.values()].some(t => t.estimatedDistance <= 5);
    if (hasThreats) return AIState.DEFENDING;

    // 코어 HP 낮으면 방어 유지 (힐링 우선)
    const myCore = this.getMyCore();
    if (myCore && myCore.hp / myCore.maxHp < 0.5) return AIState.DEFENDING;

    // 스톡 부족 → 대기
    if (stock <= 2) return this.hasFarmTargets() ? AIState.FARMING : AIState.IDLE;

    // 스톡 충분 → 공격 또는 파밍
    const weakEnemy = this.getWeakestEnemyCore();
    if (weakEnemy && weakEnemy.hp / weakEnemy.maxHp < 0.4) return AIState.ATTACKING;
    if (this.hasFarmTargets()) return AIState.FARMING;
    return AIState.ATTACKING;
  }

  private transitionTo(newState: AIState): void {
    this.state = newState;
    this.stateTimer = 0;
    if (newState === AIState.DEFENDING) this.onEnterDefending();
  }

  // ── 상태별 로직 ───────────────────────────────────────────────────────────

  // IDLE: 스톡 절약, 고가치 방어/해금만 (150+)
  private updateIdle(): void {
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock < 1) return;
    const mult = this.getStateMultipliers();
    const scoreMap = new Map<string, Candidate>();
    this.scoreDefenseCandidates(scoreMap, mult.defense);
    this.scoreHealingCandidates(scoreMap, mult.healing);
    this.scoreUnlockCandidates(scoreMap, mult.unlock);
    const best = this.getBestCandidate(scoreMap);
    if (best && best.score >= 150) {
      this.simulator.placeReflector(this.playerId, best.x, best.y, best.type);
    }
  }

  // DEFENDING: 방어 + 힐링 중심, 공 유지도 포함
  private updateDefending(): void {
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock <= 0) return;
    const mult = this.getStateMultipliers();
    const scoreMap = new Map<string, Candidate>();
    this.scoreDefenseCandidates(scoreMap, mult.defense);
    this.scoreHealingCandidates(scoreMap, mult.healing);
    this.scoreBallRetentionCandidates(scoreMap, mult.retention);
    this.scoreAttackCandidates(scoreMap, mult.attack);
    this.scoreGrowthCandidates(scoreMap, mult.growth);
    this.scoreUnlockCandidates(scoreMap, mult.unlock);
    const best = this.getBestCandidate(scoreMap);
    if (best) this.simulator.placeReflector(this.playerId, best.x, best.y, best.type);
    else this.placeStrategicFallback();
  }

  // ATTACKING: 공 유지 + 공격 중심, 힐링도 포함
  private updateAttacking(): void {
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock <= 1) return; // 예비 1개 유지
    const mult = this.getStateMultipliers();
    const scoreMap = new Map<string, Candidate>();
    this.scoreBallRetentionCandidates(scoreMap, mult.retention);
    this.scoreAttackCandidates(scoreMap, mult.attack);
    this.scoreHealingCandidates(scoreMap, mult.healing);
    this.scoreDefenseCandidates(scoreMap, mult.defense);
    this.scoreGrowthCandidates(scoreMap, mult.growth);
    this.scoreUnlockCandidates(scoreMap, mult.unlock);
    const best = this.getBestCandidate(scoreMap);
    if (best) this.simulator.placeReflector(this.playerId, best.x, best.y, best.type);
  }

  // FARMING: 공 유지 + 성장 중심, 힐링도 포함
  private updateFarming(): void {
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock <= 1) return; // 예비 1개 유지
    const mult = this.getStateMultipliers();
    const scoreMap = new Map<string, Candidate>();
    this.scoreBallRetentionCandidates(scoreMap, mult.retention);
    this.scoreGrowthCandidates(scoreMap, mult.growth);
    this.scoreHealingCandidates(scoreMap, mult.healing);
    this.scoreDefenseCandidates(scoreMap, mult.defense);
    this.scoreAttackCandidates(scoreMap, mult.attack);
    this.scoreUnlockCandidates(scoreMap, mult.unlock);
    const best = this.getBestCandidate(scoreMap);
    if (best) this.simulator.placeReflector(this.playerId, best.x, best.y, best.type);
  }

  // ── 상태 진입 ─────────────────────────────────────────────────────────────

  private onEnterDefending(): void {
    const closestThreat = this.getClosestThreat();
    if (closestThreat && closestThreat.estimatedDistance <= 3) {
      this.tryImmediateDefense(closestThreat);
    }
  }

  // ── 트리거 핸들러 ─────────────────────────────────────────────────────────

  private onBallMovedHandler(ball: BallModel, to: TileModel): void {
    if (ball.ownerId === this.playerId) return;

    if (!this.isInMyZone(to.x, to.y)) {
      this.activeThreats.delete(ball.id);
      return;
    }

    const inst = this.simulator.simulator.instances.find(
      i => i.ball.id === ball.id && !i.isEnd,
    );
    if (!inst) return;

    const myCore = this.getMyCore();
    let threat: ThreatInfo | null = null;

    if (myCore && AIPlayer.isDirectlyHeading(to.x, to.y, inst.direction, myCore.tile.x, myCore.tile.y)) {
      const dist = Math.abs(to.x - myCore.tile.x) + Math.abs(to.y - myCore.tile.y);
      threat = {
        ballId: ball.id, targetType: 'core', targetId: myCore.id,
        estimatedDistance: dist, direction: inst.direction, x: to.x, y: to.y,
      };
    }

    if (!threat) {
      for (const sp of this.getMySpawns()) {
        if (AIPlayer.isDirectlyHeading(to.x, to.y, inst.direction, sp.tile.x, sp.tile.y)) {
          const dist = Math.abs(to.x - sp.tile.x) + Math.abs(to.y - sp.tile.y);
          threat = {
            ballId: ball.id, targetType: 'spawn', targetId: sp.id,
            estimatedDistance: dist, direction: inst.direction, x: to.x, y: to.y,
          };
          break;
        }
      }
    }

    if (threat) {
      this.activeThreats.set(ball.id, threat);
      if (threat.estimatedDistance <= 3) this.immediateActionPending = true;
      this.evaluateStateTransition();
    } else {
      this.activeThreats.delete(ball.id);
    }
  }

  private onBallEndedHandler(ball: BallModel): void {
    this.activeThreats.delete(ball.id);
    if (this.activeThreats.size === 0 && this.state === AIState.DEFENDING) {
      this.evaluateStateTransition();
    }
  }

  private onCoreHpChangedHandler(event: { coreId: number; hp: number; ownerId: number }): void {
    if (event.ownerId !== this.playerId) return;
    const core = this.simulator.cores.find(c => c.id === event.coreId);
    if (!core) return;
    // HP 50% 미만이면 방어 전환 (EMERGENCY 없이 DEFENDING으로 대응)
    if (core.hp / core.maxHp < 0.5 && this.state !== AIState.DEFENDING) {
      this.transitionTo(AIState.DEFENDING);
    }
  }

  private onSpawnDestroyedHandler(spawnId: number): void {
    const sp = this.simulator.getSpawnPoint(spawnId);
    if (sp && sp.ownerId === this.playerId) this.evaluateStateTransition();
  }

  private onItemDroppedHandler(x: number, y: number): void {
    if (this.isInMyZone(x, y) && this.state === AIState.IDLE) this.evaluateStateTransition();
  }

  private onStockChangedHandler(stock: number): void {
    const prev = this.lastStockLevel;
    this.lastStockLevel = stock;
    if ((stock >= 5 && prev < 5) || (stock <= 1 && prev > 1)) this.evaluateStateTransition();
  }

  // ── 즉시 방어 ─────────────────────────────────────────────────────────────

  private tryImmediateDefense(threat: ThreatInfo): void {
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock <= 0) return;
    const myCore = this.getMyCore();
    if (!myCore) return;

    const d = AIPlayer.dirDelta(threat.direction);
    if (!d) return;

    let tx = threat.x;
    let ty = threat.y;

    for (let step = 1; step <= threat.estimatedDistance; step++) {
      tx += d.dx;
      ty += d.dy;
      if (!this.isInMyZone(tx, ty)) break;
      if (!this.simulator.canPlaceReflector(this.playerId, tx, ty)) continue;

      for (const rType of [ReflectorType.Slash, ReflectorType.Backslash]) {
        const newDir = BallSimulator.getReflectedDirection(threat.direction, rType);
        const afterPos = AIPlayer.stepInDir(tx, ty, newDir, 3);
        const distBefore = Math.abs(tx - myCore.tile.x) + Math.abs(ty - myCore.tile.y);
        const distAfter = Math.abs(afterPos.x - myCore.tile.x) + Math.abs(afterPos.y - myCore.tile.y);
        if (distAfter > distBefore) {
          this.simulator.placeReflector(this.playerId, tx, ty, rType);
          return;
        }
      }
    }
  }

  // ── 유틸 ──────────────────────────────────────────────────────────────────

  private getDecisionInterval(): number {
    switch (this.state) {
      case AIState.DEFENDING: return 0.3;
      case AIState.ATTACKING: return 0.5;
      case AIState.FARMING:   return 0.5;
      case AIState.IDLE:      return 0.8;
      default:                return 0.5;
    }
  }

  private getStateMultipliers(): Multipliers {
    const stock = this.simulator.getReflectorStock(this.playerId);
    const myCore = this.getMyCore();
    const coreRatio = myCore ? myCore.hp / myCore.maxHp : 1;
    const weakEnemy = this.getWeakestEnemyCore();

    let m: Multipliers;
    switch (this.state) {
      case AIState.IDLE:
        m = { defense: 0.3, healing: 1.0, attack: 0.2, growth: 0.5, retention: 0.3, unlock: 1.2 };
        break;
      case AIState.DEFENDING:
        m = { defense: 2.5, healing: 2.0, attack: 0.3, growth: 0.2, retention: 0.8, unlock: 0.5 };
        break;
      case AIState.ATTACKING:
        m = { defense: 0.4, healing: 0.8, attack: 2.0, growth: 0.5, retention: 1.5, unlock: 1.0 };
        break;
      case AIState.FARMING:
        m = { defense: 0.4, healing: 0.8, attack: 0.4, growth: 2.0, retention: 1.5, unlock: 1.0 };
        break;
      default:
        m = { defense: 1, healing: 1, attack: 1, growth: 1, retention: 1, unlock: 1 };
    }

    // 코어 HP 보정 — 힐링/방어 증폭
    if (coreRatio < 0.3) {
      m.defense *= 2.0;
      m.healing *= 2.5;
    } else if (coreRatio < 0.6) {
      m.defense *= 1.3;
      m.healing *= 1.5;
    }

    // 적 코어 약하면 공격 증폭
    if (weakEnemy && weakEnemy.hp / weakEnemy.maxHp < 0.3) m.attack *= 1.5;

    // 스톡 보정
    if (stock <= 1) {
      m.attack *= 0.1; m.growth *= 0.1; m.retention *= 0.1;
    } else if (stock <= 2) {
      m.attack *= 0.5; m.growth *= 0.5; m.retention *= 0.5;
    } else if (stock >= 4) {
      m.attack *= 1.3; m.growth *= 1.3; m.retention *= 1.3;
    }

    return m;
  }

  private rescanThreats(): void {
    const enemyBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd && inst.ball.ownerId !== this.playerId,
    );
    const activeBallIds = new Set(enemyBalls.map(b => b.ball.id));
    for (const ballId of this.activeThreats.keys()) {
      if (!activeBallIds.has(ballId)) this.activeThreats.delete(ballId);
    }
    const myCore = this.getMyCore();
    if (!myCore) return;
    for (const inst of enemyBalls) {
      const bx = inst.currentTile.x;
      const by = inst.currentTile.y;
      if (!this.isInMyZone(bx, by)) continue;
      if (AIPlayer.isDirectlyHeading(bx, by, inst.direction, myCore.tile.x, myCore.tile.y)) {
        const dist = Math.abs(bx - myCore.tile.x) + Math.abs(by - myCore.tile.y);
        this.activeThreats.set(inst.ball.id, {
          ballId: inst.ball.id, targetType: 'core', targetId: myCore.id,
          estimatedDistance: dist, direction: inst.direction, x: bx, y: by,
        });
      }
    }
  }

  private refreshCaches(): void {
    this.cachedMyCore = this.simulator.cores.find(c => c.ownerId === this.playerId && c.active) ?? null;
    this.cachedEnemyCores = this.simulator.cores.filter(c => c.ownerId !== this.playerId && c.active);
    this.cachedMySpawns = this.simulator.spawnPoints.filter(sp => sp.ownerId === this.playerId && sp.active);
  }

  private getMyCore(): CoreModel | null { return this.cachedMyCore; }
  private getMySpawns(): SpawnPointModel[] { return this.cachedMySpawns; }

  private getWeakestEnemyCore(): CoreModel | null {
    if (this.cachedEnemyCores.length === 0) return null;
    return this.cachedEnemyCores.reduce((a, b) => (a.hp / a.maxHp) < (b.hp / b.maxHp) ? a : b);
  }

  private getClosestThreat(): ThreatInfo | null {
    let closest: ThreatInfo | null = null;
    for (const t of this.activeThreats.values()) {
      if (!closest || t.estimatedDistance < closest.estimatedDistance) closest = t;
    }
    return closest;
  }

  private hasFarmTargets(): boolean {
    return this.simulator.getMonsters().some(m => m.active && this.isInMyZone(m.x, m.y)) ||
           this.simulator.getDroppedItems().some(i => this.isInMyZone(i.x, i.y));
  }

  private getBestCandidate(map: Map<string, Candidate>): Candidate | null {
    let best: Candidate | null = null;
    for (const c of map.values()) {
      if (!best || c.score > best.score) best = c;
    }
    return best;
  }

  // ── 스코어링 ──────────────────────────────────────────────────────────────

  private addScore(
    map: Map<string, Candidate>,
    x: number, y: number,
    type: ReflectorType,
    score: number,
  ): void {
    const key = `${x},${y},${type}`;
    const existing = map.get(key);
    if (existing) existing.score += score;
    else map.set(key, { x, y, type, score });
  }

  /**
   * [공 유지] 내 존을 벗어나려는 아군 공을 반사하여 존 안에 머물게 함.
   * 존 이탈까지 남은 거리가 짧을수록 긴급. 반사 후 존 안에 오래 머물수록 고점수.
   * 반사 후 유용한 타겟(적 코어, 몬스터) 방향이면 추가 보너스.
   */
  private scoreBallRetentionCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    const myBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd &&
        inst.ball.ownerId === this.playerId &&
        this.isInMyZone(inst.currentTile.x, inst.currentTile.y),
    );

    const enemyCore = this.getWeakestEnemyCore();

    for (const ball of myBalls) {
      const delta = AIPlayer.dirDelta(ball.direction);
      if (!delta) continue;

      // 존 이탈까지 몇 칸인지 계산
      let stepsToExit = 0;
      let sx = ball.currentTile.x;
      let sy = ball.currentTile.y;
      for (let s = 1; s <= 8; s++) {
        sx += delta.dx;
        sy += delta.dy;
        const tile = this.simulator.map.getTile(sx, sy);
        if (!tile || tile.isBlock || !this.isInMyZone(sx, sy)) {
          stepsToExit = s;
          break;
        }
      }
      if (stepsToExit === 0) continue; // 8칸 이내 이탈 없음 → 유지 불필요

      // 이탈 전 각 지점에 반사판 배치 평가
      let tx = ball.currentTile.x;
      let ty = ball.currentTile.y;
      for (let d = 1; d < stepsToExit; d++) {
        tx += delta.dx;
        ty += delta.dy;
        if (!this.isInMyZone(tx, ty)) break;
        if (!this.simulator.canPlaceReflector(this.playerId, tx, ty)) continue;

        // 이탈에 가까울수록 긴급 (urgency 높음)
        const urgency = 1 - (d / stepsToExit) * 0.4; // 0.6~1.0

        for (const rType of [ReflectorType.Slash, ReflectorType.Backslash]) {
          const newDir = BallSimulator.getReflectedDirection(ball.direction, rType);

          // 반사 후 존 안에 얼마나 오래 머무는지 계산
          let stepsInZoneAfter = 0;
          let ax = tx, ay = ty;
          const ad = AIPlayer.dirDelta(newDir);
          if (ad) {
            for (let s = 1; s <= 6; s++) {
              ax += ad.dx;
              ay += ad.dy;
              const aTile = this.simulator.map.getTile(ax, ay);
              if (!aTile || aTile.isBlock || !this.isInMyZone(ax, ay)) break;
              stepsInZoneAfter++;
            }
          }

          // 반사 후 바로 나가버리면 점수 없음
          if (stepsInZoneAfter === 0) continue;

          let score = 35 + (stepsInZoneAfter * 12); // 존 잔류 칸 수 × 12점

          // 반사 후 적 코어 방향이면 보너스
          if (enemyCore && ad) {
            const afterPos = AIPlayer.stepInDir(tx, ty, newDir, 5);
            const distBefore = Math.abs(tx - enemyCore.tile.x) + Math.abs(ty - enemyCore.tile.y);
            const distAfter = Math.abs(afterPos.x - enemyCore.tile.x) + Math.abs(afterPos.y - enemyCore.tile.y);
            if (distAfter < distBefore) score += 25;
          }

          // 반사 후 내 피격 구조물 방향이면 힐링 보너스
          const myCore = this.getMyCore();
          if (myCore && myCore.hp < myCore.maxHp) {
            const afterPos = AIPlayer.stepInDir(tx, ty, newDir, 5);
            const distToCore = Math.abs(afterPos.x - myCore.tile.x) + Math.abs(afterPos.y - myCore.tile.y);
            if (distToCore <= 3) score += 20;
          }

          this.addScore(map, tx, ty, rType, score * urgency * multiplier);
        }
      }
    }
  }

  /**
   * [힐링] 아군 공을 HP가 낮은 내 코어/타워로 유도하여 회복.
   * HP 결손율이 높을수록 점수 높음. 1-바운스 경로 사용.
   */
  private scoreHealingCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    const myBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd &&
        inst.ball.ownerId === this.playerId &&
        this.isInMyZone(inst.currentTile.x, inst.currentTile.y),
    );
    if (myBalls.length === 0) return;

    // 회복이 필요한 내 구조물 수집
    const healTargets: { x: number; y: number; urgency: number }[] = [];
    const myCore = this.getMyCore();
    if (myCore && myCore.hp < myCore.maxHp) {
      healTargets.push({
        x: myCore.tile.x, y: myCore.tile.y,
        urgency: 1 - myCore.hp / myCore.maxHp,
      });
    }
    for (const sp of this.getMySpawns()) {
      if (sp.hp < sp.maxHp) {
        healTargets.push({
          x: sp.tile.x, y: sp.tile.y,
          urgency: 1 - sp.hp / sp.maxHp,
        });
      }
    }
    if (healTargets.length === 0) return;

    for (const ball of myBalls) {
      const bx = ball.currentTile.x;
      const by = ball.currentTile.y;

      for (const target of healTargets) {
        const result = this.findReflectorForTarget(bx, by, ball.direction, target.x, target.y);
        if (!result) continue;

        // HP 결손율 0%~100% → 기본 40~140점
        const score = 40 + target.urgency * 100;
        this.addScore(map, result.x, result.y, result.type, score * multiplier);
      }
    }
  }

  /**
   * [방어] 적 공 경로를 최대 10칸 추적, 코어에서 멀어지게 꺾는 배치에 점수.
   */
  private scoreDefenseCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;
    const myCore = this.getMyCore();
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
      const directThreat = AIPlayer.isDirectlyHeading(tx, ty, ball.direction, cx, cy);

      for (let d = 0; d < 10; d++) {
        tx += delta.dx;
        ty += delta.dy;
        const tile = this.simulator.map.getTile(tx, ty);
        if (!tile || tile.isBlock) break;
        if (this.simulator.getWall(tx, ty)) break;
        if (!this.isInMyZone(tx, ty)) continue;
        if (!this.simulator.canPlaceReflector(this.playerId, tx, ty)) continue;

        const urgency = Math.max(0.3, 1 - (d + 1) * 0.08);

        for (const rType of [ReflectorType.Slash, ReflectorType.Backslash]) {
          const newDir = BallSimulator.getReflectedDirection(ball.direction, rType);
          const afterPos = AIPlayer.stepInDir(tx, ty, newDir, 5);
          const distBefore = Math.abs(tx - cx) + Math.abs(ty - cy);
          const distAfter = Math.abs(afterPos.x - cx) + Math.abs(afterPos.y - cy);
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

  /**
   * [성장] 내 공을 몬스터/아이템으로 유도하는 1-바운스 배치에 점수.
   */
  private scoreGrowthCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    const myBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd &&
        inst.ball.ownerId === this.playerId &&
        this.isInMyZone(inst.currentTile.x, inst.currentTile.y),
    );
    if (myBalls.length === 0) return;

    const monsters = this.simulator.getMonsters().filter(m => m.active && this.isInMyZone(m.x, m.y));
    const items = this.simulator.getDroppedItems().filter(i => this.isInMyZone(i.x, i.y));

    for (const ball of myBalls) {
      const bx = ball.currentTile.x;
      const by = ball.currentTile.y;

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
        this.addScore(map, result.x, result.y, result.type, (baseScore + Math.max(0, 20 - dist)) * multiplier);
      }

      for (const item of items) {
        const result = this.findReflectorForTarget(bx, by, ball.direction, item.x, item.y);
        if (!result) continue;
        let baseScore: number;
        switch (item.itemType) {
          case DropItemType.ReflectorExpand: baseScore = 75; break;
          case DropItemType.PowerUp:         baseScore = 65; break;
          case DropItemType.BallCount:       baseScore = 60; break;
          case DropItemType.SpeedUp:         baseScore = 45; break;
          default: baseScore = 50;
        }
        const dist = Math.abs(bx - item.x) + Math.abs(by - item.y);
        this.addScore(map, result.x, result.y, result.type, (baseScore + Math.max(0, 15 - dist)) * multiplier);
      }
    }
  }

  /**
   * [공격] 내 공 진행 경로(5칸)에서 적 코어 방향으로 꺾는 배치에 점수.
   */
  private scoreAttackCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    const enemyCores = this.cachedEnemyCores;
    if (enemyCores.length === 0) return;

    const myCenter = {
      x: this.zone.originX + this.zone.width / 2,
      y: this.zone.originY + this.zone.height / 2,
    };
    let targetCore = enemyCores[0];
    let minDist = Math.abs(targetCore.tile.x - myCenter.x) + Math.abs(targetCore.tile.y - myCenter.y);
    for (let i = 1; i < enemyCores.length; i++) {
      const d = Math.abs(enemyCores[i].tile.x - myCenter.x) + Math.abs(enemyCores[i].tile.y - myCenter.y);
      if (d < minDist) { minDist = d; targetCore = enemyCores[i]; }
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
          if (distAfter >= distBefore) continue;

          const improvement = (distBefore - distAfter) / Math.max(1, distBefore);
          this.addScore(map, tx, ty, rType, (40 + 30 * improvement) * multiplier);
        }
      }
    }
  }

  /**
   * [해금] 아군 공을 내 잠긴 타워로 유도하는 1-바운스 배치에 점수.
   * 박스 HP가 낮을수록(해금 임박) 더 높은 점수.
   */
  private scoreUnlockCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    const lockedSpawns = this.simulator.spawnPoints.filter(sp => {
      if (sp.ownerId !== this.playerId || sp.active) return false;
      const box = this.simulator.getTowerBox(sp.id);
      return box !== undefined && !box.broken;
    });
    if (lockedSpawns.length === 0) return;

    const myBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd &&
        inst.ball.ownerId === this.playerId &&
        this.isInMyZone(inst.currentTile.x, inst.currentTile.y),
    );
    if (myBalls.length === 0) return;

    for (const ball of myBalls) {
      const bx = ball.currentTile.x;
      const by = ball.currentTile.y;

      for (const sp of lockedSpawns) {
        const result = this.findReflectorForTarget(bx, by, ball.direction, sp.tile.x, sp.tile.y);
        if (!result) continue;

        const box = this.simulator.getTowerBox(sp.id)!;
        // 박스 HP 낮을수록 urgency 증가 (0%→1.5배, 100%→1.0배)
        const boxRatio = box.hp / box.maxHp;
        const urgency = 1.5 - boxRatio * 0.5;
        this.addScore(map, result.x, result.y, result.type, 90 * urgency * multiplier);
      }
    }
  }

  // 스코어링에서 후보가 없을 때 코어 근처 무작위 배치
  private placeStrategicFallback(): void {
    const myCore = this.getMyCore();
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

    const nearCore = candidates.filter(c => c.dist >= 1 && c.dist <= 3);
    const pool = nearCore.length > 0 ? nearCore : candidates;
    const tile = pool[Math.floor(Math.random() * pool.length)];
    const type = Math.random() < 0.5 ? ReflectorType.Slash : ReflectorType.Backslash;
    this.simulator.placeReflector(this.playerId, tile.x, tile.y, type);
  }

  // ── 기하 헬퍼 ─────────────────────────────────────────────────────────────

  private findReflectorForTarget(
    bx: number, by: number, dir: Direction,
    tx: number, ty: number,
  ): { x: number; y: number; type: ReflectorType } | null {
    if (dir === Direction.Right || dir === Direction.Left) {
      if (ty === by) return null;
      const isAhead = dir === Direction.Right ? tx > bx : tx < bx;
      if (!isAhead) return null;
      const rx = tx, ry = by;
      if (!this.isInMyZone(rx, ry)) return null;
      if (!this.simulator.canPlaceReflector(this.playerId, rx, ry)) return null;
      const goUp = ty < by;
      const type = goUp
        ? (dir === Direction.Right ? ReflectorType.Slash : ReflectorType.Backslash)
        : (dir === Direction.Right ? ReflectorType.Backslash : ReflectorType.Slash);
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
        : (dir === Direction.Up ? ReflectorType.Slash : ReflectorType.Backslash);
      return { x: rx, y: ry, type };
    }

    return null;
  }

  private isInMyZone(x: number, y: number): boolean {
    return x >= this.zone.originX && x < this.zone.originX + this.zone.width &&
           y >= this.zone.originY && y < this.zone.originY + this.zone.height;
  }

  private static isDirectlyHeading(
    bx: number, by: number, dir: Direction, tx: number, ty: number,
  ): boolean {
    return (dir === Direction.Right && by === ty && bx < tx) ||
           (dir === Direction.Left  && by === ty && bx > tx) ||
           (dir === Direction.Down  && bx === tx && by < ty) ||
           (dir === Direction.Up    && bx === tx && by > ty);
  }

  private static dirDelta(dir: Direction): { dx: number; dy: number } | null {
    if (dir === Direction.Right) return { dx: 1, dy: 0 };
    if (dir === Direction.Left)  return { dx: -1, dy: 0 };
    if (dir === Direction.Down)  return { dx: 0, dy: 1 };
    if (dir === Direction.Up)    return { dx: 0, dy: -1 };
    return null;
  }

  private static stepInDir(x: number, y: number, dir: Direction, dist: number): { x: number; y: number } {
    const d = AIPlayer.dirDelta(dir);
    if (!d) return { x, y };
    return { x: x + d.dx * dist, y: y + d.dy * dist };
  }
}
