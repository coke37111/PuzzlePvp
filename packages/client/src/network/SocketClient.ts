import { io, Socket } from 'socket.io-client';
import {
  SocketEvent,
  SetTargetPlayersMsg,
  MatchFoundMsg,
  SpawnHpMsg,
  SpawnDestroyedMsg,
  ReflectorPlacedMsg,
  ReflectorRemovedMsg,
  BallSpawnedMsg,
  BallMovedMsg,
  BallEndedMsg,
  GameOverMsg,
  PlaceReflectorMsg,
  RemoveReflectorMsg,
  PlaceWallMsg,
  WallPlacedMsg,
  WallDamagedMsg,
  WallDestroyedMsg,
  UseSwordMsg,
  UseShieldMsg,
  GoldUpdatedMsg,
  SwordUsedMsg,
  ShieldAppliedMsg,
  ShieldExpiredMsg,
  CoreHpMsg,
  CoreDestroyedMsg,
  SpawnRespawnedMsg,
  SpawnPhaseCompleteMsg,
  ReflectorStockMsg,
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
  CoreHealedMsg,
  TowerBoxDamagedMsg,
  TowerBoxBrokenMsg,
  LobbyUpdateMsg,
  PlayerEliminatedMsg,
  OwnershipTransferredMsg,
  ReflectorType,
} from '@puzzle-pvp/shared';

// 개발: localhost:4000 / 프로덕션: 같은 오리진 (서버가 클라이언트도 서빙)
const SERVER_URL = import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin;

export class SocketClient {
  private static _instance: SocketClient | null = null;
  private socket: Socket;

  // 이벤트 콜백
  onMatchFound?: (msg: MatchFoundMsg) => void;
  onSpawnHp?: (msg: SpawnHpMsg) => void;
  onSpawnDestroyed?: (msg: SpawnDestroyedMsg) => void;
  onSpawnRespawned?: (msg: SpawnRespawnedMsg) => void;
  onReflectorPlaced?: (msg: ReflectorPlacedMsg) => void;
  onReflectorRemoved?: (msg: ReflectorRemovedMsg) => void;
  onBallSpawned?: (msg: BallSpawnedMsg) => void;
  onBallMoved?: (msg: BallMovedMsg) => void;
  onBallEnded?: (msg: BallEndedMsg) => void;
  onGameOver?: (msg: GameOverMsg) => void;
  onWallPlaced?: (msg: WallPlacedMsg) => void;
  onWallDamaged?: (msg: WallDamagedMsg) => void;
  onWallDestroyed?: (msg: WallDestroyedMsg) => void;
  onGoldUpdated?: (msg: GoldUpdatedMsg) => void;
  onSwordUsed?: (msg: SwordUsedMsg) => void;
  onShieldApplied?: (msg: ShieldAppliedMsg) => void;
  onShieldExpired?: (msg: ShieldExpiredMsg) => void;
  onCoreHp?: (msg: CoreHpMsg) => void;
  onCoreDestroyed?: (msg: CoreDestroyedMsg) => void;
  onSpawnPhaseComplete?: (msg: SpawnPhaseCompleteMsg) => void;
  onReflectorStock?: (msg: ReflectorStockMsg) => void;
  onMonsterSpawned?: (msg: MonsterSpawnedMsg) => void;
  onMonsterDamaged?: (msg: MonsterDamagedMsg) => void;
  onMonsterKilled?: (msg: MonsterKilledMsg) => void;
  onMonsterMoved?: (msg: MonsterMovedMsg) => void;
  onItemDropped?: (msg: ItemDroppedMsg) => void;
  onItemPickedUp?: (msg: ItemPickedUpMsg) => void;
  onBallPoweredUp?: (msg: BallPoweredUpMsg) => void;
  onPlayerBallCountUp?: (msg: PlayerBallCountUpMsg) => void;
  onPlayerSpeedUp?: (msg: PlayerSpeedUpMsg) => void;
  onPlayerReflectorExpand?: (msg: PlayerReflectorExpandMsg) => void;
  onSpawnHealed?: (msg: SpawnHealedMsg) => void;
  onCoreHealed?: (msg: CoreHealedMsg) => void;
  onTowerBoxDamaged?: (msg: TowerBoxDamagedMsg) => void;
  onTowerBoxBroken?: (msg: TowerBoxBrokenMsg) => void;
  onLobbyUpdate?: (msg: LobbyUpdateMsg) => void;
  onPlayerEliminated?: (msg: PlayerEliminatedMsg) => void;
  onOwnershipTransferred?: (msg: OwnershipTransferredMsg) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;

  static get instance(): SocketClient {
    if (!SocketClient._instance) {
      SocketClient._instance = new SocketClient();
    }
    return SocketClient._instance;
  }

  private constructor() {
    this.socket = io(SERVER_URL, { autoConnect: false, transports: ['websocket'] });

    this.socket.on('connect', () => {
      console.log('[SocketClient] 서버 연결됨');
      this.onConnected?.();
    });

    this.socket.on('disconnect', () => {
      console.log('[SocketClient] 서버 연결 종료');
      this.onDisconnected?.();
    });

    this.socket.on(SocketEvent.MATCH_FOUND, (msg: MatchFoundMsg) => this.onMatchFound?.(msg));
    this.socket.on(SocketEvent.SPAWN_HP, (msg: SpawnHpMsg) => this.onSpawnHp?.(msg));
    this.socket.on(SocketEvent.SPAWN_DESTROYED, (msg: SpawnDestroyedMsg) => this.onSpawnDestroyed?.(msg));
    this.socket.on(SocketEvent.SPAWN_RESPAWNED, (msg: SpawnRespawnedMsg) => this.onSpawnRespawned?.(msg));
    this.socket.on(SocketEvent.REFLECTOR_PLACED, (msg: ReflectorPlacedMsg) => this.onReflectorPlaced?.(msg));
    this.socket.on(SocketEvent.REFLECTOR_REMOVED, (msg: ReflectorRemovedMsg) => this.onReflectorRemoved?.(msg));
    this.socket.on(SocketEvent.BALL_SPAWNED, (msg: BallSpawnedMsg) => this.onBallSpawned?.(msg));
    this.socket.on(SocketEvent.BALL_MOVED, (msg: BallMovedMsg) => this.onBallMoved?.(msg));
    this.socket.on(SocketEvent.BALL_ENDED, (msg: BallEndedMsg) => this.onBallEnded?.(msg));
    this.socket.on(SocketEvent.GAME_OVER, (msg: GameOverMsg) => this.onGameOver?.(msg));
    this.socket.on(SocketEvent.WALL_PLACED, (msg: WallPlacedMsg) => this.onWallPlaced?.(msg));
    this.socket.on(SocketEvent.WALL_DAMAGED, (msg: WallDamagedMsg) => this.onWallDamaged?.(msg));
    this.socket.on(SocketEvent.WALL_DESTROYED, (msg: WallDestroyedMsg) => this.onWallDestroyed?.(msg));
    this.socket.on(SocketEvent.GOLD_UPDATED, (msg: GoldUpdatedMsg) => this.onGoldUpdated?.(msg));
    this.socket.on(SocketEvent.SWORD_USED, (msg: SwordUsedMsg) => this.onSwordUsed?.(msg));
    this.socket.on(SocketEvent.SHIELD_APPLIED, (msg: ShieldAppliedMsg) => this.onShieldApplied?.(msg));
    this.socket.on(SocketEvent.SHIELD_EXPIRED, (msg: ShieldExpiredMsg) => this.onShieldExpired?.(msg));
    this.socket.on(SocketEvent.CORE_HP, (msg: CoreHpMsg) => this.onCoreHp?.(msg));
    this.socket.on(SocketEvent.CORE_DESTROYED, (msg: CoreDestroyedMsg) => this.onCoreDestroyed?.(msg));
    this.socket.on(SocketEvent.SPAWN_PHASE_COMPLETE, (msg: SpawnPhaseCompleteMsg) => this.onSpawnPhaseComplete?.(msg));
    this.socket.on(SocketEvent.REFLECTOR_STOCK, (msg: ReflectorStockMsg) => this.onReflectorStock?.(msg));
    this.socket.on(SocketEvent.MONSTER_SPAWNED, (msg: MonsterSpawnedMsg) => this.onMonsterSpawned?.(msg));
    this.socket.on(SocketEvent.MONSTER_DAMAGED, (msg: MonsterDamagedMsg) => this.onMonsterDamaged?.(msg));
    this.socket.on(SocketEvent.MONSTER_KILLED, (msg: MonsterKilledMsg) => this.onMonsterKilled?.(msg));
    this.socket.on(SocketEvent.MONSTER_MOVED, (msg: MonsterMovedMsg) => this.onMonsterMoved?.(msg));
    this.socket.on(SocketEvent.ITEM_DROPPED, (msg: ItemDroppedMsg) => this.onItemDropped?.(msg));
    this.socket.on(SocketEvent.ITEM_PICKED_UP, (msg: ItemPickedUpMsg) => this.onItemPickedUp?.(msg));
    this.socket.on(SocketEvent.BALL_POWERED_UP, (msg: BallPoweredUpMsg) => this.onBallPoweredUp?.(msg));
    this.socket.on(SocketEvent.PLAYER_BALL_COUNT_UP, (msg: PlayerBallCountUpMsg) => this.onPlayerBallCountUp?.(msg));
    this.socket.on(SocketEvent.PLAYER_SPEED_UP, (msg: PlayerSpeedUpMsg) => this.onPlayerSpeedUp?.(msg));
    this.socket.on(SocketEvent.PLAYER_REFLECTOR_EXPAND, (msg: PlayerReflectorExpandMsg) => this.onPlayerReflectorExpand?.(msg));
    this.socket.on(SocketEvent.SPAWN_HEALED, (msg: SpawnHealedMsg) => this.onSpawnHealed?.(msg));
    this.socket.on(SocketEvent.CORE_HEALED, (msg: CoreHealedMsg) => this.onCoreHealed?.(msg));
    this.socket.on(SocketEvent.TOWER_BOX_DAMAGED, (msg: TowerBoxDamagedMsg) => this.onTowerBoxDamaged?.(msg));
    this.socket.on(SocketEvent.TOWER_BOX_BROKEN, (msg: TowerBoxBrokenMsg) => this.onTowerBoxBroken?.(msg));
    this.socket.on(SocketEvent.LOBBY_UPDATE, (msg: LobbyUpdateMsg) => this.onLobbyUpdate?.(msg));
    this.socket.on(SocketEvent.PLAYER_ELIMINATED, (msg: PlayerEliminatedMsg) => this.onPlayerEliminated?.(msg));
    this.socket.on(SocketEvent.OWNERSHIP_TRANSFERRED, (msg: OwnershipTransferredMsg) => this.onOwnershipTransferred?.(msg));
  }

  get isConnected(): boolean {
    return this.socket.connected;
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  joinQueue(): void {
    this.socket.emit(SocketEvent.JOIN_QUEUE);
  }

  leaveQueue(): void {
    this.socket.emit(SocketEvent.LEAVE_QUEUE);
  }

  placeReflector(x: number, y: number, type: ReflectorType): void {
    const msg: PlaceReflectorMsg = { x, y, type };
    console.log(`[SocketClient] 반사판 설치 전송: (${x},${y}) type=${type} connected=${this.socket.connected}`);
    this.socket.emit(SocketEvent.PLACE_REFLECTOR, msg);
  }

  removeReflector(x: number, y: number): void {
    const msg: RemoveReflectorMsg = { x, y };
    console.log(`[SocketClient] 반사판 해제 전송: (${x},${y}) connected=${this.socket.connected}`);
    this.socket.emit(SocketEvent.REMOVE_REFLECTOR, msg);
  }

  placeWall(x: number, y: number): void {
    const msg: PlaceWallMsg = { x, y };
    this.socket.emit(SocketEvent.PLACE_WALL, msg);
  }

  useSword(x: number, y: number): void {
    const msg: UseSwordMsg = { x, y };
    this.socket.emit(SocketEvent.USE_SWORD, msg);
  }

  useShield(targetType: 'spawn' | 'core' | 'wall', targetId: string): void {
    const msg: UseShieldMsg = { targetType, targetId };
    this.socket.emit(SocketEvent.USE_SHIELD, msg);
  }

  setTargetPlayers(count: number): void {
    const msg: SetTargetPlayersMsg = { targetCount: count };
    this.socket.emit(SocketEvent.SET_TARGET_PLAYERS, msg);
  }
}
