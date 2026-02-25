import { Socket } from 'socket.io';
import { SocketEvent, LobbyUpdateMsg } from '@puzzle-pvp/shared';

export class LobbyManager {
  private queue: Socket[] = [];
  private countdownTimer: NodeJS.Timeout | null = null;
  private countdownSeconds: number = -1;

  readonly MAX_PLAYERS = 16;
  readonly MIN_PLAYERS = 1;
  readonly COUNTDOWN_DURATION = 10;

  /** 게임 시작 시 호출: sockets=실제 소켓, playerCount=AI 채움 후 총 인원 */
  onGameReady?: (sockets: Socket[], playerCount: number) => void;

  enqueue(socket: Socket): void {
    this.queue.push(socket);
    console.log(`[Lobby] 입장: ${socket.id} (대기: ${this.queue.length}명)`);
    if (this.queue.length >= this.MIN_PLAYERS && !this.countdownTimer) {
      this.startCountdown();
    }
    this.broadcastLobbyUpdate();
  }

  dequeue(socket: Socket): void {
    const idx = this.queue.indexOf(socket);
    if (idx < 0) return;
    this.queue.splice(idx, 1);
    console.log(`[Lobby] 이탈: ${socket.id} (대기: ${this.queue.length}명)`);
    if (this.queue.length < this.MIN_PLAYERS && this.countdownTimer) {
      this.stopCountdown();
    }
    this.broadcastLobbyUpdate();
  }

  private startCountdown(): void {
    this.countdownSeconds = this.COUNTDOWN_DURATION;
    console.log(`[Lobby] 카운트다운 시작: ${this.countdownSeconds}초`);
    this.countdownTimer = setInterval(() => {
      this.countdownSeconds--;
      this.broadcastLobbyUpdate();
      if (this.countdownSeconds <= 0) {
        this.launchGame();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
      this.countdownSeconds = -1;
      console.log('[Lobby] 카운트다운 취소');
    }
  }

  private launchGame(): void {
    this.stopCountdown();
    // 큐에서 최대 16명 수집
    const sockets = this.queue.splice(0, this.MAX_PLAYERS);
    // 2의 배수로 맞춤 (짝수 팀 구성)
    let playerCount = sockets.length;
    if (playerCount % 2 !== 0) {
      playerCount++; // AI 1명 추가해서 짝수로
    }
    console.log(`[Lobby] 게임 시작: 실제 ${sockets.length}명 + AI ${playerCount - sockets.length}명`);
    this.onGameReady?.(sockets, playerCount);
    // 큐에 남은 플레이어가 있으면 다시 카운트다운 시작
    if (this.queue.length >= this.MIN_PLAYERS) {
      this.startCountdown();
    }
    this.broadcastLobbyUpdate();
  }

  forceLaunch(socket: Socket, targetCount: number): void {
    if (!this.queue.includes(socket)) return;
    const finalCount = Math.max(2, Math.min(this.MAX_PLAYERS, targetCount));
    this.stopCountdown();
    const sockets = this.queue.splice(0, finalCount);
    console.log(`[Lobby] 강제 시작: 목표 ${finalCount}명 (실제 ${sockets.length}명 + AI ${finalCount - sockets.length}명)`);
    this.onGameReady?.(sockets, finalCount);
    if (this.queue.length >= this.MIN_PLAYERS) {
      this.startCountdown();
    }
    this.broadcastLobbyUpdate();
  }

  private broadcastLobbyUpdate(): void {
    const msg: LobbyUpdateMsg = {
      currentPlayers: this.queue.length,
      maxPlayers: this.MAX_PLAYERS,
      countdown: this.countdownSeconds,
    };
    for (const socket of this.queue) {
      socket.emit(SocketEvent.LOBBY_UPDATE, msg);
    }
  }
}
