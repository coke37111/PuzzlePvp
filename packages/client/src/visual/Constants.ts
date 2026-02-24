// === 레이아웃 ===
export const TILE_SIZE = 52;
export const BALL_RADIUS = 7;
export const HP_BAR_HEIGHT = 8;

// === 플레이어 색상 ===
export const PLAYER_COLORS = [0x4488ff, 0xff4444];
export const PLAYER_COLORS_DARK = [0x224488, 0x882222];

// === 공 색상 (팀 컬러: 인덱스 0=내 공, 1=적 공) ===
export const BALL_COLOR = 0xffffff;
export const BALL_TEAM_COLORS = [0x88ccff, 0xff8888];

// === 몬스터 타입별 색상 (Orange=공격력, White=공갯수, LightBlue=공속도, Purple=반사판확장) ===
export const MONSTER_COLORS  = [0xff8800, 0xffffff, 0x44ddff, 0xcc44ff]; // Orange, White, LightBlue, Purple
export const MONSTER_BORDERS = [0xffcc00, 0xaaaaaa, 0x0099cc, 0x8800cc]; // 테두리

// === 아이템 타입별 색상 (PowerUp, BallCount, SpeedUp, ReflectorExpand) ===
// DropItemType enum: 1=PowerUp, 2=BallCount, 3=SpeedUp, 4=ReflectorExpand (인덱스 0 = 미사용 패딩)
export const ITEM_COLOR = 0xff4444; // 하위호환
export const ITEM_COLORS = [0xff3333, 0xffffff, 0x44ddff, 0xcc44ff]; // PowerUp, BallCount, SpeedUp, ReflectorExpand

// === 배경/그리드 ===
export const BG_COLOR = 0x12121e;
export const GRID_LINE_COLOR = 0x3a3a5e;
export const GRID_LINE_ALPHA = 0.4;

// === 타일 색상 ===
export const TILE_EMPTY_COLOR = 0x2a2a3e;
export const TILE_P1_SPAWN_COLOR = 0x222266;
export const TILE_P2_SPAWN_COLOR = 0x662222;
export const TILE_P1_CORE_COLOR = 0x1144cc;
export const TILE_P2_CORE_COLOR = 0xcc1144;
export const TILE_BLOCK_COLOR = 0x333344;
export const TILE_BLOCK_X_COLOR = 0x666688;
export const TILE_BLOCK_X_ALPHA = 0.4;

// === 호버 ===
export const HOVER_COLOR = 0x3a3a5e;
export const HOVER_ALPHA = 0.3;

// === 적 스폰 보호 구역 ===
export const ENEMY_ZONE_ALPHA = 0.12;

// === 애니메이션 타이밍 (ms) ===
export const ANIM_BALL_SPAWN = 200;
export const ANIM_BALL_END = 250;
export const ANIM_REFLECTOR_PLACE = 150;
export const ANIM_HP_BAR = 300;
export const ANIM_DAMAGE_FLASH = 120;
export const ANIM_DESTROY_SHAKE_STEP = 50;

// === 공 글로우 ===
export const GLOW_RADIUS_EXTRA = 4;
export const GLOW_ALPHA = 0.25;

// === HP 바 그래디언트 색상 ===
export const HP_COLOR_HIGH = 0x44cc44;  // 초록 (100%)
export const HP_COLOR_MID  = 0xcccc44;  // 노랑 (50%)
export const HP_COLOR_LOW  = 0xff2222;  // 빨강 (0%)

// === 데미지 팝업 ===
export const ANIM_DAMAGE_POPUP_DURATION   = 1000;
export const ANIM_DAMAGE_POPUP_MOVE_Y     = -50;
export const ANIM_DAMAGE_POPUP_FADE_START = 300;

// === 반사판 선택 팝업 ===
export const POPUP_BTN_SIZE   = 36;
export const POPUP_BTN_GAP    = 6;
export const POPUP_ANIM_OPEN  = 150;
export const POPUP_ANIM_CLOSE = 100;

// === 게임 규칙 ===
export const MAX_REFLECTORS_PER_PLAYER = 5;
export const INITIAL_WALL_COUNT = 3;
export const INITIAL_TIME_STOP_COUNT = 1;

// === 성벽 ===
export const WALL_COLOR = 0x886633;
export const WALL_BORDER_COLOR = 0xddaa44;

// === 시간 정지 오버레이 ===
export const TIME_STOP_OVERLAY_ALPHA = 0.5;
export const TIME_STOP_GAUGE_COLOR = 0x8844ff;
export const TIME_STOP_DURATION = 5;

// === 스폰 타이밍 게이지 ===
export const SPAWN_GAUGE_HEIGHT = 5;
export const SPAWN_GAUGE_COLOR = 0x44ccff;

