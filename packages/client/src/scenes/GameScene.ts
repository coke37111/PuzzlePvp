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

      if (gridX < 0 || gridX >= size || gridY < 0 || gridY >= size) return;

      const tile = this.mapModel.getTile(gridX, gridY);
      if (!tile || !tile.isReflectorSetable) return;
      if (this.enemyZoneTiles.has(`${gridX},${gridY}`)) return;

      const key = `${gridX},${gridY}`;
      const existing = this.reflectorVisuals.get(key);

      if (!existing) {
        // 빈 타일 → Slash 설치
        const myCount = [...this.reflectorVisuals.values()]
          .filter(v => v.playerId === this.myPlayerId).length;
        if (myCount >= MAX_REFLECTORS_PER_PLAYER) {
          this.showToast('반사판 한도 초과. 기존 반사판을 먼저 제거하세요.');
          return;
        }
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

    // 호버 이펙트 (빈 설치 가능 타일에만)
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
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

    this.add.text(width / 2, height - 28, '터치: / → \\ → 제거', {
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
    this.reflectorVisuals.set(key, { graphics: g, x: gridX, y: gridY, type, playerId });
  }
}
