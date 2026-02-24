import { BallModel } from './BallModel';
import { TileModel } from './TileModel';
import { Direction } from '../enums/Direction';
import { EndReason } from '../enums/EndReason';
import { BallSimulatorHistory } from './BallSimulatorHistory';

export class BallSimulationInstance {
  ball: BallModel;
  direction: Direction;
  /** 현재 타일에 입사할 때의 방향 (반사판 교체 시 재계산 기준) */
  incomingDirection: Direction;
  currentTile: TileModel;
  reserveTile: TileModel | undefined;
  reserveTilePhase: number = 0;
  isMoving: boolean = true;
  endReason: EndReason = EndReason.None;
  readonly createdPhase: number;
  readonly history: BallSimulatorHistory = new BallSimulatorHistory();

  /** 인스턴스 자체의 누적 페이즈 비율 (speedMultiplier 반영) */
  localPhaseRate: number = 0;
  /** 인스턴스의 현재 정수 페이즈 */
  localPhase: number = 0;

  get isEnd(): boolean {
    return this.endReason !== EndReason.None;
  }

  get isGoalIn(): boolean {
    return this.currentTile?.isGoal ?? false;
  }

  get isLoop(): boolean {
    return this.history.getLoopCount() > 2;
  }

  private constructor(
    ball: BallModel,
    tile: TileModel,
    direction: Direction,
    createdPhase: number,
    reflectorStateHash: number,
  ) {
    this.ball = ball;
    this.currentTile = tile;
    this.direction = direction;
    this.incomingDirection = direction;
    this.createdPhase = createdPhase;
    this.history.addHistory(createdPhase, tile, direction, reflectorStateHash);
  }

  static create(
    ball: BallModel,
    tile: TileModel,
    direction: Direction,
    createdPhase: number,
    reflectorStateHash: number,
  ): BallSimulationInstance {
    return new BallSimulationInstance(ball, tile, direction, createdPhase, reflectorStateHash);
  }

  setEnd(reason: EndReason): void {
    this.endReason = reason;
  }

  copyHistoryFrom(source: BallSimulationInstance): void {
    this.history.copyFrom(source.history);
  }

  clearHistory(): void {
    this.history.clear();
  }
}
