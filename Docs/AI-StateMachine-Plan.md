# AI 상태 머신 + 트리거 기반 재설계 계획

## Context

현재 AI(`AIPlayer.ts`)는 0.5초마다 방어/성장/공격 점수를 **전부 새로 계산**하는 플랫 스코어링 시스템이다.
문제점:
- 이벤트 반응 불가 (적 공이 코어 직진해도 최대 0.5초 지연)
- 상태 개념 없음 (위기든 안전이든 같은 로직)
- 벽/시간정지 아이템 미사용
- 스톡 관리 없음 (1개든 5개든 동일 빈도)
- 연쇄 배치 불가 (한 번에 하나만)

→ **상태 머신 + 트리거 구조**로 재설계하여 상황 인식 + 즉시 반응 + 아이템 활용을 구현한다.

---

## 수정 대상 파일

| 파일 | 변경 | 설명 |
|------|------|------|
| `packages/server/src/ai/AIPlayer.ts` | **전면 재작성** | 상태 머신 + 트리거 + 스코어링 통합 |
| `packages/server/src/rooms/GameRoom.ts` | **콜백에 1줄씩 추가** | AI에게 이벤트 전달 (`ai.notify()`) |

- `packages/shared/` — **수정 없음** (BattleSimulator, BallSimulator 등 그대로)

---

## 1단계: GameRoom 콜백 → AI 이벤트 위임

BattleSimulator 콜백은 GameRoom이 이미 사용 중이므로, 각 콜백 내부에서 AI의 `notify()` 호출을 추가한다.

```typescript
// GameRoom.ts — 각 콜백에 1줄 추가 패턴
this.simulator.onBallMoved = (ball, from, to) => {
  /* 기존 브로드캐스트 코드 유지 */
  for (const ai of this.aiPlayers) ai.notify('ballMoved', { ball, from, to });  // 추가
};
```

**전달할 이벤트 목록 (10개, 핵심만):**

| 콜백 | notify 키 | AI 용도 |
|------|----------|---------|
| `onBallMoved` | `ballMoved` | 위협 추적 (핵심) |
| `onBallEnded` | `ballEnded` | 위협 제거 |
| `onCoreHpChanged` | `coreHpChanged` | 긴급 상태 판단 |
| `onSpawnDestroyed` | `spawnDestroyed` | 방어 전략 변경 |
| `onSpawnRespawned` | `spawnRespawned` | 전략 재평가 |
| `onItemDropped` | `itemDropped` | 파밍 타겟 등록 |
| `onReflectorStockChanged` | `stockChanged` | 스톡 관리 |
| `onTimeStopEnded` | `timeStopEnded` | 위협 재스캔 |
| `onOwnershipTransferred` | `ownershipTransferred` | 존 경계 변경 |
| `onBallCreated` | `ballCreated` | 신규 공 추적 |

---

## 2단계: AIPlayer.ts 상태 머신 구조

### 상태 정의

```typescript
enum AIState {
  IDLE,        // 위협 없음, 스톡 축적 대기
  DEFENDING,   // 내 코어/타워 위협 — 방어 우선
  ATTACKING,   // 적 코어 공략 — 공격 우선
  FARMING,     // 몬스터/아이템 수집 — 성장 우선
  EMERGENCY,   // 코어 HP < 20% — 벽/시간정지 사용 + 긴급 방어
}
```

### 전이 조건

```
ANY → EMERGENCY : 코어 HP < 20% 또는 (코어 직사 위협 + 스톡 0)
ANY → DEFENDING : activeThreats에 거리 ≤ 5인 위협 존재
DEFENDING → ATTACKING : 위협 해소 + 스톡 ≥ 3
DEFENDING → FARMING : 위협 해소 + 스톡 ≥ 3 + 존 내 몬스터/아이템 있음
IDLE → ATTACKING : 스톡 ≥ 3
IDLE → FARMING : 스톡 ≥ 3 + 존 내 몬스터/아이템 있음
FARMING ↔ ATTACKING : 파밍 타겟 유무에 따라
EMERGENCY → DEFENDING : 코어 HP ≥ 30% + 위협 해소
```

### 상태별 폴링 간격 & 스코어링 가중치

| 상태 | 폴링 간격 | 방어 | 성장 | 공격 | 특수 행동 |
|------|----------|------|------|------|----------|
| IDLE | 0.8초 | 0.3 | 0.5 | 0.2 | 스톡 축적, 고가치(150+) 방어만 |
| DEFENDING | 0.3초 | 2.0 | 0.2 | 0.3 | 즉시 방어 트리거 |
| ATTACKING | 0.5초 | 0.3 | 0.3 | 2.0 | 예비 1개 유지 |
| FARMING | 0.5초 | 0.3 | 2.0 | 0.3 | 예비 1개 유지 |
| EMERGENCY | 0.2초 | 3.0 | 0 | 0 | 시간정지/벽 사용 |

### 스톡 수준별 배율 보정

| 스톡 | 성장/공격 배율 보정 |
|------|-------------------|
| 0 | 행동 불가 |
| 1 | ×0.1 (방어 고가치만) |
| 2 | ×0.5 (소극적) |
| 3 | ×1.0 (기본) |
| 4-5 | ×1.5 (적극적) |

---

## 3단계: 위협 추적 시스템

`activeThreats: Map<ballId, ThreatInfo>` — 존 내 적 공 중 코어/타워 직진 중인 공을 추적.

```typescript
interface ThreatInfo {
  ballId: number;
  targetType: 'core' | 'spawn';
  targetId: number;
  estimatedDistance: number;  // 타겟까지 남은 칸 수
  direction: Direction;
  x: number; y: number;
}
```

- **갱신 시점**: `ballMoved` 트리거 + 폴링마다 `rescanThreats()`
- **삭제 시점**: `ballEnded` 트리거 / 존 이탈 / 방향 변경

---

## 4단계: 즉시 반응 메커니즘

`ballMoved` 트리거에서 코어 직사 위협 거리 ≤ 3 감지 시:
1. `immediateActionPending = true` 설정
2. 다음 `update()` 호출에서 즉시 `tryImmediateDefense()` 실행
3. 위협 경로 위 가장 가까운 배치 가능 지점에 반사판 배치

→ 폴링 주기(최대 0.8초)를 기다리지 않고 **다음 틱(50ms)에** 반응 가능.

**tryImmediateDefense 로직:**
- 위협 공의 경로를 따라가며 배치 가능 지점 탐색
- 코어에서 멀어지는 방향으로 반사하는 Slash/Backslash 선택
- 가장 가까운(코어에 가까운) 유효 배치에 즉시 배치

---

## 5단계: EMERGENCY — 벽/시간정지 사용

```
EMERGENCY 진입 시:
  1. 코어 직사 위협 있고 시간정지 미사용 → useTimeStop()
  2. 스톡 0이고 벽 미사용 → 코어 인접 위협 방향에 placeWall()
  3. 스톡 있으면 → 방어 전용 스코어링 (배율 3.0)
```

**findBestWallPosition()**: 코어 인접 4방향 중 위협이 오는 방향에 성벽 배치.
- 코어 인접 4칸 순회
- 각 칸에 대해 현재 위협의 방향과 일치하는지 점수화
- 가장 높은 점수의 위치 선택

---

## 6단계: 기존 스코어링 함수 재활용

현재 AIPlayer.ts의 핵심 스코어링 함수들은 **그대로 유지**:

| 함수 | 재활용 | 변경점 |
|------|--------|--------|
| `scoreDefenseCandidates()` | ✅ 그대로 | 없음 |
| `scoreGrowthCandidates()` | ✅ 그대로 | 없음 |
| `scoreAttackCandidates()` | ✅ 그대로 | 없음 |
| `addScore()` | ✅ 그대로 | 없음 |
| `findReflectorForTarget()` | ✅ 그대로 | 없음 |
| `placeStrategicFallback()` | ✅ 그대로 | 없음 |
| `isInMyZone()` | ✅ 그대로 | 없음 |
| `dirDelta()` | ✅ 그대로 | 없음 |
| `stepInDir()` | ✅ 그대로 | 없음 |
| `isDirectThreat()` | ✅ 이름 변경 | → `isDirectlyHeading()`, 코어뿐 아니라 타워에도 적용 |
| `getMultipliers()` | ❌ 대체 | → `getStateMultipliers()` (상태+스톡 반영) |
| `makeDecision()` | ❌ 대체 | → 상태별 `updateXxx()` 메서드로 분할 |

---

## 클래스 구조 요약

```typescript
class AIPlayer {
  // 상태 머신
  private state: AIState
  private stateTimer: number
  private stateMinDuration = 0.5  // 채터링 방지

  // 위협 추적
  private activeThreats: Map<number, ThreatInfo>
  private immediateActionPending: boolean

  // 아이템 사용 추적
  private wallUsed: boolean
  private timeStopUsed: boolean

  // 스톡 추적
  private lastStockLevel: number

  // 캐시 (폴링마다 갱신)
  private cachedMyCore: CoreModel | null
  private cachedEnemyCores: CoreModel[]
  private cachedMySpawns: SpawnPointModel[]

  // ── 퍼블릭 ──
  notify(event: string, data: any): void     // GameRoom에서 호출
  update(delta: number): void                // 메인 루프 (GameRoom 틱)

  // ── 상태 전이 엔진 ──
  private evaluateStateTransition(): void
  private determineOptimalState(): AIState
  private transitionTo(newState: AIState): void

  // ── 상태별 로직 ──
  private updateIdle(): void           // 스톡 축적 + 고가치 방어만
  private updateDefending(): void      // 방어 중심 스코어링
  private updateAttacking(): void      // 공격 중심 스코어링 (예비 1개 유지)
  private updateFarming(): void        // 성장 중심 스코어링 (예비 1개 유지)
  private updateEmergency(): void      // 시간정지/벽 + 긴급 방어

  // ── 상태 진입 액션 ──
  private onEnterEmergency(): void     // 즉시 시간정지 고려
  private onEnterDefending(): void     // 즉각 가까운 위협 대응

  // ── 트리거 핸들러 (10개) ──
  private onBallMovedHandler(data): void        // 위협 추적 + 즉시 반응
  private onCoreHpChangedHandler(data): void    // EMERGENCY 전이
  private onBallEndedHandler(data): void        // 위협 제거
  private onSpawnDestroyedHandler(data): void   // 방어 재평가
  private onSpawnRespawnedHandler(data): void   // 전략 재평가
  private onItemDroppedHandler(data): void      // FARMING 전이
  private onStockChangedHandler(data): void     // 스톡 관리
  private onTimeStopEndedHandler(): void        // 위협 재스캔
  private onOwnershipChangedHandler(data): void // 캐시 갱신
  private onBallCreatedHandler(data): void      // 신규 공 추적

  // ── 즉시 반응 ──
  private tryImmediateDefense(threat: ThreatInfo): void
  private executeImmediateAction(): void

  // ── 아이템 사용 ──
  private findBestWallPosition(): { x: number; y: number } | null

  // ── 유틸 (새로 추가) ──
  private getStateMultipliers(): { defense, growth, attack }  // 상태+스톡 반영
  private rescanThreats(): void         // 위협 목록 전체 재스캔
  private refreshCaches(): void         // 코어/스폰 캐시 갱신
  private getMyCore(): CoreModel | null
  private getMySpawns(): SpawnPointModel[]
  private getWeakestEnemyCore(): CoreModel | null
  private getClosestThreat(): ThreatInfo | null
  private hasFarmTargets(): boolean
  private getDecisionInterval(): number  // 상태별 폴링 간격
  private static isDirectlyHeading(bx, by, dir, tx, ty): boolean  // isDirectThreat 확장

  // ── 기존 재활용 (변경 없음) ──
  private scoreDefenseCandidates(map, multiplier): void
  private scoreGrowthCandidates(map, multiplier): void
  private scoreAttackCandidates(map, multiplier): void
  private addScore(map, x, y, type, score): void
  private findReflectorForTarget(bx, by, dir, tx, ty): { x, y, type } | null
  private placeStrategicFallback(): void
  private isInMyZone(x, y): boolean
  private static dirDelta(dir): { dx, dy } | null
  private static stepInDir(x, y, dir, dist): { x, y }
}
```

---

## update() 메인 루프 상세

```typescript
update(delta: number): void {
  if (this.zone.eliminated) return;
  this.gameTime += delta;
  this.stateTimer += delta;

  // 1. 즉시 액션 처리 (트리거에 의해 설정됨)
  if (this.immediateActionPending) {
    this.immediateActionPending = false;
    this.executeImmediateAction();
  }

  // 2. 정기 폴링 (상태별 간격)
  this.decisionTimer += delta;
  const interval = this.getDecisionInterval();
  if (this.decisionTimer < interval) return;
  this.decisionTimer = 0;

  // 3. 캐시 + 위협 갱신
  this.refreshCaches();
  this.rescanThreats();

  // 4. 상태별 의사결정
  switch (this.state) {
    case AIState.IDLE:       this.updateIdle(); break;
    case AIState.DEFENDING:  this.updateDefending(); break;
    case AIState.ATTACKING:  this.updateAttacking(); break;
    case AIState.FARMING:    this.updateFarming(); break;
    case AIState.EMERGENCY:  this.updateEmergency(); break;
  }

  // 5. 상태 전이 재평가
  this.evaluateStateTransition();
}
```

---

## 구현 순서

1. **GameRoom.ts** — 콜백에 `ai.notify()` 추가 (10개 콜백, 각 1줄)
2. **AIPlayer.ts** — 상태 머신 프레임워크 (enum, 전이 엔진, update 분기)
3. **AIPlayer.ts** — 위협 추적 (activeThreats, 트리거 핸들러)
4. **AIPlayer.ts** — 즉시 반응 (tryImmediateDefense)
5. **AIPlayer.ts** — 상태별 updateXxx() + getStateMultipliers()
6. **AIPlayer.ts** — EMERGENCY + 벽/시간정지 사용
7. `npm run build:shared` (shared 변경 없지만 확인) → 서버 테스트

---

## 검증 방법

1. `npm run build:shared && npm run dev:server` — 빌드/실행 확인
2. `npm run dev:client` — 브라우저에서 AI 매칭 테스트
3. 확인 포인트:
   - AI가 적 공 코어 직진 시 즉시 방어 반사판 배치하는지
   - AI가 위협 없을 때 공격/파밍 모드로 전환하는지
   - AI가 코어 HP 낮을 때 시간정지/벽을 사용하는지
   - AI가 스톡 부족 시 보수적으로 행동하는지

---

## 현재 코드 참조

| 파일 | 용도 |
|------|------|
| `packages/server/src/ai/AIPlayer.ts` | 현재 AI 전체 로직 (429줄) — 재작성 대상 |
| `packages/server/src/rooms/GameRoom.ts` | AI 생성(361-368), 틱 루프(411-417), 콜백들 — 콜백에 notify 추가 |
| `packages/shared/src/core/BattleSimulator.ts` | AI가 읽는 게임 API — 수정 없음, 참조만 |
| `packages/shared/src/core/BallSimulator.ts` | `getReflectedDirection()` 등 기하 유틸 — 수정 없음 |
| `packages/shared/src/core/MapLayout.ts` | `PlayerZone` 인터페이스 — 수정 없음 |
