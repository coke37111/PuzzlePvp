import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import {
  MonsterInfo,
  MonsterSpawnedMsg,
  MonsterDamagedMsg,
  MonsterKilledMsg,
  MonsterMovedMsg,
  ItemDroppedMsg,
  ItemPickedUpMsg,
  BallPoweredUpMsg,
  PlayerBallCountUpMsg,
  PlayerSpeedUpMsg,
  PlayerReflectorExpandMsg,
  SpawnHealedMsg,
  MapLayoutConfig,
  CoreHealedMsg,
  MatchFoundMsg,
  SpawnPointInfo,
  CoreInfo,
  MapData,
  ReflectorType,
  BallSpawnedMsg,
  BallMovedMsg,
  BallEndedMsg,
  SpawnHpMsg,
  SpawnDestroyedMsg,
  SpawnRespawnedMsg,
  ReflectorPlacedMsg,
  ReflectorRemovedMsg,
  GameOverMsg,
  WallPlacedMsg,
  WallDamagedMsg,
  WallDestroyedMsg,
  GoldUpdatedMsg,
  SwordUsedMsg,
  ShieldAppliedMsg,
  ShieldExpiredMsg,
  CoreHpMsg,
  CoreDestroyedMsg,
  SpawnPhaseCompleteMsg,
  ReflectorStockMsg,
  createBattleTileRegistry,
  MapModel,
  EMPTY_TILE_INDEX,
  MonsterType,
  DropItemType,
  Direction,
  TowerBoxInfo,
  TowerBoxDamagedMsg,
  TowerBoxBrokenMsg,
  OwnershipTransferredMsg,
  PlayerLeftMsg,
} from '@puzzle-pvp/shared';

import {
  TILE_SIZE, BALL_RADIUS, HP_BAR_HEIGHT,
  PLAYER_COLORS, PLAYER_COLORS_DARK, BALL_COLOR,
  BALL_TEAM_COLORS,
  MONSTER_COLORS, MONSTER_BORDERS, ITEM_COLORS,
  BG_COLOR,
  TILE_EMPTY_COLOR, TILE_P1_SPAWN_COLOR, TILE_P2_SPAWN_COLOR,
  TILE_P1_CORE_COLOR, TILE_P2_CORE_COLOR,
  TILE_BLOCK_COLOR, TILE_BLOCK_X_COLOR, TILE_BLOCK_X_ALPHA,
  HOVER_COLOR, HOVER_ALPHA,
  GLOW_RADIUS_EXTRA, GLOW_ALPHA,
  ENEMY_ZONE_ALPHA,
  MAX_REFLECTORS_PER_PLAYER,
  WALL_COLOR, WALL_BORDER_COLOR,
  ITEM_COST_WALL, ITEM_COST_SWORD, ITEM_COST_SHIELD,
  SHIELD_COLOR, SHIELD_ALPHA,
  SPAWN_GAUGE_HEIGHT, SPAWN_GAUGE_COLOR,
} from '../visual/Constants';
import { drawGridLines } from '../visual/GridRenderer';
import { SoundManager } from '../visual/SoundManager';
import {
  animBallSpawn,
  animBallEnd,
  animReflectorPlace,
  animHpBar,
  animDamageFlash,
  animSpawnDestroy,
  animSpawnRespawn,
  getHpColor,
  animDamagePopup,
  animHealPopup,
  toAbbreviatedString,
} from '../visual/VisualEffects';

interface BallVisual {
  circle: Phaser.GameObjects.Arc;
  shine: Phaser.GameObjects.Arc;
  ballId: number;
  ownerId: number;
  lastDx: number;  // 마지막 이동 방향 (픽셀 단위, TILE_SIZE 기준)
  lastDy: number;
}

interface MonsterVisual {
  id: number;
  container: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
  maxHp: number;
  currentHp: number;
}

interface ItemVisual {
  id: number;
  container: Phaser.GameObjects.Container;
  x: number;
  y: number;
}

interface SpawnVisual {
  id: number;
  bg: Phaser.GameObjects.Shape;
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
  countdownText: Phaser.GameObjects.Text | null;
  countdownEvent: Phaser.Time.TimerEvent | null;
}

interface ReflectorVisual {
  graphics: Phaser.GameObjects.Graphics;
  bg: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  type: ReflectorType;
  playerId: number;
}

interface CoreVisual {
  id: number;
  bg: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  diamond: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  maxHp: number;
  currentHp: number;
  ownerId: number;
  destroyed: boolean;
}

interface WallVisual {
  bg: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
  x: number;
  y: number;
  maxHp: number;
  currentHp: number;
  ownerId: number;
}

interface TowerBoxVisual {
  bg: Phaser.GameObjects.Rectangle;
  lockOverlay: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
  spawnId: number;
  maxHp: number;
  currentHp: number;
}

export class GameScene extends Phaser.Scene {
  private socket!: SocketClient;
  private myPlayerId: number = 0;
  private myTeamId: number = 0;
  private totalPlayerCount: number = 2;
  private remainingPlayersText: Phaser.GameObjects.Text | null = null;
  private mapData!: MapData;
  private mapModel!: MapModel;
  private serverSpawnPoints: SpawnPointInfo[] = [];
  private serverCores: CoreInfo[] = [];
  private timePerPhase: number = 0.3;
  private currentPhaseNumber: number = 0;

  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private initialZoom: number = 1;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private pointerDownX: number = 0;
  private pointerDownY: number = 0;
  private readonly DRAG_THRESHOLD = 5;
  private layout?: MapLayoutConfig;
  private myMapFocusBtn: Phaser.GameObjects.Rectangle | null = null;

  private ballVisuals: Map<number, BallVisual> = new Map();
  private pendingBallSpawns: Map<number, { ownerId: number; phaseNumber: number }> = new Map();
  private spawnVisuals: Map<number, SpawnVisual> = new Map();
  private coreVisuals: Map<number, CoreVisual> = new Map();
  private reflectorVisuals: Map<string, ReflectorVisual> = new Map();
  private towerBoxVisuals: Map<number, TowerBoxVisual> = new Map();  // spawnId → visual

  private tilesLayer!: Phaser.GameObjects.Container;
  private ballsLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;

  private reflectorCountTexts: [Phaser.GameObjects.Text | null, Phaser.GameObjects.Text | null] = [null, null];

  // 골드 및 아이템 UI
  private myGold: number = 0;
  private goldText: Phaser.GameObjects.Text | null = null;
  private wallMode: boolean = false;
  private swordMode: boolean = false;
  private shieldMode: boolean = false;
  private wallModeText: Phaser.GameObjects.Text | null = null;
  private swordModeText: Phaser.GameObjects.Text | null = null;
  private shieldModeText: Phaser.GameObjects.Text | null = null;
  private wallCursor: Phaser.GameObjects.Rectangle | null = null;
  private wallVisuals: Map<string, WallVisual> = new Map();
  private shieldVisuals: Map<string, Phaser.GameObjects.Rectangle> = new Map();

  // 아이템 슬롯 버튼 (터치 가능)
  private itemSlotWallBg: Phaser.GameObjects.Rectangle | null = null;
  private itemSlotWallText: Phaser.GameObjects.Text | null = null;
  private itemSlotSwordBg: Phaser.GameObjects.Rectangle | null = null;
  private itemSlotSwordText: Phaser.GameObjects.Text | null = null;
  private itemSlotShieldBg: Phaser.GameObjects.Rectangle | null = null;
  private itemSlotShieldText: Phaser.GameObjects.Text | null = null;

  // 스폰 타이밍 게이지
  private spawnInterval: number = 5.0;
  private spawnGaugeBg: Phaser.GameObjects.Rectangle | null = null;
  private spawnGaugeFill: Phaser.GameObjects.Rectangle | null = null;
  private spawnGaugeFiring: boolean = false;
  private phaseCount: number = 0;
  private phaseText: Phaser.GameObjects.Text | null = null;

  // 애니메이션 보조
  private hpTweens: Map<string, Phaser.Tweens.Tween> = new Map();
  private hoverHighlight: Phaser.GameObjects.Rectangle | null = null;
  private endingBalls: Set<number> = new Set();
  private ballMoveTweens: Map<number, Phaser.Tweens.Tween> = new Map();
  private playerPowerLevel: Map<number, number> = new Map();
  private enemyZoneTiles: Set<string> = new Set(); // "x,y" 형식
  private enemyZoneOverlays: Map<number, Phaser.GameObjects.Rectangle[]> = new Map(); // spawnId → overlays
  // 격벽 미파괴 구역 오버레이
  private inaccessibleZoneTiles: Set<string> = new Set();
  private inaccessibleZoneOverlays: Phaser.GameObjects.Rectangle[] = [];
  private capturedZones: Map<number, number> = new Map(); // oldOwnerId → capturedByPlayerId
  // 반사판 스톡 UI
  private reflectorCooldown: number = 3.0;
  private maxReflectorStock: number = 5;
  private myReflectorStock: number = 5;
  private myReflectorCooldownElapsed: number = 0;
  private reflectorSlotBgs: Phaser.GameObjects.Rectangle[] = [];
  private reflectorSlotFills: Phaser.GameObjects.Rectangle[] = [];
  private reflectorSlotLockTexts: Phaser.GameObjects.Text[] = [];
  private reflectorCooldownTween: Phaser.Tweens.Tween | null = null;
  private reflectorSlotOrigXs: number[] = [];
  private shakeInProgress: boolean = false;
  private myDestroyedSpawnCount: number = 0;
  private effectiveMaxReflectorSlots: number = 5;
  private mySpawnSlotMap: Map<number, number> = new Map(); // spawnId → locked slot index
  private slotRespawnTimerEvents: Map<number, Phaser.Time.TimerEvent> = new Map(); // slot index → timer
  private sfx!: SoundManager;
  private muteBtnBg: Phaser.GameObjects.Rectangle | null = null;
  private muteBtnText: Phaser.GameObjects.Text | null = null;
  private monsterVisuals: Map<number, MonsterVisual> = new Map();
  private itemVisuals: Map<number, ItemVisual> = new Map();
  private _initMonsters: MonsterInfo[] = [];
  private _initWalls: WallPlacedMsg[] = [];
  private _initTowerBoxes: TowerBoxInfo[] = [];

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { matchData: MatchFoundMsg; socket: SocketClient }): void {
    this.socket = data.socket;
    this.myPlayerId = data.matchData.playerId;
    this.myTeamId = data.matchData.teamId ?? this.myPlayerId;
    this.totalPlayerCount = data.matchData.playerCount ?? 2;
    this.mapData = data.matchData.mapData;
    this.serverSpawnPoints = data.matchData.spawnPoints || [];
    this.serverCores = data.matchData.cores || [];
    this.timePerPhase = data.matchData.timePerPhase || 0.3;
    this.spawnInterval = data.matchData.spawnInterval || 5.0;
    this.reflectorCooldown = data.matchData.reflectorCooldown || 3.0;
    this.maxReflectorStock = data.matchData.maxReflectorStock || 5;
    this.myReflectorStock = data.matchData.initialReflectorStock ?? this.maxReflectorStock;
    this.myDestroyedSpawnCount = 0;
    this.effectiveMaxReflectorSlots = this.maxReflectorStock;
    this.mySpawnSlotMap = new Map();
    this.slotRespawnTimerEvents = new Map();
    this.myReflectorCooldownElapsed = 0;
    this._initMonsters = data.matchData.monsters ?? [];
    this._initWalls = data.matchData.walls ?? [];
    this._initTowerBoxes = data.matchData.towerBoxes ?? [];
    this.layout = data.matchData.layout;

    const registry = createBattleTileRegistry();
    this.mapModel = new MapModel(registry);
    this.mapModel.load(this.mapData);
  }

  create(): void {
    // 우클릭 컨텍스트 메뉴 방지
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const { width, height } = this.scale;

    // 레이어: 게임 월드(원점 기준) + UI(화면 고정)
    this.tilesLayer = this.add.container(0, 0);
    this.ballsLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    // 메인 카메라: 게임 월드 줌/팬
    const worldW = this.mapData.width * TILE_SIZE;
    const worldH = this.mapData.height * TILE_SIZE;
    this.initialZoom = Math.min(width / worldW, height / worldH, 1.0);
    this.cameras.main.setBackgroundColor(BG_COLOR);
    // bounds를 최소줌 기준 반화면 크기만큼 확장 → 최소줌에서도 맵 어디든 화면 중앙에 올 수 있음
    const halfVW = width / (2 * this.initialZoom);
    const halfVH = height / (2 * this.initialZoom);
    this.cameras.main.setBounds(-halfVW, -halfVH, worldW + halfVW * 2, worldH + halfVH * 2);
    this.cameras.main.setZoom(this.initialZoom);
    this.cameras.main.centerOn(worldW / 2, worldH / 2);
    this.cameras.main.ignore(this.uiLayer);

    // UI 카메라: 화면 고정 (줌/스크롤 없음)
    this.uiCamera = this.cameras.add(0, 0, width, height);
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.ignore([this.tilesLayer, this.ballsLayer]);

    // 상태 초기화
    this.ballVisuals.clear();
    this.pendingBallSpawns.clear();
    for (const v of this.spawnVisuals.values()) this.clearSpawnCountdown(v);
    this.spawnVisuals.clear();
    this.coreVisuals.clear();
    this.reflectorVisuals.clear();
    this.wallVisuals.clear();
    this.towerBoxVisuals.clear();
    this.hpTweens.clear();
    this.endingBalls.clear();
    this.ballMoveTweens.clear();
    this.playerPowerLevel.clear();
    this.enemyZoneTiles.clear();
    this.enemyZoneOverlays.clear();
    this.inaccessibleZoneTiles.clear();
    this.inaccessibleZoneOverlays = [];
    this.capturedZones.clear();
    this.hoverHighlight = null;
    this.wallMode = false;
    this.swordMode = false;
    this.shieldMode = false;
    this.wallModeText = null;
    this.swordModeText = null;
    this.shieldModeText = null;
    this.wallCursor = null;
    this.myGold = 0;
    this.goldText = null;
    this.shieldVisuals.clear();
    this.spawnGaugeBg = null;
    this.spawnGaugeFill = null;
    this.spawnGaugeFiring = false;
    this.phaseCount = 0;
    this.phaseText = null;
    this.reflectorCountTexts = [null, null];
    this.itemSlotWallBg = null;
    this.itemSlotWallText = null;
    this.itemSlotSwordBg = null;
    this.itemSlotSwordText = null;
    this.itemSlotShieldBg = null;
    this.itemSlotShieldText = null;
    this.muteBtnBg = null;
    this.muteBtnText = null;

    this.sfx = new SoundManager();
    this.sfx.muted = localStorage.getItem('sfx_muted') === '1';
    this.monsterVisuals = new Map();
    this.itemVisuals = new Map();

    this.drawGrid();
    this.showCoreHighlight();
    for (const w of this._initWalls) {
      this.drawWall(w.x, w.y, w.hp, w.maxHp, w.playerId);
    }
    this.rebuildInaccessibleZoneOverlays();
    for (const m of this._initMonsters) {
      this.drawMonster(m.id, m.monsterType, m.x, m.y, m.hp, m.maxHp);
    }
    for (const box of this._initTowerBoxes) {
      const sp = this.serverSpawnPoints.find(s => s.id === box.spawnId);
      if (sp) this.createTowerBoxVisual(sp.x, sp.y, box.spawnId, box.hp, box.maxHp);
    }
    this.createReflectorStockUI();
    this.updateReflectorStockUI(this.myReflectorStock, 0); // 초기 풀스톡 표시
    this.setupInput();
    this.setupUI();
    this.setupSocketEvents();
    this.showPreGameIntro();
  }

  // --- 씬 종료 시 정리 ---
  shutdown(): void {
    this.input.enabled = true;
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);
    if (this.uiCamera) {
      this.cameras.remove(this.uiCamera);
    }
    this.myMapFocusBtn = null;
    this.tweens.killAll();
    this.time.removeAllEvents();
    // 다음 게임에서 stale 콜백 방지
    this.socket.onBallSpawned = undefined;
    this.socket.onBallMoved = undefined;
    this.socket.onBallEnded = undefined;
    this.socket.onSpawnHp = undefined;
    this.socket.onSpawnDestroyed = undefined;
    this.socket.onSpawnRespawned = undefined;
    this.socket.onReflectorPlaced = undefined;
    this.socket.onReflectorRemoved = undefined;
    this.socket.onGameOver = undefined;
    this.socket.onWallPlaced = undefined;
    this.socket.onWallDamaged = undefined;
    this.socket.onWallDestroyed = undefined;
    this.socket.onGoldUpdated = undefined;
    this.socket.onSwordUsed = undefined;
    this.socket.onShieldApplied = undefined;
    this.socket.onShieldExpired = undefined;
    this.socket.onCoreHp = undefined;
    this.socket.onCoreDestroyed = undefined;
    this.socket.onSpawnPhaseComplete = undefined;
    this.socket.onReflectorStock = undefined;
    this.socket.onMonsterSpawned = undefined;
    this.socket.onMonsterDamaged = undefined;
    this.socket.onMonsterKilled = undefined;
    this.socket.onMonsterMoved = undefined;
    this.socket.onItemDropped = undefined;
    this.socket.onItemPickedUp = undefined;
    this.socket.onBallPoweredUp = undefined;
    this.socket.onPlayerBallCountUp = undefined;
    this.socket.onPlayerSpeedUp = undefined;
    this.socket.onPlayerReflectorExpand = undefined;
    this.socket.onSpawnHealed = undefined;
    this.socket.onCoreHealed = undefined;
    this.socket.onTowerBoxDamaged = undefined;
    this.socket.onTowerBoxBroken = undefined;
    this.socket.onLobbyUpdate = undefined;
    this.socket.onPlayerEliminated = undefined;
    this.socket.onOwnershipTransferred = undefined;
    this.remainingPlayersText = null;
    this.monsterVisuals.clear();
    this.itemVisuals.clear();
    this.towerBoxVisuals.clear();
    this.reflectorSlotBgs = [];
    this.reflectorSlotFills = [];
    this.reflectorCooldownTween = null;
  }

  // === 그리드 그리기 ===

  private drawGrid(): void {
    const { width, height } = this.mapData;

    // 그리드 라인 (타일 뒤)
    drawGridLines(this, this.tilesLayer, this.mapData);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
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

        // 스폰포인트 (타일 인덱스 2,3,4,5)
        if (tileIdx === 2 || tileIdx === 3 || tileIdx === 4 || tileIdx === 5) {
          const spInfo = this.serverSpawnPoints.find(sp => sp.x === x && sp.y === y);
          if (spInfo) {
            this.createSpawnVisual(x, y, spInfo.ownerId, spInfo.id, spInfo.maxHp, spInfo.direction);
          }
        }

        // 코어 타일 (타일 인덱스 6, 8)
        if (tileIdx === 6 || tileIdx === 8) {
          const coreInfo = this.serverCores.find(c => c.x === x && c.y === y);
          if (coreInfo) {
            this.createCoreVisual(x, y, coreInfo.ownerId, coreInfo.id, coreInfo.maxHp);
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

  // === 반사판 스톡 UI ===

  private readonly SLOT_SIZE = 22;
  private readonly SLOT_GAP = 4;

  private createReflectorStockUI(): void {
    const ox = 8;
    const sy = SPAWN_GAUGE_HEIGHT + 4;
    this.reflectorSlotBgs = [];
    this.reflectorSlotFills = [];
    this.reflectorSlotLockTexts = [];
    this.reflectorSlotOrigXs = [];
    this.shakeInProgress = false;

    for (let i = 0; i < this.maxReflectorStock; i++) {
      const sx = ox + i * (this.SLOT_SIZE + this.SLOT_GAP);

      // 슬롯 배경 (어두운 색)
      const bg = this.add.rectangle(sx, sy, this.SLOT_SIZE, this.SLOT_SIZE, 0x111122)
        .setOrigin(0, 0).setDepth(5);
      // 반사판 아이콘 텍스트 (/)
      const iconText = this.add.text(sx + this.SLOT_SIZE / 2, sy + this.SLOT_SIZE / 2, '/', {
        fontSize: '14px', color: '#aaaaff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(6);
      // 쿨다운 필: 아이콘 위에 겹쳐서 아래→위로 채워짐 (depth 7 > icon 6)
      const fill = this.add.rectangle(sx, sy + this.SLOT_SIZE, this.SLOT_SIZE, 0, 0x4466ff, 0.75)
        .setOrigin(0, 0).setDepth(7)
        .setData('slotTop', sy)
        .setData('slotH', this.SLOT_SIZE);
      // 잠금 슬롯 카운트다운 텍스트 (타워 파괴 시 리젠 시간 표시, depth 8)
      const lockText = this.add.text(sx + this.SLOT_SIZE / 2, sy + this.SLOT_SIZE / 2, '', {
        fontSize: '11px', color: '#ff6666', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(8).setVisible(false);

      this.uiLayer.add([bg, iconText, fill, lockText]);
      this.reflectorSlotBgs.push(bg);
      this.reflectorSlotFills.push(fill);
      this.reflectorSlotLockTexts.push(lockText);
      this.reflectorSlotOrigXs.push(sx); // 흔들기 복구용 정식 X 좌표
    }
  }

  private updateReflectorStockUI(stock: number, cooldownElapsed: number): void {
    this.myReflectorStock = stock;
    this.myReflectorCooldownElapsed = cooldownElapsed;

    for (let i = 0; i < this.maxReflectorStock; i++) {
      const bg = this.reflectorSlotBgs[i];
      const fill = this.reflectorSlotFills[i];
      const lock = this.reflectorSlotLockTexts[i];
      if (!bg || !fill) continue;

      const slotTop = fill.getData('slotTop') as number;
      const slotH = fill.getData('slotH') as number;

      // 잠긴 슬롯 (타워 파괴로 비활성화)
      if (i >= this.effectiveMaxReflectorSlots) {
        bg.setFillStyle(0x330000);
        if (this.reflectorCooldownTween && (this.reflectorCooldownTween as any).targets?.includes(fill)) {
          this.reflectorCooldownTween.stop();
        }
        fill.y = slotTop + slotH;
        fill.height = 0;
        lock?.setVisible(true);
        continue;
      }

      lock?.setVisible(false);

      if (i < stock) {
        // 보유 슬롯: 가득 찬 상태
        bg.setFillStyle(0x2244aa);
        if (this.reflectorCooldownTween && (this.reflectorCooldownTween as any).targets?.includes(fill)) {
          this.reflectorCooldownTween.stop();
        }
        fill.y = slotTop;
        fill.height = slotH;
      } else if (i === stock && stock < this.effectiveMaxReflectorSlots) {
        // 쿨다운 슬롯: 아래→위 채움 애니메이션
        bg.setFillStyle(0x111122);
        this.animateReflectorCooldown(fill, cooldownElapsed);
      } else {
        // 빈 슬롯
        bg.setFillStyle(0x111122);
        fill.y = slotTop + slotH;
        fill.height = 0;
      }
    }
  }

  private startSlotCountdown(slotIndex: number, duration: number): void {
    this.stopSlotCountdown(slotIndex);
    const lockText = this.reflectorSlotLockTexts[slotIndex];
    if (!lockText) return;
    let remaining = Math.ceil(duration);
    lockText.setText(String(remaining));
    const event = this.time.addEvent({
      delay: 1000,
      repeat: remaining - 1,
      callback: () => {
        remaining--;
        if (remaining > 0) lockText.setText(String(remaining));
      },
    });
    this.slotRespawnTimerEvents.set(slotIndex, event);
  }

  private stopSlotCountdown(slotIndex: number): void {
    const event = this.slotRespawnTimerEvents.get(slotIndex);
    if (event) { event.remove(); this.slotRespawnTimerEvents.delete(slotIndex); }
    const lockText = this.reflectorSlotLockTexts[slotIndex];
    if (lockText) lockText.setText('');
  }

  private updateEffectiveMaxSlots(effectiveMax: number): void {
    this.effectiveMaxReflectorSlots = effectiveMax;
    this.updateReflectorStockUI(this.myReflectorStock, this.myReflectorCooldownElapsed);
  }

  private animateReflectorCooldown(fill: Phaser.GameObjects.Rectangle, elapsed: number): void {
    if (this.reflectorCooldownTween) {
      this.reflectorCooldownTween.stop();
      this.reflectorCooldownTween = null;
    }
    const slotTop = fill.getData('slotTop') as number;
    const slotH = fill.getData('slotH') as number;
    const startH = (elapsed / this.reflectorCooldown) * slotH;
    // 아래→위: y = 슬롯 바닥 - startH, height = startH
    fill.y = slotTop + slotH - startH;
    fill.height = startH;
    const remaining = this.reflectorCooldown - elapsed;
    if (remaining <= 0) return;
    this.reflectorCooldownTween = this.tweens.add({
      targets: fill,
      y: slotTop,
      height: slotH,
      duration: remaining * 1000,
      ease: 'Linear',
    });
  }

  private shakeReflectorStockWarning(): void {
    if (this.shakeInProgress) return; // 이미 흔드는 중이면 무시
    this.shakeInProgress = true;
    this.sfx.stockWarning();

    // 붉은색으로 전환
    for (const bg of this.reflectorSlotBgs) bg.setFillStyle(0xaa2222, 0.7);

    // 좌우 흔들기: origXs는 정식 좌표(클래스 멤버)만 사용
    let shakeCount = 0;
    const SHAKE_DIST = 4;
    const SHAKE_MS = 50;

    const doShake = () => {
      if (shakeCount >= 6) {
        // 정식 좌표로 복구
        for (let i = 0; i < this.reflectorSlotBgs.length; i++) {
          this.reflectorSlotBgs[i].x = this.reflectorSlotOrigXs[i];
          this.reflectorSlotFills[i].x = this.reflectorSlotOrigXs[i];
        }
        this.shakeInProgress = false;
        this.updateReflectorStockUI(this.myReflectorStock, this.myReflectorCooldownElapsed);
        return;
      }
      const dir = shakeCount % 2 === 0 ? SHAKE_DIST : -SHAKE_DIST;
      for (let i = 0; i < this.reflectorSlotBgs.length; i++) {
        this.reflectorSlotBgs[i].x = this.reflectorSlotOrigXs[i] + dir;
        this.reflectorSlotFills[i].x = this.reflectorSlotOrigXs[i] + dir;
      }
      shakeCount++;
      this.time.delayedCall(SHAKE_MS, doShake);
    };
    doShake();
  }

  private drawEnemyZones(): void {
    for (const sp of this.serverSpawnPoints) {
      if (sp.ownerId === this.myPlayerId) continue;
      this.addEnemyZoneForSpawn(sp.id, sp.x, sp.y, sp.ownerId);
    }
  }

  private addEnemyZoneForSpawn(spawnId: number, spawnX: number, spawnY: number, ownerId: number): void {
    const { width, height } = this.mapData;
    const color = this.getTeamColor(ownerId);
    const overlays: Phaser.GameObjects.Rectangle[] = [];

    const spInfo = this.serverSpawnPoints.find(sp => sp.id === spawnId);
    const dir = spInfo?.direction ?? 0;
    const dirOffsets: Record<number, [number, number]> = { 1: [0, -1], 2: [0, 1], 3: [-1, 0], 4: [1, 0] };
    const [dx, dy] = dirOffsets[dir] ?? [0, 0];
    if (dx !== 0 || dy !== 0) {
      const nx = spawnX + dx;
      const ny = spawnY + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && this.mapData.tiles[ny][nx] === 1) {
        const key = `${nx},${ny}`;
        this.enemyZoneTiles.add(key);
        const px = nx * TILE_SIZE + TILE_SIZE / 2;
        const py = ny * TILE_SIZE + TILE_SIZE / 2;
        const overlay = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, color, ENEMY_ZONE_ALPHA);
        this.tilesLayer.add(overlay);
        overlays.push(overlay);
      }
    }
    this.enemyZoneOverlays.set(spawnId, overlays);
  }

  private removeEnemyZoneForSpawn(spawnId: number): void {
    const overlays = this.enemyZoneOverlays.get(spawnId);
    if (overlays) {
      for (const o of overlays) o.destroy();
      this.enemyZoneOverlays.delete(spawnId);
    }
    // enemyZoneTiles 재계산 (다른 스폰이 여전히 덮는 타일 유지)
    this.rebuildEnemyZoneTiles();
  }

  private rebuildEnemyZoneTiles(): void {
    this.enemyZoneTiles.clear();
    const { width, height } = this.mapData;
    const dirOffsets: Record<number, [number, number]> = { 1: [0, -1], 2: [0, 1], 3: [-1, 0], 4: [1, 0] };
    for (const sp of this.serverSpawnPoints) {
      if (sp.ownerId === this.myPlayerId) continue;
      if (!this.enemyZoneOverlays.has(sp.id)) continue;
      const [dx, dy] = dirOffsets[sp.direction] ?? [0, 0];
      if (dx === 0 && dy === 0) continue;
      const nx = sp.x + dx;
      const ny = sp.y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (this.mapData.tiles[ny][nx] !== 1) continue;
      this.enemyZoneTiles.add(`${nx},${ny}`);
    }
  }

  /** 격벽 미파괴로 인해 설치 불가한 상대 구역 타일에 붉은 오버레이 표시 */
  private rebuildInaccessibleZoneOverlays(): void {
    // 기존 오버레이 제거
    for (const o of this.inaccessibleZoneOverlays) o.destroy();
    this.inaccessibleZoneOverlays = [];
    this.inaccessibleZoneTiles.clear();

    if (!this.layout) return;

    // 내 모든 존 (원래 존 + 점령한 존)
    const myZones = this.layout.zones.filter(z =>
      z.playerId === this.myPlayerId || this.capturedZones.get(z.playerId) === this.myPlayerId
    );
    if (myZones.length === 0) return;

    const { zoneSize, wallThickness } = this.layout;

    for (const zone of this.layout.zones) {
      // 내 구역(원래 + 점령)은 항상 접근 가능
      if (myZones.includes(zone)) continue;

      for (let ly = 0; ly < zone.height; ly++) {
        for (let lx = 0; lx < zone.width; lx++) {
          const wx = zone.originX + lx;
          const wy = zone.originY + ly;
          let accessible = false;

          // 내 모든 존에서 이 타일로 직선 접근 가능한지 확인
          for (const myZone of myZones) {
            const dcol = zone.zoneCol - myZone.zoneCol;
            const drow = zone.zoneRow - myZone.zoneRow;

            if (dcol !== 0 && drow === 0) {
              // 수평 인접: 해당 y 행의 모든 격벽 파괴 여부 확인
              const startCol = Math.min(myZone.zoneCol, zone.zoneCol);
              const endCol   = Math.max(myZone.zoneCol, zone.zoneCol);
              let blocked = false;
              for (let col = startCol; col < endCol; col++) {
                const wallX = col * (zoneSize + wallThickness) + zoneSize;
                if (this.wallVisuals.has(`${wallX},${wy}`)) { blocked = true; break; }
              }
              if (!blocked) { accessible = true; break; }
            } else if (drow !== 0 && dcol === 0) {
              // 수직 인접: 해당 x 열의 모든 격벽 파괴 여부 확인
              const startRow = Math.min(myZone.zoneRow, zone.zoneRow);
              const endRow   = Math.max(myZone.zoneRow, zone.zoneRow);
              let blocked = false;
              for (let row = startRow; row < endRow; row++) {
                const wallY = row * (zoneSize + wallThickness) + zoneSize;
                if (this.wallVisuals.has(`${wx},${wallY}`)) { blocked = true; break; }
              }
              if (!blocked) { accessible = true; break; }
            }
            // dcol≠0 && drow≠0 → 이 존에서 대각선 = 다음 존 시도
          }

          if (!accessible) {
            this.inaccessibleZoneTiles.add(`${wx},${wy}`);
            const px = wx * TILE_SIZE + TILE_SIZE / 2;
            const py = wy * TILE_SIZE + TILE_SIZE / 2;
            const overlay = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, 0xff0000, ENEMY_ZONE_ALPHA);
            this.tilesLayer.add(overlay);
            this.inaccessibleZoneOverlays.push(overlay);
          }
        }
      }
    }
  }

  private getTileColor(tileIdx: number): number {
    // 스폰/코어 타일은 상대적 관점 적용: 내 타일=파란, 적 타일=빨간
    switch (tileIdx) {
      case 2: case 4: // P1 스폰
        return this.myPlayerId === 0 ? TILE_P1_SPAWN_COLOR : TILE_P2_SPAWN_COLOR;
      case 3: case 5: // P2 스폰
        return this.myPlayerId === 1 ? TILE_P1_SPAWN_COLOR : TILE_P2_SPAWN_COLOR;
      case 6: // P1 코어
        return this.myPlayerId === 0 ? TILE_P1_CORE_COLOR : TILE_P2_CORE_COLOR;
      case 8: // P2 코어
        return this.myPlayerId === 1 ? TILE_P1_CORE_COLOR : TILE_P2_CORE_COLOR;
      case 7: return TILE_BLOCK_COLOR;
      default: return TILE_EMPTY_COLOR;
    }
  }

  // === 스폰포인트 ===

  private createSpawnVisual(
    gridX: number, gridY: number,
    ownerId: number, spawnId: number, maxHp: number,
    direction: number,  // Direction enum: Up=1, Down=2, Left=3, Right=4
  ): void {
    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE / 2;

    const spawnRadius = (TILE_SIZE - 2) * 0.4; // 원형, 크기 20% 감소
    const bg = this.add.circle(px, py, spawnRadius, this.getTeamColorDark(ownerId), 0.9);
    this.tilesLayer.add(bg);

    // HP 바 배경 (숨김 — 타워 박스 파괴 후 활성화 시 표시)
    const hpBarBg = this.add.rectangle(
      px, py - TILE_SIZE / 2 + HP_BAR_HEIGHT,
      TILE_SIZE - 4, HP_BAR_HEIGHT, 0x333333,
    ).setVisible(false);
    this.tilesLayer.add(hpBarBg);

    // HP 바 (숨김)
    const hpBar = this.add.rectangle(
      px, py - TILE_SIZE / 2 + HP_BAR_HEIGHT,
      TILE_SIZE - 4, HP_BAR_HEIGHT, getHpColor(1.0),
    ).setVisible(false);
    this.tilesLayer.add(hpBar);

    // HP 텍스트 (숨김)
    const label = this.add.text(px, py + 4, toAbbreviatedString(maxHp), {
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false);
    this.tilesLayer.add(label);

    // 발사 방향 화살표 (Direction enum 기준)
    const dirArrow = this.add.graphics();
    const arrowColor = this.getTeamColor(ownerId);
    dirArrow.fillStyle(arrowColor, 0.6);

    const arrowSize = 6;
    if (direction === Direction.Right) {
      // 오른쪽 화살표
      const ax = px + TILE_SIZE / 2 - 4;
      const ay = py;
      dirArrow.fillTriangle(ax, ay - arrowSize, ax, ay + arrowSize, ax + arrowSize, ay);
    } else if (direction === Direction.Left) {
      // 왼쪽 화살표
      const ax = px - TILE_SIZE / 2 + 4;
      const ay = py;
      dirArrow.fillTriangle(ax, ay - arrowSize, ax, ay + arrowSize, ax - arrowSize, ay);
    } else if (direction === Direction.Up) {
      // 위쪽 화살표
      const ax = px;
      const ay = py - TILE_SIZE / 2 + 4;
      dirArrow.fillTriangle(ax - arrowSize, ay, ax + arrowSize, ay, ax, ay - arrowSize);
    } else {
      // 아래쪽 화살표 (Direction.Down)
      const ax = px;
      const ay = py + TILE_SIZE / 2 - 4;
      dirArrow.fillTriangle(ax - arrowSize, ay, ax + arrowSize, ay, ax, ay + arrowSize);
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
      countdownText: null,
      countdownEvent: null,
    });
  }

  private createCoreVisual(
    gridX: number, gridY: number,
    ownerId: number, coreId: number, maxHp: number,
  ): void {
    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE / 2;

    // 배경 (진한 팀 색상)
    const bg = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, this.getTeamColorDark(ownerId), 0.7);
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

    // 코어 다이아몬드 마크
    const diamond = this.add.graphics();
    diamond.lineStyle(2, this.getTeamColor(ownerId), 0.9);
    const s = TILE_SIZE / 5;
    diamond.strokePoints([
      { x: px, y: py - s },
      { x: px + s, y: py },
      { x: px, y: py + s },
      { x: px - s, y: py },
    ], true);
    this.tilesLayer.add(diamond);

    // HP 텍스트
    const label = this.add.text(px, py + 8, toAbbreviatedString(maxHp), {
      fontSize: '12px',
      color: '#ffff88',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.tilesLayer.add(label);

    this.coreVisuals.set(coreId, {
      id: coreId,
      bg, hpBar, hpBarBg, label, diamond,
      x: gridX, y: gridY,
      maxHp, currentHp: maxHp,
      ownerId,
      destroyed: false,
    });
  }

  /**
   * 프리게임 카메라 연출:
   *  0–2초: 전체 맵을 보여줌 (initialZoom, 맵 중앙)
   *  2–3초: 내 존으로 포커싱 (pan + zoom, 1000ms)
   *  3–4초: 1초 대기
   *  4초~:  입력 활성화 + 스폰 게이지 시작 (서버 스폰 타이머와 동기)
   */
  private showPreGameIntro(): void {
    this.input.enabled = false;

    // 카메라는 이미 initialZoom + 맵 중앙으로 설정되어 있음 (create에서)

    // Phase 1: 전체 맵 2초간 표시
    this.time.delayedCall(2000, () => {
      // Phase 2: 내 존으로 포커싱 (1초 애니메이션)
      const { cx, cy } = this.getMyZoneCenter();
      this.cameras.main.pan(cx, cy, 1000, 'Sine.easeInOut');
      this.cameras.main.zoomTo(1.0, 1000, 'Sine.easeInOut');

      // Phase 3: 포커싱 완료 후 1초 대기 → 게임 시작
      this.time.delayedCall(1000 + 1000, () => {
        this.input.enabled = true;
        this.startSpawnGauge();
      });
    });
  }

  /** 내 존(또는 코어) 중심 월드 좌표 반환 */
  private getMyZoneCenter(): { cx: number; cy: number } {
    if (this.layout) {
      const zone = this.layout.zones.find(z => z.playerId === this.myPlayerId);
      if (zone) {
        return {
          cx: (zone.originX + zone.width / 2) * TILE_SIZE,
          cy: (zone.originY + zone.height / 2) * TILE_SIZE,
        };
      }
    }
    const myCore = Array.from(this.coreVisuals.values()).find(c => c.ownerId === this.myPlayerId);
    if (myCore) {
      return {
        cx: myCore.x * TILE_SIZE + TILE_SIZE / 2,
        cy: myCore.y * TILE_SIZE + TILE_SIZE / 2,
      };
    }
    return {
      cx: (this.mapData.width * TILE_SIZE) / 2,
      cy: (this.mapData.height * TILE_SIZE) / 2,
    };
  }

  private showCoreHighlight(): void {
    for (const [, core] of this.coreVisuals) {
      if (core.ownerId !== this.myPlayerId) continue;

      const cx = core.x * TILE_SIZE + TILE_SIZE / 2;
      const startY = core.y * TILE_SIZE - TILE_SIZE * 1.0;

      const arrow = this.add.graphics();
      const color = this.getTeamColor(this.myPlayerId);

      // 아래 방향 화살표: 줄기 + 삼각형 헤드
      arrow.fillStyle(color, 0.95);
      arrow.fillRect(-7, -26, 14, 14);                           // 줄기
      arrow.fillTriangle(-18, -12, 18, -12, 0, 12);             // 헤드

      arrow.setPosition(cx, startY);
      this.tilesLayer.add(arrow);

      // Y 바운스
      this.tweens.add({
        targets: arrow,
        y: startY + TILE_SIZE * 0.42,
        duration: 420,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });

      // 스쿼시 스케일 (띠용 효과)
      this.tweens.add({
        targets: arrow,
        scaleY: 0.7,
        scaleX: 1.35,
        duration: 420,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });

      // 3초 후 페이드아웃
      this.time.delayedCall(3000, () => {
        this.tweens.killTweensOf(arrow);
        this.tweens.add({
          targets: arrow,
          alpha: 0,
          duration: 400,
          onComplete: () => arrow.destroy(),
        });
      });
    }
  }

  private updateCoreHp(coreId: number, hp: number, _ownerId: number): void {
    const visual = this.coreVisuals.get(coreId);
    if (!visual || visual.destroyed) return;

    const oldHp = visual.currentHp;
    visual.currentHp = hp;
    visual.label.setText(toAbbreviatedString(hp));

    const ratio = hp / visual.maxHp;
    const baseX = visual.x * TILE_SIZE + TILE_SIZE / 2;

    visual.hpBar.setFillStyle(getHpColor(ratio));
    animHpBar(this, visual.hpBar, baseX, ratio, `core_hp_${coreId}`, this.hpTweens);

    if (hp < oldHp) {
      this.sfx.coreHit();
      animDamageFlash(this, visual.bg, this.getTeamColorDark(visual.ownerId), 0.7);
      const damage = oldHp - hp;
      const popupX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      const popupY = visual.y * TILE_SIZE;
      animDamagePopup(this, this.tilesLayer, popupX, popupY, damage);
    }
  }

  private startSpawnCountdown(visual: SpawnVisual, duration: number): void {
    if (!duration || !isFinite(duration)) return;

    const px = visual.x * TILE_SIZE + TILE_SIZE / 2;
    const py = visual.y * TILE_SIZE + TILE_SIZE / 2;

    let remaining = Math.ceil(duration);
    const text = this.add.text(px, py, String(remaining), {
      fontSize: '18px',
      color: '#000000',
      stroke: '#ffffff',
      strokeThickness: 3,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(10);
    this.tilesLayer.add(text);

    visual.countdownText = text;
    visual.countdownEvent = this.time.addEvent({
      delay: 1000,
      repeat: remaining - 1,
      callback: () => {
        remaining--;
        if (remaining > 0) {
          text.setText(String(remaining));
        }
      },
    });
  }

  private getBallScale(playerId: number): number {
    const level = this.playerPowerLevel.get(playerId) ?? 0;
    return Math.min(1.0 + level * 0.01, 2.0);
  }

  private clearSpawnCountdown(visual: SpawnVisual): void {
    if (visual.countdownEvent) {
      visual.countdownEvent.remove();
      visual.countdownEvent = null;
    }
    if (visual.countdownText) {
      visual.countdownText.destroy();
      visual.countdownText = null;
    }
  }

  private updateSpawnHp(spawnId: number, hp: number, _ownerId: number): void {
    const visual = this.spawnVisuals.get(spawnId);
    if (!visual || visual.destroyed) return;

    const oldHp = visual.currentHp;
    visual.currentHp = hp;
    visual.label.setText(toAbbreviatedString(hp));

    const ratio = hp / visual.maxHp;
    const baseX = visual.x * TILE_SIZE + TILE_SIZE / 2;

    visual.hpBar.setFillStyle(getHpColor(ratio));
    animHpBar(this, visual.hpBar, baseX, ratio, `hp_${spawnId}`, this.hpTweens);

    // HP 감소 시 데미지 플래시 + 팝업
    if (hp < oldHp) {
      if (visual.ownerId === this.myPlayerId) {
        this.sfx.spawnHitMine();
      } else {
        this.sfx.spawnHitEnemy();
      }
      animDamageFlash(this, visual.bg, this.getTeamColorDark(visual.ownerId), 0.4);
      const damage = oldHp - hp;
      const popupX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      const popupY = visual.y * TILE_SIZE;
      animDamagePopup(this, this.tilesLayer, popupX, popupY, damage);
    } else if (hp > oldHp) {
      const popupX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      const popupY = visual.y * TILE_SIZE;
      animHealPopup(this, this.tilesLayer, popupX, popupY, hp - oldHp);
    }
  }

  // === 입력 처리 ===

  private setupInput(): void {
    const { width, height } = this.mapData;

    // 키보드: 1=성벽모드, 2=칼모드, 3=쉴드모드
    this.input.keyboard?.on('keydown-ONE', () => this.toggleWallMode());
    this.input.keyboard?.on('keydown-TWO', () => this.toggleSwordMode());
    this.input.keyboard?.on('keydown-THREE', () => this.toggleShieldMode());

    // 마우스 휠: 줌
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown, _deltaX: number, deltaY: number) => {
      const cam = this.cameras.main;
      const minZoom = Math.min(
        this.scale.width / (width * TILE_SIZE),
        this.scale.height / (height * TILE_SIZE),
        1.0,
      );
      const newZoom = Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, minZoom, 3.0);
      cam.setZoom(newZoom);
    });

    // 드래그 팬 시작
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.pointerDownX = pointer.x;
      this.pointerDownY = pointer.y;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      this.isDragging = false;
    });

    // 드래그 팬 + 호버 이펙트
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // 드래그 팬
      if (pointer.isDown) {
        const dx = pointer.x - this.pointerDownX;
        const dy = pointer.y - this.pointerDownY;
        if (Math.abs(dx) > this.DRAG_THRESHOLD || Math.abs(dy) > this.DRAG_THRESHOLD) {
          this.isDragging = true;
        }
        if (this.isDragging) {
          const cam = this.cameras.main;
          cam.scrollX -= (pointer.x - this.dragStartX) / cam.zoom;
          cam.scrollY -= (pointer.y - this.dragStartY) / cam.zoom;
          this.dragStartX = pointer.x;
          this.dragStartY = pointer.y;
          if (this.hoverHighlight) this.hoverHighlight.setVisible(false);
          if (this.wallCursor) this.wallCursor.setVisible(false);
          return;
        }
      }

      // 호버 이펙트 (성벽 모드 커서 포함)
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const gridX = Math.floor(worldPoint.x / TILE_SIZE);
      const gridY = Math.floor(worldPoint.y / TILE_SIZE);

      if (gridX < 0 || gridX >= width || gridY < 0 || gridY >= height) {
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
      const isInaccessible = this.inaccessibleZoneTiles.has(`${gridX},${gridY}`);

      if (!tile || !tile.isReflectorSetable || hasReflector || isEnemyZone || isInaccessible) {
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

    // 클릭 처리 (드래그와 구분)
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      // 우클릭: 드래그 여부와 무관하게 항상 처리
      // (rightButtonDown은 pointerup 시점엔 이미 false이므로 rightButtonReleased 사용)
      if (pointer.rightButtonReleased()) {
        this.isDragging = false;
        if (this.wallMode) { this.setWallMode(false); return; }
        if (this.swordMode) { this.setSwordMode(false); return; }
        if (this.shieldMode) { this.setShieldMode(false); return; }
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gridX = Math.floor(worldPoint.x / TILE_SIZE);
        const gridY = Math.floor(worldPoint.y / TILE_SIZE);
        if (gridX >= 0 && gridX < width && gridY >= 0 && gridY < height) {
          const key = `${gridX},${gridY}`;
          const existing = this.reflectorVisuals.get(key);
          if (existing && existing.playerId === this.myPlayerId) {
            this.sfx.reflectorRemove();
            this.removeReflectorVisual(gridX, gridY);
            this.updateReflectorCount();
            this.socket.removeReflector(gridX, gridY);
          }
        }
        return;
      }

      if (this.isDragging) {
        this.isDragging = false;
        return;
      }
      this.isDragging = false;

      // 월드 좌표 변환
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const gridX = Math.floor(worldPoint.x / TILE_SIZE);
      const gridY = Math.floor(worldPoint.y / TILE_SIZE);

      if (gridX < 0 || gridX >= width || gridY < 0 || gridY >= height) {
        if (this.wallMode) this.setWallMode(false);
        if (this.swordMode) this.setSwordMode(false);
        if (this.shieldMode) this.setShieldMode(false);
        return;
      }

      const tile = this.mapModel.getTile(gridX, gridY);
      const key = `${gridX},${gridY}`;
      const existing = this.reflectorVisuals.get(key);

      // 칼 모드: 적 반사판 클릭 시 useSword
      if (this.swordMode) {
        const visual = this.reflectorVisuals.get(key);
        if (visual && visual.playerId !== this.myPlayerId) {
          this.socket.useSword(gridX, gridY);
          this.setSwordMode(false);
        } else {
          this.showToast('적 반사판을 클릭하세요.');
        }
        return;
      }

      // 쉴드 모드: 내 타워/코어/방어벽 클릭 시 useShield
      if (this.shieldMode) {
        const spawn = this.serverSpawnPoints.find(sp => sp.x === gridX && sp.y === gridY && sp.ownerId === this.myPlayerId);
        if (spawn) {
          this.socket.useShield('spawn', String(spawn.id));
          this.setShieldMode(false);
          return;
        }
        const core = this.serverCores.find(c => c.x === gridX && c.y === gridY && c.ownerId === this.myPlayerId);
        if (core) {
          this.socket.useShield('core', String(core.id));
          this.setShieldMode(false);
          return;
        }
        const wallVisual = this.wallVisuals.get(key);
        if (wallVisual && wallVisual.ownerId === this.myPlayerId) {
          this.socket.useShield('wall', key);
          this.setShieldMode(false);
          return;
        }
        this.showToast('내 타워, 코어, 또는 방어벽을 클릭하세요.');
        return;
      }

      // 성벽 모드: 빈 설치 가능 타일에 성벽 설치
      if (this.wallMode) {
        if (!tile || !tile.isReflectorSetable) return;
        if (this.wallVisuals.has(key) || existing) return;
        if (this.enemyZoneTiles.has(key)) return;
        if (this.inaccessibleZoneTiles.has(key)) return;
        this.socket.placeWall(gridX, gridY);
        this.setWallMode(false);
        return;
      }

      if (!tile || !tile.isReflectorSetable) return;
      if (this.enemyZoneTiles.has(`${gridX},${gridY}`)) return;
      if (this.inaccessibleZoneTiles.has(`${gridX},${gridY}`)) return;

      if (!existing) {
        // 빈 타일 → Slash 설치: 스톡 없으면 경고
        if (this.myReflectorStock <= 0) {
          this.shakeReflectorStockWarning();
          return;
        }
        this.sfx.reflectorPlace();
        this.drawReflector(gridX, gridY, ReflectorType.Slash, this.myPlayerId);
        animReflectorPlace(this, this.tilesLayer, gridX, gridY, this.getTeamColor(this.myPlayerId));
        this.updateReflectorCount();
        this.socket.placeReflector(gridX, gridY, ReflectorType.Slash);
      } else if (existing.playerId !== this.myPlayerId) {
        // 상대 반사판 → 무시
        return;
      } else if (existing.type === ReflectorType.Slash) {
        // Slash → Backslash: 기존 타일 교체는 스톡 소모 없음
        this.sfx.reflectorPlace();
        this.drawReflector(gridX, gridY, ReflectorType.Backslash, this.myPlayerId);
        this.socket.placeReflector(gridX, gridY, ReflectorType.Backslash);
      } else {
        // Backslash → 제거
        this.sfx.reflectorRemove();
        this.removeReflectorVisual(gridX, gridY);
        this.updateReflectorCount();
        this.socket.removeReflector(gridX, gridY);
      }
    });
  }

  private toggleWallMode(): void {
    this.setWallMode(!this.wallMode);
  }

  private setWallMode(active: boolean): void {
    if (active && this.myGold < ITEM_COST_WALL) {
      this.showToast(`골드가 부족합니다. (${ITEM_COST_WALL}g 필요)`);
      return;
    }
    if (active) {
      this.setSwordMode(false);
      this.setShieldMode(false);
    }
    this.wallMode = active;
    if (this.wallModeText) {
      this.wallModeText.setVisible(active);
    }
    if (!active && this.wallCursor) {
      this.wallCursor.setVisible(false);
    }
    // 슬롯 버튼 하이라이트
    this.itemSlotWallBg?.setFillStyle(active ? 0x664400 : 0x332211);
    this.itemSlotWallBg?.setStrokeStyle(2, active ? 0xffcc44 : 0x886633);
  }

  private toggleSwordMode(): void {
    if (this.swordMode) {
      this.setSwordMode(false);
    } else {
      this.setWallMode(false);
      this.setShieldMode(false);
      this.setSwordMode(true);
    }
  }

  private setSwordMode(active: boolean): void {
    if (active && this.myGold < ITEM_COST_SWORD) {
      this.showToast(`골드가 부족합니다. (${ITEM_COST_SWORD}g 필요)`);
      return;
    }
    this.swordMode = active;
    this.swordModeText?.setVisible(active);
    this.itemSlotSwordBg?.setFillStyle(active ? 0x334488 : 0x111122);
    this.itemSlotSwordBg?.setStrokeStyle(2, active ? 0x88aaff : 0x4466aa);
  }

  private toggleShieldMode(): void {
    if (this.shieldMode) {
      this.setShieldMode(false);
    } else {
      this.setWallMode(false);
      this.setSwordMode(false);
      this.setShieldMode(true);
    }
  }

  private setShieldMode(active: boolean): void {
    if (active && this.myGold < ITEM_COST_SHIELD) {
      this.showToast(`골드가 부족합니다. (${ITEM_COST_SHIELD}g 필요)`);
      return;
    }
    this.shieldMode = active;
    this.shieldModeText?.setVisible(active);
    this.itemSlotShieldBg?.setFillStyle(active ? 0x223366 : 0x112233);
    this.itemSlotShieldBg?.setStrokeStyle(2, active ? 0x66aaff : 0x2255aa);
  }

  // === UI ===

  private setupUI(): void {
    const { width, height } = this.scale;
    // 상단 중앙: 남은 유저 수 (N인 모드에서 유용)
    const remText = this.add.text(width / 2, 4, `${this.totalPlayerCount}/${this.totalPlayerCount}명`, {
      fontSize: '15px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(10);
    this.remainingPlayersText = remText;
    this.uiLayer.add(remText);

    // 볼륨 토글 버튼 (좌상단)
    const BTN_W = 52, BTN_H = 20;
    const btnX = 8 + BTN_W / 2;
    const btnY = 52;
    const initMuted = this.sfx.muted;
    this.muteBtnBg = this.add.rectangle(btnX, btnY, BTN_W, BTN_H, initMuted ? 0x222222 : 0x223322)
      .setStrokeStyle(1, initMuted ? 0x444444 : 0x448844)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);
    this.muteBtnText = this.add.text(btnX, btnY, initMuted ? '✕ OFF' : '♪ ON', {
      fontSize: '11px', color: initMuted ? '#888888' : '#88ff88', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11);
    this.uiLayer.add([this.muteBtnBg, this.muteBtnText]);
    this.muteBtnBg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.sfx.muted = !this.sfx.muted;
      localStorage.setItem('sfx_muted', this.sfx.muted ? '1' : '0');
      this.muteBtnText!.setText(this.sfx.muted ? '✕ OFF' : '♪ ON');
      this.muteBtnText!.setColor(this.sfx.muted ? '#888888' : '#88ff88');
      this.muteBtnBg!.setFillStyle(this.sfx.muted ? 0x222222 : 0x223322);
      this.muteBtnBg!.setStrokeStyle(1, this.sfx.muted ? 0x444444 : 0x448844);
    });

    // 내 아이템 슬롯 버튼 (좌하단, 터치 가능) — 3개 슬롯: 성벽/칼/쉴드
    const SLOT = 56;
    const GAP = 8;
    const baseX = 8 + SLOT / 2;
    const slotY = height - 8 - SLOT / 2;
    const goldY = slotY - SLOT / 2 - 18;

    // 골드 표시 (슬롯 위)
    this.goldText = this.add.text(baseX, goldY, '💰 0', {
      fontSize: '13px', color: '#FFD700', fontFamily: 'monospace',
    }).setOrigin(0, 0.5).setDepth(10);
    this.uiLayer.add(this.goldText);

    // 슬롯 1: 성벽 (🧱)
    const wallCX = baseX;
    this.itemSlotWallBg = this.add.rectangle(wallCX, slotY, SLOT, SLOT, 0x332211)
      .setStrokeStyle(2, 0x886633)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);
    const wallEmoji = this.add.text(wallCX, slotY - 8, '🧱', { fontSize: '20px' }).setOrigin(0.5).setDepth(11);
    const wallKeyLabel = this.add.text(wallCX - SLOT / 2 + 4, slotY - SLOT / 2 + 4, '1', {
      fontSize: '10px', color: '#aaaaaa',
    }).setDepth(10);
    this.itemSlotWallText = this.add.text(wallCX, slotY + 18, `${ITEM_COST_WALL}g`, {
      fontSize: '11px', color: '#ccaa44', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(10);
    this.uiLayer.add([this.itemSlotWallBg, wallEmoji, wallKeyLabel, this.itemSlotWallText]);
    this.itemSlotWallBg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.toggleWallMode();
    });

    // 슬롯 2: 칼 (⚔️)
    const swordCX = baseX + SLOT + GAP;
    this.itemSlotSwordBg = this.add.rectangle(swordCX, slotY, SLOT, SLOT, 0x111122)
      .setStrokeStyle(2, 0x4466aa)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);
    const swordEmoji = this.add.text(swordCX, slotY - 8, '⚔️', { fontSize: '20px' }).setOrigin(0.5).setDepth(11);
    const swordKeyLabel = this.add.text(swordCX - SLOT / 2 + 4, slotY - SLOT / 2 + 4, '2', {
      fontSize: '10px', color: '#aaaaaa',
    }).setDepth(10);
    this.itemSlotSwordText = this.add.text(swordCX, slotY + 18, `${ITEM_COST_SWORD}g`, {
      fontSize: '11px', color: '#4488cc', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(10);
    this.uiLayer.add([this.itemSlotSwordBg, swordEmoji, swordKeyLabel, this.itemSlotSwordText]);
    this.itemSlotSwordBg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.toggleSwordMode();
    });

    // 슬롯 3: 쉴드 (🛡️)
    const shieldCX = baseX + (SLOT + GAP) * 2;
    this.itemSlotShieldBg = this.add.rectangle(shieldCX, slotY, SLOT, SLOT, 0x112233)
      .setStrokeStyle(2, 0x2255aa)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);
    const shieldEmoji = this.add.text(shieldCX, slotY - 8, '🛡️', { fontSize: '20px' }).setOrigin(0.5).setDepth(11);
    const shieldKeyLabel = this.add.text(shieldCX - SLOT / 2 + 4, slotY - SLOT / 2 + 4, '3', {
      fontSize: '10px', color: '#aaaaaa',
    }).setDepth(10);
    this.itemSlotShieldText = this.add.text(shieldCX, slotY + 18, `${ITEM_COST_SHIELD}g`, {
      fontSize: '11px', color: '#2266cc', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(10);
    this.uiLayer.add([this.itemSlotShieldBg, shieldEmoji, shieldKeyLabel, this.itemSlotShieldText]);
    this.itemSlotShieldBg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.toggleShieldMode();
    });

    const helpText = this.add.text(width / 2, 8, '터치: / → \\ → 제거 | 우클릭: 제거', {
      fontSize: '10px',
      color: '#555566',
    }).setOrigin(0.5, 0);
    this.uiLayer.add(helpText);

    // 성벽 모드 안내 텍스트
    this.wallModeText = this.add.text(
      width / 2, height / 2 - 120,
      '🧱 성벽 설치 모드\n클릭: 설치 | 우클릭/ESC: 취소',
      { fontSize: '14px', color: '#ddaa44', fontStyle: 'bold', align: 'center', backgroundColor: '#00000088', padding: { x: 10, y: 6 } },
    ).setOrigin(0.5).setDepth(100).setVisible(false);
    this.uiLayer.add(this.wallModeText);

    // 칼 모드 안내 텍스트
    this.swordModeText = this.add.text(width / 2, height / 2 - 80, '⚔️ 칼 모드: 적 반사판 클릭', {
      fontSize: '18px', color: '#4488ff', backgroundColor: '#00000099', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(20).setVisible(false);
    this.uiLayer.add(this.swordModeText);

    // 쉴드 모드 안내 텍스트
    this.shieldModeText = this.add.text(width / 2, height / 2 - 80, '🛡️ 쉴드 모드: 내 타워/코어/방어벽 클릭', {
      fontSize: '18px', color: '#4466ff', backgroundColor: '#00000099', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(20).setVisible(false);
    this.uiLayer.add(this.shieldModeText);

    // ESC로 모드 해제
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.wallMode) this.setWallMode(false);
      if (this.swordMode) this.setSwordMode(false);
      if (this.shieldMode) this.setShieldMode(false);
    });

    // 페이즈 카운터 (상단 게이지 왼쪽)
    const phaseY = 7;
    this.phaseText = this.add.text(8, phaseY, '1', {
      fontSize: '14px',
      color: '#44ccff',
      fontStyle: 'bold',
    }).setOrigin(0, 0).setDepth(5).setAlpha(0.7);
    this.uiLayer.add(this.phaseText);

    // 스폰 타이밍 게이지 (상단)
    this.spawnGaugeBg = this.add.rectangle(0, 0, width, SPAWN_GAUGE_HEIGHT, 0x111133)
      .setOrigin(0, 0).setDepth(5);
    this.spawnGaugeFill = this.add.rectangle(0, 0, width, SPAWN_GAUGE_HEIGHT, SPAWN_GAUGE_COLOR)
      .setOrigin(0, 0).setDepth(6);
    this.spawnGaugeFill.scaleX = 0;
    this.uiLayer.add([this.spawnGaugeBg, this.spawnGaugeFill]);

    // "내 맵" 포커스 버튼
    this.createMyMapButton();
  }

  private startSpawnGauge(phaseNumber?: number): void {
    if (!this.spawnGaugeFill) return;
    if (phaseNumber !== undefined) {
      this.phaseCount = phaseNumber;
    } else {
      this.phaseCount++;
    }
    if (this.phaseText) {
      this.phaseText.setText(toAbbreviatedString(this.phaseCount));
      this.tweens.add({
        targets: this.phaseText,
        scaleX: 1.5, scaleY: 1.5,
        duration: 80,
        ease: 'Sine.easeOut',
        yoyo: true,
      });
    }
    this.spawnGaugeFill.scaleX = 0;
    this.spawnGaugeFill.setFillStyle(SPAWN_GAUGE_COLOR);
    this.tweens.add({
      targets: this.spawnGaugeFill,
      scaleX: 1,
      duration: (this.spawnInterval - 0.07) * 1000,
      ease: 'Linear',
      onComplete: () => {
        this.spawnGaugeFill?.setFillStyle(0xffffff);
      },
    });
  }

  private shakeBoard(): void {
    this.cameras.main.shake(200, 0.007);
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

  private updateItemSlots(): void {
    this.goldText?.setText(`💰 ${this.myGold}`);
    const canWall = this.myGold >= ITEM_COST_WALL;
    const canSword = this.myGold >= ITEM_COST_SWORD;
    const canShield = this.myGold >= ITEM_COST_SHIELD;
    if (!this.wallMode)  this.itemSlotWallBg?.setAlpha(canWall ? 1 : 0.4);
    if (!this.swordMode) this.itemSlotSwordBg?.setAlpha(canSword ? 1 : 0.4);
    if (!this.shieldMode) this.itemSlotShieldBg?.setAlpha(canShield ? 1 : 0.4);
  }

  private showToast(message: string): void {
    const { width, height } = this.scale;
    const toast = this.add.text(width / 2, height - 50, message, {
      fontSize: '13px',
      color: '#ffffff',
      backgroundColor: '#442222',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(200).setAlpha(0);
    this.uiLayer.add(toast);

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
    this.socket.onReflectorStock = (msg: ReflectorStockMsg) => {
      if (msg.playerId === this.myPlayerId) {
        this.updateReflectorStockUI(msg.stock, msg.cooldownElapsed);
      }
    };

    this.socket.onSpawnPhaseComplete = (msg: SpawnPhaseCompleteMsg) => {
      this.currentPhaseNumber = msg.phaseNumber;
      if (this.spawnGaugeFill) {
        this.tweens.killTweensOf(this.spawnGaugeFill);
        this.startSpawnGauge(msg.phaseNumber);
      }
    };

    this.socket.onBallSpawned = (msg: BallSpawnedMsg) => {
      if (this.endingBalls.has(msg.ballId)) return;

      // 페이즈가 바뀌는 첫 공 → 즉시 진동 (게이지 완료 타이밍)
      if (msg.phaseNumber !== this.phaseCount) {
        this.phaseCount = msg.phaseNumber;
        this.sfx.phaseChange();
        this.shakeBoard();
      }

      // 시각적 생성은 첫 onBallMoved까지 보류 (스폰 후 대기 없이 바로 출발하는 효과)
      this.pendingBallSpawns.set(msg.ballId, { ownerId: msg.ownerId, phaseNumber: msg.phaseNumber });
    };

    this.socket.onBallMoved = (msg: BallMovedMsg) => {
      if (this.endingBalls.has(msg.ballId)) return;

      // 첫 이동: pending에서 visual 생성
      if (!this.ballVisuals.has(msg.ballId)) {
        const pending = this.pendingBallSpawns.get(msg.ballId);
        if (!pending) return;
        this.pendingBallSpawns.delete(msg.ballId);

        const px = msg.fromX * TILE_SIZE + TILE_SIZE / 2;
        const py = msg.fromY * TILE_SIZE + TILE_SIZE / 2;
        const isMyBall = pending.ownerId === this.myPlayerId;
        const ballColor = BALL_TEAM_COLORS[isMyBall ? 0 : 1];
        const circle = this.add.circle(px, py, BALL_RADIUS, ballColor, 1.0);
        this.ballsLayer.add(circle);
        const shine = this.add.circle(px, py, 4, 0xffffff, 0.4);
        this.ballsLayer.add(shine);
        this.ballVisuals.set(msg.ballId, { circle, shine, ballId: msg.ballId, ownerId: pending.ownerId, lastDx: 0, lastDy: 0 });
        animBallSpawn(this, [circle, shine], this.getBallScale(pending.ownerId));
      }

      const visual = this.ballVisuals.get(msg.ballId);
      if (!visual) return;

      // 방향 추적 (다음 onBallEnded에서 반칸 전진에 사용)
      visual.lastDx = (msg.toX - msg.fromX) * TILE_SIZE;
      visual.lastDy = (msg.toY - msg.fromY) * TILE_SIZE;

      const toX = msg.toX * TILE_SIZE + TILE_SIZE / 2;
      const toY = msg.toY * TILE_SIZE + TILE_SIZE / 2;
      // 실제 이동 시간 = timePerPhase / speedMultiplier
      const duration = (this.timePerPhase / msg.speedMultiplier) * 1000;

      // movement tween만 교체 — spawn tween(scale/alpha)은 그대로 실행
      this.ballMoveTweens.get(msg.ballId)?.stop();
      const moveTween = this.tweens.add({
        targets: [visual.circle, visual.shine],
        x: toX,
        y: toY,
        duration,
        ease: 'Linear',
      });
      this.ballMoveTweens.set(msg.ballId, moveTween);
    };

    this.socket.onBallEnded = (msg: BallEndedMsg) => {
      // pending 상태에서 끝나는 경우 정리
      this.pendingBallSpawns.delete(msg.ballId);
      const visual = this.ballVisuals.get(msg.ballId);
      if (!visual) return;
      if (this.endingBalls.has(msg.ballId)) return;

      this.endingBalls.add(msg.ballId);
      this.ballMoveTweens.delete(msg.ballId);
      this.sfx.ballEnd();
      // 진행 중인 모든 tween 중지 (spawn/move/powerup 포함)
      this.tweens.killTweensOf(visual.circle);
      this.tweens.killTweensOf(visual.shine);

      const isMyBall = visual.ownerId === this.myPlayerId;
      const ballColor = BALL_TEAM_COLORS[isMyBall ? 0 : 1];
      const explode = () => animBallEnd(
        this,
        this.ballsLayer,
        [visual.circle, visual.shine],
        visual.circle.x,
        visual.circle.y,
        ballColor,
        () => {
          visual.circle.destroy();
          visual.shine.destroy();
          this.ballVisuals.delete(msg.ballId);
          this.endingBalls.delete(msg.ballId);
        },
        visual.circle.scaleX,
      );

      // 서버가 전달한 종료 방향으로 lastDx/lastDy 갱신 (반사판 통과 직후 벽에 막히는 경우 보정)
      if (msg.direction === Direction.Right) { visual.lastDx = TILE_SIZE; visual.lastDy = 0; }
      else if (msg.direction === Direction.Left) { visual.lastDx = -TILE_SIZE; visual.lastDy = 0; }
      else if (msg.direction === Direction.Down) { visual.lastDx = 0; visual.lastDy = TILE_SIZE; }
      else if (msg.direction === Direction.Up) { visual.lastDx = 0; visual.lastDy = -TILE_SIZE; }

      // 반칸 더 전진 후 폭발
      const halfDur = this.timePerPhase * 500 * 0.5;
      if (visual.lastDx !== 0 || visual.lastDy !== 0) {
        this.tweens.add({
          targets: [visual.circle, visual.shine],
          x: visual.circle.x + visual.lastDx * 0.5,
          y: visual.circle.y + visual.lastDy * 0.5,
          duration: halfDur,
          ease: 'Linear',
          onComplete: explode,
        });
      } else {
        explode();
      }
    };

    this.socket.onSpawnHp = (msg: SpawnHpMsg) => {
      this.updateSpawnHp(msg.spawnId, msg.hp, msg.ownerId);
    };

    this.socket.onSpawnDestroyed = (msg: SpawnDestroyedMsg) => {
      const visual = this.spawnVisuals.get(msg.spawnId);
      if (!visual || visual.destroyed) return;
      visual.destroyed = true;

      this.sfx.spawnDestroy();
      animSpawnDestroy(this, visual.bg, visual.hpBar, visual.hpBarBg, visual.label, visual.dirArrow);
      this.removeEnemyZoneForSpawn(msg.spawnId);

      // 리스폰 카운트다운 표시
      this.startSpawnCountdown(visual, msg.respawnDuration);

      // 내 스폰이면 반사판 슬롯 감소 + 잠긴 슬롯에 리젠 카운트다운 표시
      const spInfo = this.serverSpawnPoints.find(sp => sp.id === msg.spawnId);
      if (spInfo?.ownerId === this.myPlayerId) {
        const slotIndex = this.maxReflectorStock - 1 - this.myDestroyedSpawnCount;
        this.mySpawnSlotMap.set(msg.spawnId, slotIndex);
        this.myDestroyedSpawnCount++;
        this.updateEffectiveMaxSlots(this.maxReflectorStock - this.myDestroyedSpawnCount);
        this.startSlotCountdown(slotIndex, msg.respawnDuration);
      }
    };

    this.socket.onSpawnRespawned = (msg: SpawnRespawnedMsg) => {
      const visual = this.spawnVisuals.get(msg.spawnId);
      if (!visual || !visual.destroyed) return;

      // 카운트다운 정리
      this.clearSpawnCountdown(visual);

      // 보호 구역 복원 (상대방 스폰만)
      const spInfo = this.serverSpawnPoints.find(sp => sp.id === msg.spawnId);
      if (spInfo && spInfo.ownerId !== this.myPlayerId) this.addEnemyZoneForSpawn(spInfo.id, spInfo.x, spInfo.y, spInfo.ownerId);

      visual.destroyed = false;
      visual.currentHp = msg.hp;

      // 비주얼 복구
      visual.bg.setFillStyle(this.getTeamColorDark(visual.ownerId), 0.9);
      visual.bg.setAlpha(1);
      visual.hpBar.setVisible(true);
      visual.hpBarBg.setVisible(true);
      visual.label.setVisible(true);
      visual.dirArrow.setVisible(true);
      visual.label.setText(toAbbreviatedString(msg.hp)).setColor('#ffffff');

      // HP 바 풀로 복구
      const baseX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      animHpBar(this, visual.hpBar, baseX, 1.0, `spawn_hp_${msg.spawnId}`, this.hpTweens);

      // 내 스폰이면 반사판 슬롯 복구 + 카운트다운 정리
      if (spInfo?.ownerId === this.myPlayerId) {
        const slotIndex = this.mySpawnSlotMap.get(msg.spawnId);
        if (slotIndex !== undefined) {
          this.stopSlotCountdown(slotIndex);
          this.mySpawnSlotMap.delete(msg.spawnId);
        }
        this.myDestroyedSpawnCount = Math.max(0, this.myDestroyedSpawnCount - 1);
        this.updateEffectiveMaxSlots(this.maxReflectorStock - this.myDestroyedSpawnCount);
      }

      // 팝인 애니메이션
      this.sfx.spawnRespawn();
      animSpawnRespawn(this, [visual.bg, visual.hpBar, visual.hpBarBg, visual.label, visual.dirArrow]);
    };

    this.socket.onCoreHp = (msg: CoreHpMsg) => {
      this.updateCoreHp(msg.coreId, msg.hp, msg.ownerId);
    };

    this.socket.onCoreDestroyed = (msg: CoreDestroyedMsg) => {
      const visual = this.coreVisuals.get(msg.coreId);
      if (!visual || visual.destroyed) return;
      visual.destroyed = true;

      this.sfx.coreDestroy();
      animSpawnDestroy(this, visual.bg, visual.hpBar, visual.hpBarBg, visual.label);
    };

    this.socket.onReflectorPlaced = (msg: ReflectorPlacedMsg) => {
      if (msg.playerId === this.myPlayerId) return; // 내 것은 이미 낙관적으로 렌더됨
      this.sfx.reflectorPlace();
      this.drawReflector(msg.x, msg.y, msg.type, msg.playerId);
      animReflectorPlace(this, this.tilesLayer, msg.x, msg.y, this.getTeamColor(msg.playerId));
      this.updateReflectorCount();
    };

    this.socket.onReflectorRemoved = (msg: ReflectorRemovedMsg) => {
      if (msg.playerId === this.myPlayerId) {
        // 수동 제거: 낙관적으로 이미 처리됨 → 비주얼이 없으면 스킵
        // FIFO 자동 제거: 서버가 오래된 것을 제거 → 비주얼이 있으면 제거 필요
        const key = `${msg.x},${msg.y}`;
        if (!this.reflectorVisuals.has(key)) return;
      } else {
        this.sfx.reflectorRemove();
      }
      this.removeReflectorVisual(msg.x, msg.y);
      this.updateReflectorCount();
    };

    this.socket.onTowerBoxDamaged = (msg: TowerBoxDamagedMsg) => {
      this.updateTowerBoxHp(msg.spawnId, msg.hp, msg.maxHp);
    };

    this.socket.onTowerBoxBroken = (msg: TowerBoxBrokenMsg) => {
      this.removeTowerBoxVisual(msg.spawnId);
    };

    this.socket.onPlayerEliminated = (msg) => {
      this.remainingPlayersText?.setText(`${msg.remainingPlayers}/${this.totalPlayerCount}명`);
      // 탈락 존 시각적 표시 (N인 모드, 자신 제외, 내가 점령한 존 제외)
      if (this.layout && msg.playerId !== this.myPlayerId) {
        if (this.capturedZones.get(msg.playerId) === this.myPlayerId) return;
        const zone = this.layout.zones.find(z => z.playerId === msg.playerId);
        if (zone) this.showEliminatedZoneOverlay(zone.originX, zone.originY, zone.width, zone.height);
      }
    };

    this.socket.onPlayerLeft = (msg: PlayerLeftMsg) => {
      // 게임 이탈 유저 딤드 처리 (N인 모드, 자신 제외, 내가 점령한 존 제외)
      if (this.layout && msg.playerId !== this.myPlayerId) {
        if (this.capturedZones.get(msg.playerId) === this.myPlayerId) return;
        const zone = this.layout.zones.find(z => z.playerId === msg.playerId);
        if (zone) this.showEliminatedZoneOverlay(zone.originX, zone.originY, zone.width, zone.height);
      }
    };

    this.socket.onOwnershipTransferred = (msg: OwnershipTransferredMsg) => {
      // 코어 비주얼 소유권 이전 + 재활성화
      const coreVisual = this.coreVisuals.get(msg.coreId);
      if (coreVisual) {
        this.tweens.killTweensOf(coreVisual.bg);
        coreVisual.ownerId = msg.newOwnerId;
        coreVisual.destroyed = false;
        coreVisual.maxHp = msg.coreMaxHp;
        coreVisual.currentHp = msg.coreHp;
        coreVisual.bg.setFillStyle(this.getTeamColorDark(msg.newOwnerId), 0.7);
        coreVisual.bg.setAlpha(1);
        coreVisual.hpBar.setVisible(true);
        coreVisual.hpBarBg.setVisible(true);
        coreVisual.label.setText(toAbbreviatedString(msg.coreHp)).setColor('#ffff88');
        // 다이아몬드 색상 업데이트
        coreVisual.diamond.clear();
        coreVisual.diamond.lineStyle(2, this.getTeamColor(msg.newOwnerId), 0.9);
        const px = coreVisual.x * TILE_SIZE + TILE_SIZE / 2;
        const py = coreVisual.y * TILE_SIZE + TILE_SIZE / 2;
        const s = TILE_SIZE / 5;
        coreVisual.diamond.strokePoints([
          { x: px, y: py - s },
          { x: px + s, y: py },
          { x: px, y: py + s },
          { x: px - s, y: py },
        ], true);
        // HP 바 풀로 복구
        const baseX = coreVisual.x * TILE_SIZE + TILE_SIZE / 2;
        animHpBar(this, coreVisual.hpBar, baseX, 1.0, `core_hp_${msg.coreId}`, this.hpTweens);
        // 팝인 애니메이션
        animSpawnRespawn(this, [coreVisual.bg, coreVisual.hpBar, coreVisual.hpBarBg, coreVisual.label, coreVisual.diamond]);
      }

      // 스폰 타워 소유권 이전
      for (const st of msg.spawnTransfers) {
        const spVisual = this.spawnVisuals.get(st.spawnId);
        if (!spVisual) continue;

        this.tweens.killTweensOf(spVisual.bg);
        spVisual.ownerId = msg.newOwnerId;
        spVisual.maxHp = st.maxHp;
        spVisual.currentHp = st.hp;

        // 서버 스폰 정보도 업데이트
        const spInfo = this.serverSpawnPoints.find(sp => sp.id === st.spawnId);
        if (spInfo) spInfo.ownerId = msg.newOwnerId;

        if (st.active) {
          // 카운트다운 정리
          this.clearSpawnCountdown(spVisual);
          spVisual.destroyed = false;
          spVisual.bg.setFillStyle(this.getTeamColorDark(msg.newOwnerId), 0.9);
          spVisual.bg.setAlpha(1);
          spVisual.hpBar.setVisible(true);
          spVisual.hpBarBg.setVisible(true);
          spVisual.label.setVisible(true);
          spVisual.dirArrow.setVisible(true);
          spVisual.label.setText(toAbbreviatedString(st.hp)).setColor('#ffffff');
          // 방향 화살표 색상 업데이트
          spVisual.dirArrow.clear();
          this.redrawDirArrow(spVisual);
          // HP 바 복구
          const spBaseX = spVisual.x * TILE_SIZE + TILE_SIZE / 2;
          animHpBar(this, spVisual.hpBar, spBaseX, st.hp / st.maxHp, `spawn_hp_${st.spawnId}`, this.hpTweens);
          // 팝인 애니메이션
          animSpawnRespawn(this, [spVisual.bg, spVisual.hpBar, spVisual.hpBarBg, spVisual.label, spVisual.dirArrow]);
        }

        // 적 보호 구역 업데이트
        this.removeEnemyZoneForSpawn(st.spawnId);
        if (msg.newOwnerId !== this.myPlayerId && spInfo) {
          this.addEnemyZoneForSpawn(st.spawnId, spInfo.x, spInfo.y, msg.newOwnerId);
        }
      }

      // 점령 기록 + 격벽 오버레이 재계산
      this.capturedZones.set(msg.oldOwnerId, msg.newOwnerId);
      this.rebuildInaccessibleZoneOverlays();
    };

    this.socket.onGameOver = (msg: GameOverMsg) => {
      // N인 모드: winnerId = 승리 팀 ID, 1v1: winnerId = 승리 플레이어 ID
      const myId = this.layout ? this.myTeamId : this.myPlayerId;
      if (msg.winnerId === -1) {
        this.sfx.gameLose();
      } else if (msg.winnerId === myId) {
        this.sfx.gameWin();
      } else {
        this.sfx.gameLose();
      }
      this.time.delayedCall(1000, () => {
        this.scene.launch('ResultScene', {
          winnerId: msg.winnerId,
          myPlayerId: myId,
        });
      });
    };

    this.socket.onWallPlaced = (msg: WallPlacedMsg) => {
      this.drawWall(msg.x, msg.y, msg.hp, msg.maxHp, msg.playerId);
    };

    this.socket.onWallDamaged = (msg: WallDamagedMsg) => {
      this.updateWallHp(msg.x, msg.y, msg.hp);
    };

    this.socket.onWallDestroyed = (msg: WallDestroyedMsg) => {
      this.removeWallVisual(msg.x, msg.y);
      this.rebuildInaccessibleZoneOverlays();
    };

    this.socket.onGoldUpdated = (msg: GoldUpdatedMsg) => {
      if (msg.playerId === this.myPlayerId) {
        this.myGold = msg.gold;
        this.updateItemSlots();
      }
    };

    this.socket.onSwordUsed = (_msg: SwordUsedMsg) => {
      // 반사판 제거는 onReflectorRemoved 에서 처리됨
      this.setSwordMode(false);
    };

    this.socket.onShieldApplied = (msg: ShieldAppliedMsg) => {
      this.drawShieldVisual(msg.targetType, msg.targetId);
    };

    this.socket.onShieldExpired = (msg: ShieldExpiredMsg) => {
      this.removeShieldVisual(msg.targetId);
    };

    this.socket.onMonsterSpawned = (msg: MonsterSpawnedMsg) => {
      this.spawnMonster(msg.id, msg.monsterType, msg.x, msg.y, msg.hp, msg.maxHp);
    };

    this.socket.onMonsterDamaged = (msg: MonsterDamagedMsg) => {
      this.damageMonster(msg.id, msg.hp, msg.maxHp);
    };

    this.socket.onMonsterKilled = (msg: MonsterKilledMsg) => {
      this.killMonster(msg.id);
    };

    this.socket.onMonsterMoved = (msg: MonsterMovedMsg) => {
      this.moveMonster(msg.id, msg.toX, msg.toY);
    };

    this.socket.onItemDropped = (msg: ItemDroppedMsg) => {
      this.drawItem(msg.itemId, msg.x, msg.y, msg.itemType);
    };

    this.socket.onItemPickedUp = (msg: ItemPickedUpMsg) => {
      this.pickupItem(msg.itemId);
      this.sfx.itemPickup();
    };

    this.socket.onBallPoweredUp = (msg: BallPoweredUpMsg) => {
      const prev = this.playerPowerLevel.get(msg.playerId) ?? 0;
      this.playerPowerLevel.set(msg.playerId, prev + 1);
      const newScale = this.getBallScale(msg.playerId);
      for (const visual of this.ballVisuals.values()) {
        if (visual.ownerId !== msg.playerId) continue;
        if (this.endingBalls.has(visual.ballId)) continue;
        this.tweens.add({
          targets: [visual.circle, visual.shine],
          scaleX: newScale,
          scaleY: newScale,
          duration: 200,
          ease: 'Back.easeOut',
        });
      }
    };

    this.socket.onPlayerBallCountUp = (_msg: PlayerBallCountUpMsg) => {
      // 필요 시 UI 표시 (예: 공 갯수 카운터)
    };

    this.socket.onPlayerSpeedUp = (_msg: PlayerSpeedUpMsg) => {
      // 필요 시 UI 표시 (예: 속도 카운터)
    };

    this.socket.onSpawnHealed = (msg: SpawnHealedMsg) => {
      const visual = this.spawnVisuals.get(msg.spawnId);
      if (!visual || visual.destroyed) return;
      const healAmount = msg.hp - visual.currentHp;
      visual.currentHp = msg.hp;
      visual.maxHp = msg.maxHp;
      visual.label.setText(toAbbreviatedString(msg.hp));
      const ratio = msg.hp / msg.maxHp;
      const baseX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      visual.hpBar.setFillStyle(getHpColor(ratio));
      animHpBar(this, visual.hpBar, baseX, ratio, `hp_${msg.spawnId}`, this.hpTweens);
      const popupX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      const popupY = visual.y * TILE_SIZE;
      animHealPopup(this, this.tilesLayer, popupX, popupY, healAmount);
      this.sfx.healEffect();
    };

    this.socket.onCoreHealed = (msg: CoreHealedMsg) => {
      const visual = this.coreVisuals.get(msg.coreId);
      if (!visual || visual.destroyed) return;
      const healAmount = msg.hp - visual.currentHp;
      visual.currentHp = msg.hp;
      visual.maxHp = msg.maxHp;
      visual.label.setText(toAbbreviatedString(msg.hp));
      const ratio = msg.hp / msg.maxHp;
      const baseX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      visual.hpBar.setFillStyle(getHpColor(ratio));
      animHpBar(this, visual.hpBar, baseX, ratio, `core_hp_${msg.coreId}`, this.hpTweens);
      const popupX = visual.x * TILE_SIZE + TILE_SIZE / 2;
      const popupY = visual.y * TILE_SIZE;
      animHealPopup(this, this.tilesLayer, popupX, popupY, healAmount);
      this.sfx.healEffect();
    };

    this.socket.onPlayerReflectorExpand = (_msg: PlayerReflectorExpandMsg) => {
      // 필요 시 UI 표시 (예: 반사판 슬롯 갱신)
    };

    this.socket.onDisconnected = () => {
      this.add.text(
        this.scale.width / 2, this.scale.height / 2,
        'Disconnected',
        { fontSize: '20px', color: '#ff4444' },
      ).setOrigin(0.5);
    };
  }

  private drawMonster(id: number, monsterType: MonsterType, gridX: number, gridY: number, hp: number, maxHp: number): void {
    const existing = this.monsterVisuals.get(id);
    if (existing) {
      existing.container.destroy();
    }

    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE / 2;
    const s = monsterType === MonsterType.Purple ? TILE_SIZE / 2 - 4 : Math.round((TILE_SIZE / 2 - 4) * 0.7);
    const color  = MONSTER_COLORS[monsterType]  ?? MONSTER_COLORS[0];
    const border = MONSTER_BORDERS[monsterType] ?? MONSTER_BORDERS[0];

    // 타입별 색상 다이아몬드
    const g = this.add.graphics();
    g.fillStyle(color, 0.85);
    g.fillPoints([
      { x: 0, y: -s },
      { x: s, y: 0 },
      { x: 0, y: s },
      { x: -s, y: 0 },
    ], true);
    g.lineStyle(2, border, 1);
    g.strokePoints([
      { x: 0, y: -s },
      { x: s, y: 0 },
      { x: 0, y: s },
      { x: -s, y: 0 },
    ], true);

    // HP 바 배경
    const hpBarBg = this.add.rectangle(0, s + HP_BAR_HEIGHT + 1, TILE_SIZE - 4, HP_BAR_HEIGHT, 0x333333).setOrigin(0.5);
    // HP 바
    const hpBar = this.add.rectangle(0, s + HP_BAR_HEIGHT + 1, TILE_SIZE - 4, HP_BAR_HEIGHT, getHpColor(hp / maxHp)).setOrigin(0.5);
    // HP 텍스트
    const hpText = this.add.text(0, 0, toAbbreviatedString(hp), {
      fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);

    const container = this.add.container(px, py, [g, hpBarBg, hpBar, hpText]);
    container.setDepth(4);
    this.tilesLayer.add(container);

    this.monsterVisuals.set(id, { id, container, hpBar, hpBarBg, hpText, maxHp, currentHp: hp });
  }

  private moveMonster(id: number, toGridX: number, toGridY: number): void {
    const mv = this.monsterVisuals.get(id);
    if (!mv) return;
    const toX = toGridX * TILE_SIZE + TILE_SIZE / 2;
    const toY = toGridY * TILE_SIZE + TILE_SIZE / 2;
    this.tweens.killTweensOf(mv.container);
    this.tweens.add({
      targets: mv.container,
      x: toX,
      y: toY,
      duration: 300,
      ease: 'Back.easeOut',
    });
  }

  private damageMonster(id: number, hp: number, maxHp: number): void {
    const mv = this.monsterVisuals.get(id);
    if (!mv) return;
    const damage = mv.currentHp - hp;
    mv.currentHp = hp;
    mv.maxHp = maxHp;
    mv.hpText.setText(toAbbreviatedString(hp));
    const ratio = hp / maxHp;
    mv.hpBar.setFillStyle(getHpColor(ratio));
    mv.hpBar.setDisplaySize((TILE_SIZE - 4) * ratio, HP_BAR_HEIGHT);
    this.sfx.monsterHit();
    // 데미지 팝업
    if (damage > 0) {
      const cx = mv.container.x;
      const cy = mv.container.y - TILE_SIZE / 2;
      animDamagePopup(this, this.tilesLayer, cx, cy, damage);
    }
    // 빨간 플래시
    const container = mv.container;
    this.time.delayedCall(0, () => {
      const flash = this.add.rectangle(0, 0, TILE_SIZE - 2, TILE_SIZE - 2, 0xff2222, 0.5);
      container.add(flash);
      this.time.delayedCall(120, () => flash.destroy());
    });
  }

  private killMonster(id: number): void {
    const mv = this.monsterVisuals.get(id);
    if (!mv) return;
    const container = mv.container;
    this.sfx.monsterKill();
    this.tweens.add({
      targets: container,
      scaleX: 1.4, scaleY: 1.4,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => container.destroy(),
    });
    this.monsterVisuals.delete(id);
  }

  private spawnMonster(id: number, monsterType: MonsterType, gridX: number, gridY: number, hp: number, maxHp: number): void {
    this.drawMonster(id, monsterType, gridX, gridY, hp, maxHp);
    const mv = this.monsterVisuals.get(id);
    if (!mv) return;
    const container = mv.container;
    container.setAlpha(0);
    container.setScale(0.3);
    this.tweens.add({
      targets: container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 300,
      ease: 'Back.easeOut',
    });
  }

  private drawItem(id: number, gridX: number, gridY: number, itemType: DropItemType = DropItemType.PowerUp): void {
    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE / 2;
    const color = ITEM_COLORS[itemType - 1] ?? ITEM_COLORS[0];

    const g = this.add.graphics();
    g.fillStyle(color, 0.9);

    if (itemType === DropItemType.PowerUp) {
      // 빨간 위쪽 화살표: 줄기 + 삼각형 헤드
      g.fillRect(-4, 2, 8, 10);
      g.fillTriangle(-10, 2, 10, 2, 0, -12);
    } else if (itemType === DropItemType.BallCount) {
      // 흰 원
      g.fillCircle(0, 0, 10);
    } else if (itemType === DropItemType.SpeedUp) {
      // 하늘색 위쪽 화살표: 줄기 + 삼각형 헤드
      g.fillRect(-3, 2, 6, 10);
      g.fillTriangle(-9, 2, 9, 2, 0, -11);
    }

    const container = this.add.container(px, py - 6, [g]);
    container.setDepth(5);
    this.tilesLayer.add(container);

    this.tweens.add({
      targets: container,
      y: py - 10,
      duration: 700,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    this.itemVisuals.set(id, { id, container, x: gridX, y: gridY });
  }

  private pickupItem(id: number): void {
    const visual = this.itemVisuals.get(id);
    if (!visual) return;
    this.itemVisuals.delete(id);
    const container = visual.container;
    this.tweens.killTweensOf(container);
    this.tweens.add({
      targets: container,
      y: container.y - 40,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => container.destroy(),
    });
  }

  /** 자기 팀은 항상 파란색, 상대는 빨간색으로 반환 */
  private getTeamColor(playerId: number): number {
    return PLAYER_COLORS[playerId === this.myPlayerId ? 0 : 1];
  }

  private getTeamColorDark(playerId: number): number {
    return PLAYER_COLORS_DARK[playerId === this.myPlayerId ? 0 : 1];
  }

  /** 스폰 비주얼의 방향 화살표를 현재 소유자 색상으로 다시 그림 */
  private redrawDirArrow(visual: SpawnVisual): void {
    const spInfo = this.serverSpawnPoints.find(sp => sp.id === visual.id);
    if (!spInfo) return;
    const arrowColor = this.getTeamColor(visual.ownerId);
    visual.dirArrow.fillStyle(arrowColor, 0.6);
    const px = visual.x * TILE_SIZE + TILE_SIZE / 2;
    const py = visual.y * TILE_SIZE + TILE_SIZE / 2;
    const arrowSize = 6;
    if (spInfo.direction === Direction.Right) {
      const ax = px + TILE_SIZE / 2 - 4;
      visual.dirArrow.fillTriangle(ax, py - arrowSize, ax, py + arrowSize, ax + arrowSize, py);
    } else if (spInfo.direction === Direction.Left) {
      const ax = px - TILE_SIZE / 2 + 4;
      visual.dirArrow.fillTriangle(ax, py - arrowSize, ax, py + arrowSize, ax - arrowSize, py);
    } else if (spInfo.direction === Direction.Up) {
      const ay = py - TILE_SIZE / 2 + 4;
      visual.dirArrow.fillTriangle(px - arrowSize, ay, px + arrowSize, ay, px, ay - arrowSize);
    } else {
      const ay = py + TILE_SIZE / 2 - 4;
      visual.dirArrow.fillTriangle(px - arrowSize, ay, px + arrowSize, ay, px, ay + arrowSize);
    }
  }

  private formatHp(n: number): string {
    return toAbbreviatedString(n);
  }

  private drawWall(gridX: number, gridY: number, hp: number, maxHp: number, ownerId: number = -1): void {
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

    const bg = this.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, WALL_COLOR, 0.95);
    bg.setStrokeStyle(2, WALL_BORDER_COLOR, 1);
    this.tilesLayer.add(bg);

    const hpBarBg = this.add.rectangle(px, py + TILE_SIZE / 2 - HP_BAR_HEIGHT, TILE_SIZE - 4, HP_BAR_HEIGHT, 0x333333).setOrigin(0.5);
    this.tilesLayer.add(hpBarBg);

    const ratio = hp / maxHp;
    const fullWidth = TILE_SIZE - 4;
    const hpBar = this.add.rectangle(
      px - fullWidth / 2 * (1 - ratio),
      py + TILE_SIZE / 2 - HP_BAR_HEIGHT,
      fullWidth * ratio, HP_BAR_HEIGHT, WALL_BORDER_COLOR,
    ).setOrigin(0.5);
    this.tilesLayer.add(hpBar);

    const hpText = this.add.text(px, py, this.formatHp(hp), {
      fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);
    this.tilesLayer.add(hpText);

    this.wallVisuals.set(key, { bg, hpBar, hpBarBg, hpText, x: gridX, y: gridY, maxHp, currentHp: hp, ownerId });
  }

  private updateWallHp(gridX: number, gridY: number, hp: number): void {
    const key = `${gridX},${gridY}`;
    const visual = this.wallVisuals.get(key);
    if (!visual) return;

    const damage = visual.currentHp - hp;
    visual.currentHp = hp;

    const ratio = hp / visual.maxHp;
    const fullWidth = TILE_SIZE - 4;
    const px = visual.x * TILE_SIZE + TILE_SIZE / 2;
    const py = visual.y * TILE_SIZE + TILE_SIZE / 2;
    visual.hpBar.setDisplaySize(fullWidth * ratio, HP_BAR_HEIGHT);
    visual.hpBar.setX(px - fullWidth / 2 * (1 - ratio));
    visual.hpText.setText(this.formatHp(hp));

    if (damage > 0) {
      animDamagePopup(this, this.tilesLayer, px, py - TILE_SIZE / 4, damage);
    }
  }

  private removeWallVisual(gridX: number, gridY: number): void {
    const key = `${gridX},${gridY}`;
    const visual = this.wallVisuals.get(key);
    if (!visual) return;

    // 파괴 애니메이션
    this.sfx.wallDestroy();
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

  // === 타워 박스 비주얼 ===

  private createTowerBoxVisual(gridX: number, gridY: number, spawnId: number, hp: number, maxHp: number): void {
    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE / 2;
    const S = TILE_SIZE - 2;

    // 타워 박스 배경 (스폰 타워 위 반투명 검은색 커버)
    const bg = this.add.rectangle(px, py, S, S, 0x000000, 0)
      .setDepth(3);
    this.tilesLayer.add(bg);

    // 잠금 오버레이 (반투명 검은색, 스폰 타워와 화살표는 아래에 보임)
    const lockOverlay = this.add.rectangle(px, py, S, S, 0x000000, 0.55)
      .setDepth(4);
    this.tilesLayer.add(lockOverlay);

    // HP 바
    const hpBarBg = this.add.rectangle(px, py + S / 2 - HP_BAR_HEIGHT, S - 4, HP_BAR_HEIGHT, 0x333333)
      .setOrigin(0.5).setDepth(4);
    this.tilesLayer.add(hpBarBg);

    const ratio = hp / maxHp;
    const fullW = S - 4;
    const hpBar = this.add.rectangle(
      px - fullW / 2 * (1 - ratio),
      py + S / 2 - HP_BAR_HEIGHT,
      fullW * ratio, HP_BAR_HEIGHT, 0xffaa22,
    ).setOrigin(0.5).setDepth(4);
    this.tilesLayer.add(hpBar);

    const hpText = this.add.text(px, py - S * 0.12, this.formatHp(hp), {
      fontSize: '10px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(5);
    this.tilesLayer.add(hpText);

    this.towerBoxVisuals.set(spawnId, { bg, lockOverlay, hpBar, hpBarBg, hpText, spawnId, maxHp, currentHp: hp });
  }

  private updateTowerBoxHp(spawnId: number, hp: number, maxHp: number): void {
    const visual = this.towerBoxVisuals.get(spawnId);
    if (!visual) return;

    const damage = visual.currentHp - hp;
    visual.currentHp = hp;

    const ratio = hp / maxHp;
    const S = TILE_SIZE - 2;
    const fullW = S - 4;
    visual.hpBar.setDisplaySize(fullW * ratio, HP_BAR_HEIGHT);

    const sp = this.serverSpawnPoints.find(s => s.id === spawnId);
    if (sp) {
      const px = sp.x * TILE_SIZE + TILE_SIZE / 2;
      const py = sp.y * TILE_SIZE + TILE_SIZE / 2;
      visual.hpBar.setX(px - fullW / 2 * (1 - ratio));
      if (damage > 0) {
        animDamagePopup(this, this.tilesLayer, px, py - S * 0.25, damage);
      }
    }
    visual.hpText.setText(this.formatHp(hp));
  }

  private removeTowerBoxVisual(spawnId: number): void {
    const visual = this.towerBoxVisuals.get(spawnId);
    if (!visual) return;

    this.tweens.add({
      targets: [visual.bg, visual.lockOverlay, visual.hpBar, visual.hpBarBg, visual.hpText],
      alpha: 0,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 350,
      ease: 'Sine.easeOut',
      onComplete: () => {
        visual.bg.destroy();
        visual.lockOverlay.destroy();
        visual.hpBar.destroy();
        visual.hpBarBg.destroy();
        visual.hpText.destroy();
      },
    });
    this.towerBoxVisuals.delete(spawnId);
  }

  private drawShieldVisual(targetType: 'spawn' | 'core' | 'wall', targetId: string): void {
    this.removeShieldVisual(targetId);

    let worldX: number | null = null;
    let worldY: number | null = null;

    if (targetType === 'spawn') {
      const sp = this.serverSpawnPoints.find(s => s.id === parseInt(targetId));
      if (sp) { worldX = sp.x; worldY = sp.y; }
    } else if (targetType === 'core') {
      const core = this.serverCores.find(c => c.id === parseInt(targetId));
      if (core) { worldX = core.x; worldY = core.y; }
    } else if (targetType === 'wall') {
      const [wx, wy] = targetId.split(',').map(Number);
      if (!isNaN(wx) && !isNaN(wy)) { worldX = wx; worldY = wy; }
    }

    if (worldX === null || worldY === null) return;

    const px = worldX * TILE_SIZE + TILE_SIZE / 2;
    const py = worldY * TILE_SIZE + TILE_SIZE / 2;
    const size = TILE_SIZE + 6;

    const shield = this.add.rectangle(px, py, size, size, SHIELD_COLOR, SHIELD_ALPHA)
      .setDepth(8)
      .setStrokeStyle(2, SHIELD_COLOR);
    this.tilesLayer.add(shield);

    this.tweens.add({
      targets: shield,
      alpha: { from: SHIELD_ALPHA, to: Math.min(SHIELD_ALPHA * 2, 1) },
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    this.shieldVisuals.set(targetId, shield);
  }

  private removeShieldVisual(targetId: string): void {
    const existing = this.shieldVisuals.get(targetId);
    if (existing) {
      this.tweens.killTweensOf(existing);
      existing.destroy();
      this.shieldVisuals.delete(targetId);
    }
  }

  private createMyMapButton(): void {
    const { width, height } = this.scale;
    const btnW = 64, btnH = 22;
    const btnX = width - btnW / 2 - 8;
    const btnY = height - btnH / 2 - 8;

    const btn = this.add.rectangle(btnX, btnY, btnW, btnH, 0x334488, 0.85)
      .setStrokeStyle(1, 0x6688cc)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);
    const label = this.add.text(btnX, btnY, '내 맵', {
      fontSize: '13px', color: '#aaccff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11);
    this.uiLayer.add([btn, label]);
    this.myMapFocusBtn = btn;

    btn.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.focusOnMyZone(true);
    });
  }

  private focusOnMyZone(animate: boolean): void {
    const worldW = this.mapData.width * TILE_SIZE;
    const worldH = this.mapData.height * TILE_SIZE;
    let cx = worldW / 2;
    let cy = worldH / 2;

    if (this.layout) {
      const zone = this.layout.zones.find(z => z.playerId === this.myPlayerId);
      if (zone) {
        cx = (zone.originX + zone.width / 2) * TILE_SIZE;
        cy = (zone.originY + zone.height / 2) * TILE_SIZE;
      }
    } else {
      const myCore = Array.from(this.coreVisuals.values()).find(c => c.ownerId === this.myPlayerId);
      if (myCore) {
        cx = myCore.x * TILE_SIZE + TILE_SIZE / 2;
        cy = myCore.y * TILE_SIZE + TILE_SIZE / 2;
      }
    }

    if (animate) {
      this.cameras.main.pan(cx, cy, 500, 'Sine.easeInOut');
      this.cameras.main.zoomTo(1.0, 500, 'Sine.easeInOut');
    } else {
      this.cameras.main.centerOn(cx, cy);
      this.cameras.main.setZoom(1.0);
    }
  }

  private showEliminatedZoneOverlay(originX: number, originY: number, zoneW: number, zoneH: number): void {
    const px = originX * TILE_SIZE + (zoneW * TILE_SIZE) / 2;
    const py = originY * TILE_SIZE + (zoneH * TILE_SIZE) / 2;
    const overlay = this.add.rectangle(px, py, zoneW * TILE_SIZE, zoneH * TILE_SIZE, 0x000000, 0.55)
      .setDepth(20);
    this.tilesLayer.add(overlay);
  }

  private removeReflectorVisual(gridX: number, gridY: number): void {
    const key = `${gridX},${gridY}`;
    const visual = this.reflectorVisuals.get(key);
    if (!visual) return;
    visual.graphics.destroy();
    this.reflectorVisuals.delete(key);
    const bg = visual.bg;
    this.tweens.add({
      targets: bg,
      alpha: 0,
      duration: 1000,
      onComplete: () => bg.destroy(),
    });
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
