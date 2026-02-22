import { BallModel } from './BallModel';
import { TileModel } from './TileModel';
import { Direction } from '../enums/Direction';
import { EndReason } from '../enums/EndReason';
import { BallSimulatorHistory } from './BallSimulatorHistory';

export class BallSimulationInstance {
  ball: BallModel;
  direction: Direction;
  currentTile: TileModel;
  previousTile: TileModel | undefined;
  reserveTile: TileModel | undefined;
  reserveTilePhase: number = 0;
  isMoving: boolean = true;
  endReason: EndReason = EndReason.None;
  readonly createdPhase: number;
  readonly history: BallSimulatorHistory = new BallSimulatorHistory();

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
