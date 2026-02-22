import { MapModel, ReflectorPlacement } from './MapModel';
import { BallSimulator } from './BallSimulator';
import { SpawnPointModel, CoreModel } from './SpawnPointModel';
import { TileModel } from './TileModel';
import { BallModel } from './BallModel';
import { Direction } from '../enums/Direction';
import { ReflectorType } from '../enums/ReflectorType';
import { EndReason } from '../enums/EndReason';

export interface WallState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ownerId: number;
}

export interface ItemCounts {
  wall: number;
  timeStop: number;
}

export interface WallEvent {
  x: number;
  y: number;
  hp: number;
  playerId?: number;
  maxHp?: number;
}

export interface TimeStopEvent {
  playerId: number;
  duration: number;
}

export interface BattleConfig {
  spawnInterval: number;    // 초 단위 (기본 1.0)
  timePerPhase: number;     // 초 단위 (기본 0.3, 클수록 느림)
  maxReflectorsPerPlayer: number;  // 플레이어당 반사판 한도 (기본 5)
  spawnHp: number;          // SpawnPoint 기본 HP
  coreHp: number;           // Core 기본 HP
  maxWallsPerPlayer: number;       // 플레이어당 성벽 아이템 사용 횟수 (기본 3)
  wallHp: number;           // 성벽 HP (기본 10)
  timeStopUsesPerPlayer: number;   // 시간 정지 사용 횟수 (기본 1)
  timeStopDuration: number; // 시간 정지 지속 시간 초 (기본 5)
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  spawnInterval:5.0,
  timePerPhase: 0.2,
  maxReflectorsPerPlayer: 5,
  spawnHp: 10,
  coreHp: 10,
  maxWallsPerPlayer: 3,
  wallHp: 10,
  timeStopUsesPerPlayer: 1,
  timeStopDuration: 5,
};

export interface CoreEvent {
  coreId: number;
  hp: number;
  ownerId: number;
}

export interface SpawnEvent {
  spawnId: number;
  hp: number;
  ownerId: number;
}

export interface BattleResult {
  winnerId: number;  // 0 또는 1, -1이면 무승부
}

export class BattleSimulator {
  readonly map: MapModel;
  readonly simulator: BallSimulator;
  readonly config: BattleConfig;

  spawnPoints: SpawnPointModel[] = [];
  cores: CoreModel[] = [];
  private spawnTimer: number = 0;
  private phaseNumber: number = 0;
  private pendingSpawnQueue: Array<{ tile: TileModel; direction: Direction; ownerId: number }> = [];
  private pendingSpawnTimer: number = 0;
  private static readonly SPAWN_FIRE_INTERVAL = 0.2;
  private reflectorQueues: Map<number, number[]> = new Map();  // playerId → [tileIndex, ...]
  private nextSpawnPointId: number = 1;
  private nextCoreId: number = 1;
  private isRunning: boolean = false;

  // 아이템
  private itemCounts: Map<number, ItemCounts> = new Map();  // playerId → counts
  private walls: Map<string, WallState> = new Map();  // "x,y" → WallState
  private isTimeStopped: boolean = false;
  private timeStopRemaining: number = 0;

  // 스폰 리스폰 타이머 (spawnId → 남은 초)
  private spawnRespawnTimers: Map<number, number> = new Map();
  static readonly SPAWN_RESPAWN_DELAY = 20;

  // 이벤트
  onSpawnHpChanged?: (event: SpawnEvent) => void;
  onSpawnDestroyed?: (spawnId: number) => void;
  onSpawnRespawned?: (spawnId: number, hp: number) => void;
  onReflectorPlaced?: (placement: ReflectorPlacement) => void;
  onReflectorRemoved?: (x: number, y: number, playerId: number) => void;
  onGameOver?: (result: BattleResult) => void;
  onBallCreated?: (ball: BallModel, direction: Direction) => void;
  onBallMoved?: (ball: BallModel, from: TileModel, to: TileModel) => void;
  onBallEnded?: (ball: BallModel, tile: TileModel, reason: EndReason) => void;
  onWallPlaced?: (event: WallEvent & { playerId: number; maxHp: number }) => void;
  onWallDamaged?: (event: WallEvent) => void;
  onWallDestroyed?: (x: number, y: number) => void;
  onTimeStopStarted?: (event: TimeStopEvent) => void;
  onTimeStopEnded?: () => void;
  onCoreHpChanged?: (event: CoreEvent) => void;
  onCoreDestroyed?: (coreId: number) => void;

  constructor(map: MapModel, config: Partial<BattleConfig> = {}) {
    this.map = map;
    this.config = { ...DEFAULT_BATTLE_CONFIG, ...config };
    this.simulator = new BallSimulator(map);

    // 반사판 큐 초기화 (2명)
    this.reflectorQueues.set(0, []);
    this.reflectorQueues.set(1, []);

    // 아이템 초기화 (2명)
    this.itemCounts.set(0, { wall: this.config.maxWallsPerPlayer, timeStop: this.config.timeStopUsesPerPlayer });
    this.itemCounts.set(1, { wall: this.config.maxWallsPerPlayer, timeStop: this.config.timeStopUsesPerPlayer });
  }

  getItemCounts(playerId: number): ItemCounts {
    return this.itemCounts.get(playerId) ?? { wall: 0, timeStop: 0 };
  }

  getWall(x: number, y: number): WallState | undefined {
    return this.walls.get(`${x},${y}`);
  }

  get isGameTimeStopped(): boolean {
    return this.isTimeStopped;
  }

  init(): void {
    this.spawnPoints = [];
    this.cores = [];
    this.nextSpawnPointId = 1;
    this.nextCoreId = 1;
    this.spawnTimer = 0;
    this.phaseNumber = 0;
    this.pendingSpawnQueue = [];
    this.pendingSpawnTimer = 0;
    this.isRunning = true;

    // 스타트 타일에서 SpawnPoint 생성
    // uniqueIndex 2,4 = P1(ownerId=0), 3,5 = P2(ownerId=1)
    const startTiles = this.map.getStartTiles();
    for (const tile of startTiles) {
      const idx = tile.tileData.uniqueIndex;
      const ownerId = (idx === 2 || idx === 4) ? 0 : 1;
      const dir = tile.startDirection;
      const sp = new SpawnPointModel(this.nextSpawnPointId++, tile, ownerId, dir, this.config.spawnHp);
      this.spawnPoints.push(sp);
    }

    // 코어 타일에서 CoreModel 생성
    // uniqueIndex 6 = P1(ownerId=0), 8 = P2(ownerId=1)
    const coreTiles = this.map.getCoreTiles();
    for (const tile of coreTiles) {
      const ownerId = tile.tileData.uniqueIndex === 6 ? 0 : 1;
      const core = new CoreModel(this.nextCoreId++, tile, ownerId, this.config.coreHp);
      this.cores.push(core);
    }

    // BallSimulator 이벤트 연결
    this.simulator.onBallCreated = (ball, dir) => this.onBallCreated?.(ball, dir);
    this.simulator.onBallMoved = (ball, from, to) => this.onBallMoved?.(ball, from, to);
    this.simulator.onBallEnded = (ball, tile, reason) => this.onBallEnded?.(ball, tile, reason);

    // 공이 타일에 도착할 때 SpawnPoint/Wall 체크
    this.simulator.onBallArrivedAtTile = (ball, tile) => {
      // 성벽 체크
      const wallKey = `${tile.x},${tile.y}`;
      const wall = this.walls.get(wallKey);
      if (wall) {
        wall.hp -= 1;
        if (wall.hp <= 0) {
          this.walls.delete(wallKey);
          this.onWallDestroyed?.(tile.x, tile.y);
        } else {
          this.onWallDamaged?.({ x: tile.x, y: tile.y, hp: wall.hp });
        }
        return true; // 공 캡처
      }

      // 스폰포인트 체크
      const sp = this.spawnPoints.find(s => s.tile.x === tile.x && s.tile.y === tile.y);
      if (sp && sp.active) {
        sp.damage();
        if (!sp.active) {
          this.onSpawnDestroyed?.(sp.id);
          this.spawnRespawnTimers.set(sp.id, BattleSimulator.SPAWN_RESPAWN_DELAY);
        }
        this.onSpawnHpChanged?.({ spawnId: sp.id, hp: sp.hp, ownerId: sp.ownerId });
        return true; // 공 캡처
      }

      // 코어 체크 (승패 결정)
      const core = this.cores.find(c => c.tile.x === tile.x && c.tile.y === tile.y);
      if (core && core.active) {
        core.damage();
        this.onCoreHpChanged?.({ coreId: core.id, hp: core.hp, ownerId: core.ownerId });
        if (!core.active) {
          this.onCoreDestroyed?.(core.id);
          this.checkWinCondition();
        }
        return true; // 공 캡처
      }

      return false;
    };

    // BallSimulator 배틀 모드 초기화 (bracket notation 제거)
    this.simulator.initForBattle(this.config.timePerPhase);

    // 초기 스폰
    this.spawnAll();
  }

  /** delta(초) 만큼 시뮬레이션 진행 */
  update(delta: number): void {
    if (!this.isRunning) return;

    // 시간 정지 처리
    if (this.isTimeStopped) {
      this.timeStopRemaining -= delta;
      if (this.timeStopRemaining <= 0) {
        this.isTimeStopped = false;
        this.onTimeStopEnded?.();
      }
      return;
    }

    // 공 시뮬레이션 진행 (인스턴스 없어도 timer는 계속)
    if (this.simulator.instances.length > 0) {
      const allEnded = this.simulator.update(delta);
      // 종료된 인스턴스 정리 (메모리 누적 방지)
      if (allEnded) {
        this.simulator.instances = [];
      }
    }

    // 지연 발사 큐 처리
    if (this.pendingSpawnQueue.length > 0) {
      this.pendingSpawnTimer += delta;
      while (this.pendingSpawnTimer >= BattleSimulator.SPAWN_FIRE_INTERVAL && this.pendingSpawnQueue.length > 0) {
        this.pendingSpawnTimer -= BattleSimulator.SPAWN_FIRE_INTERVAL;
        const next = this.pendingSpawnQueue.shift()!;
        this.simulator.spawnBall(next.tile, next.direction, next.ownerId);
      }
    }

    // 스폰 타이머
    this.spawnTimer += delta;
    if (this.spawnTimer >= this.config.spawnInterval) {
      this.spawnTimer -= this.config.spawnInterval;
      this.spawnAll();
    }

    // 스폰 리스폰 타이머
    for (const [spawnId, remaining] of this.spawnRespawnTimers) {
      const next = remaining - delta;
      if (next <= 0) {
        this.spawnRespawnTimers.delete(spawnId);
        const sp = this.spawnPoints.find(s => s.id === spawnId);
        if (sp) {
          sp.respawn(this.config.spawnHp);
          this.onSpawnRespawned?.(sp.id, sp.hp);
        }
      } else {
        this.spawnRespawnTimers.set(spawnId, next);
      }
    }
  }

  private spawnAll(): void {
    this.phaseNumber++;
    const ballCount = Math.floor(this.phaseNumber / 10) + 1;

    // 첫 번째 공은 즉시 발사, 나머지는 0.2초 간격 큐에 추가
    let firstFired = false;
    for (const sp of this.spawnPoints) {
      if (!sp.active) continue;
      for (let i = 0; i < ballCount; i++) {
        if (!firstFired) {
          this.simulator.spawnBall(sp.tile, sp.spawnDirection, sp.ownerId);
          this.pendingSpawnTimer = 0;
          firstFired = true;
        } else {
          this.pendingSpawnQueue.push({ tile: sp.tile, direction: sp.spawnDirection, ownerId: sp.ownerId });
        }
      }
    }
  }

  private checkWinCondition(): void {
    const p0CoreAlive = this.cores.some(c => c.ownerId === 0 && c.active);
    const p1CoreAlive = this.cores.some(c => c.ownerId === 1 && c.active);

    if (!p0CoreAlive && !p1CoreAlive) {
      this.isRunning = false;
      this.onGameOver?.({ winnerId: -1 });
    } else if (!p0CoreAlive) {
      this.isRunning = false;
      this.onGameOver?.({ winnerId: 1 });
    } else if (!p1CoreAlive) {
      this.isRunning = false;
      this.onGameOver?.({ winnerId: 0 });
    }
  }

  /** 반사판 배치 (플레이어 큐 FIFO 관리) */
  /** (x,y)가 playerId에게 적 코어 인접 1칸인지 확인 */
  isEnemyCoreZone(playerId: number, x: number, y: number): boolean {
    for (const core of this.cores) {
      if (core.ownerId === playerId) continue; // 아군 코어는 무시
      if (Math.abs(core.tile.x - x) <= 1 && Math.abs(core.tile.y - y) <= 1) return true;
    }
    return false;
  }

  placeReflector(playerId: number, x: number, y: number, type: ReflectorType): boolean {
    if (this.isEnemyCoreZone(playerId, x, y)) return false;

    const queue = this.reflectorQueues.get(playerId)!;
    const tileIndex = x + y * 100;
    const isReplacing = queue.includes(tileIndex);

    // 한도 초과 시 가장 오래된 반사판 자동 제거 (FIFO)
    if (!isReplacing && queue.length >= this.config.maxReflectorsPerPlayer) {
      const oldestIndex = queue.shift()!;
      const ox = oldestIndex % 100;
      const oy = Math.floor(oldestIndex / 100);
      const removed = this.map.removeReflector(ox, oy);
      if (removed) this.onReflectorRemoved?.(ox, oy, playerId);
    }

    const success = this.map.placeReflector(x, y, type, playerId);
    if (!success) return false;

    if (!isReplacing) queue.push(tileIndex);

    // 해당 타일에 있는 공의 방향 즉시 재계산 (입사 방향 기준으로 올바르게 계산)
    for (const inst of this.simulator.instances) {
      if (!inst.isEnd && inst.currentTile.x === x && inst.currentTile.y === y) {
        inst.direction = BallSimulator.getReflectedDirection(inst.incomingDirection, type);
      }
    }

    const placement = this.map.reflectors.get(tileIndex)!;
    this.onReflectorPlaced?.(placement);
    return true;
  }

  removeReflector(playerId: number, x: number, y: number): boolean {
    const tileIndex = x + y * 100;
    const queue = this.reflectorQueues.get(playerId)!;
    const queueIdx = queue.indexOf(tileIndex);
    if (queueIdx === -1) return false;

    queue.splice(queueIdx, 1);
    const removed = this.map.removeReflector(x, y);
    if (removed) {
      this.onReflectorRemoved?.(x, y, playerId);
    }
    return removed !== undefined;
  }

  placeWall(playerId: number, x: number, y: number): boolean {
    const counts = this.itemCounts.get(playerId)!;
    if (counts.wall <= 0) return false;

    // 빈 타일이어야 하고 반사판/스폰포인트가 없어야 함
    const tile = this.map.getTile(x, y);
    if (!tile || !tile.isReflectorSetable) return false;
    if (this.map.reflectors.has(x + y * 100)) return false;
    if (this.walls.has(`${x},${y}`)) return false;
    if (this.spawnPoints.some(s => s.tile.x === x && s.tile.y === y)) return false;

    counts.wall -= 1;
    const wall: WallState = { x, y, hp: this.config.wallHp, maxHp: this.config.wallHp, ownerId: playerId };
    this.walls.set(`${x},${y}`, wall);
    this.onWallPlaced?.({ x, y, hp: wall.hp, maxHp: wall.maxHp, playerId });
    return true;
  }

  useTimeStop(playerId: number): boolean {
    const counts = this.itemCounts.get(playerId)!;
    if (counts.timeStop <= 0) return false;
    if (this.isTimeStopped) return false;

    counts.timeStop -= 1;
    this.isTimeStopped = true;
    this.timeStopRemaining = this.config.timeStopDuration;
    this.onTimeStopStarted?.({ playerId, duration: this.config.timeStopDuration });
    return true;
  }

  getSpawnPoint(id: number): SpawnPointModel | undefined {
    return this.spawnPoints.find(s => s.id === id);
  }
}
