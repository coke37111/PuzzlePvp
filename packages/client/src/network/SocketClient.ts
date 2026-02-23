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
  PlaceWallMsg,
  WallPlacedMsg,
  WallDamagedMsg,
  WallDestroyedMsg,
  TimeStopStartedMsg,
  TimeStopEndedMsg,
  CoreHpMsg,
  CoreDestroyedMsg,
  SpawnRespawnedMsg,
  SpawnPhaseCompleteMsg,
  ReflectorStockMsg,
  MovingWallMovedMsg,
  ReflectorType,
} from '@puzzle-pvp/shared';

// 개발: localhost:4000 / 프로덕션: 같은 오리진 (서버가 클라이언트도 서빙)
const SERVER_URL = import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin;

export class SocketClient {
  private static _instance: SocketClient | null = null;
  private socket: Socket;

  // 이벤트 콜백
  onMatchFound?: (msg: MatchFoundMsg) => void;
  onSpawnHp?: (msg: SpawnHpMsg) => void;
  onSpawnDestroyed?: (msg: SpawnDestroyedMsg) => void;
  onSpawnRespawned?: (msg: SpawnRespawnedMsg) => void;
  onReflectorPlaced?: (msg: ReflectorPlacedMsg) => void;
  onReflectorRemoved?: (msg: ReflectorRemovedMsg) => void;
  onBallSpawned?: (msg: BallSpawnedMsg) => void;
  onBallMoved?: (msg: BallMovedMsg) => void;
  onBallEnded?: (msg: BallEndedMsg) => void;
  onGameOver?: (msg: GameOverMsg) => void;
  onWallPlaced?: (msg: WallPlacedMsg) => void;
  onWallDamaged?: (msg: WallDamagedMsg) => void;
  onWallDestroyed?: (msg: WallDestroyedMsg) => void;
  onTimeStopStarted?: (msg: TimeStopStartedMsg) => void;
  onTimeStopEnded?: (msg: TimeStopEndedMsg) => void;
  onCoreHp?: (msg: CoreHpMsg) => void;
  onCoreDestroyed?: (msg: CoreDestroyedMsg) => void;
  onSpawnPhaseComplete?: (msg: SpawnPhaseCompleteMsg) => void;
  onReflectorStock?: (msg: ReflectorStockMsg) => void;
  onMovingWallMoved?: (msg: MovingWallMovedMsg) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;

  static get instance(): SocketClient {
    if (!SocketClient._instance) {
      SocketClient._instance = new SocketClient();
    }
    return SocketClient._instance;
  }

  private constructor() {
    this.socket = io(SERVER_URL, { autoConnect: false, transports: ['websocket'] });

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
    this.socket.on(SocketEvent.SPAWN_RESPAWNED, (msg: SpawnRespawnedMsg) => this.onSpawnRespawned?.(msg));
    this.socket.on(SocketEvent.REFLECTOR_PLACED, (msg: ReflectorPlacedMsg) => this.onReflectorPlaced?.(msg));
    this.socket.on(SocketEvent.REFLECTOR_REMOVED, (msg: ReflectorRemovedMsg) => this.onReflectorRemoved?.(msg));
    this.socket.on(SocketEvent.BALL_SPAWNED, (msg: BallSpawnedMsg) => this.onBallSpawned?.(msg));
    this.socket.on(SocketEvent.BALL_MOVED, (msg: BallMovedMsg) => this.onBallMoved?.(msg));
    this.socket.on(SocketEvent.BALL_ENDED, (msg: BallEndedMsg) => this.onBallEnded?.(msg));
    this.socket.on(SocketEvent.GAME_OVER, (msg: GameOverMsg) => this.onGameOver?.(msg));
    this.socket.on(SocketEvent.WALL_PLACED, (msg: WallPlacedMsg) => this.onWallPlaced?.(msg));
    this.socket.on(SocketEvent.WALL_DAMAGED, (msg: WallDamagedMsg) => this.onWallDamaged?.(msg));
    this.socket.on(SocketEvent.WALL_DESTROYED, (msg: WallDestroyedMsg) => this.onWallDestroyed?.(msg));
    this.socket.on(SocketEvent.TIME_STOP_STARTED, (msg: TimeStopStartedMsg) => this.onTimeStopStarted?.(msg));
    this.socket.on(SocketEvent.TIME_STOP_ENDED, (msg: TimeStopEndedMsg) => this.onTimeStopEnded?.(msg));
    this.socket.on(SocketEvent.CORE_HP, (msg: CoreHpMsg) => this.onCoreHp?.(msg));
    this.socket.on(SocketEvent.CORE_DESTROYED, (msg: CoreDestroyedMsg) => this.onCoreDestroyed?.(msg));
    this.socket.on(SocketEvent.SPAWN_PHASE_COMPLETE, (msg: SpawnPhaseCompleteMsg) => this.onSpawnPhaseComplete?.(msg));
    this.socket.on(SocketEvent.REFLECTOR_STOCK, (msg: ReflectorStockMsg) => this.onReflectorStock?.(msg));
    this.socket.on(SocketEvent.MOVING_WALL_MOVED, (msg: MovingWallMovedMsg) => this.onMovingWallMoved?.(msg));
  }

  get isConnected(): boolean {
    return this.socket.connected;
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

  placeWall(x: number, y: number): void {
    const msg: PlaceWallMsg = { x, y };
    this.socket.emit(SocketEvent.PLACE_WALL, msg);
  }

  useTimeStop(): void {
    this.socket.emit(SocketEvent.USE_TIME_STOP);
  }
}
