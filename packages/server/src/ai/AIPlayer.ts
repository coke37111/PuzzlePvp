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

  // 골드 소비 타이머
  private goldTimer: number = 0;
  private readonly GOLD_DECISION_INTERVAL = 1.5;

  // 파밍 계획
  private farmPlan: { x: number; y: number; type: ReflectorType }[] = [];

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

    // 골드 소비 결정 (매 프레임 누적)
    this.goldTimer += delta;
    if (this.goldTimer >= this.GOLD_DECISION_INTERVAL) {
      this.goldTimer = 0;
      this.trySpendGold();
    }

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

    // 스톡 부족 → 대기 (파밍 목표 있으면 파밍)
    if (stock <= 2) return this.hasFarmTargets() ? AIState.FARMING : AIState.IDLE;

    // 스톡 충분 → 파밍 > 공격 (파밍 목표 있으면 항상 파밍 우선)
    // 적 코어가 매우 약할 때만(< 15%) 공격 우선
    const weakEnemy = this.getWeakestEnemyCore();
    const enemyNearDeath = weakEnemy && weakEnemy.hp / weakEnemy.maxHp < 0.15;
    if (enemyNearDeath) return AIState.ATTACKING;
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

  // FARMING: 스폰 기준 전체 반사판 배치 계획 → 단계적 실행
  private updateFarming(): void {
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock <= 0) return;

    // 매 틱마다 최적 배치 재계산 (몬스터/아이템 위치 변동 반영)
    this.farmPlan = this.planFarmLayout();

    // 계획 실행 (한 틱에 하나씩)
    if (this.executeFarmPlan()) return;

    // 계획 완료 후 잔여 스톡으로 방어/힐링/공격 보조
    if (stock <= 1) return;
    const mult = this.getStateMultipliers();
    const scoreMap = new Map<string, Candidate>();
    this.scoreBallRetentionCandidates(scoreMap, mult.retention);
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
        m = { defense: 0.3, healing: 1.0, attack: 0.2, growth: 1.0, retention: 0.3, unlock: 1.2 };
        break;
      case AIState.DEFENDING:
        m = { defense: 2.5, healing: 2.0, attack: 0.3, growth: 0.3, retention: 0.8, unlock: 0.5 };
        break;
      case AIState.ATTACKING:
        m = { defense: 0.4, healing: 0.8, attack: 2.0, growth: 1.0, retention: 1.5, unlock: 1.0 };
        break;
      case AIState.FARMING:
        m = { defense: 0.4, healing: 0.8, attack: 0.5, growth: 2.5, retention: 1.5, unlock: 1.0 };
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
   * [성장] 방향 변화(반사판) 대비 최대 아이템/몬스터 획득 경로를 찾아 첫 반사판 위치에 점수.
   *
   * 알고리즘:
   * 1. 공 진행 경로의 각 칸을 첫 반사판 후보로 평가
   * 2. 각 후보에서 반사 후 경로를 최대 2회 추가 바운스까지 재귀 탐색
   * 3. 효율 = 누적 획득 점수 / 총 반사판 수 로 경로 비교
   * 4. 가장 높은 효율의 경로에 해당하는 첫 반사판 위치를 선택
   */
  private scoreGrowthCandidates(map: Map<string, Candidate>, multiplier: number): void {
    if (multiplier === 0) return;

    const myBalls = this.simulator.simulator.instances.filter(
      inst => !inst.isEnd &&
        inst.ball.ownerId === this.playerId &&
        this.isInMyZone(inst.currentTile.x, inst.currentTile.y),
    );
    if (myBalls.length === 0) return;

    const rawMonsters = this.simulator.getMonsters().filter(m => m.active && this.isInOrNearMyZone(m.x, m.y, 2));
    const rawItems = this.simulator.getDroppedItems().filter(i => this.isInOrNearMyZone(i.x, i.y, 2));
    if (rawMonsters.length === 0 && rawItems.length === 0) return;

    // O(1) 좌표 조회를 위한 맵 구성
    const monsterMap = new Map<string, typeof rawMonsters[0]>();
    for (const m of rawMonsters) monsterMap.set(`${m.x},${m.y}`, m);
    const itemMap = new Map<string, typeof rawItems[0]>();
    for (const i of rawItems) itemMap.set(`${i.x},${i.y}`, i);

    for (const ball of myBalls) {
      // 공의 실제 이동 경로를 따라가며 첫 반사판 후보 위치 탐색.
      // 기존 반사판이 있으면 그 방향으로 꺾어 따라감 (직진 가정 X).
      let cx = ball.currentTile.x;
      let cy = ball.currentTile.y;
      let currentDir = ball.direction;

      for (let d = 1; d <= 12; d++) {
        const delta = AIPlayer.dirDelta(currentDir);
        if (!delta) break;
        cx += delta.dx;
        cy += delta.dy;

        const tile = this.simulator.map.getTile(cx, cy);
        if (!tile || tile.isBlock) break;
        if (this.simulator.getWall(cx, cy)) break;

        // 기존 반사판이 있으면 방향을 꺾어 계속 진행 (설치 후보 아님)
        const existingRef = this.simulator.map.reflectors.get(cx + cy * 100);
        if (existingRef) {
          currentDir = BallSimulator.getReflectedDirection(currentDir, existingRef.type);
          continue;
        }

        if (!this.simulator.canPlaceReflector(this.playerId, cx, cy)) continue;

        for (const rType of [ReflectorType.Slash, ReflectorType.Backslash]) {
          const newDir = BallSimulator.getReflectedDirection(currentDir, rType);
          const totalScore = this.computeMaxFarmScore(
            cx, cy, newDir, monsterMap, itemMap,
            /* bouncesLeft= */ 2, /* accScore= */ 0,
          );
          if (totalScore > 0) {
            this.addScore(map, cx, cy, rType, totalScore * multiplier);
          }
        }
      }
    }
  }

  /**
   * 경로 추적 + 재귀 바운스로 달성 가능한 최대 총 획득 점수를 계산.
   * 반사판을 최대한 활용해 몬스터/아이템을 최대한 많이 획득하는 경로를 탐색.
   *
   * @param startX/Y    현재 반사판 위치
   * @param dir         반사 후 방향
   * @param monsterMap  O(1) 몬스터 조회용 좌표 맵
   * @param itemMap     O(1) 아이템 조회용 좌표 맵
   * @param bouncesLeft 이 지점부터 추가로 배치 가능한 반사판 수
   * @param accScore    이전 구간까지 누적된 획득 점수
   * @returns 이 경로에서 달성 가능한 최대 총 점수
   */
  private computeMaxFarmScore(
    startX: number, startY: number, dir: Direction,
    monsterMap: Map<string, ReturnType<BattleSimulator['getMonsters']>[0]>,
    itemMap: Map<string, ReturnType<BattleSimulator['getDroppedItems']>[0]>,
    bouncesLeft: number,
    accScore: number,
  ): number {
    let currentDir = dir;
    let segScore = 0;
    let bestTotal = accScore;
    let cx = startX, cy = startY;

    for (let s = 1; s <= 12; s++) {
      const delta = AIPlayer.dirDelta(currentDir);
      if (!delta) break;
      cx += delta.dx;
      cy += delta.dy;

      if (!this.isInOrNearMyZone(cx, cy, 2)) break;
      const tile = this.simulator.map.getTile(cx, cy);
      if (!tile || tile.isBlock) break;
      if (this.simulator.getWall(cx, cy)) break;

      segScore += this.getFarmCellScore(cx, cy, monsterMap, itemMap);
      const totalSoFar = accScore + segScore;
      if (totalSoFar > bestTotal) bestTotal = totalSoFar;

      // 기존 반사판이 있으면 방향을 꺾어 계속 진행 (추가 설치 불가)
      const existingRef = this.simulator.map.reflectors.get(cx + cy * 100);
      if (existingRef) {
        currentDir = BallSimulator.getReflectedDirection(currentDir, existingRef.type);
        continue;
      }

      // 추가 반사판 배치 탐색
      if (bouncesLeft > 0 && this.simulator.canPlaceReflector(this.playerId, cx, cy)) {
        for (const rType of [ReflectorType.Slash, ReflectorType.Backslash]) {
          const newDir = BallSimulator.getReflectedDirection(currentDir, rType);
          const subTotal = this.computeMaxFarmScore(
            cx, cy, newDir, monsterMap, itemMap,
            bouncesLeft - 1, accScore + segScore,
          );
          if (subTotal > bestTotal) bestTotal = subTotal;
        }
      }
    }

    return bestTotal;
  }

  /** 특정 좌표의 몬스터/아이템 획득 점수 반환 (O(1) 맵 조회). */
  private getFarmCellScore(
    x: number, y: number,
    monsterMap: Map<string, ReturnType<BattleSimulator['getMonsters']>[0]>,
    itemMap: Map<string, ReturnType<BattleSimulator['getDroppedItems']>[0]>,
  ): number {
    let score = 0;
    const monster = monsterMap.get(`${x},${y}`);
    if (monster) {
      switch (monster.type) {
        case MonsterType.Purple:    score += 120; break;
        case MonsterType.Orange:    score += 100; break;
        case MonsterType.White:     score += 85;  break;
        case MonsterType.LightBlue: score += 70;  break;
        default:                    score += 70;
      }
    }
    const item = itemMap.get(`${x},${y}`);
    if (item) {
      switch (item.itemType) {
        case DropItemType.ReflectorExpand: score += 110; break;
        case DropItemType.PowerUp:         score += 95;  break;
        case DropItemType.BallCount:       score += 85;  break;
        case DropItemType.SpeedUp:         score += 65;  break;
        default:                           score += 70;
      }
    }
    return score;
  }

  // ── 파밍 계획 (스폰 기준 전체 반사판 배치) ─────────────────────────────────

  /**
   * 스폰 포인트에서 출발하는 공의 경로를 기준으로
   * 모든 반사판 슬롯을 사용해 최대 몬스터/아이템을 수집하는 배치를 계획.
   *
   * 알고리즘: 탐욕(Greedy) — 한 번에 하나씩, 가장 점수 높은 반사판을 배치.
   * 각 라운드마다 모든 스폰 경로를 재추적하여 다음 최적 위치를 선정.
   */
  private planFarmLayout(): { x: number; y: number; type: ReflectorType }[] {
    const spawns = this.getMySpawns();
    if (spawns.length === 0) return [];

    const maxReflectors = this.simulator.getEffectiveMaxReflectors(this.playerId);
    if (maxReflectors <= 0) return [];

    // 타겟 맵 구성 (몬스터 + 아이템)
    const rawMonsters = this.simulator.getMonsters().filter(m => m.active && this.isInOrNearMyZone(m.x, m.y, 2));
    const rawItems = this.simulator.getDroppedItems().filter(i => this.isInOrNearMyZone(i.x, i.y, 2));
    if (rawMonsters.length === 0 && rawItems.length === 0) return [];

    const monsterMap = new Map<string, typeof rawMonsters[0]>();
    for (const m of rawMonsters) monsterMap.set(`${m.x},${m.y}`, m);
    const itemMap = new Map<string, typeof rawItems[0]>();
    for (const i of rawItems) itemMap.set(`${i.x},${i.y}`, i);

    const placements: { x: number; y: number; type: ReflectorType }[] = [];
    const placedSet = new Set<string>();

    // 탐욕 반복: 매 라운드마다 최적 반사판 1개 선정
    for (let round = 0; round < maxReflectors; round++) {
      let bestPlacement: { x: number; y: number; type: ReflectorType } | null = null;
      let bestScore = 0;

      for (const spawn of spawns) {
        // 스폰에서 출발, 기존 맵 반사판 무시, 계획된 반사판만 반영한 경로
        const pathTiles = this.traceFarmPath(
          spawn.tile.x, spawn.tile.y, spawn.spawnDirection, placements,
        );

        for (const pt of pathTiles) {
          if (placedSet.has(`${pt.x},${pt.y}`)) continue;
          if (!this.canPlaceFarmReflector(pt.x, pt.y)) continue;

          for (const rType of [ReflectorType.Slash, ReflectorType.Backslash]) {
            const newDir = BallSimulator.getReflectedDirection(pt.dir, rType);
            if (newDir === pt.dir) continue; // 변화 없으면 스킵

            const score = this.scoreFarmPathSegment(
              pt.x, pt.y, newDir, monsterMap, itemMap, placements,
            );
            if (score > bestScore) {
              bestScore = score;
              bestPlacement = { x: pt.x, y: pt.y, type: rType };
            }
          }
        }
      }

      if (!bestPlacement || bestScore <= 0) break;
      placements.push(bestPlacement);
      placedSet.add(`${bestPlacement.x},${bestPlacement.y}`);
    }

    return placements;
  }

  /**
   * 기존 맵 반사판을 무시하고, 계획된 반사판만 반영하여 공 경로를 추적.
   * 각 타일에서의 진입 방향(dir)을 함께 반환하여 반사판 배치 후보로 사용.
   */
  private traceFarmPath(
    startX: number, startY: number, dir: Direction,
    placements: { x: number; y: number; type: ReflectorType }[],
  ): { x: number; y: number; dir: Direction }[] {
    const plannedMap = new Map<string, ReflectorType>();
    for (const p of placements) plannedMap.set(`${p.x},${p.y}`, p.type);

    const path: { x: number; y: number; dir: Direction }[] = [];
    let cx = startX, cy = startY, currentDir = dir;
    const visited = new Set<string>();

    for (let step = 0; step < 30; step++) {
      const delta = AIPlayer.dirDelta(currentDir);
      if (!delta) break;
      cx += delta.dx;
      cy += delta.dy;

      // 맵 경계/장애물 체크
      const tile = this.simulator.map.getTile(cx, cy);
      if (!tile || tile.isBlock) break;
      if (this.simulator.getWall(cx, cy)) break;

      // 루프 감지
      const visitKey = `${cx},${cy},${currentDir}`;
      if (visited.has(visitKey)) break;
      visited.add(visitKey);

      // 계획된 반사판이 있으면 방향 변경 (배치 후보 아님)
      const plannedType = plannedMap.get(`${cx},${cy}`);
      if (plannedType !== undefined) {
        currentDir = BallSimulator.getReflectedDirection(currentDir, plannedType);
        continue;
      }

      // 배치 후보 타일 (현재 진입 방향 포함)
      path.push({ x: cx, y: cy, dir: currentDir });
    }

    return path;
  }

  /**
   * 반사 후 경로를 따라가며 몬스터/아이템 점수를 합산.
   * 계획된 반사판은 경로 반영, 맵 반사판은 무시.
   */
  private scoreFarmPathSegment(
    fromX: number, fromY: number, dir: Direction,
    monsterMap: Map<string, ReturnType<BattleSimulator['getMonsters']>[0]>,
    itemMap: Map<string, ReturnType<BattleSimulator['getDroppedItems']>[0]>,
    placements: { x: number; y: number; type: ReflectorType }[],
  ): number {
    const plannedMap = new Map<string, ReflectorType>();
    for (const p of placements) plannedMap.set(`${p.x},${p.y}`, p.type);

    let score = 0;
    let cx = fromX, cy = fromY, currentDir = dir;

    for (let step = 0; step < 20; step++) {
      const delta = AIPlayer.dirDelta(currentDir);
      if (!delta) break;
      cx += delta.dx;
      cy += delta.dy;

      const tile = this.simulator.map.getTile(cx, cy);
      if (!tile || tile.isBlock) break;
      if (this.simulator.getWall(cx, cy)) break;

      score += this.getFarmCellScore(cx, cy, monsterMap, itemMap);

      // 계획된 반사판 반영
      const plannedType = plannedMap.get(`${cx},${cy}`);
      if (plannedType !== undefined) {
        currentDir = BallSimulator.getReflectedDirection(currentDir, plannedType);
      }
    }

    return score;
  }

  /** 파밍 계획용 설치 가능 여부 (몬스터 점유 무시 — 공이 도착할 때 이미 사라질 수 있음) */
  private canPlaceFarmReflector(x: number, y: number): boolean {
    if (!this.simulator.isZoneAccessible(this.playerId, x, y)) return false;
    if (this.simulator.isEnemySpawnZone(this.playerId, x, y)) return false;
    if (this.simulator.getWall(x, y)) return false;
    const tile = this.simulator.map.getTile(x, y);
    if (!tile || !tile.isReflectorSetable) return false;
    return true;
  }

  /**
   * 파밍 계획을 보드에 실행. 한 틱에 하나씩 행동.
   * Phase 0: 계획에 없는 기존 반사판 제거 (슬롯 확보)
   * Phase 1: 같은 위치 타입 교체 (무료)
   * Phase 2: 새 위치 배치 (스톡 소비)
   * @returns true면 이번 틱에 행동 완료
   */
  private executeFarmPlan(): boolean {
    if (this.farmPlan.length === 0) return false;

    const planSet = new Set(this.farmPlan.map(p => p.x + p.y * 100));

    // Phase 0: 계획에 없는 기존 반사판 제거 (위치 재배치를 위해 슬롯 확보)
    for (const [tileIndex, placement] of this.simulator.map.reflectors) {
      if (placement.playerId !== this.playerId) continue;
      if (planSet.has(tileIndex)) continue;
      // 계획에 없는 반사판 → 제거
      const rx = tileIndex % 100;
      const ry = Math.floor(tileIndex / 100);
      this.simulator.removeReflector(this.playerId, rx, ry);
      return true;
    }

    // Phase 1: 같은 위치 타입 교체 (무료)
    for (const p of this.farmPlan) {
      const tileIndex = p.x + p.y * 100;
      const existing = this.simulator.map.reflectors.get(tileIndex);
      if (existing && existing.playerId === this.playerId && existing.type !== p.type) {
        this.simulator.placeReflector(this.playerId, p.x, p.y, p.type);
        return true;
      }
    }

    // Phase 2: 새 위치 배치 (스톡 소비)
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock <= 0) return false;

    for (const p of this.farmPlan) {
      const tileIndex = p.x + p.y * 100;
      const existing = this.simulator.map.reflectors.get(tileIndex);
      if (existing && existing.playerId === this.playerId) continue; // 이미 정확히 배치됨

      if (!this.simulator.canPlaceReflector(this.playerId, p.x, p.y)) continue;
      this.simulator.placeReflector(this.playerId, p.x, p.y, p.type);
      return true;
    }

    return false; // 모든 계획 실행 완료
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

  // ── 골드 소비 ─────────────────────────────────────────────────────────────

  private trySpendGold(): void {
    const gold = this.simulator.getPlayerGold(this.playerId);

    // 방패 우선: 300g 이상이고 위기 구조물 있을 때
    if (gold >= this.simulator.config.shieldCostGold && this.tryShield()) return;

    // 검: 30g 이상 쌓이면 적 반사판 제거 (저렴하므로 적극 사용)
    if (gold >= this.simulator.config.swordCostGold * 3) this.trySword();
  }

  private trySword(): void {
    const enemyCore = this.getWeakestEnemyCore();
    let bestTarget: { x: number; y: number; priority: number } | null = null;

    for (const [, placement] of this.simulator.map.reflectors) {
      if (placement.playerId === this.playerId) continue;

      let priority = 0;
      // 적 코어 근처 반사판 우선 제거 (방어력 약화)
      if (enemyCore) {
        const distToCore = Math.abs(placement.x - enemyCore.tile.x) + Math.abs(placement.y - enemyCore.tile.y);
        priority += Math.max(0, 20 - distToCore * 2);
      }
      // 내 존과 가까울수록 우선 (내 공이 직접 닿을 수 있는 위치)
      const distToZone = this.distToMyZoneBorder(placement.x, placement.y);
      priority += Math.max(0, 10 - distToZone);

      if (!bestTarget || priority > bestTarget.priority) {
        bestTarget = { x: placement.x, y: placement.y, priority };
      }
    }

    if (bestTarget) {
      this.simulator.useSword(this.playerId, bestTarget.x, bestTarget.y);
    }
  }

  private tryShield(): boolean {
    let bestTarget: { targetType: 'spawn' | 'core'; id: string; urgency: number } | null = null;

    const myCore = this.getMyCore();
    if (myCore && myCore.hp / myCore.maxHp < 0.4) {
      bestTarget = { targetType: 'core', id: myCore.id.toString(), urgency: 1 - myCore.hp / myCore.maxHp };
    }

    for (const sp of this.getMySpawns()) {
      const urgency = 1 - sp.hp / sp.maxHp;
      if (urgency > 0.5 && (!bestTarget || urgency > bestTarget.urgency)) {
        bestTarget = { targetType: 'spawn', id: sp.id.toString(), urgency };
      }
    }

    if (!bestTarget) return false;
    return this.simulator.useShield(this.playerId, bestTarget.targetType, bestTarget.id);
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

  private isInOrNearMyZone(x: number, y: number, margin: number): boolean {
    return x >= this.zone.originX - margin && x < this.zone.originX + this.zone.width + margin &&
           y >= this.zone.originY - margin && y < this.zone.originY + this.zone.height + margin;
  }

  private distToMyZoneBorder(x: number, y: number): number {
    const dx = Math.max(0, this.zone.originX - x, x - (this.zone.originX + this.zone.width - 1));
    const dy = Math.max(0, this.zone.originY - y, y - (this.zone.originY + this.zone.height - 1));
    return dx + dy;
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
