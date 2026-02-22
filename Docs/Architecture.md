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
| `TileType.ts` | Empty, Start, Goal, Gold, Split, Portal, Block, 반사판 4종 | 타일 종류 |
| `ReflectorType.ts` | TopLeft, TopRight, BottomLeft, BottomRight | 반사판 방향 |
| `EndReason.ts` | Goal, Blocked, Split, Crash, Loop, PortalUnlinked | 공 종료 사유 |

### 핵심 모델

**TileData** → 타일 불변 속성 (uniqueIndex, tileType, 방향, 이동성)
**TileModel** → 런타임 타일 (x, y 좌표, 고유 인덱스 = `x + y * 100`)
**BallModel** → 공 (id, placementTile, ownerId)
**SpawnPointModel** → 출발점 HP 시스템 (heal/damage, 활성/비활성)
**MapModel** → 맵 데이터 + 반사판 관리 (배치/제거, 소유자 검증)
**TileRegistry** → 타일 데이터 레지스트리 + 기본 배틀 맵 생성

### 시뮬레이션 엔진

```
BallSimulator (공 물리 시뮬레이션)
├── BallSimulationInstance (개별 공 상태)
├── BallSimulatorHistory (루프 감지)
└── Phase 기반 이동 루프

BattleSimulator (대전 시뮬레이터)
├── BallSimulator 확장
├── SpawnPointModel[] (출발점 HP)
├── 자동 공 발사 (spawnInterval)
├── 반사판 한도 관리 (초과 시 거부, 기존 위치 타입 변경 허용)
├── 적 스폰존 보호 (설치 금지 영역)
└── 승리 조건 판정
```

### 네트워크 메시지

**클라이언트 → 서버**:
- `join_queue` — 매칭 요청
- `place_reflector` — 반사판 배치 (x, y, type)
- `remove_reflector` — 반사판 제거 (x, y)

**서버 → 클라이언트**:
- `match_found` — 매칭 성공 (roomId, playerId, mapData, spawnPoints)
- `ball_spawned` / `ball_moved` / `ball_ended` — 공 이벤트
- `reflector_placed` / `reflector_removed` — 반사판 이벤트
- `spawn_hp` / `spawn_destroyed` — 출발점 HP 이벤트
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
- 프로덕션: `client/dist` 정적 파일 서빙 (Express → Vite 빌드 결과물)
- 연결 시 MatchmakingQueue에 등록

**MatchmakingQueue** — FIFO 매칭
- 2명 이상 대기 시 매칭 성사
- 연결 끊김 시 자동 제거

**GameRoom** — 게임 방
- 50ms 틱 타이머 (20 FPS)
- BattleSimulator 구동
- 이벤트 콜백 → Socket.io 브로드캐스트
- 플레이어 연결 끊김 → 상대 승리 처리
- stop() 시 타이머 정리 + onDestroy 콜백

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
| `GameScene` | 게임플레이 (그리드, 공, 반사판, HP바, 입력) |
| `ResultScene` | 승리/패배/무승부, 다시 플레이 |

### SocketClient (싱글턴)

서버와의 Socket.io 통신 관리. 콜백 기반 이벤트 처리.
- 개발: `http://localhost:4000`
- 프로덕션: `window.location.origin` (서버가 클라이언트도 서빙)

### visual/ 패키지

| 파일 | 역할 |
|------|------|
| `Constants.ts` | 타일 크기, 색상, HP 그라디언트 색상, 팝업 버튼 크기/간격, 애니메이션 타이밍 |
| `GridRenderer.ts` | 그리드 타일 렌더링 (배경, 타일 색상, 스폰존 오버레이) |
| `VisualEffects.ts` | HP 그라디언트 색상 계산, 대미지 팝업 애니메이션 |

**HP 그라디언트**: HP 비율에 따라 초록(1.0) → 노랑(0.5) → 빨강(0.0)으로 선형 보간

**대미지 팝업**: 스폰 포인트 타격 시 `-1` 텍스트가 위로 떠오르며 페이드 아웃

### GameScene UI

| 요소 | 설명 |
|------|------|
| 반사판 카운트 | `◆ N/5` 형식, 우상단 표시 |
| 설치 팝업 | 타일 클릭 → 해당 타일 위치에 2×2 버튼 팝업 (X 버튼 중앙) |
| 팝업 버튼 | TopLeft / TopRight / BottomLeft / BottomRight 반투명, 클릭으로 반사판 타입 선택 |
| 스폰존 오버레이 | 플레이어별 색상으로 설치 금지 영역 표시 (내 구역 + 상대 구역 모두) |
| HP 바 | 스폰 포인트 아래, HP 비율에 따라 색상 변경 |
| 토스트 알림 | 반사판 한도 초과 시 하단 메시지 표시 |

### GameScene 렌더링 상수

| 상수 | 값 | 설명 |
|------|-----|------|
| `TILE_SIZE` | 52px | 타일 크기 |
| `BALL_RADIUS` | 10px | 공 반경 |
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

### Phase 기반 공 이동

```typescript
update(deltaTime):
  phaseRate += deltaTime / timePerPhase  // 기본 0.6초
  currentPhase = floor(phaseRate)

  매 phase마다:
    1. updateNextTile()         // 다음 타일로 이동
    2. procCurrentTileEvent()   // 타일 이벤트 (반사, 분기, 골인)
    3. checkBallCollisions()    // 충돌 감지
    4. checkEndConditions()     // 종료 조건
```

### 반사판 방향 변환

| 반사판 | Up → | Down → | Left → | Right → |
|--------|------|--------|--------|---------|
| TopLeft | Right | 막힘 | Down | 막힘 |
| TopRight | Left | 막힘 | 막힘 | Down |
| BottomLeft | 막힘 | Right | Up | 막힘 |
| BottomRight | 막힘 | Left | 막힘 | Up |

### 충돌 감지

1. **교차 충돌**: A가 tile1→tile2, B가 tile2→tile1 동시 이동 → Crash
2. **집합 충돌**: 여러 공이 같은 비-목표 타일로 향함 → Crash

### 루프 감지

상태 키: `(tileIndex, direction, reflectorStateHash)`
같은 상태 3회 이상 방문 시 Loop 판정

### 승리 조건

- 한쪽 SpawnPoint 모두 파괴 → 다른 쪽 승리
- 동시 파괴 → 무승부 (winnerId = -1)
