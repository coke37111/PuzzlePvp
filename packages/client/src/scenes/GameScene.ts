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
  POPUP_BTN_SIZE, POPUP_BTN_GAP, POPUP_ANIM_OPEN, POPUP_ANIM_CLOSE,
  MAX_REFLECTORS_PER_PLAYER,
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
  glow: Phaser.GameObjects.Arc;
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
  x: number;
  y: number;
  type: ReflectorType;
  playerId: number;
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

  // 반사판 선택 팝업
  private popupContainer: Phaser.GameObjects.Container | null = null;
  private popupGridX: number = -1;
  private popupGridY: number = -1;
  private reflectorCountText: Phaser.GameObjects.Text | null = null;

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
    this.hpTweens.clear();
    this.endingBalls.clear();
    this.enemyZoneTiles.clear();
    this.hoverHighlight = null;
    this.popupContainer = null;
    this.reflectorCountText = null;

    this.drawGrid();
    this.setupInput();
    this.setupUI();
    this.setupSocketEvents();

    this.add.text(width / 2, 8, `Player ${this.myPlayerId + 1} (${this.myPlayerId === 0 ? 'Blue' : 'Red'})`, {
      fontSize: '14px',
      color: this.myPlayerId === 0 ? '#4488ff' : '#ff4444',
    }).setOrigin(0.5, 0);
  }

  // --- 씬 종료 시 정리 ---
  shutdown(): void {
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.popupContainer?.destroy();
    this.popupContainer = null;
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
      const color = PLAYER_COLORS[sp.ownerId];

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = sp.x + dx;
          const ny = sp.y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;

          const tileIdx = this.mapData.tiles[ny][nx];
          if (tileIdx < EMPTY_TILE_INDEX) continue;
          if (tileIdx === 2 || tileIdx === 3 || tileIdx === 7) continue;

          const key = `${nx},${ny}`;

          // 설치 불가 추적은 적 스폰 주변만
          if (isEnemy) this.enemyZoneTiles.add(key);

          // 오버레이는 중복 없이 모두 표시
          if (drawnKeys.has(key)) continue;
          drawnKeys.add(key);

          const px = nx * TILE_SIZE + TILE_SIZE / 2;
          const py = ny * TILE_SIZE + TILE_SIZE / 2;
          const overlay = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, color, ENEMY_ZONE_ALPHA);
          this.tilesLayer.add(overlay);
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

    const bg = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, PLAYER_COLORS_DARK[ownerId], 0.4);
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
    const arrowColor = PLAYER_COLORS[ownerId];
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
      animDamageFlash(this, visual.bg, PLAYER_COLORS_DARK[visual.ownerId], 0.4);
      const damage = oldHp - hp;
      const popupX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      const popupY = visual.y * TILE_SIZE;
      animDamagePopup(this, this.tilesLayer, popupX, popupY, damage);
    }
  }

  // === 입력 처리 ===

  private setupInput(): void {
    const size = this.mapData.size;

    this.input.on('pointerdown', (_pointer: Phaser.Input.Pointer) => {
      const localX = _pointer.x - this.gridOffsetX;
      const localY = _pointer.y - this.gridOffsetY;
      const gridX = Math.floor(localX / TILE_SIZE);
      const gridY = Math.floor(localY / TILE_SIZE);

      // 그리드 밖
      if (gridX < 0 || gridX >= size || gridY < 0 || gridY >= size) {
        this.closeReflectorPopup();
        return;
      }

      // 같은 타일 다시 클릭 → 팝업 닫기
      if (this.popupContainer && this.popupGridX === gridX && this.popupGridY === gridY) {
        this.closeReflectorPopup();
        return;
      }

      const tile = this.mapModel.getTile(gridX, gridY);
      if (!tile || !tile.isReflectorSetable) {
        this.closeReflectorPopup();
        return;
      }

      if (this.enemyZoneTiles.has(`${gridX},${gridY}`)) {
        this.closeReflectorPopup();
        return;
      }

      // 반사판 없는 타일인데 내 한도가 꽉 찼으면 토스트
      const tileHasReflector = this.reflectorVisuals.has(`${gridX},${gridY}`);
      const myCount = [...this.reflectorVisuals.values()]
        .filter(v => v.playerId === this.myPlayerId).length;
      if (!tileHasReflector && myCount >= MAX_REFLECTORS_PER_PLAYER) {
        this.showToast('반사판이 없습니다. 기존 반사판을 제거 후 설치하세요.');
        return;
      }

      this.openReflectorPopup(gridX, gridY);
    });

    // 호버 이펙트
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.popupContainer) {
        if (this.hoverHighlight) this.hoverHighlight.setVisible(false);
        return;
      }

      const localX = pointer.x - this.gridOffsetX;
      const localY = pointer.y - this.gridOffsetY;
      const gridX = Math.floor(localX / TILE_SIZE);
      const gridY = Math.floor(localY / TILE_SIZE);

      if (gridX < 0 || gridX >= size || gridY < 0 || gridY >= size) {
        if (this.hoverHighlight) this.hoverHighlight.setVisible(false);
        return;
      }

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

  // === UI ===

  private setupUI(): void {
    const { width, height } = this.scale;

    this.add.text(width / 2, height - 28, '타일을 클릭해 반사판을 설치하세요', {
      fontSize: '11px',
      color: '#666688',
    }).setOrigin(0.5);

    this.reflectorCountText = this.add.text(
      width / 2, height - 13,
      `◆ ${MAX_REFLECTORS_PER_PLAYER}/${MAX_REFLECTORS_PER_PLAYER}`,
      { fontSize: '13px', color: '#aaaaff', fontStyle: 'bold' },
    ).setOrigin(0.5);
  }

  private updateReflectorCount(): void {
    if (!this.reflectorCountText) return;
    const myCount = [...this.reflectorVisuals.values()]
      .filter(v => v.playerId === this.myPlayerId).length;
    const remaining = MAX_REFLECTORS_PER_PLAYER - myCount;
    this.reflectorCountText.setText(`◆ ${remaining}/${MAX_REFLECTORS_PER_PLAYER}`);
    if (remaining === 0) {
      this.reflectorCountText.setColor('#ff4444');
    } else if (remaining <= 2) {
      this.reflectorCountText.setColor('#cccc44');
    } else {
      this.reflectorCountText.setColor('#aaaaff');
    }
  }

  private openReflectorPopup(gridX: number, gridY: number): void {
    this.closeReflectorPopup();

    const worldX = gridX * TILE_SIZE + TILE_SIZE / 2 + this.gridOffsetX;
    const tileCenterY = gridY * TILE_SIZE + TILE_SIZE / 2 + this.gridOffsetY;

    const hasReflector = this.reflectorVisuals.has(`${gridX},${gridY}`);

    // step: 버튼 크기 + 간격, half: 그 절반
    const step = POPUP_BTN_SIZE + POPUP_BTN_GAP;  // 42
    const half = step / 2;                          // 21

    // 레이아웃:
    //   반사판 있음 → [TL][TR] / [X] / [BL][BR]  (X가 2x2 중앙)
    //   반사판 없음 → [TL][TR] / [BL][BR]
    const popupW = 2 * step - POPUP_BTN_GAP + 16;
    const popupH = (hasReflector ? 3 : 2) * step - POPUP_BTN_GAP + 16;

    const { width, height } = this.scale;
    let px = worldX;
    let py = tileCenterY;
    px = Math.max(popupW / 2 + 4, Math.min(width - popupW / 2 - 4, px));
    py = Math.max(popupH / 2 + 4, Math.min(height - popupH / 2 - 4, py));

    const container = this.add.container(px, py);
    container.setDepth(100);

    const bgRect = this.add.rectangle(0, 0, popupW, popupH, 0x1a1a2e, 0.6);
    bgRect.setStrokeStyle(1, 0x5555aa, 0.5);
    container.add(bgRect);

    // 2x2 반사판 버튼:
    //   hasReflector: 행0 by=-step, 행1 by=+step  (X가 by=0으로 사이에 삽입)
    //   !hasReflector: 행0 by=-half, 행1 by=+half
    const types2x2 = [
      [ReflectorType.TopLeft,    ReflectorType.TopRight],
      [ReflectorType.BottomLeft, ReflectorType.BottomRight],
    ];

    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const type = types2x2[row][col];
        const bx = col === 0 ? -half : half;
        const by = hasReflector
          ? (row === 0 ? -step : step)
          : (row === 0 ? -half : half);

        const btnBg = this.add.rectangle(bx, by, POPUP_BTN_SIZE, POPUP_BTN_SIZE, 0x2a2a4a, 0.6)
          .setInteractive({ useHandCursor: true });
        const icon = this.drawReflectorIcon(bx, by, POPUP_BTN_SIZE, type, 0xccccff);

        btnBg.on('pointerover', () => btnBg.setFillStyle(0x4444aa, 0.8));
        btnBg.on('pointerout', () => btnBg.setFillStyle(0x2a2a4a, 0.6));
        btnBg.on(
          'pointerdown',
          (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
            ev.stopPropagation();
            this.socket.placeReflector(gridX, gridY, type);
            this.closeReflectorPopup();
          },
        );

        container.add([btnBg, icon]);
      }
    }

    // X 삭제 버튼 — 반사판 있을 때만, 2x2 사이 중앙(by=0)
    if (hasReflector) {
      const removeBg = this.add.rectangle(0, 0, POPUP_BTN_SIZE, POPUP_BTN_SIZE, 0x2a2a4a, 0.6)
        .setInteractive({ useHandCursor: true });

      const rg = this.add.graphics();
      const m = POPUP_BTN_SIZE * 0.28;
      rg.lineStyle(2, 0xff6666, 1);
      rg.lineBetween(-m, -m, m, m);
      rg.lineBetween(m, -m, -m, m);

      removeBg.on('pointerover', () => removeBg.setFillStyle(0xaa2222, 0.8));
      removeBg.on('pointerout', () => removeBg.setFillStyle(0x2a2a4a, 0.6));
      removeBg.on(
        'pointerdown',
        (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
          ev.stopPropagation();
          this.socket.removeReflector(gridX, gridY);
          this.closeReflectorPopup();
        },
      );

      container.add([removeBg, rg]);
    }

    container.setScale(0);
    this.tweens.add({
      targets: container,
      scaleX: 1, scaleY: 1,
      duration: POPUP_ANIM_OPEN,
      ease: 'Back.easeOut',
    });

    this.popupContainer = container;
    this.popupGridX = gridX;
    this.popupGridY = gridY;
  }

  private closeReflectorPopup(): void {
    if (!this.popupContainer) return;
    const container = this.popupContainer;
    this.popupContainer = null;
    this.popupGridX = -1;
    this.popupGridY = -1;
    this.tweens.add({
      targets: container,
      scaleX: 0, scaleY: 0,
      duration: POPUP_ANIM_CLOSE,
      ease: 'Quad.easeIn',
      onComplete: () => container.destroy(),
    });
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

  private drawReflectorIcon(
    cx: number, cy: number, size: number,
    type: ReflectorType, color: number,
  ): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    const m = size * 0.22;
    const left = cx - size / 2 + m;
    const right = cx + size / 2 - m;
    const top = cy - size / 2 + m;
    const bottom = cy + size / 2 - m;

    g.lineStyle(3, color, 1);
    g.fillStyle(color, 1);

    switch (type) {
      case ReflectorType.TopLeft:
        g.lineBetween(left, bottom, right, top);
        g.fillCircle(left, top, 3);
        break;
      case ReflectorType.TopRight:
        g.lineBetween(left, top, right, bottom);
        g.fillCircle(right, top, 3);
        break;
      case ReflectorType.BottomLeft:
        g.lineBetween(left, top, right, bottom);
        g.fillCircle(left, bottom, 3);
        break;
      case ReflectorType.BottomRight:
        g.lineBetween(left, bottom, right, top);
        g.fillCircle(right, bottom, 3);
        break;
    }

    return g;
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

      // 글로우 (소유자 색상)
      const glow = this.add.circle(px, py, BALL_RADIUS + GLOW_RADIUS_EXTRA, PLAYER_COLORS[msg.ownerId], GLOW_ALPHA);
      this.ballsLayer.add(glow);

      // 공 (흰색)
      const circle = this.add.circle(px, py, BALL_RADIUS, 0xffffff);
      this.ballsLayer.add(circle);

      const visual: BallVisual = {
        circle, glow,
        ballId: msg.ballId,
        ownerId: msg.ownerId,
      };
      this.ballVisuals.set(msg.ballId, visual);

      // 스폰 애니메이션
      animBallSpawn(this, [circle, glow]);
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
        targets: [visual.circle, visual.glow],
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
      this.tweens.killTweensOf(visual.glow);
      const color = PLAYER_COLORS[visual.ownerId];

      animBallEnd(
        this,
        this.ballsLayer,
        [visual.circle, visual.glow],
        visual.circle.x,
        visual.circle.y,
        color,
        () => {
          visual.circle.destroy();
          visual.glow.destroy();
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
      animReflectorPlace(this, this.tilesLayer, msg.x, msg.y, PLAYER_COLORS[msg.playerId]);
      this.updateReflectorCount();
    };

    this.socket.onReflectorRemoved = (msg: ReflectorRemovedMsg) => {
      const key = `${msg.x},${msg.y}`;
      const visual = this.reflectorVisuals.get(key);
      if (visual) {
        visual.graphics.destroy();
        this.reflectorVisuals.delete(key);
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

    this.socket.onDisconnected = () => {
      this.add.text(
        this.scale.width / 2, this.scale.height / 2,
        'Disconnected',
        { fontSize: '20px', color: '#ff4444' },
      ).setOrigin(0.5);
    };
  }

  private drawReflector(gridX: number, gridY: number, type: ReflectorType, playerId: number): void {
    const key = `${gridX},${gridY}`;
    const existing = this.reflectorVisuals.get(key);
    if (existing) existing.graphics.destroy();

    const px = gridX * TILE_SIZE;
    const py = gridY * TILE_SIZE;
    const m = 8;
    const color = PLAYER_COLORS[playerId];

    const g = this.add.graphics();
    g.lineStyle(3, color, 1);

    switch (type) {
      case ReflectorType.TopLeft:
        g.lineBetween(px + m, py + TILE_SIZE - m, px + TILE_SIZE - m, py + m);
        g.fillStyle(color, 1);
        g.fillCircle(px + m, py + m, 4);
        break;
      case ReflectorType.TopRight:
        g.lineBetween(px + m, py + m, px + TILE_SIZE - m, py + TILE_SIZE - m);
        g.fillStyle(color, 1);
        g.fillCircle(px + TILE_SIZE - m, py + m, 4);
        break;
      case ReflectorType.BottomLeft:
        g.lineBetween(px + m, py + m, px + TILE_SIZE - m, py + TILE_SIZE - m);
        g.fillStyle(color, 1);
        g.fillCircle(px + m, py + TILE_SIZE - m, 4);
        break;
      case ReflectorType.BottomRight:
        g.lineBetween(px + m, py + TILE_SIZE - m, px + TILE_SIZE - m, py + m);
        g.fillStyle(color, 1);
        g.fillCircle(px + TILE_SIZE - m, py + TILE_SIZE - m, 4);
        break;
    }

    this.tilesLayer.add(g);
    this.reflectorVisuals.set(key, { graphics: g, x: gridX, y: gridY, type, playerId });
  }
}
