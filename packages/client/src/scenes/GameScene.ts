import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import {
  MatchFoundMsg,
  SpawnPointInfo,
  MapData,
  ReflectorType,
  BallSpawnedMsg,
  BallMovedMsg,
  BallEndedMsg,
  SpawnHpMsg,
  SpawnDestroyedMsg,
  ReflectorPlacedMsg,
  ReflectorRemovedMsg,
  GameOverMsg,
  WallPlacedMsg,
  WallDamagedMsg,
  WallDestroyedMsg,
  TimeStopStartedMsg,
  createBattleTileRegistry,
  MapModel,
  EMPTY_TILE_INDEX,
} from '@puzzle-pvp/shared';

import {
  TILE_SIZE, BALL_RADIUS, HP_BAR_HEIGHT,
  PLAYER_COLORS, PLAYER_COLORS_DARK,
  BG_COLOR,
  TILE_EMPTY_COLOR, TILE_P1_SPAWN_COLOR, TILE_P2_SPAWN_COLOR,
  TILE_BLOCK_COLOR, TILE_BLOCK_X_COLOR, TILE_BLOCK_X_ALPHA,
  HOVER_COLOR, HOVER_ALPHA,
  GLOW_RADIUS_EXTRA, GLOW_ALPHA,
  ENEMY_ZONE_ALPHA,
  MAX_REFLECTORS_PER_PLAYER,
  INITIAL_WALL_COUNT, INITIAL_TIME_STOP_COUNT,
  WALL_COLOR, WALL_BORDER_COLOR,
  TIME_STOP_OVERLAY_ALPHA, TIME_STOP_GAUGE_COLOR, TIME_STOP_DURATION,
} from '../visual/Constants';
import { drawGridLines } from '../visual/GridRenderer';
import {
  animBallSpawn,
  animBallEnd,
  animReflectorPlace,
  animHpBar,
  animDamageFlash,
  animSpawnDestroy,
  getHpColor,
  animDamagePopup,
} from '../visual/VisualEffects';

interface BallVisual {
  circle: Phaser.GameObjects.Arc;
  shine: Phaser.GameObjects.Arc;
  ballId: number;
  ownerId: number;
}

interface SpawnVisual {
  id: number;
  bg: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  dirArrow: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  maxHp: number;
  currentHp: number;
  ownerId: number;
  destroyed: boolean;
}

interface ReflectorVisual {
  graphics: Phaser.GameObjects.Graphics;
  bg: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  type: ReflectorType;
  playerId: number;
}

interface WallVisual {
  bg: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
  x: number;
  y: number;
  maxHp: number;
}

export class GameScene extends Phaser.Scene {
  private socket!: SocketClient;
  private myPlayerId: number = 0;
  private mapData!: MapData;
  private mapModel!: MapModel;
  private serverSpawnPoints: SpawnPointInfo[] = [];
  private timePerPhase: number = 0.3;

  private gridOffsetX: number = 0;
  private gridOffsetY: number = 0;

  private ballVisuals: Map<number, BallVisual> = new Map();
  private spawnVisuals: Map<number, SpawnVisual> = new Map();
  private reflectorVisuals: Map<string, ReflectorVisual> = new Map();

  private tilesLayer!: Phaser.GameObjects.Container;
  private ballsLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;

  private reflectorCountTexts: [Phaser.GameObjects.Text | null, Phaser.GameObjects.Text | null] = [null, null];

  // 아이템 UI
  private itemUiTexts: { wall: [Phaser.GameObjects.Text | null, Phaser.GameObjects.Text | null], timeStop: [Phaser.GameObjects.Text | null, Phaser.GameObjects.Text | null] } = {
    wall: [null, null], timeStop: [null, null],
  };
  private itemCounts: { wall: [number, number], timeStop: [number, number] } = {
    wall: [INITIAL_WALL_COUNT, INITIAL_WALL_COUNT],
    timeStop: [INITIAL_TIME_STOP_COUNT, INITIAL_TIME_STOP_COUNT],
  };
  private wallMode: boolean = false;
  private wallModeText: Phaser.GameObjects.Text | null = null;
  private wallCursor: Phaser.GameObjects.Rectangle | null = null;
  private wallVisuals: Map<string, WallVisual> = new Map();

  // 시간 정지 오버레이
  private timeStopOverlay: Phaser.GameObjects.Rectangle | null = null;
  private timeStopLabel: Phaser.GameObjects.Text | null = null;
  private timeStopGaugeBg: Phaser.GameObjects.Rectangle | null = null;
  private timeStopGauge: Phaser.GameObjects.Rectangle | null = null;
  private timeStopRemaining: number = 0;
  private timeStopTotal: number = TIME_STOP_DURATION;

  // 애니메이션 보조
  private hpTweens: Map<string, Phaser.Tweens.Tween> = new Map();
  private hoverHighlight: Phaser.GameObjects.Rectangle | null = null;
  private endingBalls: Set<number> = new Set();
  private enemyZoneTiles: Set<string> = new Set(); // "x,y" 형식

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { matchData: MatchFoundMsg; socket: SocketClient }): void {
    this.socket = data.socket;
    this.myPlayerId = data.matchData.playerId;
    this.mapData = data.matchData.mapData;
    this.serverSpawnPoints = data.matchData.spawnPoints || [];
    this.timePerPhase = data.matchData.timePerPhase || 0.3;

    const registry = createBattleTileRegistry();
    this.mapModel = new MapModel(registry);
    this.mapModel.load(this.mapData);
  }

  create(): void {
    // 우클릭 컨텍스트 메뉴 방지
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, BG_COLOR).setOrigin(0, 0);

    const gridW = this.mapData.size * TILE_SIZE;
    const gridH = this.mapData.size * TILE_SIZE;
    this.gridOffsetX = (width - gridW) / 2;
    this.gridOffsetY = (height - gridH) / 2 + 10;

    this.tilesLayer = this.add.container(this.gridOffsetX, this.gridOffsetY);
    this.ballsLayer = this.add.container(this.gridOffsetX, this.gridOffsetY);
    this.uiLayer = this.add.container(0, 0);

    // 상태 초기화
    this.ballVisuals.clear();
    this.spawnVisuals.clear();
    this.reflectorVisuals.clear();
    this.wallVisuals.clear();
    this.hpTweens.clear();
    this.endingBalls.clear();
    this.enemyZoneTiles.clear();
    this.hoverHighlight = null;
    this.wallMode = false;
    this.wallModeText = null;
    this.wallCursor = null;
    this.timeStopOverlay = null;
    this.timeStopLabel = null;
    this.timeStopGaugeBg = null;
    this.timeStopGauge = null;
    this.timeStopRemaining = 0;
    this.itemCounts = { wall: [INITIAL_WALL_COUNT, INITIAL_WALL_COUNT], timeStop: [INITIAL_TIME_STOP_COUNT, INITIAL_TIME_STOP_COUNT] };
    this.itemUiTexts = { wall: [null, null], timeStop: [null, null] };
    this.reflectorCountTexts = [null, null];

    this.drawGrid();
    this.setupInput();
    this.setupUI();
    this.setupSocketEvents();

    this.add.text(width / 2, 8, `Player ${this.myPlayerId + 1} (Blue)`, {
      fontSize: '14px',
      color: '#4488ff',
    }).setOrigin(0.5, 0);
  }

  // --- 씬 종료 시 정리 ---
  shutdown(): void {
    this.tweens.killAll();
    this.time.removeAllEvents();
  }

  // === 그리드 그리기 ===

  private drawGrid(): void {
    const size = this.mapData.size;

    // 그리드 라인 (타일 뒤)
    drawGridLines(this, this.tilesLayer, this.mapData);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tileIdx = this.mapData.tiles[y][x];
        if (tileIdx < EMPTY_TILE_INDEX) continue;

        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        const tileColor = this.getTileColor(tileIdx);
        const rect = this.add.rectangle(
          px + TILE_SIZE / 2, py + TILE_SIZE / 2,
          TILE_SIZE - 2, TILE_SIZE - 2, tileColor, 0.9,
        );
        this.tilesLayer.add(rect);

        // 스폰포인트
        if (tileIdx === 2 || tileIdx === 3) {
          const spInfo = this.serverSpawnPoints.find(sp => sp.x === x && sp.y === y);
          if (spInfo) {
            this.createSpawnVisual(x, y, spInfo.ownerId, spInfo.id, spInfo.maxHp, tileIdx);
          }
        }

        // 블록 타일: X 패턴
        if (tileIdx === 7) {
          const g = this.add.graphics();
          g.lineStyle(2, TILE_BLOCK_X_COLOR, TILE_BLOCK_X_ALPHA);
          const m = 6;
          g.lineBetween(px + m, py + m, px + TILE_SIZE - m, py + TILE_SIZE - m);
          g.lineBetween(px + TILE_SIZE - m, py + m, px + m, py + TILE_SIZE - m);
          this.tilesLayer.add(g);
        }
      }
    }

    // 적 스폰포인트 보호 구역 오버레이
    this.drawEnemyZones();
  }

  private drawEnemyZones(): void {
    const size = this.mapData.size;
    const drawnKeys = new Set<string>();

    // 모든 스폰포인트 주변을 표시 (적=설치불가, 아군=적 설치불가)
    for (const sp of this.serverSpawnPoints) {
      const isEnemy = sp.ownerId !== this.myPlayerId;
      const color = this.getTeamColor(sp.ownerId);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = sp.x + dx;
          const ny = sp.y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;

          const tileIdx = this.mapData.tiles[ny][nx];
          if (tileIdx < EMPTY_TILE_INDEX) continue;
          if (tileIdx === 2 || tileIdx === 3 || tileIdx === 7) continue;

          const key = `${nx},${ny}`;

          if (isEnemy) {
            // 적 스폰 주변: 설치 불가 추적 + 오버레이
            this.enemyZoneTiles.add(key);
            if (drawnKeys.has(key)) continue;
            drawnKeys.add(key);
            const px = nx * TILE_SIZE + TILE_SIZE / 2;
            const py = ny * TILE_SIZE + TILE_SIZE / 2;
            const overlay = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, color, ENEMY_ZONE_ALPHA);
            this.tilesLayer.add(overlay);
          }
          // 아군 스폰 주변: 오버레이 없음 (설치 가능, 적만 서버에서 차단)
        }
      }
    }
  }

  private getTileColor(tileIdx: number): number {
    switch (tileIdx) {
      case 2: return TILE_P1_SPAWN_COLOR;
      case 3: return TILE_P2_SPAWN_COLOR;
      case 7: return TILE_BLOCK_COLOR;
      default: return TILE_EMPTY_COLOR;
    }
  }

  // === 스폰포인트 ===

  private createSpawnVisual(
    gridX: number, gridY: number,
    ownerId: number, spawnId: number, maxHp: number,
    tileIdx: number,
  ): void {
    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE / 2;

    const bg = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, this.getTeamColorDark(ownerId), 0.4);
    this.tilesLayer.add(bg);

    // HP 바 배경
    const hpBarBg = this.add.rectangle(
      px, py - TILE_SIZE / 2 + HP_BAR_HEIGHT,
      TILE_SIZE - 4, HP_BAR_HEIGHT, 0x333333,
    );
    this.tilesLayer.add(hpBarBg);

    // HP 바
    const hpBar = this.add.rectangle(
      px, py - TILE_SIZE / 2 + HP_BAR_HEIGHT,
      TILE_SIZE - 4, HP_BAR_HEIGHT, getHpColor(1.0),
    );
    this.tilesLayer.add(hpBar);

    // HP 텍스트
    const label = this.add.text(px, py + 4, String(maxHp), {
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.tilesLayer.add(label);

    // 발사 방향 화살표
    const dirArrow = this.add.graphics();
    const arrowColor = this.getTeamColor(ownerId);
    dirArrow.fillStyle(arrowColor, 0.6);

    // tileIdx=2: 오른쪽 발사, tileIdx=3: 왼쪽 발사
    const arrowSize = 6;
    if (tileIdx === 2) {
      // 오른쪽 화살표
      const ax = px + TILE_SIZE / 2 - 4;
      const ay = py;
      dirArrow.fillTriangle(ax, ay - arrowSize, ax, ay + arrowSize, ax + arrowSize, ay);
    } else {
      // 왼쪽 화살표
      const ax = px - TILE_SIZE / 2 + 4;
      const ay = py;
      dirArrow.fillTriangle(ax, ay - arrowSize, ax, ay + arrowSize, ax - arrowSize, ay);
    }
    this.tilesLayer.add(dirArrow);

    this.spawnVisuals.set(spawnId, {
      id: spawnId,
      bg, hpBar, hpBarBg, label, dirArrow,
      x: gridX, y: gridY,
      maxHp,
      currentHp: maxHp,
      ownerId,
      destroyed: false,
    });
  }

  private updateSpawnHp(spawnId: number, hp: number, _ownerId: number): void {
    const visual = this.spawnVisuals.get(spawnId);
    if (!visual || visual.destroyed) return;

    const oldHp = visual.currentHp;
    visual.currentHp = hp;
    visual.label.setText(String(hp));

    const ratio = hp / visual.maxHp;
    const baseX = visual.x * TILE_SIZE + TILE_SIZE / 2;

    visual.hpBar.setFillStyle(getHpColor(ratio));
    animHpBar(this, visual.hpBar, baseX, ratio, `hp_${spawnId}`, this.hpTweens);

    // HP 감소 시 데미지 플래시 + 팝업
    if (hp < oldHp) {
      animDamageFlash(this, visual.bg, this.getTeamColorDark(visual.ownerId), 0.4);
      const damage = oldHp - hp;
      const popupX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      const popupY = visual.y * TILE_SIZE;
      animDamagePopup(this, this.tilesLayer, popupX, popupY, damage);
    }
  }

  // === 입력 처리 ===

  private setupInput(): void {
    const size = this.mapData.size;

    // 키보드: 1=성벽모드, 2=시간정지
    this.input.keyboard?.on('keydown-ONE', () => this.toggleWallMode());
    this.input.keyboard?.on('keydown-TWO', () => this.useTimeStop());

    this.input.on('pointerdown', (_pointer: Phaser.Input.Pointer) => {
      const localX = _pointer.x - this.gridOffsetX;
      const localY = _pointer.y - this.gridOffsetY;
      const gridX = Math.floor(localX / TILE_SIZE);
      const gridY = Math.floor(localY / TILE_SIZE);

      if (gridX < 0 || gridX >= size || gridY < 0 || gridY >= size) {
        // 그리드 밖 클릭 시 성벽 모드 해제
        if (this.wallMode && !_pointer.rightButtonDown()) this.setWallMode(false);
        return;
      }

      const tile = this.mapModel.getTile(gridX, gridY);
      const key = `${gridX},${gridY}`;
      const existing = this.reflectorVisuals.get(key);

      // 우클릭: 내 반사판 즉시 제거 (성벽 모드 해제도)
      if (_pointer.rightButtonDown()) {
        if (this.wallMode) {
          this.setWallMode(false);
          return;
        }
        if (existing && existing.playerId === this.myPlayerId) {
          this.socket.removeReflector(gridX, gridY);
        }
        return;
      }

      // 성벽 모드: 빈 설치 가능 타일에 성벽 설치
      if (this.wallMode) {
        if (!tile || !tile.isReflectorSetable) return;
        if (this.wallVisuals.has(key) || existing) return;
        if (this.enemyZoneTiles.has(key)) return;
        this.socket.placeWall(gridX, gridY);
        this.setWallMode(false);
        return;
      }

      if (!tile || !tile.isReflectorSetable) return;
      if (this.enemyZoneTiles.has(`${gridX},${gridY}`)) return;

      if (!existing) {
        // 빈 타일 → Slash 설치 (한도 초과 시 서버에서 FIFO 자동 제거)
        this.socket.placeReflector(gridX, gridY, ReflectorType.Slash);
      } else if (existing.playerId !== this.myPlayerId) {
        // 상대 반사판 → 무시
        return;
      } else if (existing.type === ReflectorType.Slash) {
        // Slash → Backslash
        this.socket.placeReflector(gridX, gridY, ReflectorType.Backslash);
      } else {
        // Backslash → 제거
        this.socket.removeReflector(gridX, gridY);
      }
    });

    // 호버 이펙트 (성벽 모드 커서 포함)
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const localX = pointer.x - this.gridOffsetX;
      const localY = pointer.y - this.gridOffsetY;
      const gridX = Math.floor(localX / TILE_SIZE);
      const gridY = Math.floor(localY / TILE_SIZE);

      if (gridX < 0 || gridX >= size || gridY < 0 || gridY >= size) {
        if (this.hoverHighlight) this.hoverHighlight.setVisible(false);
        if (this.wallCursor) this.wallCursor.setVisible(false);
        return;
      }

      // 성벽 모드: 커서 표시
      if (this.wallMode) {
        if (this.hoverHighlight) this.hoverHighlight.setVisible(false);
        const px = gridX * TILE_SIZE + TILE_SIZE / 2;
        const py = gridY * TILE_SIZE + TILE_SIZE / 2;
        if (!this.wallCursor) {
          this.wallCursor = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, WALL_COLOR, 0.5);
          this.tilesLayer.add(this.wallCursor);
        }
        this.wallCursor.setPosition(px, py).setVisible(true);
        return;
      }

      if (this.wallCursor) this.wallCursor.setVisible(false);

      const tile = this.mapModel.getTile(gridX, gridY);
      const hasReflector = this.reflectorVisuals.has(`${gridX},${gridY}`);
      const isEnemyZone = this.enemyZoneTiles.has(`${gridX},${gridY}`);

      if (!tile || !tile.isReflectorSetable || hasReflector || isEnemyZone) {
        if (this.hoverHighlight) this.hoverHighlight.setVisible(false);
        return;
      }

      const px = gridX * TILE_SIZE + TILE_SIZE / 2;
      const py = gridY * TILE_SIZE + TILE_SIZE / 2;

      if (!this.hoverHighlight) {
        this.hoverHighlight = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, HOVER_COLOR, HOVER_ALPHA);
        this.tilesLayer.add(this.hoverHighlight);
      }
      this.hoverHighlight.setPosition(px, py).setVisible(true);
    });
  }

  private toggleWallMode(): void {
    this.setWallMode(!this.wallMode);
  }

  private setWallMode(active: boolean): void {
    if (active && this.itemCounts.wall[this.myPlayerId] <= 0) {
      this.showToast('성벽 아이템이 없습니다.');
      return;
    }
    this.wallMode = active;
    if (this.wallModeText) {
      this.wallModeText.setVisible(active);
    }
    if (!active && this.wallCursor) {
      this.wallCursor.setVisible(false);
    }
  }

  private useTimeStop(): void {
    if (this.itemCounts.timeStop[this.myPlayerId] <= 0) {
      this.showToast('시간 정지 아이템이 없습니다.');
      return;
    }
    this.socket.useTimeStop();
  }

  // === UI ===

  private setupUI(): void {
    const { width, height } = this.scale;
    const opponentId = 1 - this.myPlayerId;

    // 좌상단: 내 팀 (항상 파란색)
    this.reflectorCountTexts[this.myPlayerId] = this.add.text(
      8, 8,
      `◆ ${MAX_REFLECTORS_PER_PLAYER}/${MAX_REFLECTORS_PER_PLAYER}`,
      { fontSize: '13px', color: '#4488ff', fontStyle: 'bold' },
    ).setOrigin(0, 0);

    this.itemUiTexts.wall[this.myPlayerId as 0|1] = this.add.text(
      8, 26,
      `🧱[1] ${INITIAL_WALL_COUNT}`,
      { fontSize: '12px', color: '#ddaa44', fontStyle: 'bold' },
    ).setOrigin(0, 0);

    this.itemUiTexts.timeStop[this.myPlayerId as 0|1] = this.add.text(
      8, 42,
      `⏸[2] ${INITIAL_TIME_STOP_COUNT}`,
      { fontSize: '12px', color: '#aa88ff', fontStyle: 'bold' },
    ).setOrigin(0, 0);

    // 우상단: 상대 팀 (항상 빨간색)
    this.reflectorCountTexts[opponentId] = this.add.text(
      width - 8, 8,
      `◆ ${MAX_REFLECTORS_PER_PLAYER}/${MAX_REFLECTORS_PER_PLAYER}`,
      { fontSize: '13px', color: '#ff4444', fontStyle: 'bold' },
    ).setOrigin(1, 0);

    this.itemUiTexts.wall[opponentId as 0|1] = this.add.text(
      width - 8, 26,
      `${INITIAL_WALL_COUNT} [1]🧱`,
      { fontSize: '12px', color: '#ddaa44', fontStyle: 'bold' },
    ).setOrigin(1, 0);

    this.itemUiTexts.timeStop[opponentId as 0|1] = this.add.text(
      width - 8, 42,
      `${INITIAL_TIME_STOP_COUNT} [2]⏸`,
      { fontSize: '12px', color: '#aa88ff', fontStyle: 'bold' },
    ).setOrigin(1, 0);

    this.add.text(width / 2, 8, '터치: / → \\ → 제거 | 우클릭: 제거', {
      fontSize: '10px',
      color: '#555566',
    }).setOrigin(0.5, 0);

    // 성벽 모드 안내 텍스트
    this.wallModeText = this.add.text(
      width / 2, height / 2 - 120,
      '🧱 성벽 설치 모드\n클릭: 설치 | 우클릭/ESC: 취소',
      { fontSize: '14px', color: '#ddaa44', fontStyle: 'bold', align: 'center', backgroundColor: '#00000088', padding: { x: 10, y: 6 } },
    ).setOrigin(0.5).setDepth(100).setVisible(false);

    // 시간 정지 오버레이 (초기 숨김)
    this.timeStopOverlay = this.add.rectangle(0, 0, width, height, 0x220044, TIME_STOP_OVERLAY_ALPHA)
      .setOrigin(0, 0).setDepth(150).setVisible(false);
    this.timeStopLabel = this.add.text(
      width / 2, height / 2 - 30,
      '⏸ 시간 정지 스킬',
      { fontSize: '22px', color: '#cc88ff', fontStyle: 'bold' },
    ).setOrigin(0.5).setDepth(151).setVisible(false);
    this.timeStopGaugeBg = this.add.rectangle(
      width / 2, height / 2 + 20,
      300, 18, 0x333333,
    ).setOrigin(0.5).setDepth(151).setVisible(false);
    this.timeStopGauge = this.add.rectangle(
      width / 2 - 150, height / 2 + 20,
      300, 18, TIME_STOP_GAUGE_COLOR,
    ).setOrigin(0, 0.5).setDepth(152).setVisible(false);

    // ESC로 성벽 모드 해제
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.wallMode) this.setWallMode(false);
    });
  }

  private updateReflectorCount(): void {
    for (let pid = 0; pid < 2; pid++) {
      const text = this.reflectorCountTexts[pid];
      if (!text) continue;
      const count = [...this.reflectorVisuals.values()]
        .filter(v => v.playerId === pid).length;
      const remaining = MAX_REFLECTORS_PER_PLAYER - count;
      text.setText(`◆ ${remaining}/${MAX_REFLECTORS_PER_PLAYER}`);
    }
  }

  private updateItemUI(): void {
    for (let pid = 0; pid < 2; pid++) {
      const wallText = this.itemUiTexts.wall[pid as 0|1];
      const tsText = this.itemUiTexts.timeStop[pid as 0|1];
      const wallCount = this.itemCounts.wall[pid as 0|1];
      const tsCount = this.itemCounts.timeStop[pid as 0|1];

      if (pid === 0) {
        wallText?.setText(`🧱[1] ${wallCount}`).setAlpha(wallCount > 0 ? 1 : 0.4);
        tsText?.setText(`⏸[2] ${tsCount}`).setAlpha(tsCount > 0 ? 1 : 0.4);
      } else {
        wallText?.setText(`${wallCount} [1]🧱`).setAlpha(wallCount > 0 ? 1 : 0.4);
        tsText?.setText(`${tsCount} [2]⏸`).setAlpha(tsCount > 0 ? 1 : 0.4);
      }
    }
  }

  private showToast(message: string): void {
    const { width, height } = this.scale;
    const toast = this.add.text(width / 2, height - 50, message, {
      fontSize: '13px',
      color: '#ffffff',
      backgroundColor: '#442222',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(200).setAlpha(0);

    this.tweens.add({
      targets: toast,
      alpha: 1,
      duration: 150,
      onComplete: () => {
        this.time.delayedCall(1500, () => {
          this.tweens.add({
            targets: toast,
            alpha: 0,
            duration: 300,
            onComplete: () => toast.destroy(),
          });
        });
      },
    });
  }

  // === 소켓 이벤트 ===

  private setupSocketEvents(): void {
    this.socket.onBallSpawned = (msg: BallSpawnedMsg) => {
      const tile = this.mapModel.getTile(msg.x, msg.y);
      if (!tile) return;

      // 종료 애니메이션 중인 같은 ID 방어
      if (this.endingBalls.has(msg.ballId)) return;

      const px = msg.x * TILE_SIZE + TILE_SIZE / 2;
      const py = msg.y * TILE_SIZE + TILE_SIZE / 2;

      // 공 (팀 색상)
      const circle = this.add.circle(px, py, BALL_RADIUS, this.getTeamColor(msg.ownerId));
      this.ballsLayer.add(circle);

      // 광택 하이라이트
      const shine = this.add.circle(px, py, 4, 0xffffff, 0.8);
      this.ballsLayer.add(shine);

      const visual: BallVisual = {
        circle, shine,
        ballId: msg.ballId,
        ownerId: msg.ownerId,
      };
      this.ballVisuals.set(msg.ballId, visual);

      // 스폰 애니메이션
      animBallSpawn(this, [circle, shine]);
    };

    this.socket.onBallMoved = (msg: BallMovedMsg) => {
      const visual = this.ballVisuals.get(msg.ballId);
      if (!visual) return;
      if (this.endingBalls.has(msg.ballId)) return;

      const toX = msg.toX * TILE_SIZE + TILE_SIZE / 2;
      const toY = msg.toY * TILE_SIZE + TILE_SIZE / 2;
      const duration = this.timePerPhase * 1000; // 초 → ms

      // from→to를 timePerPhase 동안 클라이언트에서 자체 보간
      this.tweens.add({
        targets: [visual.circle, visual.shine],
        x: toX,
        y: toY,
        duration,
        ease: 'Linear',
      });
    };

    this.socket.onBallEnded = (msg: BallEndedMsg) => {
      const visual = this.ballVisuals.get(msg.ballId);
      if (!visual) return;
      if (this.endingBalls.has(msg.ballId)) return;

      this.endingBalls.add(msg.ballId);
      // 진행 중인 이동 tween 중지
      this.tweens.killTweensOf(visual.circle);
      this.tweens.killTweensOf(visual.shine);

      const color = this.getTeamColor(visual.ownerId);
      animBallEnd(
        this,
        this.ballsLayer,
        [visual.circle, visual.shine],
        visual.circle.x,
        visual.circle.y,
        color,
        () => {
          visual.circle.destroy();
          visual.shine.destroy();
          this.ballVisuals.delete(msg.ballId);
          this.endingBalls.delete(msg.ballId);
        },
      );
    };

    this.socket.onSpawnHp = (msg: SpawnHpMsg) => {
      this.updateSpawnHp(msg.spawnId, msg.hp, msg.ownerId);
    };

    this.socket.onSpawnDestroyed = (msg: SpawnDestroyedMsg) => {
      const visual = this.spawnVisuals.get(msg.spawnId);
      if (!visual || visual.destroyed) return;
      visual.destroyed = true;

      animSpawnDestroy(this, visual.bg, visual.hpBar, visual.hpBarBg, visual.label, visual.dirArrow);
    };

    this.socket.onReflectorPlaced = (msg: ReflectorPlacedMsg) => {
      this.drawReflector(msg.x, msg.y, msg.type, msg.playerId);
      animReflectorPlace(this, this.tilesLayer, msg.x, msg.y, this.getTeamColor(msg.playerId));
      this.updateReflectorCount();
    };

    this.socket.onReflectorRemoved = (msg: ReflectorRemovedMsg) => {
      const key = `${msg.x},${msg.y}`;
      const visual = this.reflectorVisuals.get(key);
      if (visual) {
        visual.graphics.destroy();
        this.reflectorVisuals.delete(key);
        // 팀색 배경: 1초에 걸쳐 페이드 아웃
        const bg = visual.bg;
        this.tweens.add({
          targets: bg,
          alpha: 0,
          duration: 1000,
          onComplete: () => bg.destroy(),
        });
      }
      this.updateReflectorCount();
    };

    this.socket.onGameOver = (msg: GameOverMsg) => {
      this.time.delayedCall(1000, () => {
        this.scene.start('ResultScene', {
          winnerId: msg.winnerId,
          myPlayerId: this.myPlayerId,
        });
      });
    };

    this.socket.onWallPlaced = (msg: WallPlacedMsg) => {
      this.drawWall(msg.x, msg.y, msg.hp, msg.maxHp);
      // 사용한 플레이어의 성벽 카운트 감소
      this.itemCounts.wall[msg.playerId as 0|1] = Math.max(0, this.itemCounts.wall[msg.playerId as 0|1] - 1);
      this.updateItemUI();
    };

    this.socket.onWallDamaged = (msg: WallDamagedMsg) => {
      this.updateWallHp(msg.x, msg.y, msg.hp);
    };

    this.socket.onWallDestroyed = (msg: WallDestroyedMsg) => {
      this.removeWallVisual(msg.x, msg.y);
    };

    this.socket.onTimeStopStarted = (msg: TimeStopStartedMsg) => {
      // 사용한 플레이어의 시간 정지 카운트 감소
      this.itemCounts.timeStop[msg.playerId as 0|1] = Math.max(0, this.itemCounts.timeStop[msg.playerId as 0|1] - 1);
      this.updateItemUI();
      this.showTimeStop(msg.duration);
    };

    this.socket.onTimeStopEnded = () => {
      this.hideTimeStop();
    };

    this.socket.onDisconnected = () => {
      this.add.text(
        this.scale.width / 2, this.scale.height / 2,
        'Disconnected',
        { fontSize: '20px', color: '#ff4444' },
      ).setOrigin(0.5);
    };
  }

  /** 자기 팀은 항상 파란색, 상대는 빨간색으로 반환 */
  private getTeamColor(playerId: number): number {
    return PLAYER_COLORS[playerId === this.myPlayerId ? 0 : 1];
  }

  private getTeamColorDark(playerId: number): number {
    return PLAYER_COLORS_DARK[playerId === this.myPlayerId ? 0 : 1];
  }

  private drawWall(gridX: number, gridY: number, hp: number, maxHp: number): void {
    const key = `${gridX},${gridY}`;
    const existing = this.wallVisuals.get(key);
    if (existing) {
      existing.bg.destroy();
      existing.hpBarBg.destroy();
      existing.hpBar.destroy();
      existing.hpText.destroy();
    }

    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE / 2;

    const bg = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, WALL_COLOR, 0.85);
    bg.setStrokeStyle(2, WALL_BORDER_COLOR, 1);
    this.tilesLayer.add(bg);

    const hpBarBg = this.add.rectangle(px, py - TILE_SIZE / 2 + HP_BAR_HEIGHT, TILE_SIZE - 4, HP_BAR_HEIGHT, 0x333333);
    this.tilesLayer.add(hpBarBg);

    const ratio = hp / maxHp;
    const hpBar = this.add.rectangle(
      px - (TILE_SIZE - 4) / 2 * (1 - ratio),
      py - TILE_SIZE / 2 + HP_BAR_HEIGHT,
      (TILE_SIZE - 4) * ratio, HP_BAR_HEIGHT, WALL_BORDER_COLOR,
    );
    this.tilesLayer.add(hpBar);

    const hpText = this.add.text(px, py + 2, String(hp), {
      fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.tilesLayer.add(hpText);

    this.wallVisuals.set(key, { bg, hpBar, hpBarBg, hpText, x: gridX, y: gridY, maxHp });
  }

  private updateWallHp(gridX: number, gridY: number, hp: number): void {
    const key = `${gridX},${gridY}`;
    const visual = this.wallVisuals.get(key);
    if (!visual) return;

    const ratio = hp / visual.maxHp;
    const fullWidth = TILE_SIZE - 4;
    visual.hpBar.setDisplaySize(fullWidth * ratio, HP_BAR_HEIGHT);
    visual.hpBar.setX(visual.x * TILE_SIZE + TILE_SIZE / 2 - fullWidth / 2 * (1 - ratio));
    visual.hpText.setText(String(hp));
  }

  private removeWallVisual(gridX: number, gridY: number): void {
    const key = `${gridX},${gridY}`;
    const visual = this.wallVisuals.get(key);
    if (!visual) return;

    // 파괴 애니메이션
    this.tweens.add({
      targets: [visual.bg, visual.hpBar, visual.hpBarBg, visual.hpText],
      alpha: 0,
      duration: 300,
      onComplete: () => {
        visual.bg.destroy();
        visual.hpBar.destroy();
        visual.hpBarBg.destroy();
        visual.hpText.destroy();
      },
    });
    this.wallVisuals.delete(key);
  }

  private showTimeStop(duration: number): void {
    this.timeStopTotal = duration;
    this.timeStopRemaining = duration;

    this.timeStopOverlay?.setVisible(true);
    this.timeStopLabel?.setVisible(true);
    this.timeStopGaugeBg?.setVisible(true);
    this.timeStopGauge?.setVisible(true);
    if (this.timeStopGauge) this.timeStopGauge.scaleX = 1;

    // 게이지 줄어드는 tween
    if (this.timeStopGauge) {
      this.tweens.add({
        targets: this.timeStopGauge,
        scaleX: 0,
        duration: duration * 1000,
        ease: 'Linear',
      });
    }
  }

  private hideTimeStop(): void {
    this.timeStopOverlay?.setVisible(false);
    this.timeStopLabel?.setVisible(false);
    this.timeStopGaugeBg?.setVisible(false);
    this.timeStopGauge?.setVisible(false);
    if (this.timeStopGauge) this.tweens.killTweensOf(this.timeStopGauge);
  }

  private drawReflector(gridX: number, gridY: number, type: ReflectorType, playerId: number): void {
    const key = `${gridX},${gridY}`;
    const existing = this.reflectorVisuals.get(key);
    if (existing) {
      existing.graphics.destroy();
      existing.bg.destroy();
      this.tweens.killTweensOf(existing.bg);
    }

    const px = gridX * TILE_SIZE;
    const py = gridY * TILE_SIZE;
    const m = 8;
    const color = this.getTeamColor(playerId);

    const bg = this.add.rectangle(
      px + TILE_SIZE / 2, py + TILE_SIZE / 2,
      TILE_SIZE - 2, TILE_SIZE - 2,
      color, 0.25,
    );
    this.tilesLayer.add(bg);

    // 흰색 플래시: 신규 생성 알림
    const flash = this.add.rectangle(
      px + TILE_SIZE / 2, py + TILE_SIZE / 2,
      TILE_SIZE - 2, TILE_SIZE - 2, 0xffffff, 0.7,
    );
    this.tilesLayer.add(flash);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 100,
      onComplete: () => flash.destroy(),
    });

    const g = this.add.graphics();
    g.lineStyle(3, color, 1);

    switch (type) {
      case ReflectorType.Slash:
        // "/" 대각선: 왼쪽 아래 → 오른쪽 위
        g.lineBetween(px + m, py + TILE_SIZE - m, px + TILE_SIZE - m, py + m);
        break;
      case ReflectorType.Backslash:
        // "\" 대각선: 왼쪽 위 → 오른쪽 아래
        g.lineBetween(px + m, py + m, px + TILE_SIZE - m, py + TILE_SIZE - m);
        break;
    }

    this.tilesLayer.add(g);
    this.reflectorVisuals.set(key, { graphics: g, bg, x: gridX, y: gridY, type, playerId });
  }
}
