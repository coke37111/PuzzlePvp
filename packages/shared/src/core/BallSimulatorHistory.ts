import { TileModel } from './TileModel';
import { Direction } from '../enums/Direction';

interface LoopCheckState {
  tileIndex: number;
  direction: Direction;
  reflectorStateHash: number;
}

function stateKey(s: LoopCheckState): string {
  return `${s.tileIndex}:${s.direction}:${s.reflectorStateHash}`;
}

export interface HistoryEntry {
  phase: number;
  tile: TileModel;
}

export class BallSimulatorHistory {
  readonly entries: HistoryEntry[] = [];
  private stateVisitCount: Map<string, number> = new Map();
  private maxVisitCount: number = 0;

  addHistory(phase: number, tile: TileModel, direction: Direction, reflectorStateHash: number): void {
    const state: LoopCheckState = { tileIndex: tile.index, direction, reflectorStateHash };
    const key = stateKey(state);

    const prev = this.stateVisitCount.get(key) ?? 0;
    const next = prev + 1;
    this.stateVisitCount.set(key, next);
    if (next > this.maxVisitCount) this.maxVisitCount = next;

    this.entries.push({ phase, tile });
  }

  copyFrom(source: BallSimulatorHistory): void {
    this.entries.length = 0;
    this.entries.push(...source.entries);
    this.stateVisitCount = new Map(source.stateVisitCount);
    this.maxVisitCount = source.maxVisitCount;
  }

  clear(): void {
    this.entries.length = 0;
    this.stateVisitCount.clear();
    this.maxVisitCount = 0;
  }

  getLoopCount(): number {
    if (this.entries.length < 4) return 0;
    return this.maxVisitCount > 1 ? this.maxVisitCount - 1 : 0;
  }

  get isGoalIn(): boolean {
    if (this.entries.length === 0) return false;
    return this.entries[this.entries.length - 1].tile.isGoal;
  }
}
