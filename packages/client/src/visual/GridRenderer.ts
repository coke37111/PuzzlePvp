import Phaser from 'phaser';
import { MapData, EMPTY_TILE_INDEX } from '@puzzle-pvp/shared';
import { TILE_SIZE, GRID_LINE_COLOR, GRID_LINE_ALPHA } from './Constants';

/** 타일 경계에 반투명 그리드 라인을 그린다 (타일이 존재하는 영역만) */
export function drawGridLines(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  mapData: MapData,
): void {
  const { width, height } = mapData;
  const g = scene.add.graphics();
  g.lineStyle(1, GRID_LINE_COLOR, GRID_LINE_ALPHA);

  const hasTile = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height && mapData.tiles[y][x] >= EMPTY_TILE_INDEX;

  // 가로 라인 (타일 위/아래 경계)
  for (let y = 0; y <= height; y++) {
    let lineStart = -1;
    for (let x = 0; x <= width; x++) {
      const above = hasTile(x, y - 1);
      const below = hasTile(x, y);
      if (above || below) {
        if (lineStart === -1) lineStart = x;
      } else {
        if (lineStart !== -1) {
          g.lineBetween(lineStart * TILE_SIZE, y * TILE_SIZE, x * TILE_SIZE, y * TILE_SIZE);
          lineStart = -1;
        }
      }
    }
    if (lineStart !== -1) {
      g.lineBetween(lineStart * TILE_SIZE, y * TILE_SIZE, width * TILE_SIZE, y * TILE_SIZE);
    }
  }

  // 세로 라인 (타일 좌/우 경계)
  for (let x = 0; x <= width; x++) {
    let lineStart = -1;
    for (let y = 0; y <= height; y++) {
      const left = hasTile(x - 1, y);
      const right = hasTile(x, y);
      if (left || right) {
        if (lineStart === -1) lineStart = y;
      } else {
        if (lineStart !== -1) {
          g.lineBetween(x * TILE_SIZE, lineStart * TILE_SIZE, x * TILE_SIZE, y * TILE_SIZE);
          lineStart = -1;
        }
      }
    }
    if (lineStart !== -1) {
      g.lineBetween(x * TILE_SIZE, lineStart * TILE_SIZE, x * TILE_SIZE, height * TILE_SIZE);
    }
  }

  container.add(g);
  container.sendToBack(g);
}
