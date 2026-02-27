# Fly.io 배포 구성 플랜

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** PuzzlePvP를 fly.io에 배포 — Express 서버가 Socket.io + 클라이언트 정적 파일을 단일 컨테이너로 서빙

**Architecture:** 단일 fly.io 머신에서 Node.js 컨테이너 실행. 서버가 프로덕션 빌드 클라이언트 파일을 static serving. 클라이언트는 `window.location.origin`으로 WebSocket 연결.

**Tech Stack:** fly.io (flyctl), Docker, Node.js 20-alpine, Socket.io WebSocket

---

## 현재 상태 (Already Done)

- ✅ `fly.toml` 존재 (app: `puzzlepvp`, region: `nrt`)
- ✅ `Dockerfile` 존재 (빌드 + 서빙 통합)
- ✅ `.dockerignore` 존재
- ✅ 서버 프로덕션 모드에서 `packages/client/dist` 정적 서빙
- ✅ 클라이언트 `SocketClient.ts`: 프로덕션에서 `window.location.origin` 사용

---

## Task 1: fly.toml 수정 — 실시간 게임 서버 설정

**Files:**
- Modify: `fly.toml`

**문제:** 현재 설정은 `auto_stop_machines = 'stop'`, `min_machines_running = 0`.
실시간 WebSocket 게임 서버에서는 머신이 sleep되면:
- 기존 WebSocket 연결이 끊김
- Cold start 지연으로 새 접속자가 연결 불가

**Step 1: fly.toml 수정**

```toml
app = 'puzzlepvp'
primary_region = 'nrt'

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 1
  processes = ['app']

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
```

**Step 2: 변경사항 확인**

`fly.toml`에서 다음 확인:
- `dockerfile = "Dockerfile"` — Dockerfile 명시적 지정
- `auto_stop_machines = 'off'` — 게임 세션 중 머신 멈춤 방지
- `min_machines_running = 1` — 항상 1개 머신 실행

**Step 3: Commit**

```bash
git add fly.toml
git commit -m "fix: fly.toml 실시간 게임 서버용 설정 (auto_stop off, min 1 machine)"
```

---

## Task 2: 로컬 Docker 빌드 검증

**목적:** fly.io에 배포하기 전에 Dockerfile이 정상 동작하는지 로컬에서 확인

**Step 1: Docker 빌드 테스트**

```bash
docker build -t puzzlepvp-test .
```

Expected: 빌드 성공, 마지막 줄 `Successfully built ...`

> 실패 시 에러 메시지 확인. 가장 흔한 문제:
> - `npm install` 실패 → network 문제 또는 lock file 충돌
> - TypeScript 컴파일 에러 → 로컬에서 `npm run build` 먼저 실행

**Step 2: 로컬 실행 테스트**

```bash
docker run -p 8080:8080 puzzlepvp-test
```

Expected 출력:
```
[Server] 실행 중: http://localhost:8080
```

**Step 3: 브라우저에서 확인**

`http://localhost:8080` 접속. 게임 메인 화면이 나오면 OK.

**Step 4: 컨테이너 정리**

```bash
docker ps  # 컨테이너 ID 확인
docker stop <container-id>
docker rmi puzzlepvp-test
```

---

## Task 3: Fly.io 배포

**Prerequisites:**
- flyctl 설치됨 (`fly version` 으로 확인)
- fly.io 로그인됨 (`fly auth whoami` 로 확인)
- `puzzlepvp` 앱이 fly.io 계정에 존재

**Step 1: fly.io 로그인 확인**

```bash
fly auth whoami
```

Expected: 이메일 주소 출력. 실패 시: `fly auth login`

**Step 2: 앱 존재 확인**

```bash
fly apps list
```

Expected: `puzzlepvp` 앱이 목록에 있어야 함.

없는 경우:
```bash
# fly.toml이 있는 상태에서 앱 새로 생성 (launch 대신)
fly apps create puzzlepvp
```

**Step 3: 배포 실행**

```bash
fly deploy
```

Expected 출력 (순서대로):
```
==> Building image
...
--> Building image done
==> Pushing image to fly.io registry
...
==> Creating release
...
==> Monitoring deployment
...
--> v1 deployed successfully
```

배포 시간: 3-5분 (Docker 빌드 포함)

**Step 4: 배포 상태 확인**

```bash
fly status
```

Expected:
```
App
  Name     = puzzlepvp
  ...
Machines
ID          PROCESS VERSION REGION  STATE   CHECKS  LAST UPDATED
xxxxxxxxxx  app     1       nrt     started         ...
```

`STATE = started` 확인.

---

## Task 4: 배포 후 동작 검증

**Step 1: 헬스체크 확인**

```bash
curl https://puzzlepvp.fly.dev/health
```

Expected:
```json
{"status":"ok","timestamp":"2026-02-27T..."}
```

**Step 2: 브라우저 접속**

`https://puzzlepvp.fly.dev` 접속 → 게임 메인 화면 표시 확인

**Step 3: WebSocket 연결 확인**

브라우저 개발자 도구 → Network 탭 → WS 필터.
매칭 큐 진입 시 WebSocket 연결 확인 (`wss://puzzlepvp.fly.dev`).

**Step 4: 로그 확인 (문제 발생 시)**

```bash
fly logs
```

실시간 로그로 에러 확인.

---

## 트러블슈팅 가이드

### 빌드 실패
```bash
fly deploy --verbose  # 상세 로그
```

### Socket.io 연결 안 됨
- fly.io는 WebSocket을 기본 지원함
- `SocketClient.ts`에서 `transports: ['websocket']`만 사용 → 폴링 fallback 없음
- 정상이면 `wss://` 연결 확인

### 머신 메모리 부족
```bash
fly scale memory 512  # 또는 256 (1gb는 현재 설정)
```

### 앱 URL 확인
```bash
fly info
```
