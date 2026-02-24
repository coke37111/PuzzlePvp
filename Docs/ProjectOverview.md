# PuzzlePvP - 프로젝트 개요

## 게임 소개

Classic1의 공+반사판 퍼즐 메카닉을 기반으로 한 **HTML5 1v1 실시간 대전 게임**.
유료화, UGC, Firebase 등 부가 기능 없이 게임 핵심 요소만 포함.

**원본 저장소**: `C:\Projects\Classic1` (Unity 2D Puzzle Game)
**설계 문서**: [Notion - Classic1 Battle 설계](https://www.notion.so/30ed7aa750848105a070f79e8a685fa7)

---

## 핵심 메카닉

| 요소 | 설명 |
|------|------|
| 공 발사 | 활성 출발점에서 자동 연속 발사 (5초 간격) |
| 반사판 | 스톡 기반 설치 (최대 5개 보유, 3초마다 1개 충전, 시작 3개) |
| 터치 사이클 | 빈 타일 → `/` 설치 → `\` 교체 → 제거 |
| 공유 보드 | 공끼리 충돌 없음, 반사판은 모든 방향에서 통과·반사 |
| 출발점 HP | 적 공 도착 → HP 감소, HP=0 → 비활성화 후 카운트다운 리스폰 |
| 코어 | 플레이어당 1개, 모든 코어 파괴 시 패배 |
| 몬스터 | 보드 위를 돌아다니며 공에 맞으면 아이템 드랍 |
| 아이템 | 4종: PowerUp(공격력↑) / BallCount(발사 수↑) / SpeedUp(속도↑) / ReflectorExpand(반사판 한도↑) |
| 성벽 | 아이템으로 설치, HP 소진 시 파괴. 성벽 위에 반사판 설치 불가 |
| 승리 조건 | 상대의 모든 코어 HP=0 |

---

## 기술 스택

| 계층 | 기술 | 버전 |
|------|------|------|
| 공유 코어 | TypeScript | 5.3.0 |
| 서버 | Node.js + Express | 4.18.2 |
| 네트워크 | Socket.io | 4.6.1 |
| 클라이언트 | Phaser.js | 3.70.0 |
| 빌드 | Vite | 5.0.0 |

---

## 프로젝트 구조

```
PuzzlePvp/
├── packages/
│   ├── shared/          # 클라이언트/서버 공유 코어 로직
│   │   └── src/
│   │       ├── core/    # BallSimulator, MapModel, BattleSimulator 등
│   │       ├── enums/   # Direction, TileType, ReflectorType, EndReason
│   │       └── types/   # NetworkMessage, GameState
│   ├── server/          # Node.js + Socket.io 게임 서버
│   │   └── src/
│   │       ├── rooms/        # GameRoom (게임 방 관리)
│   │       └── matchmaking/  # MatchmakingQueue
│   └── client/          # Phaser.js 프론트엔드
│       └── src/
│           ├── scenes/  # MainMenu, Matchmaking, Game, Result
│           ├── network/ # SocketClient (싱글턴)
│           └── visual/  # Constants, SoundManager, VisualEffects
├── Docs/                # 프로젝트 문서
├── railway.json         # Railway 배포 설정
├── package.json         # npm workspaces monorepo
├── tsconfig.base.json   # 기본 TypeScript 설정
└── CLAUDE.md            # AI 개발 가이드라인
```

### 의존성 관계

```
shared/ (의존성 없음 - 순수 TypeScript)
  ↑
server/ (shared 의존)
  └── Express, Socket.io

client/ (shared 의존)
  └── Phaser 3, Socket.io-client
```

---

## 게임 밸런스 수치

| 파라미터 | 값 | 설명 |
|----------|-----|------|
| `timePerPhase` | 0.2초 | 공 한 칸 이동 시간 (작을수록 빠름) |
| `spawnInterval` | 5.0초 | 출발점당 공 자동 발사 주기 |
| `spawnHp` | 7 | 출발점 최대 HP |
| `coreHp` | 15 | 코어 최대 HP |
| `maxReflectorsPerPlayer` | 5 | 플레이어당 반사판 보드 한도 |
| `reflectorCooldown` | 3.0초 | 반사판 스톡 1개 충전 시간 |
| `maxReflectorStock` | 5 | 반사판 최대 보유 수 |
| `initialReflectorStock` | 3 | 게임 시작 초기 보유 수 |
| `maxWallsPerPlayer` | 3 | 플레이어당 성벽 아이템 사용 횟수 |
| `wallHp` | 10 | 성벽 HP |
| `timeStopUsesPerPlayer` | 1 | 시간 정지 아이템 사용 횟수 |
| `timeStopDuration` | 5초 | 시간 정지 지속 시간 |
| 서버 틱 | 50ms (20 FPS) | 서버 시뮬레이션 주기 |

---

## 기본 맵 구조

```
13 x 9 그리드

P1 스폰: (0,6) 위쪽 발사, (2,8) 오른쪽 발사  — 좌하단
P2 스폰: (10,0) 왼쪽 발사, (12,2) 아래쪽 발사 — 우상단

P1 코어: (0,8)   — 좌하단 모서리
P2 코어: (12,0)  — 우상단 모서리

장애물 없음 (기본 맵은 모두 빈 타일)
```

---

## 몬스터 시스템

| 타입 | 색상 | 스폰 확률 | 드랍 아이템 |
|------|------|-----------|------------|
| Orange | 주황 | 50% | PowerUp (공격력 +1) |
| White | 흰색 | 30% | BallCount (발사 공 수 +1) |
| LightBlue | 하늘 | 19.9% | SpeedUp (공 속도 +0.25배) |
| Purple | 보라 | 0.1% | ReflectorExpand (반사판 한도 +1) |

---

## 실행 방법

```bash
# 1. 의존성 설치
npm install

# 2. shared 패키지 빌드 (최초 1회 또는 shared 변경 시)
npm run build:shared

# 3. 서버 실행 (터미널 1)
npm run dev:server    # http://localhost:4000

# 4. 클라이언트 실행 (터미널 2)
npm run dev:client    # http://localhost:5173

# 5. 브라우저 탭 2개로 1v1 테스트
```

---

## 배포

Railway 단일 서비스로 클라이언트 + 서버 통합 배포.
프로덕션 빌드 시 Express 서버가 Vite 빌드 결과물(정적 파일)도 서빙.

```
빌드 순서: shared → client (Vite) → server (tsc)
시작:      NODE_ENV=production node packages/server/dist/index.js
```

---

## Classic1에서 포팅된 파일

| C# 원본 (Classic1) | TypeScript 포트 |
|---------------------|-----------------|
| `Core/Enums/Direction.cs` | `shared/enums/Direction.ts` |
| `Core/Enums/TileType.cs` | `shared/enums/TileType.ts` |
| `Core/Enums/ReflectorType.cs` | `shared/enums/ReflectorType.ts` |
| `Core/Model/BallModel.cs` | `shared/core/BallModel.ts` |
| `Core/Model/TileModel.cs` | `shared/core/TileModel.ts` |
| `Core/Model/MapModel.cs` | `shared/core/MapModel.ts` |
| `Core/Model/BallSimulator.cs` | `shared/core/BallSimulator.ts` |
| `Core/Model/BallSimulationInstance.cs` | `shared/core/BallSimulationInstance.ts` |
| `UI/InGameReflectorDisplay.cs` | `client/scenes/GameScene.ts` (반사판 카운트) |
| `UI/MobDisplayUI.cs` | `client/visual/VisualEffects.ts` (HP 그라디언트, 데미지 팝업) |
| (신규) | `shared/core/SpawnPointModel.ts` |
| (신규) | `shared/core/CoreModel.ts` |
| (신규) | `shared/core/MonsterModel.ts` |
| (신규) | `shared/core/ItemModel.ts` |
| (신규) | `shared/core/BattleSimulator.ts` |
| (신규) | `shared/core/TileRegistry.ts` |
| (신규) | `client/visual/SoundManager.ts` |
