import { Socket } from 'socket.io';
import {
  BattleSimulator,
  DEFAULT_BATTLE_CONFIG,
  MapModel,
  createBattleTileRegistry,
  createDefaultBattleMapData,
  SocketEvent,
  PlaceReflectorMsg,
  RemoveReflectorMsg,
  MatchFoundMsg,
  SpawnPointInfo,
  SpawnHpMsg,
  SpawnDestroyedMsg,
  ReflectorPlacedMsg,
  ReflectorRemovedMsg,
  BallSpawnedMsg,
  BallMovedMsg,
  BallEndedMsg,
  GameOverMsg,
} from '@puzzle-pvp/shared';

const TICK_INTERVAL_MS = 50;  // 20 FPS 서버 틱

export class GameRoom {
  readonly id: string;
  private players: [Socket, Socket];
  private simulator: BattleSimulator;
  private map: MapModel;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastTickTime: number = Date.now();
  onDestroy?: () => void;

  constructor(id: string, p1: Socket, p2: Socket) {
    this.id = id;
    this.players = [p1, p2];

    // 맵 및 시뮬레이터 초기화
    const registry = createBattleTileRegistry();
    this.map = new MapModel(registry);
    this.map.load(createDefaultBattleMapData());

    this.simulator = new BattleSimulator(this.map, DEFAULT_BATTLE_CONFIG);

    // 이벤트 연결
    this.simulator.onBallCreated = (ball, direction) => {
      const msg: BallSpawnedMsg = {
        ballId: ball.id,
        ownerId: ball.ownerId,
        x: ball.placementTile.x,
        y: ball.placementTile.y,
        direction,
      };
      this.broadcast(SocketEvent.BALL_SPAWNED, msg);
    };

    this.simulator.onBallMoved = (ball, from, to) => {
      const msg: BallMovedMsg = {
        ballId: ball.id,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      };
      this.broadcast(SocketEvent.BALL_MOVED, msg);
    };

    this.simulator.onBallEnded = (ball, tile, reason) => {
      const msg: BallEndedMsg = {
        ballId: ball.id,
        x: tile.x,
        y: tile.y,
        reason,
      };
      this.broadcast(SocketEvent.BALL_ENDED, msg);
    };

    this.simulator.onSpawnHpChanged = (event) => {
      const msg: SpawnHpMsg = event;
      this.broadcast(SocketEvent.SPAWN_HP, msg);
    };

    this.simulator.onSpawnDestroyed = (spawnId) => {
      const msg: SpawnDestroyedMsg = { spawnId };
      this.broadcast(SocketEvent.SPAWN_DESTROYED, msg);
    };

    this.simulator.onReflectorPlaced = (placement) => {
      const msg: ReflectorPlacedMsg = {
        playerId: placement.playerId,
        x: placement.x,
        y: placement.y,
        type: placement.type,
      };
      this.broadcast(SocketEvent.REFLECTOR_PLACED, msg);
    };

    this.simulator.onReflectorRemoved = (x, y, playerId) => {
      const msg: ReflectorRemovedMsg = { playerId, x, y };
      this.broadcast(SocketEvent.REFLECTOR_REMOVED, msg);
    };

    this.simulator.onGameOver = (result) => {
      const msg: GameOverMsg = result;
      this.broadcast(SocketEvent.GAME_OVER, msg);
      this.stop();
    };
  }

  start(): void {
    this.simulator.init();

    // 플레이어에게 매칭 정보 전송 (SpawnPoint 포함)
    const mapData = createDefaultBattleMapData();
    const spawnPoints: SpawnPointInfo[] = this.simulator.spawnPoints.map(sp => ({
      id: sp.id,
      x: sp.tile.x,
      y: sp.tile.y,
      ownerId: sp.ownerId,
      hp: sp.hp,
      maxHp: sp.maxHp,
    }));

    for (let i = 0; i < 2; i++) {
      const msg: MatchFoundMsg = {
        roomId: this.id,
        playerId: i,
        mapData,
        spawnPoints,
        timePerPhase: DEFAULT_BATTLE_CONFIG.timePerPhase,
      };
      this.players[i].emit(SocketEvent.MATCH_FOUND, msg);
    }

    // 입력 이벤트 등록
    for (let i = 0; i < 2; i++) {
      const socket = this.players[i];
      const playerId = i;

      socket.on(SocketEvent.PLACE_REFLECTOR, (msg: PlaceReflectorMsg) => {
        console.log(`[GameRoom ${this.id}] P${playerId} 반사판 설치: (${msg.x},${msg.y}) type=${msg.type}`);
        const ok = this.simulator.placeReflector(playerId, msg.x, msg.y, msg.type);
        console.log(`[GameRoom ${this.id}] 설치 결과: ${ok}`);
      });

      socket.on(SocketEvent.REMOVE_REFLECTOR, (msg: RemoveReflectorMsg) => {
        console.log(`[GameRoom ${this.id}] P${playerId} 반사판 해제: (${msg.x},${msg.y})`);
        this.simulator.removeReflector(playerId, msg.x, msg.y);
      });

      socket.on('disconnect', () => {
        console.log(`[GameRoom ${this.id}] 플레이어 ${playerId} 연결 끊김`);
        // 상대에게 승리 알림
        const opponentIdx = playerId === 0 ? 1 : 0;
        const opponentSocket = this.players[opponentIdx];
        if (opponentSocket.connected) {
          const msg: GameOverMsg = { winnerId: opponentIdx };
          opponentSocket.emit(SocketEvent.GAME_OVER, msg);
        }
        this.stop();
      });
    }

    // 서버 틱 시작
    this.lastTickTime = Date.now();
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);

    console.log(`[GameRoom ${this.id}] 게임 시작`);
  }

  private tick(): void {
    const now = Date.now();
    const delta = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    this.simulator.update(delta);
  }

  private stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    // 소켓 이벤트 리스너 정리
    for (const socket of this.players) {
      socket.removeAllListeners(SocketEvent.PLACE_REFLECTOR);
      socket.removeAllListeners(SocketEvent.REMOVE_REFLECTOR);
    }

    this.onDestroy?.();
    console.log(`[GameRoom ${this.id}] 게임 종료`);
  }

  private broadcast(event: string, data: unknown): void {
    for (const player of this.players) {
      player.emit(event, data);
    }
  }
}
