# PuzzlePvP - 아키텍처

## 전체 구조

Monorepo (npm workspaces) 기반 3-패키지 아키텍처.
Classic1의 Core-UnityAdapter 패턴에서 영감을 받아, **shared 패키지가 Core 역할**을 수행.

```
┌─────────────────────────────────────────────┐
│                  client/                     │
│  Phaser.js Scenes + SocketClient            │
│  (렌더링, 입력, 네트워크 통신)                │
└──────────────────┬──────────────────────────┘
                   │ import
┌──────────────────▼──────────────────────────┐
│                  shared/                     │
│  게임 코어 로직 (순수 TypeScript)              │
│  BallSimulator, BattleSimulator, MapModel   │
│  Enums, Types, NetworkMessage               │
└──────────────────▲──────────────────────────┘
                   │ import
┌──────────────────┴──────────────────────────┐
│                  server/                     │
│  Express + Socket.io                        │
│  GameRoom, MatchmakingQueue                 │
│  (서버 권위 시뮬레이션)                       │
└─────────────────────────────────────────────┘
```

---

## Shared 패키지 (게임 코어)

### Enum

| 파일 | 값 | 설명 |
|------|-----|------|
| `Direction.ts` | None, Up, Down, Left, Right | 4방향 + None |
| `TileType.ts` | Empty, Start, Core, Block, Split, FixedReflector, 반사판 2종 | 타일 종류 |
| `ReflectorType.ts` | Slash(1), Backslash(2) | 반사판 종류 (`/`, `\`) |
| `EndReason.ts` | Goal, Blocked, Split, Crash, Loop, PortalUnlinked | 공 종료 사유 |

### 핵심 모델

**TileData** → 타일 불변 속성 (uniqueIndex, tileType, 방향, 이동성)
**TileModel** → 런타임 타일 (x, y 좌표, 고유 인덱스 = `x + y * 100`)
**BallModel** → 공 (id, placementTile, ownerId, power, speedMultiplier)
**SpawnPointModel** → 출발점 HP 시스템 (heal/damage, 활성/비활성, 리스폰 카운트다운)
**CoreModel** → 코어 HP 시스템 (heal/damage)
**MonsterModel** → 몬스터 (id, type, x, y, hp, active)
**DroppedItemModel** → 드랍 아이템 (id, x, y, itemType)
**MapModel** → 맵 데이터 + 반사판 관리 (배치/제거, 소유자 검증)
**TileRegistry** → 타일 데이터 레지스트리 + 기본 배틀 맵 생성 (13x9)

### 시뮬레이션 엔진

```
BallSimulator (공 물리 시뮬레이션)
├── BallSimulationInstance (개별 공 상태 + 독립 페이즈 추적)
└── Phase 기반 이동 루프 (공별 독립 speedMultiplier 적용)

BattleSimulator (대전 시뮬레이터)
├── BallSimulator 확장
├── SpawnPointModel[] (출발점 HP, 리스폰)
├── CoreModel[] (코어 HP)
├── MonsterModel[] (몬스터 AI + 이동)
├── DroppedItemModel (아이템 드랍/픽업)
├── WallState (성벽 HP 관리)
├── 골드 시스템 (Map<playerId, gold>, 킬/구조물 파괴 시 지급)
├── 쉴드 시스템 (Map<targetId, ShieldState>, 타이머 기반 만료)
├── 자동 공 발사 (spawnInterval: 5.0초)
├── 반사판 스톡/쿨다운 시스템 (3초마다 1개 충전)
├── 격벽(TowerBox) 시스템 — 코어 점령 시 인접 구역 잠금 해제
├── 적 스폰존 보호 (설치 금지 영역)
├── 성벽 위 반사판 설치 불가
└── 승리 조건 판정 (모든 코어 파괴)
```

### 몬스터 타입 및 아이템 드랍

| MonsterType | 확률 | DropItemType | 효과 |
|-------------|------|--------------|------|
| Orange | 50% | PowerUp | 공격력 +1 (누적) |
| White | 30% | BallCount | 발사당 공 수 +1 (누적) |
| LightBlue | 19.9% | SpeedUp | 공 속도 배율 +0.25 (누적) |
| Purple | 0.1% | ReflectorExpand | 반사판 보드 한도 +1 (누적) |

### 네트워크 메시지 (`NetworkMessage.ts`)

**클라이언트 → 서버**:
- `join_queue` — 매칭 요청
- `place_reflector` — 반사판 배치 (x, y, type)
- `remove_reflector` — 반사판 제거 (x, y)
- `place_wall` — 성벽 설치 (x, y) — 골드 100g 소모
- `use_sword` — 칼 사용 (x, y) — 골드 10g 소모, 해당 위치 적 반사판 제거
- `use_shield` — 쉴드 사용 (targetType, targetId) — 골드 300g 소모

**서버 → 클라이언트**:
- `match_found` — 매칭 성공 (roomId, playerId, mapData, spawnPoints, cores, monsters)
- `ball_spawned` / `ball_moved` / `ball_ended` — 공 이벤트
- `reflector_placed` / `reflector_removed` — 반사판 이벤트
- `reflector_stock` — 반사판 스톡 변경 (stock, cooldownElapsed)
- `spawn_hp` / `spawn_destroyed` / `spawn_respawned` / `spawn_healed` — 출발점 이벤트
- `core_hp` / `core_healed` / `core_destroyed` — 코어 HP 이벤트
- `monster_spawned` / `monster_moved` / `monster_damaged` / `monster_killed` — 몬스터 이벤트
- `item_dropped` / `item_picked_up` — 아이템 드랍/픽업
- `ball_powered_up` — 공 공격력 증가 (playerId, power)
- `player_ball_count_up` — 발사 공 수 증가 (playerId, ballCountBonus)
- `player_speed_up` — 공 속도 증가 (playerId, speedBonus)
- `player_reflector_expand` — 반사판 한도 증가 (playerId, maxReflectors)
- `wall_placed` / `wall_damaged` / `wall_destroyed` — 성벽 이벤트
- `gold_updated` — 골드 변경 (playerId, gold)
- `sword_used` — 칼 사용 결과 (attackerId, x, y)
- `shield_applied` — 쉴드 적용 (targetType, targetId, duration, ownerId)
- `shield_expired` — 쉴드 만료 (targetType, targetId)
- `tower_box_damaged` / `tower_box_broken` — 격벽 이벤트 (구역 잠금 해제)
- `ownership_transferred` — 코어 점령 후 스폰 소유권 이전
- `lobby_update` — 대기열 상태 갱신
- `player_eliminated` — 플레이어 탈락
- `game_over` — 게임 종료 (winnerId)

---

## Server 패키지

### 서버 권위 모델 (Server-Authoritative)

서버가 유일한 시뮬레이션 권위자. 클라이언트는 입력 전송 + 결과 렌더링만 담당.

```
클라이언트 입력 → 서버 검증 → 시뮬레이션 → 결과 브로드캐스트
```

### 주요 클래스

**index.ts** — Express + Socket.io 앱 (포트 환경변수 `PORT`, 기본 4000)
- 헬스 체크: `GET /health`
- CORS 전체 허용
- 프로덕션: `client/dist` 정적 파일 서빙
- 연결 시 MatchmakingQueue에 등록

**MatchmakingQueue** — FIFO 매칭
- 2명 이상 대기 시 매칭 성사
- 연결 끊김 시 자동 제거

**GameRoom** — 게임 방
- 50ms 틱 타이머 (20 FPS)
- BattleSimulator 구동
- 이벤트 콜백 → Socket.io 브로드캐스트
- AIPlayer 인스턴스 관리 (AI 매칭 시 생성)
- 플레이어 연결 끊김 → 상대 승리 처리
- stop() 시 타이머 정리 + 모든 소켓 리스너 해제

**AIPlayer** (`server/src/ai/AIPlayer.ts`) — AI 봇
- 상태 머신 기반: IDLE / DEFENDING / ATTACKING / FARMING
- 이벤트 기반 반응: `notify(event, data)` — ballMoved, coreHpChanged 등 10개 이벤트
- 위협 추적: `activeThreats` — 코어/스폰 직진 위협 공 실시간 추적
- 스코어링: 방어(scoreDefense) / 공격(scoreAttack) / 성장(scoreGrowth) 점수 기반 반사판 배치
- 파밍 최적화: `planFarmLayout()` — 스폰 기준 전체 반사판 레이아웃 선제 계획 후 단계적 실행

---

## Client 패키지

### Scene 흐름

```
MainMenuScene → MatchmakingScene → GameScene → ResultScene → MainMenuScene
```

### Scene 설명

| Scene | 역할 |
|-------|------|
| `MainMenuScene` | 타이틀, 게임 시작 버튼 |
| `MatchmakingScene` | 서버 연결, 매칭 대기, 취소 |
| `GameScene` | 게임플레이 (그리드, 공, 반사판, HP바, 입력, UI) |
| `ResultScene` | 승리/패배/무승부, 다시 플레이 |

### SocketClient (싱글턴)

서버와의 Socket.io 통신 관리. 콜백 기반 이벤트 처리.
- 개발: `http://localhost:4000`
- 프로덕션: `window.location.origin`

### visual/ 패키지

| 파일 | 역할 |
|------|------|
| `Constants.ts` | 타일 크기, 색상, HP 그라디언트, 몬스터 타입별 색상 |
| `VisualEffects.ts` | HP 그라디언트 계산, 데미지/힐 팝업 애니메이션, 공 종료 파티클 (반칸 전진 후 폭발) |
| `SoundManager.ts` | Web Audio API 기반 효과음 (on/off 상태 localStorage 저장) |

### GameScene UI 요소

| 요소 | 설명 |
|------|------|
| 반사판 스톡 UI | 좌/우상단, 아이콘으로 현재 스톡 수 표시 + 쿨다운 게이지 (아래→위 채움) |
| 출발점 HP 바 | 스폰 포인트 아래, HP 비율에 따라 색상 변경 |
| 코어 HP 바 | 코어 타일 아래, HP 비율에 따라 색상 변경 |
| 스폰존 오버레이 | 플레이어별 색상으로 반사판 설치 금지 영역 표시 |
| 리스폰 카운트다운 | 파괴된 스폰 위에 남은 시간 표시 (20초 시작, +5초씩 증가) |
| 데미지 팝업 | 피격 시 `-N` 텍스트 위로 떠오르며 페이드아웃 |
| 힐 팝업 | HP 회복 시 `+N` 텍스트 |
| 골드 표시 | 좌하단 아이템 슬롯 위, 현재 보유 골드 표시 |
| 아이템 슬롯 | 좌하단 3개: 🧱 성벽(100g) / ⚔️ 칼(10g) / 🛡️ 쉴드(300g) — 골드 부족 시 반투명 |
| 쉴드 시각 효과 | 보호막 적용 타일에 파란 맥동 오라 표시 (30초 후 사라짐) |
| 볼륨 토글 버튼 | 좌상단, 사운드 on/off 전환 |
| 코어 화살표 | 게임 시작 시 내 코어 위치 강조 애니메이션 |
| 격벽(TowerBox) 오버레이 | 잠긴 구역 시각화 (HP 바 + 파괴 시 구역 오픈) |

### 렌더링 상수

| 상수 | 값 | 설명 |
|------|-----|------|
| `TILE_SIZE` | 52px | 타일 크기 |
| `BALL_RADIUS` | 7px | 공 반경 |
| P1 색상 | `0x4488ff` | 파랑 |
| P2 색상 | `0xff4444` | 빨강 |
| `HP_COLOR_HIGH` | `0x44cc44` | HP 만렙 (초록) |
| `HP_COLOR_MID` | `0xcccc44` | HP 50% (노랑) |
| `HP_COLOR_LOW` | `0xff2222` | HP 위험 (빨강) |

---

## 배포 아키텍처

Railway 단일 서비스로 클라이언트 + 서버 통합 배포.

```
빌드: shared → client (Vite) → server (tsc)
실행: NODE_ENV=production node packages/server/dist/index.js

HTTP 요청 흐름:
  GET /health          → Express 헬스 체크
  WS  /socket.io/...   → Socket.io 게임 서버
  GET /*               → Express → client/dist/index.html (SPA)
```

**환경 변수**:
- `PORT`: 서버 포트 (Railway 자동 주입, 로컬 기본값 4000)
- `NODE_ENV`: `production` 시 정적 파일 서빙 활성화

---

## 핵심 알고리즘

### 공 종료 애니메이션 (히트감)

`onBallEnded` 수신 시 즉시 폭발하지 않고, `BallVisual.lastDx/lastDy`에 저장된 마지막 이동 방향으로 반칸(`TILE_SIZE × 0.5`) 전진한 뒤 파티클 폭발.
전진 시간 = `timePerPhase × 250ms`.

### Phase 기반 공 이동 (공별 독립 속도)

```typescript
// BallSimulationInstance 단위로 독립 페이즈 관리
update(deltaTime, speedMultiplier):
  phaseRate += deltaTime / timePerPhase * speedMultiplier
  currentPhase = floor(phaseRate)

  매 phase마다:
    1. updateNextTile()         // 다음 타일로 이동
    2. procCurrentTileEvent()   // 타일 이벤트 (반사, 골인)
    3. checkEndConditions()     // 종료 조건
```

### 반사판 방향 변환

거울은 양방향 반사 — 어느 방향에서든 항상 통과하며 방향을 전환.

| 반사판 | Up → | Down → | Left → | Right → |
|--------|------|--------|--------|---------|
| Slash `/` | Right | Left | Down | Up |
| Backslash `\` | Left | Right | Up | Down |

### 반사판 스톡 시스템

```
초기: initialReflectorStock (3)개 보유
설치 시: stock -= 1
쿨다운: reflectorCooldown (3초)마다 stock += 1
한도: maxReflectorStock (5)개 초과 시 충전 정지
```

### 승리 조건

- 한쪽 Core 모두 파괴 → 다른 쪽 승리
- 동시 파괴 → 무승부 (winnerId = -1)
