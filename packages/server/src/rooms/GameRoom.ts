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
  PlaceWallMsg,
  MatchFoundMsg,
  SpawnPointInfo,
  CoreInfo,
  SpawnHpMsg,
  SpawnDestroyedMsg,
  SpawnRespawnedMsg,
  ReflectorPlacedMsg,
  ReflectorRemovedMsg,
  BallSpawnedMsg,
  BallMovedMsg,
  BallEndedMsg,
  GameOverMsg,
  WallPlacedMsg,
  WallDamagedMsg,
  WallDestroyedMsg,
  TimeStopStartedMsg,
  TimeStopEndedMsg,
  CoreHpMsg,
  CoreDestroyedMsg,
  SpawnPhaseCompleteMsg,
  ReflectorStockMsg,
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
        phaseNumber: this.simulator.phaseNumber,
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

    this.simulator.onSpawnDestroyed = (spawnId, respawnDuration) => {
      const msg: SpawnDestroyedMsg = { spawnId, respawnDuration };
      this.broadcast(SocketEvent.SPAWN_DESTROYED, msg);
    };

    this.simulator.onSpawnRespawned = (spawnId, hp) => {
      const msg: SpawnRespawnedMsg = { spawnId, hp };
      this.broadcast(SocketEvent.SPAWN_RESPAWNED, msg);
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

    this.simulator.onWallPlaced = (event) => {
      const msg: WallPlacedMsg = {
        playerId: event.playerId,
        x: event.x,
        y: event.y,
        hp: event.hp,
        maxHp: event.maxHp,
      };
      this.broadcast(SocketEvent.WALL_PLACED, msg);
    };

    this.simulator.onWallDamaged = (event) => {
      const msg: WallDamagedMsg = { x: event.x, y: event.y, hp: event.hp };
      this.broadcast(SocketEvent.WALL_DAMAGED, msg);
    };

    this.simulator.onWallDestroyed = (x, y) => {
      const msg: WallDestroyedMsg = { x, y };
      this.broadcast(SocketEvent.WALL_DESTROYED, msg);
    };

    this.simulator.onTimeStopStarted = (event) => {
      const msg: TimeStopStartedMsg = { playerId: event.playerId, duration: event.duration };
      this.broadcast(SocketEvent.TIME_STOP_STARTED, msg);
    };

    this.simulator.onTimeStopEnded = () => {
      const msg: TimeStopEndedMsg = {};
      this.broadcast(SocketEvent.TIME_STOP_ENDED, msg);
    };

    this.simulator.onCoreHpChanged = (event) => {
      const msg: CoreHpMsg = { coreId: event.coreId, hp: event.hp, ownerId: event.ownerId };
      this.broadcast(SocketEvent.CORE_HP, msg);
    };

    this.simulator.onCoreDestroyed = (coreId) => {
      const msg: CoreDestroyedMsg = { coreId };
      this.broadcast(SocketEvent.CORE_DESTROYED, msg);
    };

    this.simulator.onSpawnPhaseComplete = (phaseNumber) => {
      const msg: SpawnPhaseCompleteMsg = { phaseNumber };
      this.broadcast(SocketEvent.SPAWN_PHASE_COMPLETE, msg);
    };

    this.simulator.onReflectorStockChanged = (playerId, stock, cooldownElapsed) => {
      const msg: ReflectorStockMsg = { playerId, stock, cooldownElapsed };
      this.broadcast(SocketEvent.REFLECTOR_STOCK, msg);
    };
  }

  start(): void {
    this.simulator.init();

    // 플레이어에게 매칭 정보 전송 (SpawnPoint + Core 포함)
    const mapData = createDefaultBattleMapData();
    const spawnPoints: SpawnPointInfo[] = this.simulator.spawnPoints.map(sp => ({
      id: sp.id,
      x: sp.tile.x,
      y: sp.tile.y,
      ownerId: sp.ownerId,
      hp: sp.hp,
      maxHp: sp.maxHp,
    }));
    const cores: CoreInfo[] = this.simulator.cores.map(c => ({
      id: c.id,
      x: c.tile.x,
      y: c.tile.y,
      ownerId: c.ownerId,
      hp: c.hp,
      maxHp: c.maxHp,
    }));

    for (let i = 0; i < 2; i++) {
      const msg: MatchFoundMsg = {
        roomId: this.id,
        playerId: i,
        mapData,
        spawnPoints,
        cores,
        timePerPhase: DEFAULT_BATTLE_CONFIG.timePerPhase,
        spawnInterval: DEFAULT_BATTLE_CONFIG.spawnInterval,
        reflectorCooldown: DEFAULT_BATTLE_CONFIG.reflectorCooldown,
        maxReflectorStock: DEFAULT_BATTLE_CONFIG.maxReflectorStock,
        initialReflectorStock: DEFAULT_BATTLE_CONFIG.initialReflectorStock,
      };
      this.players[i].emit(SocketEvent.MATCH_FOUND, msg);
    }

    // 서버 틱 시작 (disconnect 핸들러 등록 전에 설정)
    this.lastTickTime = Date.now();
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);

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

      socket.on(SocketEvent.PLACE_WALL, (msg: PlaceWallMsg) => {
        console.log(`[GameRoom ${this.id}] P${playerId} 성벽 설치: (${msg.x},${msg.y})`);
        const ok = this.simulator.placeWall(playerId, msg.x, msg.y);
        console.log(`[GameRoom ${this.id}] 성벽 설치 결과: ${ok}`);
      });

      socket.on(SocketEvent.USE_TIME_STOP, () => {
        console.log(`[GameRoom ${this.id}] P${playerId} 시간 정지 사용`);
        const ok = this.simulator.useTimeStop(playerId);
        console.log(`[GameRoom ${this.id}] 시간 정지 결과: ${ok}`);
      });

      socket.on('disconnect', () => {
        if (!this.tickTimer) return;  // 이미 종료된 게임 무시
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
      socket.removeAllListeners(SocketEvent.PLACE_WALL);
      socket.removeAllListeners(SocketEvent.USE_TIME_STOP);
      socket.removeAllListeners('disconnect');
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
