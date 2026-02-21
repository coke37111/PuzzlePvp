import { io, Socket } from 'socket.io-client';
import {
  SocketEvent,
  MatchFoundMsg,
  SpawnHpMsg,
  SpawnDestroyedMsg,
  ReflectorPlacedMsg,
  ReflectorRemovedMsg,
  BallSpawnedMsg,
  BallMovedMsg,
  BallEndedMsg,
  GameOverMsg,
  PlaceReflectorMsg,
  RemoveReflectorMsg,
  ReflectorType,
} from '@puzzle-pvp/shared';

const SERVER_URL = 'http://localhost:4000';

export class SocketClient {
  private static _instance: SocketClient | null = null;
  private socket: Socket;

  // 이벤트 콜백
  onMatchFound?: (msg: MatchFoundMsg) => void;
  onSpawnHp?: (msg: SpawnHpMsg) => void;
  onSpawnDestroyed?: (msg: SpawnDestroyedMsg) => void;
  onReflectorPlaced?: (msg: ReflectorPlacedMsg) => void;
  onReflectorRemoved?: (msg: ReflectorRemovedMsg) => void;
  onBallSpawned?: (msg: BallSpawnedMsg) => void;
  onBallMoved?: (msg: BallMovedMsg) => void;
  onBallEnded?: (msg: BallEndedMsg) => void;
  onGameOver?: (msg: GameOverMsg) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;

  static get instance(): SocketClient {
    if (!SocketClient._instance) {
      SocketClient._instance = new SocketClient();
    }
    return SocketClient._instance;
  }

  private constructor() {
    this.socket = io(SERVER_URL, { autoConnect: false });

    this.socket.on('connect', () => {
      console.log('[SocketClient] 서버 연결됨');
      this.onConnected?.();
    });

    this.socket.on('disconnect', () => {
      console.log('[SocketClient] 서버 연결 종료');
      this.onDisconnected?.();
    });

    this.socket.on(SocketEvent.MATCH_FOUND, (msg: MatchFoundMsg) => this.onMatchFound?.(msg));
    this.socket.on(SocketEvent.SPAWN_HP, (msg: SpawnHpMsg) => this.onSpawnHp?.(msg));
    this.socket.on(SocketEvent.SPAWN_DESTROYED, (msg: SpawnDestroyedMsg) => this.onSpawnDestroyed?.(msg));
    this.socket.on(SocketEvent.REFLECTOR_PLACED, (msg: ReflectorPlacedMsg) => this.onReflectorPlaced?.(msg));
    this.socket.on(SocketEvent.REFLECTOR_REMOVED, (msg: ReflectorRemovedMsg) => this.onReflectorRemoved?.(msg));
    this.socket.on(SocketEvent.BALL_SPAWNED, (msg: BallSpawnedMsg) => this.onBallSpawned?.(msg));
    this.socket.on(SocketEvent.BALL_MOVED, (msg: BallMovedMsg) => this.onBallMoved?.(msg));
    this.socket.on(SocketEvent.BALL_ENDED, (msg: BallEndedMsg) => this.onBallEnded?.(msg));
    this.socket.on(SocketEvent.GAME_OVER, (msg: GameOverMsg) => this.onGameOver?.(msg));
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  joinQueue(): void {
    this.socket.emit(SocketEvent.JOIN_QUEUE);
  }

  placeReflector(x: number, y: number, type: ReflectorType): void {
    const msg: PlaceReflectorMsg = { x, y, type };
    console.log(`[SocketClient] 반사판 설치 전송: (${x},${y}) type=${type} connected=${this.socket.connected}`);
    this.socket.emit(SocketEvent.PLACE_REFLECTOR, msg);
  }

  removeReflector(x: number, y: number): void {
    const msg: RemoveReflectorMsg = { x, y };
    console.log(`[SocketClient] 반사판 해제 전송: (${x},${y}) connected=${this.socket.connected}`);
    this.socket.emit(SocketEvent.REMOVE_REFLECTOR, msg);
  }
}
