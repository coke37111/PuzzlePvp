import { MapModel, ReflectorPlacement } from './MapModel';
import { BallSimulator } from './BallSimulator';
import { SpawnPointModel, CoreModel } from './SpawnPointModel';
import { TileModel } from './TileModel';
import { BallModel } from './BallModel';
import { MonsterModel, MonsterType } from './MonsterModel';
import { DroppedItemModel, DropItemType } from './ItemModel';
import { Direction } from '../enums/Direction';
import { ReflectorType } from '../enums/ReflectorType';
import { EndReason } from '../enums/EndReason';
import type { SpawnAssignment, CoreAssignment, ZoneWallSegment, PlayerZone } from './MapLayout';
import { TowerBoxModel } from './TowerBoxModel';

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
  initialBallPower: number; // 공 초기 공격력 (기본 3)
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
  initialBallPower: 3,
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

  // N인 지원 필드
  private playerIds: number[] = [0, 1];
  private playerZoneBounds: Map<number, { xMin: number; xMax: number; yMin: number; yMax: number }> = new Map();
  private playerZones: Map<number, PlayerZone> = new Map();
  private towerBoxes: Map<number, TowerBoxModel> = new Map();  // spawnId → box

  // 이벤트
  onSpawnHpChanged?: (event: SpawnEvent) => void;
  onSpawnDestroyed?: (spawnId: number, respawnDuration: number) => void;
  onSpawnRespawned?: (spawnId: number, hp: number) => void;
  onReflectorPlaced?: (placement: ReflectorPlacement) => void;
  onReflectorRemoved?: (x: number, y: number, playerId: number) => void;
  onGameOver?: (result: BattleResult) => void;
  onBallCreated?: (ball: BallModel, direction: Direction) => void;
  onBallMoved?: (ball: BallModel, from: TileModel, to: TileModel) => void;
  onBallEnded?: (ball: BallModel, tile: TileModel, reason: EndReason, direction: Direction) => void;
  onWallPlaced?: (event: WallEvent & { playerId: number; maxHp: number }) => void;
  onWallDamaged?: (event: WallEvent) => void;
  onWallDestroyed?: (x: number, y: number) => void;
  onTimeStopStarted?: (event: TimeStopEvent) => void;
  onTimeStopEnded?: () => void;
  onCoreHpChanged?: (event: CoreEvent) => void;
  onCoreDestroyed?: (coreId: number) => void;
  onSpawnPhaseComplete?: (phaseNumber: number) => void;
  onReflectorStockChanged?: (playerId: number, stock: number, cooldownElapsed: number) => void;
  onMonsterSpawned?: (id: number, monsterType: MonsterType, x: number, y: number, hp: number, maxHp: number) => void;
  onMonsterDamaged?: (id: number, hp: number, maxHp: number) => void;
  onMonsterKilled?: (id: number, x: number, y: number) => void;
  onMonsterMoved?: (id: number, fromX: number, fromY: number, toX: number, toY: number) => void;
  onItemDropped?: (itemId: number, x: number, y: number, itemType: DropItemType) => void;
  onItemPickedUp?: (itemId: number, ballId: number, ballOwnerId: number) => void;
  onBallPoweredUp?: (ballId: number, ownerId: number) => void;
  onPlayerBallCountUp?: (playerId: number, ballCountBonus: number) => void;
  onPlayerSpeedUp?: (playerId: number, speedBonus: number) => void;
  onPlayerReflectorExpand?: (playerId: number, reflectorBonus: number) => void;
  onSpawnHealed?: (event: { spawnId: number; hp: number; maxHp: number; ownerId: number }) => void;
  onCoreHealed?: (event: { coreId: number; hp: number; maxHp: number; ownerId: number }) => void;
  onTowerBoxDamaged?: (spawnId: number, hp: number, maxHp: number) => void;
  onTowerBoxBroken?: (spawnId: number) => void;
  onOwnershipTransferred?: (oldOwnerId: number, newOwnerId: number, coreId: number, coreHp: number, coreMaxHp: number, spawnTransfers: { spawnId: number; hp: number; maxHp: number; active: boolean }[]) => void;
  onPlayerEliminated?: (playerId: number, teamId: number, remainingPlayers: number) => void;

  /** 카메라 연출 동안 게임 시작 지연 (초) */
  static readonly PRE_GAME_DELAY = 4.0;

  private monsters: Map<number, MonsterModel[]> = new Map();
  private monsterGeneration: Map<number, number> = new Map();
  private static readonly MAX_MONSTERS_PER_ZONE = 3;
  private nextMonsterId: number = 1;
  private droppedItems: Map<string, DroppedItemModel> = new Map();
  private nextItemId: number = 1;
  private playerBasePower: Map<number, number> = new Map();
  private playerBallCountBonus: Map<number, number> = new Map();    // White 몬스터 드랍: 페이즈당 추가 공 수
  private playerSpeedMultiplier: Map<number, number> = new Map();   // LightBlue 몬스터 드랍: 공 이동 속도 배율
  private playerReflectorBonus: Map<number, number> = new Map();    // Purple 몬스터 드랍: 보드 반사판 최대 갯수 보너스

  getMonsters(): MonsterModel[] {
    const all: MonsterModel[] = [];
    for (const list of this.monsters.values()) all.push(...list);
    return all;
  }

  // 타워별 순차 발사 큐 (spawnId → 발사 대기 목록)
  private spawnQueues: Map<number, { tile: TileModel; direction: Direction; ownerId: number }[]> = new Map();
  private lastSimPhase: number = -1; // 마지막으로 공을 발사한 시뮬레이터 페이즈

  constructor(map: MapModel, config: Partial<BattleConfig> = {}) {
    this.map = map;
    this.config = { ...DEFAULT_BATTLE_CONFIG, ...config };
    this.simulator = new BallSimulator(map);

    // 반사판 큐, 아이템 초기화
    for (const pid of this.playerIds) {
      this.reflectorQueues.set(pid, []);
      this.itemCounts.set(pid, { wall: this.config.maxWallsPerPlayer, timeStop: this.config.timeStopUsesPerPlayer });
    }
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

  getTowerBoxes(): TowerBoxModel[] {
    return Array.from(this.towerBoxes.values());
  }

  getDroppedItemPositions(): { x: number; y: number }[] {
    return Array.from(this.droppedItems.values())
      .filter(item => !item.pickedUp)
      .map(item => ({ x: item.x, y: item.y }));
  }

  getDroppedItems(): DroppedItemModel[] {
    return Array.from(this.droppedItems.values()).filter(item => !item.pickedUp);
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

    // 몬스터 & 아이템 초기화 (N인 지원 Map)
    this.monsters.clear();
    this.monsterGeneration.clear();
    this.playerBasePower.clear();
    this.playerBallCountBonus.clear();
    this.playerSpeedMultiplier.clear();
    this.playerReflectorBonus.clear();
    for (const pid of this.playerIds) {
      this.monsters.set(pid, []);
      this.monsterGeneration.set(pid, 0);
      this.playerBasePower.set(pid, this.config.initialBallPower);
      this.playerBallCountBonus.set(pid, 0);
      this.playerSpeedMultiplier.set(pid, 1.0);
      this.playerReflectorBonus.set(pid, 0);
    }
    this.nextMonsterId = 1;
    this.droppedItems.clear();
    this.nextItemId = 1;
    this.towerBoxes.clear();

    // 항상 assignments 기반 초기화 (N:N 포함 2인도 동일 경로)
    const raw = this.map.rawData!;
    this.initFromAssignments(raw.spawnAssignments!, raw.coreAssignments!, raw.zoneWalls ?? []);

    // BallSimulator 이벤트 연결
    this.simulator.onBallCreated = (ball, dir) => this.onBallCreated?.(ball, dir);
    this.simulator.onBallMoved = (ball, from, to) => this.onBallMoved?.(ball, from, to);
    this.simulator.onBallEnded = (ball, tile, reason, direction) => this.onBallEnded?.(ball, tile, reason, direction);

    // 공이 타일에 도착할 때 충돌 처리
    this.simulator.onBallArrivedAtTile = (ball, tile) => {
      // 1. 아이템 픽업 (공 계속 진행, 캡처 안 됨)
      const itemKey = `${tile.x},${tile.y}`;
      const item = this.droppedItems.get(itemKey);
      if (item && !item.pickedUp) {
        item.pickedUp = true;
        this.droppedItems.delete(itemKey);
        if (item.itemType === DropItemType.PowerUp) {
          const newPower = (this.playerBasePower.get(ball.ownerId) ?? 1) + 1;
          this.playerBasePower.set(ball.ownerId, newPower);
          for (const inst of this.simulator.instances) {
            if (inst.ball.ownerId === ball.ownerId) {
              inst.ball.power = newPower;
            }
          }
          ball.power = newPower;
          this.onBallPoweredUp?.(ball.id, ball.ownerId);
        } else if (item.itemType === DropItemType.BallCount) {
          const newCount = (this.playerBallCountBonus.get(ball.ownerId) ?? 0) + 1;
          this.playerBallCountBonus.set(ball.ownerId, newCount);
          this.onPlayerBallCountUp?.(ball.ownerId, newCount);
        } else if (item.itemType === DropItemType.SpeedUp) {
          const newSpeed = (this.playerSpeedMultiplier.get(ball.ownerId) ?? 1.0) + 0.05;
          this.playerSpeedMultiplier.set(ball.ownerId, newSpeed);
          this.onPlayerSpeedUp?.(ball.ownerId, newSpeed);
        } else if (item.itemType === DropItemType.ReflectorExpand) {
          const newBonus = (this.playerReflectorBonus.get(ball.ownerId) ?? 0) + 1;
          this.playerReflectorBonus.set(ball.ownerId, newBonus);
          this.onPlayerReflectorExpand?.(ball.ownerId, newBonus);
        }
        this.onItemPickedUp?.(item.id, ball.id, ball.ownerId);
      }

      // 2. 몬스터 체크
      for (const pid of this.playerIds) {
        const monsterList = this.monsters.get(pid) ?? [];
        const idx = monsterList.findIndex(m => m.active && m.x === tile.x && m.y === tile.y);
        if (idx === -1) continue;
        const monster = monsterList[idx];
        const monsterHpBefore = monster.hp;
        monster.damage(ball.power);
        if (!monster.active) {
          this.onMonsterKilled?.(monster.id, monster.x, monster.y);
          this.spawnItemAt(monster.x, monster.y, monster.type);
          // 즉시 리젠 (확률로 새 타입 결정)
          const gen = (this.monsterGeneration.get(pid) ?? 0) + 1;
          this.monsterGeneration.set(pid, gen);
          const newHp = Math.ceil(Math.pow(1.1, gen));
          const spawnTile = this.pickRandomEmptyTile(pid);
          if (spawnTile) {
            const newType = this.pickRandomMonsterType();
            const m = new MonsterModel(this.nextMonsterId++, newType, spawnTile.x, spawnTile.y, newHp);
            monsterList[idx] = m;
            this.onMonsterSpawned?.(m.id, m.type, m.x, m.y, m.hp, m.maxHp);
          } else {
            monsterList.splice(idx, 1); // 빈 자리 정리
          }
          // 관통: 남은 공격력으로 계속 진행
          ball.power -= monsterHpBefore;
          if (ball.power <= 0) return true; // 공 소멸
          // ball.power > 0이면 관통 (공 계속)
        } else {
          this.onMonsterDamaged?.(monster.id, monster.hp, monster.maxHp);
          return true; // 공 소멸
        }
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

      // 4a. 타워 박스 체크 (잠긴 타워 → 박스가 있으면 박스에 데미지)
      if (sp && !sp.active) {
        const box = this.towerBoxes.get(sp.id);
        if (box && !box.broken) {
          const destroyed = box.damage(ball.power);
          this.onTowerBoxDamaged?.(sp.id, box.hp, box.maxHp);
          if (destroyed) {
            this.onTowerBoxBroken?.(sp.id);
            // 타워 활성화
            sp.active = true;
            sp.hp = this.config.spawnHp;
            sp.maxHp = this.config.spawnHp;
            this.onSpawnRespawned?.(sp.id, sp.hp);
          }
          return true; // 공 캡처
        }
      }

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
            // 파괴된 스폰의 발사 대기 큐 클리어 (이미 큐잉된 공이 계속 나오는 버그 방지)
            this.spawnQueues.set(sp.id, []);
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
            this.transferOwnership(core, ball.ownerId);
          }
        }
        return true; // 공 캡처
      }

      return false;
    };

    // BallSimulator 배틀 모드 초기화 (bracket notation 제거)
    this.simulator.initForBattle(this.config.timePerPhase);

    // Pre-game delay: 카메라 연출(2초 전체맵 + 1초 포커싱 + 1초 대기) 후 첫 발사
    this.spawnTimer = -BattleSimulator.PRE_GAME_DELAY;
  }

  /** N인 초기화 — spawnAssignments/coreAssignments 기반 */
  private initFromAssignments(
    spawns: SpawnAssignment[],
    cores: CoreAssignment[],
    zoneWalls: ZoneWallSegment[],
  ): void {
    const raw = this.map.rawData;
    const layout = raw?.layout;

    // 플레이어 IDs 및 존 경계 설정
    if (layout) {
      this.playerIds = layout.zones.map(z => z.playerId);
      for (const zone of layout.zones) {
        this.playerZones.set(zone.playerId, zone);
        this.playerZoneBounds.set(zone.playerId, {
          xMin: zone.originX,
          xMax: zone.originX + zone.width - 1,
          yMin: zone.originY,
          yMax: zone.originY + zone.height - 1,
        });
      }
      // 새 플레이어에 대한 모든 per-player 맵 초기화 (init()이 [0,1]로만 설정했을 수 있음)
      for (const pid of this.playerIds) {
        if (!this.monsters.has(pid)) {
          this.monsters.set(pid, []);
          this.monsterGeneration.set(pid, 0);
          this.playerBasePower.set(pid, this.config.initialBallPower);
          this.playerBallCountBonus.set(pid, 0);
          this.playerSpeedMultiplier.set(pid, 1.0);
          this.playerReflectorBonus.set(pid, 0);
        }
        if (!this.reflectorQueues.has(pid)) {
          this.reflectorQueues.set(pid, []);
        }
        if (!this.itemCounts.has(pid)) {
          this.itemCounts.set(pid, { wall: this.config.maxWallsPerPlayer, timeStop: this.config.timeStopUsesPerPlayer });
        }
        if (!this.reflectorStocks.has(pid)) {
          this.reflectorStocks.set(pid, this.config.initialReflectorStock);
          this.reflectorCooldownTimers.set(pid, 0);
        }
      }
    }

    // 코어 생성
    for (const ca of cores) {
      const tile = this.map.getTile(ca.x, ca.y);
      if (!tile) continue;
      const core = new CoreModel(this.nextCoreId++, tile, ca.ownerId, this.config.coreHp);
      this.cores.push(core);
    }

    // 스폰 생성
    for (const sa of spawns) {
      const tile = this.map.getTile(sa.x, sa.y);
      if (!tile) continue;
      const sp = new SpawnPointModel(this.nextSpawnPointId++, tile, sa.ownerId, sa.direction, this.config.spawnHp);
      if (sa.locked) {
        sp.active = false; // 잠긴 타워는 비활성 (박스 파괴 시 활성화)
      }
      this.spawnPoints.push(sp);
      if (sa.locked && sa.boxTier > 0) {
        this.towerBoxes.set(sp.id, new TowerBoxModel(sp.id, sa.boxTier));
      }
    }

    // 존 경계 벽 배치 (WallState 시스템 활용)
    for (const zw of zoneWalls) {
      const wall: WallState = { x: zw.x, y: zw.y, hp: zw.hp, maxHp: zw.hp, ownerId: -1 };
      this.walls.set(`${zw.x},${zw.y}`, wall);
    }

    // 각 플레이어 진영에 몬스터 생성
    for (const pid of this.playerIds) {
      const monsterList = this.monsters.get(pid)!;
      for (let i = 0; i < BattleSimulator.MAX_MONSTERS_PER_ZONE; i++) {
        const tile = this.pickRandomEmptyTile(pid);
        if (tile) {
          const monsterType = this.pickRandomMonsterType();
          const gen = this.monsterGeneration.get(pid) ?? 0;
          const m = new MonsterModel(this.nextMonsterId++, monsterType, tile.x, tile.y, Math.ceil(Math.pow(1.1, gen)));
          monsterList.push(m);
          this.onMonsterSpawned?.(m.id, m.type, m.x, m.y, m.hp, m.maxHp);
        }
      }
    }
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
    const baseBallCount = 1; // 아이템으로만 증가 (자동 증가 없음)

    // 플레이어별 모든 몬스터 이동
    const CARDINAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const allMonsters = this.getMonsters();
    for (const pid of this.playerIds) {
      const monsterList = this.monsters.get(pid) ?? [];
      const bounds = this.playerZoneBounds.get(pid);
      for (const monster of monsterList) {
        if (!monster.active) continue;
        const validMoves: { x: number; y: number }[] = [];
        for (const [dx, dy] of CARDINAL) {
          const nx = monster.x + dx;
          const ny = monster.y + dy;
          const tile = this.map.getTile(nx, ny);
          if (!tile || !tile.isReflectorSetable) continue;
          // 존 경계 체크 (레거시: 중앙 x=6 기준, N인: playerZoneBounds)
          if (bounds && (nx < bounds.xMin || nx > bounds.xMax || ny < bounds.yMin || ny > bounds.yMax)) continue;
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

    // 각 존 몬스터 수 보충 (처치 후 리스폰 실패로 감소한 경우 복구)
    for (const pid of this.playerIds) {
      const monsterList = this.monsters.get(pid)!;
      const activeCount = monsterList.filter(m => m.active).length;
      const deficit = BattleSimulator.MAX_MONSTERS_PER_ZONE - activeCount;
      for (let i = 0; i < deficit; i++) {
        const tile = this.pickRandomEmptyTile(pid);
        if (!tile) break;
        const gen = this.monsterGeneration.get(pid) ?? 0;
        const m = new MonsterModel(this.nextMonsterId++, this.pickRandomMonsterType(), tile.x, tile.y, Math.ceil(Math.pow(1.1, gen)));
        monsterList.push(m);
        this.onMonsterSpawned?.(m.id, m.type, m.x, m.y, m.hp, m.maxHp);
      }
    }

    // 타워별 큐에 추가 (페이즈 경계마다 1발씩 순차 발사 → 겹침 방지)
    for (const sp of this.spawnPoints) {
      if (!sp.active) continue;
      const queue = this.spawnQueues.get(sp.id) ?? [];
      const ballCount = baseBallCount + (this.playerBallCountBonus.get(sp.ownerId) ?? 0);
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
      if (queue.length === 0) continue;
      const entry = queue.shift()!;
      const inst = this.simulator.spawnBall(entry.tile, entry.direction, entry.ownerId);
      if (inst) {
        inst.ball.power = this.playerBasePower.get(entry.ownerId) ?? 1;
        inst.ball.speedMultiplier = this.playerSpeedMultiplier.get(entry.ownerId) ?? 1.0;
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

    // 존 경계 기반 범위 (레거시: P1=0~5, P2=7~width-1)
    const bounds = this.playerZoneBounds.get(playerId);
    const xMin = bounds?.xMin ?? 0;
    const xMax = bounds?.xMax ?? (width - 1);
    const yMin = bounds?.yMin ?? 0;
    const yMax = bounds?.yMax ?? (height - 1);

    const candidates: { x: number; y: number }[] = [];
    for (let y = yMin; y <= yMax; y++) {
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

  /** 코어 파괴 시 소유권 이전: 코어 + 스폰 타워를 공격자에게 넘기고 재활성화 */
  private transferOwnership(destroyedCore: CoreModel, newOwnerId: number): void {
    const oldOwnerId = destroyedCore.ownerId;

    // 코어 소유권 이전 및 재활성화
    destroyedCore.ownerId = newOwnerId;
    destroyedCore.maxHp = this.config.coreHp;
    destroyedCore.hp = this.config.coreHp;
    destroyedCore.active = true;

    // 해당 플레이어의 모든 스폰 타워 소유권 이전
    const spawnTransfers: { spawnId: number; hp: number; maxHp: number; active: boolean }[] = [];
    for (const sp of this.spawnPoints) {
      if (sp.ownerId === oldOwnerId) {
        sp.ownerId = newOwnerId;
        // 파괴 상태인 스폰은 즉시 재활성화
        if (!sp.active) {
          sp.hp = this.config.spawnHp;
          sp.maxHp = this.config.spawnHp;
          sp.active = true;
          this.spawnRespawnTimers.delete(sp.id);
        }
        spawnTransfers.push({ spawnId: sp.id, hp: sp.hp, maxHp: sp.maxHp, active: sp.active });
      }
    }

    // 이전 주인의 반사판 제거
    const oldQueue = this.reflectorQueues.get(oldOwnerId);
    if (oldQueue) {
      for (const tileIdx of [...oldQueue]) {
        const placement = this.map.reflectors.get(tileIdx);
        if (placement) {
          this.map.reflectors.delete(tileIdx);
          this.onReflectorRemoved?.(placement.x, placement.y, oldOwnerId);
        }
      }
      oldQueue.length = 0;
    }

    // 존 소유권 이전
    const zone = this.playerZones.get(oldOwnerId);
    if (zone) {
      zone.eliminated = true;
    }

    // 콜백 알림
    this.onOwnershipTransferred?.(
      oldOwnerId, newOwnerId, destroyedCore.id,
      destroyedCore.hp, destroyedCore.maxHp, spawnTransfers,
    );

    // 승리 조건 체크
    this.checkWinCondition();
  }

  /** 플레이어 탈락 처리: 스폰/코어 비활성화 후 승리 조건 체크 */
  eliminatePlayer(playerId: number): void {
    for (const sp of this.spawnPoints) {
      if (sp.ownerId === playerId) sp.active = false;
    }
    for (const core of this.cores) {
      if (core.ownerId === playerId) core.active = false;
    }
    const zone = this.playerZones.get(playerId);
    if (zone) zone.eliminated = true;

    const alivePlayerIds = new Set<number>();
    for (const core of this.cores) {
      if (core.active) alivePlayerIds.add(core.ownerId);
    }
    const teamId = zone?.teamId ?? playerId;
    this.onPlayerEliminated?.(playerId, teamId, alivePlayerIds.size);
    this.checkWinCondition();
  }

  private checkWinCondition(): void {
    if (this.playerZones.size > 0) {
      // N인 모드: 팀 기반 체크
      const aliveTeams = new Set<number>();
      for (const core of this.cores) {
        if (core.active) {
          const z = this.playerZones.get(core.ownerId);
          if (z) aliveTeams.add(z.teamId);
        }
      }
      if (aliveTeams.size <= 1) {
        this.isRunning = false;
        const winnerTeamId = aliveTeams.size === 1 ? [...aliveTeams][0] : -1;
        this.onGameOver?.({ winnerId: winnerTeamId });
      }
    } else {
      // 레거시 1v1 경로
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
  }

  /** 현재 유효 반사판 최대 슬롯 (전투로 파괴된 아군 스폰 수만큼 감소, 아이템 보너스 포함) */
  getEffectiveMaxReflectors(playerId: number): number {
    // 잠긴 타워(박스 미파괴)는 파괴 카운트에서 제외 — 전투로 파괴된 타워만 카운트
    const destroyed = this.spawnPoints.filter(sp => {
      if (sp.ownerId !== playerId || sp.active) return false;
      const box = this.towerBoxes.get(sp.id);
      return !(box && !box.broken); // 박스가 살아있으면 잠긴 상태 → 제외
    }).length;
    return Math.max(0, this.config.maxReflectorsPerPlayer + (this.playerReflectorBonus.get(playerId) ?? 0) - destroyed);
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

  /** (x,y)가 playerId에게 적 스폰타일 발사 방향 1칸인지 확인 */
  isEnemySpawnZone(playerId: number, x: number, y: number): boolean {
    for (const sp of this.spawnPoints) {
      if (sp.ownerId === playerId) continue; // 아군 스폰은 무시
      if (!sp.active) continue; // 파괴된 스폰은 보호 구역 없음
      let tx = sp.tile.x;
      let ty = sp.tile.y;
      switch (sp.spawnDirection) {
        case Direction.Up:    ty -= 1; break;
        case Direction.Down:  ty += 1; break;
        case Direction.Left:  tx -= 1; break;
        case Direction.Right: tx += 1; break;
      }
      if (x === tx && y === ty) return true;
    }
    return false;
  }

  placeReflector(playerId: number, x: number, y: number, type: ReflectorType): boolean {
    if (this.isEnemySpawnZone(playerId, x, y)) return false;
    if (this.walls.has(`${x},${y}`)) return false;
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

  /** 확률에 따라 몬스터 타입 결정: Orange 50%, White 30%, LightBlue 19.9%, Purple 0.1% */
  private pickRandomMonsterType(): MonsterType {
    const r = Math.random() * 100;
    if (r < 0.1)  return MonsterType.Purple;    // 0.1%
    if (r < 20.0) return MonsterType.LightBlue; // 19.9%
    if (r < 50.0) return MonsterType.White;     // 30%
    return MonsterType.Orange;                   // 50%
  }

  private spawnItemAt(x: number, y: number, monsterType: MonsterType): void {
    const itemType =
      monsterType === MonsterType.White     ? DropItemType.BallCount :
      monsterType === MonsterType.LightBlue ? DropItemType.SpeedUp   :
      monsterType === MonsterType.Purple    ? DropItemType.ReflectorExpand :
                                              DropItemType.PowerUp;
    const item = new DroppedItemModel(this.nextItemId++, x, y, itemType);
    this.droppedItems.set(`${x},${y}`, item);
    this.onItemDropped?.(item.id, x, y, item.itemType);
  }

  getSpawnPoint(id: number): SpawnPointModel | undefined {
    return this.spawnPoints.find(s => s.id === id);
  }

  /** 반사판 설치 가능 여부 확인 (AI용) */
  canPlaceReflector(playerId: number, x: number, y: number): boolean {
    if (this.isEnemySpawnZone(playerId, x, y)) return false;
    if (this.walls.has(`${x},${y}`)) return false;
    if (this.getMonsters().some(m => m.active && m.x === x && m.y === y)) return false;
    const tile = this.map.getTile(x, y);
    if (!tile || !tile.isReflectorSetable) return false;
    return true;
  }

  /** 현재 반사판 스톡 반환 */
  getReflectorStock(playerId: number): number {
    return this.reflectorStocks.get(playerId) ?? 0;
  }
}
