import { Socket } from 'socket.io';
import { AIPlayer } from '../ai/AIPlayer';
import {
  BattleSimulator,
  DEFAULT_BATTLE_CONFIG,
  MapModel,
  createBattleTileRegistry,
  generateNPlayerBattleMap,
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
  MonsterInfo,
  MonsterSpawnedMsg,
  MonsterDamagedMsg,
  MonsterKilledMsg,
  MonsterMovedMsg,
  ItemDroppedMsg,
  ItemPickedUpMsg,
  BallPoweredUpMsg,
  PlayerBallCountUpMsg,
  PlayerSpeedUpMsg,
  PlayerReflectorExpandMsg,
  SpawnHealedMsg,
  CoreHealedMsg,
  PlayerEliminatedMsg,
  TowerBoxDamagedMsg,
  TowerBoxBrokenMsg,
  OwnershipTransferredMsg,
} from '@puzzle-pvp/shared';
import type { MapLayoutConfig } from '@puzzle-pvp/shared';

const TICK_INTERVAL_MS = 50;  // 20 FPS 서버 틱

export class GameRoom {
  readonly id: string;
  private players: Map<number, Socket | null>;  // playerId → Socket (null = AI)
  private simulator: BattleSimulator;
  private map: MapModel;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastTickTime: number = Date.now();
  private layout?: MapLayoutConfig;
  private aiPlayers: AIPlayer[] = [];
  onDestroy?: () => void;

  constructor(id: string, players: Map<number, Socket | null>, playerCount?: number) {
    this.id = id;
    this.players = players;

    // 맵 및 시뮬레이터 초기화 (2인 포함 항상 N:N 동적 맵)
    const registry = createBattleTileRegistry();
    this.map = new MapModel(registry);
    const count = playerCount ?? players.size;

    const generated = generateNPlayerBattleMap(count);
    this.layout = generated.layout;
    this.map.load({
      ...generated.mapData,
      spawnAssignments: generated.spawnAssignments,
      coreAssignments: generated.coreAssignments,
      zoneWalls: generated.zoneWalls,
      layout: generated.layout,
    });

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
        speedMultiplier: ball.speedMultiplier,
      };
      this.broadcast(SocketEvent.BALL_MOVED, msg);
    };

    this.simulator.onBallEnded = (ball, tile, reason, direction) => {
      const msg: BallEndedMsg = {
        ballId: ball.id,
        x: tile.x,
        y: tile.y,
        reason,
        direction,
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

    this.simulator.onMonsterSpawned = (id, monsterType, x, y, hp, maxHp) => {
      const msg: MonsterSpawnedMsg = { id, monsterType, x, y, hp, maxHp };
      this.broadcast(SocketEvent.MONSTER_SPAWNED, msg);
    };

    this.simulator.onMonsterDamaged = (id, hp, maxHp) => {
      const msg: MonsterDamagedMsg = { id, hp, maxHp };
      this.broadcast(SocketEvent.MONSTER_DAMAGED, msg);
    };

    this.simulator.onMonsterKilled = (id, x, y) => {
      const msg: MonsterKilledMsg = { id, x, y };
      this.broadcast(SocketEvent.MONSTER_KILLED, msg);
    };

    this.simulator.onMonsterMoved = (id, fromX, fromY, toX, toY) => {
      const msg: MonsterMovedMsg = { id, fromX, fromY, toX, toY };
      this.broadcast(SocketEvent.MONSTER_MOVED, msg);
    };

    this.simulator.onItemDropped = (itemId, x, y, itemType) => {
      const msg: ItemDroppedMsg = { itemId, x, y, itemType };
      this.broadcast(SocketEvent.ITEM_DROPPED, msg);
    };

    this.simulator.onItemPickedUp = (itemId, ballId, ballOwnerId) => {
      const msg: ItemPickedUpMsg = { itemId, ballId, ballOwnerId };
      this.broadcast(SocketEvent.ITEM_PICKED_UP, msg);
    };

    this.simulator.onBallPoweredUp = (ballId, ownerId) => {
      const msg: BallPoweredUpMsg = { ballId, playerId: ownerId };
      this.broadcast(SocketEvent.BALL_POWERED_UP, msg);
    };

    this.simulator.onPlayerBallCountUp = (playerId, ballCountBonus) => {
      const msg: PlayerBallCountUpMsg = { playerId, ballCountBonus };
      this.broadcast(SocketEvent.PLAYER_BALL_COUNT_UP, msg);
    };

    this.simulator.onPlayerSpeedUp = (playerId, speedBonus) => {
      const msg: PlayerSpeedUpMsg = { playerId, speedBonus };
      this.broadcast(SocketEvent.PLAYER_SPEED_UP, msg);
    };

    this.simulator.onPlayerReflectorExpand = (playerId, reflectorBonus) => {
      const msg: PlayerReflectorExpandMsg = { playerId, reflectorBonus };
      this.broadcast(SocketEvent.PLAYER_REFLECTOR_EXPAND, msg);
    };

    this.simulator.onSpawnHealed = (event) => {
      const msg: SpawnHealedMsg = event;
      this.broadcast(SocketEvent.SPAWN_HEALED, msg);
    };

    this.simulator.onCoreHealed = (event) => {
      const msg: CoreHealedMsg = event;
      this.broadcast(SocketEvent.CORE_HEALED, msg);
    };

    this.simulator.onTowerBoxDamaged = (spawnId, hp, maxHp) => {
      const msg: TowerBoxDamagedMsg = { spawnId, hp, maxHp };
      this.broadcast(SocketEvent.TOWER_BOX_DAMAGED, msg);
    };

    this.simulator.onTowerBoxBroken = (spawnId) => {
      const msg: TowerBoxBrokenMsg = { spawnId };
      this.broadcast(SocketEvent.TOWER_BOX_BROKEN, msg);
    };

    this.simulator.onOwnershipTransferred = (oldOwnerId, newOwnerId, coreId, coreHp, coreMaxHp, spawnTransfers) => {
      const msg: OwnershipTransferredMsg = { oldOwnerId, newOwnerId, coreId, coreHp, coreMaxHp, spawnTransfers };
      this.broadcast(SocketEvent.OWNERSHIP_TRANSFERRED, msg);
    };

    this.simulator.onPlayerEliminated = (playerId, teamId, remainingPlayers) => {
      const msg: PlayerEliminatedMsg = { playerId, teamId, remainingPlayers };
      this.broadcast(SocketEvent.PLAYER_ELIMINATED, msg);
    };
  }

  start(): void {
    this.simulator.init();

    // 플레이어에게 매칭 정보 전송
    const mapData = this.map.rawData!;
    const spawnPoints: SpawnPointInfo[] = this.simulator.spawnPoints.map(sp => ({
      id: sp.id,
      x: sp.tile.x,
      y: sp.tile.y,
      ownerId: sp.ownerId,
      hp: sp.hp,
      maxHp: sp.maxHp,
      direction: sp.spawnDirection,
    }));
    const cores: CoreInfo[] = this.simulator.cores.map(c => ({
      id: c.id,
      x: c.tile.x,
      y: c.tile.y,
      ownerId: c.ownerId,
      hp: c.hp,
      maxHp: c.maxHp,
    }));

    const monsters: MonsterInfo[] = this.simulator.getMonsters()
      .filter(m => m.active)
      .map(m => ({ id: m.id, monsterType: m.type, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp }));
    const walls = this.simulator.getWalls().map(w => ({
      playerId: w.ownerId,
      x: w.x,
      y: w.y,
      hp: w.hp,
      maxHp: w.maxHp,
    }));
    const towerBoxes = this.simulator.getTowerBoxes().map(b => ({
      spawnId: b.spawnPointId,
      tier: b.tier,
      hp: b.hp,
      maxHp: b.maxHp,
    }));

    const playerCount = this.players.size;

    for (const [playerId, socket] of this.players) {
      if (!socket) continue; // AI 슬롯은 스킵
      const teamId = this.layout?.zones.find(z => z.playerId === playerId)?.teamId;
      const msg: MatchFoundMsg = {
        roomId: this.id,
        playerId,
        mapData,
        spawnPoints,
        cores,
        timePerPhase: DEFAULT_BATTLE_CONFIG.timePerPhase,
        spawnInterval: DEFAULT_BATTLE_CONFIG.spawnInterval,
        reflectorCooldown: DEFAULT_BATTLE_CONFIG.reflectorCooldown,
        maxReflectorStock: DEFAULT_BATTLE_CONFIG.maxReflectorStock,
        initialReflectorStock: DEFAULT_BATTLE_CONFIG.initialReflectorStock,
        monsters,
        walls,
        // N인 필드
        playerCount,
        teamId,
        teams: this.layout?.teams,
        layout: this.layout,
        towerBoxes,
      };
      socket.emit(SocketEvent.MATCH_FOUND, msg);
    }

    // AI 플레이어 초기화 (null 소켓 슬롯)
    this.aiPlayers = [];
    if (this.layout) {
      for (const [playerId, socket] of this.players) {
        if (socket !== null) continue;
        const zone = this.layout.zones.find(z => z.playerId === playerId);
        if (zone) this.aiPlayers.push(new AIPlayer(playerId, this.simulator, zone));
      }
    }

    // 서버 틱 시작
    this.lastTickTime = Date.now();
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);

    // 입력 이벤트 등록 (실제 소켓만)
    for (const [playerId, socket] of this.players) {
      if (!socket) continue; // AI 슬롯은 스킵

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
        this.simulator.eliminatePlayer(playerId);
      });
    }

    console.log(`[GameRoom ${this.id}] 게임 시작 (플레이어 ${this.players.size}명)`);
  }

  private tick(): void {
    const now = Date.now();
    const delta = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    this.simulator.update(delta);
    for (const ai of this.aiPlayers) ai.update(delta);
  }

  private stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    // 소켓 이벤트 리스너 정리
    for (const socket of this.players.values()) {
      if (!socket) continue;
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
    for (const socket of this.players.values()) {
      if (socket) socket.emit(event, data);  // AI(null)는 스킵
    }
  }
}
