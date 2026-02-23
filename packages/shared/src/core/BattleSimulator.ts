import { MapModel, ReflectorPlacement } from './MapModel';
import { BallSimulator } from './BallSimulator';
import { SpawnPointModel, CoreModel } from './SpawnPointModel';
import { TileModel } from './TileModel';
import { BallModel } from './BallModel';
import { MonsterModel } from './MonsterModel';
import { DroppedItemModel, DropItemType } from './ItemModel';
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
  maxReflectorsPerPlayer: number;  // 플레이어당 반사판 보드 한도 (기본 5)
  reflectorCooldown: number;       // 반사판 1개 재생성 시간 (초, 기본 3.0)
  maxReflectorStock: number;       // 반사판 최대 보유 수 (기본 5)
  initialReflectorStock: number;   // 게임 시작 초기 보유 수 (기본 3)
  spawnHp: number;          // SpawnPoint 기본 HP
  coreHp: number;           // Core 기본 HP
  maxWallsPerPlayer: number;       // 플레이어당 성벽 아이템 사용 횟수 (기본 3)
  wallHp: number;           // 성벽 HP (기본 10)
  timeStopUsesPerPlayer: number;   // 시간 정지 사용 횟수 (기본 1)
  timeStopDuration: number; // 시간 정지 지속 시간 초 (기본 5)
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  spawnInterval: 5.0,
  timePerPhase: 0.2,
  maxReflectorsPerPlayer: 5,
  reflectorCooldown: 3.0,
  maxReflectorStock: 5,
  initialReflectorStock: 3,
  spawnHp: 7,
  coreHp: 15,
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
  private _phaseNumber: number = 0;
  get phaseNumber(): number { return this._phaseNumber; }
  private static readonly SPEED_RAMP_TURNS = 10; // 10턴 후 정상 속도 도달
  // 반사판 스톡 & 쿨다운
  private reflectorStocks: Map<number, number> = new Map();   // playerId → stock
  private reflectorCooldownTimers: Map<number, number> = new Map(); // playerId → elapsed(초)
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
  // 스폰 파괴 횟수 (spawnId → 횟수) — 리스폰 시간 계산용
  private spawnDestroyCount: Map<number, number> = new Map();
  static readonly SPAWN_RESPAWN_BASE = 20;   // 첫 파괴: 20초
  static readonly SPAWN_RESPAWN_INC  = 5;    // 이후 매 파괴마다 +5초

  // 이벤트
  onSpawnHpChanged?: (event: SpawnEvent) => void;
  onSpawnDestroyed?: (spawnId: number, respawnDuration: number) => void;
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
  onSpawnPhaseComplete?: (phaseNumber: number) => void;
  onReflectorStockChanged?: (playerId: number, stock: number, cooldownElapsed: number) => void;
  onMonsterSpawned?: (id: number, x: number, y: number, hp: number, maxHp: number) => void;
  onMonsterDamaged?: (id: number, hp: number, maxHp: number) => void;
  onMonsterKilled?: (id: number, x: number, y: number) => void;
  onMonsterMoved?: (id: number, fromX: number, fromY: number, toX: number, toY: number) => void;
  onItemDropped?: (itemId: number, x: number, y: number, itemType: DropItemType) => void;
  onItemPickedUp?: (itemId: number, ballId: number, ballOwnerId: number) => void;
  onBallPoweredUp?: (ballId: number, ownerId: number) => void;
  onSpawnHealed?: (event: { spawnId: number; hp: number; maxHp: number; ownerId: number }) => void;
  onCoreHealed?: (event: { coreId: number; hp: number; maxHp: number; ownerId: number }) => void;

  private monsters: MonsterModel[][] = [[], []];
  private monsterGeneration: number[] = [0, 0];
  private static readonly MAX_MONSTERS_PER_ZONE = 3;
  private nextMonsterId: number = 1;
  private droppedItems: Map<string, DroppedItemModel> = new Map();
  private nextItemId: number = 1;
  private playerBasePower: number[] = [1, 1];

  getMonsters(): MonsterModel[] {
    return [...this.monsters[0], ...this.monsters[1]];
  }

  // 타워별 순차 발사 큐 (spawnId → 발사 대기 목록)
  private spawnQueues: Map<number, { tile: TileModel; direction: Direction; ownerId: number }[]> = new Map();
  private lastSimPhase: number = -1; // 마지막으로 공을 발사한 시뮬레이터 페이즈

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

  getWalls(): WallState[] {
    return Array.from(this.walls.values());
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
    this._phaseNumber = 0;
    this.spawnRespawnTimers.clear();
    this.spawnDestroyCount.clear();
    this.reflectorStocks.clear();
    this.reflectorCooldownTimers.clear();
    for (const playerId of this.reflectorQueues.keys()) {
      this.reflectorStocks.set(playerId, this.config.initialReflectorStock);
      this.reflectorCooldownTimers.set(playerId, 0);
    }
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

    // 몬스터 초기화
    this.monsters = [[], []];
    this.monsterGeneration = [0, 0];
    this.nextMonsterId = 1;
    this.droppedItems.clear();
    this.nextItemId = 1;
    this.playerBasePower = [1, 1];

    // 중앙 라인(x=6) 초기 벽 배치
    const centerWalls: { y: number; hp: number }[] = [
      { y: 0, hp: 10_000_000 },
      { y: 1, hp:  1_000_000 },
      { y: 2, hp:    100_000 },
      { y: 3, hp:     10_000 },
      { y: 4, hp:        100 },
      { y: 5, hp:      1_000 },
      { y: 6, hp:     10_000 },
      { y: 7, hp:    100_000 },
      { y: 8, hp:  1_000_000 },
    ];
    for (const { y, hp } of centerWalls) {
      const wall: WallState = { x: 6, y, hp, maxHp: hp, ownerId: -1 };
      this.walls.set(`6,${y}`, wall);
    }

    // 각 플레이어 진영에 몬스터 3마리씩 생성
    for (let pid = 0; pid < 2; pid++) {
      for (let i = 0; i < BattleSimulator.MAX_MONSTERS_PER_ZONE; i++) {
        const tile = this.pickRandomEmptyTile(pid);
        if (tile) {
          const m = new MonsterModel(this.nextMonsterId++, tile.x, tile.y, Math.ceil(Math.pow(1.2, this.monsterGeneration[pid])));
          this.monsters[pid].push(m);
          this.onMonsterSpawned?.(m.id, m.x, m.y, m.hp, m.maxHp);
        }
      }
    }

    // BallSimulator 이벤트 연결
    this.simulator.onBallCreated = (ball, dir) => this.onBallCreated?.(ball, dir);
    this.simulator.onBallMoved = (ball, from, to) => this.onBallMoved?.(ball, from, to);
    this.simulator.onBallEnded = (ball, tile, reason) => this.onBallEnded?.(ball, tile, reason);

    // 공이 타일에 도착할 때 충돌 처리
    this.simulator.onBallArrivedAtTile = (ball, tile) => {
      // 1. 아이템 픽업 (공 계속 진행, 캡처 안 됨)
      const itemKey = `${tile.x},${tile.y}`;
      const item = this.droppedItems.get(itemKey);
      if (item && !item.pickedUp) {
        item.pickedUp = true;
        this.droppedItems.delete(itemKey);
        if (item.itemType === DropItemType.PowerUp) {
          this.playerBasePower[ball.ownerId]++;
          for (const inst of this.simulator.instances) {
            if (inst.ball.ownerId === ball.ownerId) {
              inst.ball.power = this.playerBasePower[ball.ownerId];
            }
          }
          ball.power = this.playerBasePower[ball.ownerId];
          this.onBallPoweredUp?.(ball.id, ball.ownerId);
        }
        this.onItemPickedUp?.(item.id, ball.id, ball.ownerId);
      }

      // 2. 몬스터 체크
      for (let pid = 0; pid < 2; pid++) {
        const idx = this.monsters[pid].findIndex(m => m.active && m.x === tile.x && m.y === tile.y);
        if (idx === -1) continue;
        const monster = this.monsters[pid][idx];
        monster.damage(ball.power);
        if (!monster.active) {
          this.onMonsterKilled?.(monster.id, monster.x, monster.y);
          this.spawnItemAt(monster.x, monster.y);
          // 즉시 리젠
          this.monsterGeneration[pid]++;
          const newHp = Math.ceil(Math.pow(1.2, this.monsterGeneration[pid]));
          const spawnTile = this.pickRandomEmptyTile(pid);
          if (spawnTile) {
            const m = new MonsterModel(this.nextMonsterId++, spawnTile.x, spawnTile.y, newHp);
            this.monsters[pid][idx] = m;
            this.onMonsterSpawned?.(m.id, m.x, m.y, m.hp, m.maxHp);
          } else {
            this.monsters[pid].splice(idx, 1); // 빈 자리 정리
          }
        } else {
          this.onMonsterDamaged?.(monster.id, monster.hp, monster.maxHp);
        }
        return true; // 공 소멸
      }

      // 3. 성벽 체크
      const wallKey = `${tile.x},${tile.y}`;
      const wall = this.walls.get(wallKey);
      if (wall) {
        wall.hp -= ball.power;
        if (wall.hp <= 0) {
          this.walls.delete(wallKey);
          this.onWallDestroyed?.(tile.x, tile.y);
        } else {
          this.onWallDamaged?.({ x: tile.x, y: tile.y, hp: wall.hp });
        }
        return true; // 공 캡처
      }

      // 4. 스폰포인트 체크 (소유권 기반)
      const sp = this.spawnPoints.find(s => s.tile.x === tile.x && s.tile.y === tile.y);
      if (sp && sp.active) {
        if (ball.ownerId === sp.ownerId) {
          // 아군 공 → 힐
          sp.heal(ball.power);
          this.onSpawnHealed?.({ spawnId: sp.id, hp: sp.hp, maxHp: sp.maxHp, ownerId: sp.ownerId });
        } else {
          // 적 공 → 데미지
          sp.damage(ball.power);
          if (!sp.active) {
            const count = (this.spawnDestroyCount.get(sp.id) ?? 0) + 1;
            this.spawnDestroyCount.set(sp.id, count);
            const respawnDelay = BattleSimulator.SPAWN_RESPAWN_BASE + (count - 1) * BattleSimulator.SPAWN_RESPAWN_INC;
            this.spawnRespawnTimers.set(sp.id, respawnDelay);
            this.onSpawnDestroyed?.(sp.id, respawnDelay);
            this.trimReflectorsForPlayer(sp.ownerId);
          }
          this.onSpawnHpChanged?.({ spawnId: sp.id, hp: sp.hp, ownerId: sp.ownerId });
        }
        return true; // 공 캡처
      }

      // 5. 코어 체크 (소유권 기반)
      const core = this.cores.find(c => c.tile.x === tile.x && c.tile.y === tile.y);
      if (core && core.active) {
        if (ball.ownerId === core.ownerId) {
          // 아군 공 → 힐
          core.heal(ball.power);
          this.onCoreHealed?.({ coreId: core.id, hp: core.hp, maxHp: core.maxHp, ownerId: core.ownerId });
        } else {
          // 적 공 → 데미지
          core.damage(ball.power);
          this.onCoreHpChanged?.({ coreId: core.id, hp: core.hp, ownerId: core.ownerId });
          if (!core.active) {
            this.onCoreDestroyed?.(core.id);
            this.checkWinCondition();
          }
        }
        return true; // 공 캡처
      }

      return false;
    };

    // BallSimulator 배틀 모드 초기화 (bracket notation 제거)
    this.simulator.initForBattle(this.config.timePerPhase);

    // 첫 틱에서 바로 발사되도록 타이머를 가득 채움 (MATCH_FOUND 이후 발사 보장)
    this.spawnTimer = this.config.spawnInterval;
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
      // 페이즈 변경 시 다음 큐 발사 (페이즈 경계에 맞춰 발사 → 겹침 방지)
      const currPhase = this.simulator.currentPhaseCount;
      if (currPhase > this.lastSimPhase) {
        this.lastSimPhase = currPhase;
        this.fireNextQueuedBalls();
      }
      // 종료된 인스턴스 정리 + 페이즈 카운터 리셋 (maxPhaseLimit 초과 방지)
      if (allEnded) {
        this.simulator.instances = [];
        this.simulator.resetPhaseCounters();
        this.lastSimPhase = -1;
      }
    }

    // 스폰 타이머
    this.spawnTimer += delta;
    if (this.spawnTimer >= this.config.spawnInterval) {
      this.spawnTimer = 0;
      this.spawnAll();
    }

    // 반사판 쿨다운 타이머
    for (const [playerId, elapsed] of this.reflectorCooldownTimers) {
      const stock = this.reflectorStocks.get(playerId) ?? 0;
      if (stock >= this.config.maxReflectorStock) {
        // 스톡이 가득 차면 타이머 정지
        if (elapsed !== 0) {
          this.reflectorCooldownTimers.set(playerId, 0);
          this.onReflectorStockChanged?.(playerId, stock, 0);
        }
        continue;
      }
      const newElapsed = elapsed + delta;
      if (newElapsed >= this.config.reflectorCooldown) {
        const newStock = stock + 1;
        this.reflectorStocks.set(playerId, newStock);
        const carry = newElapsed - this.config.reflectorCooldown;
        this.reflectorCooldownTimers.set(playerId, newStock >= this.config.maxReflectorStock ? 0 : carry);
        this.onReflectorStockChanged?.(playerId, newStock, carry);
      } else {
        this.reflectorCooldownTimers.set(playerId, newElapsed);
      }
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
    this._phaseNumber++;
    const ballCount = Math.floor(this._phaseNumber / 5) + 1;

    // 플레이어별 모든 몬스터 이동
    const CARDINAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const allMonsters = this.getMonsters();
    for (let pid = 0; pid < 2; pid++) {
      for (const monster of this.monsters[pid]) {
        if (!monster.active) continue;
        const validMoves: { x: number; y: number }[] = [];
        for (const [dx, dy] of CARDINAL) {
          const nx = monster.x + dx;
          const ny = monster.y + dy;
          const tile = this.map.getTile(nx, ny);
          if (!tile || !tile.isReflectorSetable) continue;
          if (pid === 0 && nx >= 6) continue; // P1은 x<6 유지
          if (pid === 1 && nx <= 6) continue; // P2는 x>6 유지
          if (this.spawnPoints.some(s => s.tile.x === nx && s.tile.y === ny)) continue;
          if (this.cores.some(c => c.tile.x === nx && c.tile.y === ny)) continue;
          if (this.walls.has(`${nx},${ny}`)) continue;
          if (this.droppedItems.has(`${nx},${ny}`)) continue;
          if (this.map.reflectors.has(nx + ny * 100)) continue;
          if (allMonsters.some(m => m.active && m !== monster && m.x === nx && m.y === ny)) continue;
          validMoves.push({ x: nx, y: ny });
        }
        if (validMoves.length > 0 && Math.random() < 0.5) {
          const next = validMoves[Math.floor(Math.random() * validMoves.length)];
          const fromX = monster.x;
          const fromY = monster.y;
          monster.x = next.x;
          monster.y = next.y;
          this.onMonsterMoved?.(monster.id, fromX, fromY, next.x, next.y);
        }
      }
    }

    // 속도 점진 증가: 1턴=2배 느림, 10턴마다 10% 빨라져 10턴 후 정상 속도
    const ramp = BattleSimulator.SPEED_RAMP_TURNS;
    const t = this.config.timePerPhase;
    const effectiveTimePerPhase = Math.max(t, t * 2 - (this._phaseNumber - 1) * (t / ramp));
    this.simulator.setTimePerPhase(effectiveTimePerPhase);

    // 타워별 큐에 추가 (페이즈 경계마다 1발씩 순차 발사 → 겹침 방지)
    for (const sp of this.spawnPoints) {
      if (!sp.active) continue;
      const queue = this.spawnQueues.get(sp.id) ?? [];
      for (let i = 0; i < ballCount; i++) {
        queue.push({ tile: sp.tile, direction: sp.spawnDirection, ownerId: sp.ownerId });
      }
      this.spawnQueues.set(sp.id, queue);
    }

    this.onSpawnPhaseComplete?.(this._phaseNumber);

    // 인스턴스가 없으면 첫 공을 즉시 발사 (이후 공은 페이즈 변경 시 자동 발사)
    if (this.simulator.instances.length === 0) {
      this.fireNextQueuedBalls();
      this.lastSimPhase = this.simulator.currentPhaseCount;
    }
  }

  /** 각 타워 큐에서 공 한 발씩 발사 */
  private fireNextQueuedBalls(): void {
    for (const queue of this.spawnQueues.values()) {
      if (queue.length > 0) {
        const entry = queue.shift()!;
        const inst = this.simulator.spawnBall(entry.tile, entry.direction, entry.ownerId);
        if (inst) inst.ball.power = this.playerBasePower[entry.ownerId];
      }
    }
  }

  private pickRandomEmptyTile(playerId: number): { x: number; y: number } | null {
    const width = this.map.width;
    const height = this.map.height;
    const occupied = new Set<string>();
    const CARDINAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const sp of this.spawnPoints) {
      occupied.add(`${sp.tile.x},${sp.tile.y}`);
      for (const [dx, dy] of CARDINAL) {
        occupied.add(`${sp.tile.x + dx},${sp.tile.y + dy}`);
      }
    }
    for (const core of this.cores) occupied.add(`${core.tile.x},${core.tile.y}`);
    for (const key of this.walls.keys()) occupied.add(key);
    for (const key of this.droppedItems.keys()) occupied.add(key);
    for (const m of this.getMonsters()) {
      if (m.active) occupied.add(`${m.x},${m.y}`);
    }

    // P1(0): x=0~5, P2(1): x=7~(width-1)
    const xMin = playerId === 0 ? 0 : 7;
    const xMax = playerId === 0 ? 5 : width - 1;

    const candidates: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const tile = this.map.getTile(x, y);
        if (!tile || !tile.isReflectorSetable) continue;
        if (occupied.has(`${x},${y}`)) continue;
        if (this.map.reflectors.has(x + y * 100)) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
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

  /** 현재 유효 반사판 최대 슬롯 (파괴된 아군 스폰 수만큼 감소) */
  getEffectiveMaxReflectors(playerId: number): number {
    const destroyed = this.spawnPoints.filter(sp => sp.ownerId === playerId && !sp.active).length;
    return Math.max(0, this.config.maxReflectorsPerPlayer - destroyed);
  }

  /** 타워 파괴 시 초과 반사판(마지막 배치순) 제거 */
  private trimReflectorsForPlayer(playerId: number): void {
    const queue = this.reflectorQueues.get(playerId);
    if (!queue) return;
    const effectiveMax = this.getEffectiveMaxReflectors(playerId);
    while (queue.length > effectiveMax) {
      const removedIndex = queue.pop()!;
      const rx = removedIndex % 100;
      const ry = Math.floor(removedIndex / 100);
      const removed = this.map.removeReflector(rx, ry);
      if (removed) this.onReflectorRemoved?.(rx, ry, playerId);
    }
  }

  /** (x,y)가 playerId에게 적 스폰타일 상하좌우 인접 1칸인지 확인 */
  isEnemySpawnZone(playerId: number, x: number, y: number): boolean {
    for (const sp of this.spawnPoints) {
      if (sp.ownerId === playerId) continue; // 아군 스폰은 무시
      if (!sp.active) continue; // 파괴된 스폰은 보호 구역 없음
      const dx = Math.abs(sp.tile.x - x);
      const dy = Math.abs(sp.tile.y - y);
      if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) return true; // 상하좌우만
    }
    return false;
  }

  placeReflector(playerId: number, x: number, y: number, type: ReflectorType): boolean {
    if (this.isEnemySpawnZone(playerId, x, y)) return false;
    if (this.getMonsters().some(m => m.active && m.x === x && m.y === y)) return false;

    const queue = this.reflectorQueues.get(playerId)!;
    const tileIndex = x + y * 100;
    const isReplacing = queue.includes(tileIndex);

    // 새 배치는 스톡 필요
    if (!isReplacing) {
      const stock = this.reflectorStocks.get(playerId) ?? 0;
      if (stock <= 0) return false;
    }

    // 보드 한도 초과 시 가장 오래된 반사판 자동 제거 (FIFO)
    if (!isReplacing && queue.length >= this.getEffectiveMaxReflectors(playerId)) {
      const oldestIndex = queue.shift()!;
      const ox = oldestIndex % 100;
      const oy = Math.floor(oldestIndex / 100);
      const removed = this.map.removeReflector(ox, oy);
      if (removed) this.onReflectorRemoved?.(ox, oy, playerId);
    }

    const success = this.map.placeReflector(x, y, type, playerId);
    if (!success) return false;

    if (!isReplacing) {
      queue.push(tileIndex);
      // 스톡 차감
      const newStock = (this.reflectorStocks.get(playerId) ?? 1) - 1;
      this.reflectorStocks.set(playerId, newStock);
      const elapsed = this.reflectorCooldownTimers.get(playerId) ?? 0;
      this.onReflectorStockChanged?.(playerId, newStock, elapsed);
    }

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

  private spawnItemAt(x: number, y: number): void {
    const item = new DroppedItemModel(this.nextItemId++, x, y, DropItemType.PowerUp);
    this.droppedItems.set(`${x},${y}`, item);
    this.onItemDropped?.(item.id, x, y, item.itemType);
  }

  getSpawnPoint(id: number): SpawnPointModel | undefined {
    return this.spawnPoints.find(s => s.id === id);
  }
}
