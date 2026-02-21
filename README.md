# PuzzlePvP

Classic1 퍼즐 게임의 핵심 메카닉을 기반으로 한 1v1 실시간 대전 HTML5 게임.

## 빠른 시작

```bash
# 의존성 설치
npm install

# shared 패키지 빌드 (최초 1회)
npm run build:shared

# 서버 실행 (터미널 1)
npm run dev:server

# 클라이언트 실행 (터미널 2)
npm run dev:client
```

## 테스트

1. 서버 실행: `npm run dev:server` → http://localhost:3001
2. 클라이언트 실행: `npm run dev:client` → http://localhost:5173
3. 두 개의 브라우저 탭에서 http://localhost:5173 접속
4. 두 탭 모두 "게임 시작" 클릭 → 자동 매칭

## 게임 규칙

- 반사판을 배치해 자기 공이 상대 SpawnPoint에 도달하도록 유도
- 자기 공이 자기 SpawnPoint 도착 → HP +1 (회복)
- 적 공이 자기 SpawnPoint 도착 → HP -1 (피해)
- HP = 0 → SpawnPoint 파괴, 공 생성 중단
- 상대 SpawnPoint 전부 파괴 → 승리

## 프로젝트 구조

```
packages/
  shared/   - 게임 코어 로직 (BallSimulator, TileModel, BattleSimulator 등)
  server/   - Node.js + Socket.io 서버
  client/   - Phaser.js 클라이언트
```
