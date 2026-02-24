# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참조하는 가이드라인입니다.

## 📋 목차

1. [커뮤니케이션 규칙](#커뮤니케이션-규칙)
2. [프로젝트 개요](#프로젝트-개요)
3. [아키텍처](#아키텍처)
4. [개발 원칙](#개발-원칙)
5. [개발 워크플로우](#개발-워크플로우)
6. [문서 구조](#문서-구조)

---

## 커뮤니케이션 규칙

### 언어 및 소통
- **언어**: 모든 커뮤니케이션 한국어 (한국어)
- **파일 인코딩**: UTF-8 BOM
- **권한 요청**: 최소화 — Git이 롤백/백업 처리

---

## 프로젝트 개요

**HTML5 1v1 실시간 대전 게임** (PuzzlePvP)

Classic1(Unity 2D 퍼즐 게임)의 공+반사판 메카닉을 TypeScript로 포팅한 웹 기반 대전 게임.
유료화, UGC, Firebase 등 부가 기능 없이 게임 핵심 요소만 포함.

- **원본 저장소**: `C:\Projects\Classic1`
- **기술 스택**: TypeScript, Phaser.js, Socket.io, Express, Vite
- **구조**: npm workspaces monorepo (shared, server, client)

### 핵심 게임 메카닉
- 두 플레이어가 같은 보드 위에서 반사판을 설치해 공의 경로를 조종
- 상대의 출발점 HP를 모두 0으로 만들면 승리
- 반사판 FIFO 큐 (플레이어당 5개 한도)
- 서버 권위 모델 (Server-Authoritative)

### 실행 방법

```bash
npm run build:shared     # shared 빌드 (최초/변경 시)
npm run dev:server       # 서버 (포트 4000)
npm run dev:client       # 클라이언트 (포트 5173)
```

---

## 아키텍처

### Monorepo 3-패키지 구조

```
packages/
├── shared/    # 게임 코어 로직 (순수 TypeScript, 의존성 없음)
├── server/    # Express + Socket.io 게임 서버 (shared 의존)
└── client/    # Phaser.js 프론트엔드 (shared 의존)
```

### Shared — 게임 코어

Classic1의 `Core/` 폴더에 해당. Unity 독립적인 순수 게임 로직.

**Enum**: Direction, TileType, ReflectorType, EndReason
**모델**: TileData, TileModel, BallModel, SpawnPointModel, MapModel
**시뮬레이션**: BallSimulator, BallSimulationInstance, BallSimulatorHistory, BattleSimulator
**유틸**: TileRegistry (타일 데이터 + 기본 맵 생성)
**타입**: NetworkMessage (Socket.io 이벤트 정의), GameState

### Server — 멀티플레이어 서버

- `index.ts`: Express + Socket.io 앱 (포트 4000, CORS 전체 허용)
- `MatchmakingQueue.ts`: FIFO 매칭 (2명 모이면 방 생성)
- `GameRoom.ts`: BattleSimulator 구동, 50ms 틱 (20 FPS), 이벤트 브로드캐스트

### Client — Phaser.js 프론트엔드

- `SocketClient.ts`: Socket.io 싱글턴 (서버 통신)
- Scene 흐름: `MainMenu → Matchmaking → Game → Result → MainMenu`
- `GameScene.ts`: 그리드 렌더링, 공 애니메이션, 반사판 입출력, HP바

### 게임 밸런스 수치

| 파라미터 | 값 |
|----------|-----|
| timePerPhase | 0.2초 (공 한 칸 이동) |
| spawnInterval | 5.0초 (자동 발사 주기) |
| spawnHp | 7 |
| coreHp | 15 |
| maxReflectorsPerPlayer | 5 |
| reflectorCooldown | 3.0초 |
| 서버 틱 | 50ms (20 FPS) |
| 맵 크기 | 13 x 9 |

---

## 개발 원칙

### 절대 금지
- ❌ **임시 코드**: "일단 이렇게...", TODO 주석으로 미루기
- ❌ **Mock/Placeholder**: 나중에 교체할 가짜 구현
- ❌ **불완전한 구현**: 동작하지 않는 코드 제출

### 필수 준수
- ✅ **실제 구현만**: 처음부터 완전히 동작하는 코드
- ✅ **단계적 구현**: 복잡한 기능은 여러 완전한 단계로 분할
- ✅ **즉시 구현**: 나중으로 미루지 않음
- ✅ **서버 권위**: 게임 로직은 서버에서만 실행, 클라이언트는 렌더링만

### 코드 스타일
- **UTF-8 BOM**: 모든 텍스트 파일
- **TypeScript strict**: 타입 안전성 유지
- **shared 변경 시**: `npm run build:shared` 재빌드 필요
- **네이밍**: camelCase (변수/함수), PascalCase (클래스/타입/인터페이스)

### 패키지 간 규칙
- **shared**: 순수 TypeScript만. Node.js/브라우저 API 금지
- **server**: shared import 가능. 클라이언트 코드 참조 금지
- **client**: shared import 가능 (Vite alias 경유). 서버 코드 참조 금지
- **네트워크 메시지**: 반드시 `shared/types/NetworkMessage.ts`에 정의

---

## 개발 워크플로우

### 새 기능 추가 시

1. **네트워크 메시지 정의** — `shared/types/NetworkMessage.ts`에 타입 추가
2. **이벤트 상수 추가** — `SocketEvent` enum에 이벤트명 추가
3. **서버 로직 구현** — GameRoom 또는 BattleSimulator에서 처리
4. **클라이언트 연동** — SocketClient에 콜백 추가, Scene에서 처리

### shared 패키지 수정 시

```bash
# 1. shared 코드 수정
# 2. 서버가 dist/ 참조하므로 재빌드 필요
npm run build:shared

# 3. 서버 재시작
npm run dev:server
```

> 클라이언트는 Vite alias로 shared/src를 직접 참조하므로 빌드 불필요

### 게임 밸런스 조정

`shared/core/BattleSimulator.ts`의 `DEFAULT_BATTLE_CONFIG` 수정:

```typescript
export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  spawnInterval: 1.0,           // 자동 발사 주기 (초)
  timePerPhase: 0.3,            // 공 이동 속도 (초/칸)
  maxReflectorsPerPlayer: 5,    // 반사판 한도
  spawnHp: 5,                   // 출발점 HP
};
```

### 맵 수정

`shared/core/TileRegistry.ts`의 `createDefaultBattleMapData()` 수정.
맵 크기, 출발점 위치, 장애물 배치 등.

---

## 문서 구조

```
PuzzlePvP/
├── CLAUDE.md                         ← AI 개발 가이드라인 (이 파일)
└── Docs/
    ├── ProjectOverview.md            ← 프로젝트 전체 개요, 실행 방법
    └── Architecture.md               ← 아키텍처 상세, 알고리즘
```

| 문서 | 내용 |
|------|------|
| [ProjectOverview.md](Docs/ProjectOverview.md) | 게임 소개, 기술 스택, 프로젝트 구조, 실행 방법, 포팅 파일 목록 |
| [Architecture.md](Docs/Architecture.md) | 패키지별 아키텍처 상세, 네트워크 프로토콜, 핵심 알고리즘 |

**외부 참조**:
- [Notion 설계 문서](https://www.notion.so/30ed7aa750848105a070f79e8a685fa7): 원본 기획서 (게임 콘셉트, 구현 순서, 검증 체크리스트)
- Classic1 원본: `C:\Projects\Classic1` (Unity C# 소스)
