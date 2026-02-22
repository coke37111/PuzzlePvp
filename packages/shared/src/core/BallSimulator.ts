import { TileModel } from './TileModel';
import { BallModel } from './BallModel';
import { BallSimulationInstance } from './BallSimulationInstance';
import { MapModel } from './MapModel';
import { Direction } from '../enums/Direction';
import { ReflectorType } from '../enums/ReflectorType';
import { EndReason } from '../enums/EndReason';

const DEFAULT_MAX_PHASE_LIMIT = 1000;

export interface SimulationSummary {
  isCleared: boolean;
  isLooped: boolean;
}

export type BallCreatedCallback = (ball: BallModel, direction: Direction) => void;
export type BallMovedCallback = (ball: BallModel, from: TileModel, to: TileModel) => void;
export type BallEndedCallback = (ball: BallModel, tile: TileModel, reason: EndReason) => void;
export type BallGoalInCallback = (ball: BallModel, tile: TileModel) => void;
export type SimulationEndCallback = (summary: SimulationSummary) => void;
/** 공이 타일에 도착할 때마다 호출. true 반환 시 공을 캡처(종료)함 */
export type BallArrivedAtTileCallback = (ball: BallModel, tile: TileModel) => boolean;

export class BallSimulator {
  private map: MapModel;
  private maxPhaseLimit: number;
  private nextBallId: number = 1;

  private currentPhase: number = 0;
  private totalPhaseRate: number = 0;
  private lastTileChangedPhase: number = -1;
  private timePerPhase: number = 0.25;
  private tickTime: number = 0.03;

  private goalProgress: Map<number, { required: number; current: number }> = new Map();
  private initialGoalCount: number = 0;
  private endReserved: Array<{ instance: BallSimulationInstance; tile: TileModel }> = [];

  instances: BallSimulationInstance[] = [];

  // 이벤트 콜백
  onBallCreated?: BallCreatedCallback;
  onBallMoved?: BallMovedCallback;
  onBallEnded?: BallEndedCallback;
  onGoalIn?: BallGoalInCallback;
  onBallArrivedAtTile?: BallArrivedAtTileCallback;
  onEnd?: SimulationEndCallback;
  onPhaseAdvanced?: (phase: number) => void;

  constructor(map: MapModel) {
    this.map = map;
    this.maxPhaseLimit = Math.max(DEFAULT_MAX_PHASE_LIMIT, map.size * map.size * 10);
  }

  init(timePerPhase: number = 0.25, tickTime: number = 0.03): void {
    this.timePerPhase = timePerPhase;
    this.tickTime = tickTime;
    this.currentPhase = 0;
    this.totalPhaseRate = 0;
    this.lastTileChangedPhase = -1;
    this.nextBallId = 1;
    this.endReserved = [];
    this.instances = [];

    // 골 타일 진행 상황 초기화
    this.goalProgress.clear();
    const goalTiles = this.map.getGoalTiles();
    this.initialGoalCount = goalTiles.length;
    for (const tile of goalTiles) {
      this.goalProgress.set(tile.index, { required: tile.goalCount > 0 ? tile.goalCount : 1, current: 0 });
    }

    // 스타트 타일에서 공 생성
    for (const startTile of this.map.getStartTiles()) {
      this.createInstanceFromStart(startTile);
    }
  }

  /** 배틀 모드용 초기화 (Start 타일에서 자동 생성하지 않음) */
  initForBattle(timePerPhase: number = 0.3, tickTime: number = 0.03): void {
    this.timePerPhase = timePerPhase;
    this.tickTime = tickTime;
    this.currentPhase = 0;
    this.totalPhaseRate = 0;
    this.lastTileChangedPhase = -1;
    this.nextBallId = 1;
    this.endReserved = [];
    this.instances = [];
    this.goalProgress.clear();
    this.initialGoalCount = 0;
  }

  /** 외부에서 특정 타일에 공 생성 (BattleSimulator에서 사용) */
  spawnBall(tile: TileModel, direction: Direction, ownerId: number = 0): BallSimulationInstance | undefined {
    if (!tile) return undefined;
    const ball = this.createBall(tile, ownerId);
    const hash = this.getReflectorHash();
    const instance = BallSimulationInstance.create(ball, tile, direction, this.currentPhase, hash);
    this.instances.push(instance);
    this.onBallCreated?.(ball, direction);

    // 즉시 다음 타일 체크
    const nextTile = this.findNearTile(tile, direction);
    if (!this.checkPassable(nextTile, direction)) {
      instance.setEnd(EndReason.Blocked);
      instance.isMoving = false;
      this.endReserved.push({ instance, tile });
    }
    return instance;
  }

  get isCleared(): boolean {
    return this.initialGoalCount > 0 && this.goalProgress.size === 0;
  }

  get isEnd(): boolean {
    return this.instances.every(i => i.isEnd);
  }

  /** delta 시간만큼 시뮬레이션 진행. 시뮬레이션이 끝나면 true 반환 */
  update(delta: number): boolean {
    this.totalPhaseRate += delta * (1 / this.timePerPhase);

    const currentPhase = Math.floor(this.totalPhaseRate);
    let phaseChanged = currentPhase !== this.currentPhase;

    if (phaseChanged) {
      // 1. 다음 타일로 이동
      for (const inst of this.instances.filter(i => !i.isEnd)) {
        this.updateNextTile(inst, currentPhase);
      }

      // 2. 충돌 감지 (적팀 공 소멸)
      this.detectCrashes();

      // 3. 현재 타일 이벤트 처리
      const newInstances: BallSimulationInstance[] = [];
      const processedSplit = new Set<number>();
      for (const inst of this.instances.filter(i => !i.isEnd)) {
        if (processedSplit.has(inst.currentTile.index)) continue;
        this.procCurrentTileEvent(inst, currentPhase, newInstances);
        if (inst.currentTile.isSplit) processedSplit.add(inst.currentTile.index);
      }

      // 4. 신규 공 추가
      for (const ni of newInstances) {
        this.instances.push(ni);
        this.onBallCreated?.(ni.ball, ni.direction);
      }

      this.currentPhase = currentPhase;
    }

    const currentRate = this.totalPhaseRate - currentPhase;

    // 타일 변경 이벤트 (50% 지점)
    if (this.lastTileChangedPhase < this.currentPhase && currentRate >= 0.5) {
      this.lastTileChangedPhase++;
    }

    // 공 이동 이벤트 — phase 변경 시 1회만 (클라이언트가 자체 보간)
    if (phaseChanged) {
      for (const inst of this.instances.filter(i => !i.isEnd && i.isMoving)) {
        const nextTile = this.findNearTile(inst.currentTile, inst.direction);
        if (nextTile) {
          this.onBallMoved?.(inst.ball, inst.currentTile, nextTile);
        }
      }
    }

    // 종료 예약 처리
    if (this.endReserved.length > 0) {
      for (const { instance, tile } of this.endReserved) {
        this.onBallEnded?.(instance.ball, tile, instance.endReason);
      }
      this.endReserved = [];
    }

    // 모든 공 종료 체크
    if (this.instances.length > 0 && this.instances.every(i => i.isEnd)) {
      this.onEnd?.({
        isCleared: this.isCleared,
        isLooped: this.instances.some(i => i.endReason === EndReason.Loop),
      });
      return true;
    }

    // MaxPhaseLimit 초과
    if (this.currentPhase > this.maxPhaseLimit) {
      for (const inst of this.instances.filter(i => !i.isEnd)) {
        inst.setEnd(EndReason.Loop);
        this.onBallEnded?.(inst.ball, inst.currentTile, EndReason.Loop);
      }
      this.onEnd?.({ isCleared: false, isLooped: true });
      return true;
    }

    return false;
  }

  /** 모든 phase를 즉시 계산 (비동기 없이) */
  updateAll(): void {
    let done = false;
    while (!done) {
      done = this.update(this.tickTime);
    }
  }

  private createInstanceFromStart(tile: TileModel): void {
    const ball = this.createBall(tile);
    const hash = this.getReflectorHash();
    const inst = BallSimulationInstance.create(ball, tile, tile.startDirection, 0, hash);
    this.instances.push(inst);
    this.onBallCreated?.(ball, tile.startDirection);

    const nextTile = this.findNearTile(tile, tile.startDirection);
    if (!this.checkPassable(nextTile, tile.startDirection)) {
      inst.setEnd(EndReason.Blocked);
      inst.isMoving = false;
      this.endReserved.push({ instance: inst, tile });
    }
  }

  private updateNextTile(inst: BallSimulationInstance, phase: number): void {
    if (!inst.currentTile) {
      inst.setEnd(EndReason.Blocked);
      return;
    }

    if (inst.reserveTile !== undefined) {
      const hash = this.getReflectorHash();
      inst.history.addHistory(phase, inst.currentTile, inst.direction, hash);
      inst.previousTile = inst.currentTile;
      inst.currentTile = inst.reserveTile;

      if (phase >= inst.reserveTilePhase) {
        inst.reserveTile = undefined;
        inst.isMoving = true;
      }
      return;
    }

    const nextTile = this.findNearTile(inst.currentTile, inst.direction);
    if (!this.checkPassable(nextTile, inst.direction)) {
      inst.setEnd(EndReason.Blocked);
      this.endReserved.push({ instance: inst, tile: inst.currentTile });
      return;
    }

    inst.previousTile = inst.currentTile;
    inst.currentTile = nextTile!;
    const hash = this.getReflectorHash();
    inst.history.addHistory(phase, inst.currentTile, inst.direction, hash);

    if (inst.currentTile.isPortal) {
      const linked = this.map.linkedPortals.get(inst.currentTile);
      if (linked) {
        inst.reserveTile = linked;
        inst.reserveTilePhase = phase + 2;
        inst.isMoving = false;
      } else {
        inst.setEnd(EndReason.PortalUnlinked);
        this.endReserved.push({ instance: inst, tile: inst.currentTile });
      }
    } else {
      // 반사판 처리
      const reflType = this.getReflectorType(inst.currentTile);
      if (reflType !== ReflectorType.None) {
        const newDir = BallSimulator.getReflectedDirection(inst.direction, reflType);
        inst.direction = newDir;
      }
    }
  }

  private detectCrashes(): void {
    const active = this.instances.filter(i => !i.isEnd);

    // 1. 교차 감지: A→B, B→A인 경우 쌍으로 소멸 (팀 무관)
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (a.isEnd || b.isEnd) continue;
        if (
          a.previousTile && b.previousTile &&
          a.currentTile.index === b.previousTile.index &&
          b.currentTile.index === a.previousTile.index
        ) {
          a.setEnd(EndReason.Crash);
          b.setEnd(EndReason.Crash);
          this.endReserved.push({ instance: a, tile: a.currentTile });
          this.endReserved.push({ instance: b, tile: b.currentTile });
        }
      }
    }

    // 2. 같은 타일 2개 이상이면 쌍으로 소멸 (팀 무관)
    const tileMap = new Map<number, BallSimulationInstance[]>();
    for (const inst of active.filter(i => !i.isEnd)) {
      const key = inst.currentTile.index;
      if (!tileMap.has(key)) tileMap.set(key, []);
      tileMap.get(key)!.push(inst);
    }

    for (const [, group] of tileMap) {
      if (group.length < 2) continue;
      const pairs = Math.floor(group.length / 2);
      for (let k = 0; k < pairs; k++) {
        const a = group[k * 2], b = group[k * 2 + 1];
        a.setEnd(EndReason.Crash);
        b.setEnd(EndReason.Crash);
        this.endReserved.push({ instance: a, tile: a.currentTile });
        this.endReserved.push({ instance: b, tile: b.currentTile });
      }
    }
  }

  private procCurrentTileEvent(
    inst: BallSimulationInstance,
    phase: number,
    newInstances: BallSimulationInstance[],
  ): void {
    const tile = inst.currentTile;

    // 타일 도착 콜백 — true 반환 시 공 캡처
    if (this.onBallArrivedAtTile?.(inst.ball, tile)) {
      inst.setEnd(EndReason.Goal);
      this.endReserved.push({ instance: inst, tile });
      return;
    }

    if (tile.isGold) {
      // 배틀 모드에서는 골드 없음
    } else if (tile.isSplit) {
      for (const dir of tile.splitDirections) {
        const ball = this.createBall(tile, inst.ball.ownerId);
        const hash = this.getReflectorHash();
        const ni = BallSimulationInstance.create(ball, tile, dir, this.currentPhase + 1, hash);
        ni.copyHistoryFrom(inst);
        newInstances.push(ni);
      }
      inst.clearHistory();
      inst.setEnd(EndReason.Split);
      this.endReserved.push({ instance: inst, tile });
    } else if (tile.isGoal) {
      const prog = this.goalProgress.get(tile.index);
      if (prog) {
        prog.current++;
        if (prog.current >= prog.required) {
          this.goalProgress.delete(tile.index);
        }
      }
      this.onGoalIn?.(inst.ball, tile);
      inst.setEnd(EndReason.Goal);
      this.endReserved.push({ instance: inst, tile });
    }

    // 다음 타일 진입 가능 체크
    if (!inst.isEnd && inst.isMoving) {
      const nextTile = this.findNearTile(tile, inst.direction);
      if (!this.checkPassable(nextTile, inst.direction)) {
        inst.setEnd(EndReason.Blocked);
        inst.isMoving = false;
        this.endReserved.push({ instance: inst, tile });
      }
    }
  }

  findNearTile(tile: TileModel, direction: Direction): TileModel | undefined {
    switch (direction) {
      case Direction.Up: return this.map.getTile(tile.x, tile.y - 1);
      case Direction.Down: return this.map.getTile(tile.x, tile.y + 1);
      case Direction.Left: return this.map.getTile(tile.x - 1, tile.y);
      case Direction.Right: return this.map.getTile(tile.x + 1, tile.y);
      default: return undefined;
    }
  }

  private checkPassable(tile: TileModel | undefined, _inDir: Direction): boolean {
    if (!tile || tile.isBlock) return false;
    return true;  // 거울은 모든 방향에서 통과 (양방향 반사)
  }

  private getReflectorType(tile: TileModel): ReflectorType {
    return this.map.getReflectorType(tile.x, tile.y);
  }

  private getReflectorHash(): number {
    // 배틀 모드에서는 회전 반사판이 없으므로 간단하게
    return this.map.reflectors.size;
  }

  private createBall(tile: TileModel, ownerId: number = 0): BallModel {
    return new BallModel(this.nextBallId++, tile, ownerId);
  }

  static getReflectedDirection(dir: Direction, reflector: ReflectorType): Direction {
    switch (reflector) {
      case ReflectorType.Slash:
        // "/" 거울: Up↔Right, Down↔Left
        if (dir === Direction.Up) return Direction.Right;
        if (dir === Direction.Right) return Direction.Up;
        if (dir === Direction.Down) return Direction.Left;
        if (dir === Direction.Left) return Direction.Down;
        return dir;
      case ReflectorType.Backslash:
        // "\" 거울: Up↔Left, Down↔Right
        if (dir === Direction.Up) return Direction.Left;
        if (dir === Direction.Left) return Direction.Up;
        if (dir === Direction.Down) return Direction.Right;
        if (dir === Direction.Right) return Direction.Down;
        return dir;
      default:
        return dir;
    }
  }
}
