import { Socket } from 'socket.io';

export class MatchmakingQueue {
  private queue: Socket[] = [];
  private onMatch: (socket1: Socket, socket2: Socket) => void;

  constructor(onMatch: (socket1: Socket, socket2: Socket) => void) {
    this.onMatch = onMatch;
  }

  enqueue(socket: Socket): void {
    this.queue.push(socket);
    console.log(`[Matchmaking] 플레이어 대기 중: ${socket.id} (대기열: ${this.queue.length}명)`);
    this.tryMatch();
  }

  dequeue(socket: Socket): void {
    const idx = this.queue.indexOf(socket);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      console.log(`[Matchmaking] 대기열 이탈: ${socket.id} (대기열: ${this.queue.length}명)`);
    }
  }

  private tryMatch(): void {
    if (this.queue.length >= 2) {
      const p1 = this.queue.shift()!;
      const p2 = this.queue.shift()!;
      console.log(`[Matchmaking] 매칭 성공: ${p1.id} vs ${p2.id}`);
      this.onMatch(p1, p2);
    }
  }
}
