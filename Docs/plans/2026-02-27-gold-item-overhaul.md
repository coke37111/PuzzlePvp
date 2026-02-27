# Gold & Item Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace time-stop item with gold currency system and three gold-purchased items (wall, sword, shield).

**Architecture:** Gold is server-authoritative (Map<playerId, number> in BattleSimulator). Gold gained on enemy entity destruction. Items deduct gold and trigger server-side logic. Shield state tracked in BattleSimulator with timer-based expiry. Client displays gold and updated item UI.

**Tech Stack:** TypeScript, Phaser.js, Socket.io, npm workspaces monorepo

---

### Task 1: NetworkMessage.ts — Remove timeStop, Add Gold/Sword/Shield

**Files:**
- Modify: `packages/shared/src/types/NetworkMessage.ts`

**Step 1: Remove timeStop message types**

Delete these three interfaces (lines ~34-36 and ~253-260):
```typescript
// DELETE these:
export interface UseTimeStopMsg { /* empty */ }
export interface TimeStopStartedMsg { playerId: number; duration: number; }
export interface TimeStopEndedMsg { /* empty */ }
```

**Step 2: Add new message types**

Add after `PlaceWallMsg` (after line ~32):
```typescript
export interface UseSwordMsg {
  x: number;
  y: number;
}

export interface UseShieldMsg {
  targetType: 'spawn' | 'core' | 'wall';
  targetId: string; // spawnId, coreId, or "x,y" for walls
}
```

Add after `WallDestroyedMsg` (after line ~251), replacing the timeStop interfaces:
```typescript
export interface GoldUpdatedMsg {
  playerId: number;
  gold: number;
}

export interface SwordUsedMsg {
  attackerId: number;
  x: number;
  y: number;
}

export interface ShieldAppliedMsg {
  targetType: 'spawn' | 'core' | 'wall';
  targetId: string;
  duration: number;
  ownerId: number;
}

export interface ShieldExpiredMsg {
  targetType: 'spawn' | 'core' | 'wall';
  targetId: string;
}
```

**Step 3: Update SocketEvent enum**

Remove from SocketEvent (lines ~331-332, ~351-352):
```typescript
USE_TIME_STOP: 'use_time_stop',      // DELETE
TIME_STOP_STARTED: 'time_stop_started',  // DELETE
TIME_STOP_ENDED: 'time_stop_ended',      // DELETE
```

Add to SocketEvent C→S section:
```typescript
USE_SWORD: 'use_sword',
USE_SHIELD: 'use_shield',
```

Add to SocketEvent S→C section:
```typescript
GOLD_UPDATED: 'gold_updated',
SWORD_USED: 'sword_used',
SHIELD_APPLIED: 'shield_applied',
SHIELD_EXPIRED: 'shield_expired',
```

**Step 4: Build shared to verify no errors**
```bash
cd C:/Projects/PuzzlePvp && npm run build:shared
```
Expected: Build succeeds with no TypeScript errors.

---

### Task 2: BattleSimulator.ts — Gold, Shield, Sword, Config Changes

**Files:**
- Modify: `packages/shared/src/core/BattleSimulator.ts`

**Step 1: Update imports at top of file**

The file already imports from `NetworkMessage` indirectly via type usage. No import changes needed for messages — the file uses its own internal types.

**Step 2: Remove ItemCounts interface and timeStop from BattleConfig**

Replace the `ItemCounts` interface (lines ~22-25):
```typescript
// DELETE ItemCounts interface entirely
```

Replace in `BattleConfig` — remove timeStop fields, add gold/shield fields (lines ~40-54):
```typescript
export interface BattleConfig {
  spawnInterval: number;
  timePerPhase: number;
  maxReflectorsPerPlayer: number;
  reflectorCooldown: number;
  maxReflectorStock: number;
  initialReflectorStock: number;
  spawnHp: number;
  coreHp: number;
  // Removed: maxWallsPerPlayer, wallHp (fixed HP), timeStopUsesPerPlayer, timeStopDuration
  // Added: gold item costs
  wallCostGold: number;    // 100
  swordCostGold: number;   // 10
  shieldCostGold: number;  // 300
  shieldDuration: number;  // 30 seconds
  initialBallPower: number;
}
```

Update `DEFAULT_BATTLE_CONFIG`:
```typescript
export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  spawnInterval: 5.0,
  timePerPhase: 0.2,
  maxReflectorsPerPlayer: 5,
  reflectorCooldown: 3.0,
  maxReflectorStock: 5,
  initialReflectorStock: 3,
  spawnHp: 7,
  coreHp: 15,
  wallCostGold: 100,
  swordCostGold: 10,
  shieldCostGold: 300,
  shieldDuration: 30,
  initialBallPower: 3,
};
```

Also remove the `TimeStopEvent` interface (lines ~35-38):
```typescript
// DELETE:
export interface TimeStopEvent { playerId: number; duration: number; }
```

**Step 3: Replace fields in class body**

In the class fields section, replace:
```typescript
// DELETE:
private itemCounts: Map<number, ItemCounts> = new Map();
private isTimeStopped: boolean = false;
private timeStopRemaining: number = 0;
```

Add new fields (after `private walls`):
```typescript
private playerGold: Map<number, number> = new Map();

// Shield state: key is targetId (spawnId string, coreId string, or "x,y" for walls)
private shields: Map<string, { targetType: 'spawn' | 'core' | 'wall'; remaining: number; ownerId: number }> = new Map();
```

**Step 4: Remove timeStop callbacks, add gold/sword/shield callbacks**

Delete from callbacks section (lines ~140-141):
```typescript
// DELETE:
onTimeStopStarted?: (event: TimeStopEvent) => void;
onTimeStopEnded?: () => void;
```

Add new callbacks after `onTowerBoxBroken?`:
```typescript
onGoldUpdated?: (playerId: number, gold: number) => void;
onSwordUsed?: (attackerId: number, x: number, y: number) => void;
onShieldApplied?: (targetType: 'spawn' | 'core' | 'wall', targetId: string, duration: number, ownerId: number) => void;
onShieldExpired?: (targetType: 'spawn' | 'core' | 'wall', targetId: string) => void;
```

**Step 5: Remove isGameTimeStopped getter**

Delete (line ~229-231):
```typescript
// DELETE:
get isGameTimeStopped(): boolean { return this.isTimeStopped; }
```

**Step 6: Update constructor — remove itemCounts init**

In the constructor (lines ~192-196), replace:
```typescript
// OLD:
for (const pid of this.playerIds) {
  this.reflectorQueues.set(pid, []);
  this.itemCounts.set(pid, { wall: this.config.maxWallsPerPlayer, timeStop: this.config.timeStopUsesPerPlayer });
}

// NEW:
for (const pid of this.playerIds) {
  this.reflectorQueues.set(pid, []);
}
```

**Step 7: Remove getItemCounts method**

Delete (lines ~199-201):
```typescript
// DELETE:
getItemCounts(playerId: number): ItemCounts {
  return this.itemCounts.get(playerId) ?? { wall: 0, timeStop: 0 };
}
```

Add new getter:
```typescript
getPlayerGold(playerId: number): number {
  return this.playerGold.get(playerId) ?? 0;
}
```

**Step 8: Update init() — remove itemCounts init, add gold init**

In `init()` (lines ~233+), remove the `itemCounts.clear()` / initialization logic.
Add gold init in the per-player init loop:
```typescript
// In the for loop that clears per-player state:
for (const pid of this.playerIds) {
  // ... existing code ...
  this.playerGold.set(pid, 0);  // ADD THIS
}
// Also clear shields:
this.shields.clear();  // ADD after droppedItems.clear()
```

**Step 9: Update initFromAssignments() — remove itemCounts init**

In `initFromAssignments()` (lines ~458+), find and delete:
```typescript
// DELETE:
if (!this.itemCounts.has(pid)) {
  this.itemCounts.set(pid, { wall: this.config.maxWallsPerPlayer, timeStop: this.config.timeStopUsesPerPlayer });
}
```

Replace with gold init:
```typescript
if (!this.playerGold.has(pid)) {
  this.playerGold.set(pid, 0);
}
```

**Step 10: Update update() — remove timeStop block, add shield timer**

Delete the timeStop block in `update()` (lines ~528-536):
```typescript
// DELETE the entire timeStop block:
if (this.isTimeStopped) {
  this.timeStopRemaining -= delta;
  if (this.timeStopRemaining <= 0) {
    this.isTimeStopped = false;
    this.onTimeStopEnded?.();
  }
  return;
}
```

Add shield timer processing in `update()` after the existing `if (!this.isRunning) return;`:
```typescript
// Shield timers
for (const [key, shield] of this.shields) {
  shield.remaining -= delta;
  if (shield.remaining <= 0) {
    this.shields.delete(key);
    this.onShieldExpired?.(shield.targetType, key);
  }
}
```

**Step 11: Add shield checks in collision handling**

In `onBallArrivedAtTile` callback, add shield checks:

**Wall collision** (before `wall.hp -= ball.power`, around line ~352):
```typescript
const wallKey = `${tile.x},${tile.y}`;
const wall = this.walls.get(wallKey);
if (wall) {
  // NEW: shield check
  if (this.shields.has(wallKey)) return true;  // shielded, absorb ball

  wall.hp -= ball.power;
  if (wall.hp <= 0) {
    this.walls.delete(wallKey);
    // NEW: gold for zone walls only (ownerId === -1 means it's a zone wall)
    if (wall.ownerId === -1) {
      this.addGold(ball.ownerId, 10);
    }
    this.onWallDestroyed?.(tile.x, tile.y);
  } else {
    this.onWallDamaged?.({ x: tile.x, y: tile.y, hp: wall.hp });
  }
  return true;
}
```

**Spawn collision** (before `sp.damage(ball.power)`, around line ~391):
```typescript
if (sp && sp.active) {
  if (ball.ownerId === sp.ownerId) {
    sp.heal(ball.power);
    this.onSpawnHealed?.({ spawnId: sp.id, hp: sp.hp, maxHp: sp.maxHp, ownerId: sp.ownerId });
  } else {
    // NEW: shield check
    if (this.shields.has(sp.id.toString())) return true;  // shielded

    sp.damage(ball.power);
    if (!sp.active) {
      const count = (this.spawnDestroyCount.get(sp.id) ?? 0) + 1;
      this.spawnDestroyCount.set(sp.id, count);
      const respawnDelay = BattleSimulator.SPAWN_RESPAWN_BASE + (count - 1) * BattleSimulator.SPAWN_RESPAWN_INC;
      this.spawnRespawnTimers.set(sp.id, respawnDelay);
      this.onSpawnDestroyed?.(sp.id, respawnDelay);
      this.trimReflectorsForPlayer(sp.ownerId);
      this.spawnQueues.set(sp.id, []);
      // NEW: gold for destroying enemy spawn
      this.addGold(ball.ownerId, 30);
    }
    this.onSpawnHpChanged?.({ spawnId: sp.id, hp: sp.hp, ownerId: sp.ownerId });
  }
  return true;
}
```

**Core collision** (before `core.damage(ball.power)`, around line ~416):
```typescript
if (core && core.active) {
  if (ball.ownerId === core.ownerId) {
    core.heal(ball.power);
    this.onCoreHealed?.({ coreId: core.id, hp: core.hp, maxHp: core.maxHp, ownerId: core.ownerId });
  } else {
    // NEW: shield check
    if (this.shields.has(core.id.toString())) return true;  // shielded

    core.damage(ball.power);
    this.onCoreHpChanged?.({ coreId: core.id, hp: core.hp, ownerId: core.ownerId });
    if (!core.active) {
      // NEW: gold for destroying enemy core
      this.addGold(ball.ownerId, 300);
      this.onCoreDestroyed?.(core.id);
      this.transferOwnership(core, ball.ownerId);
    }
  }
  return true;
}
```

**Step 12: Add gold for cascade in transferOwnership()**

In `transferOwnership()` (line ~747+), add gold for each active spawn being transferred:
```typescript
private transferOwnership(destroyedCore: CoreModel, newOwnerId: number): void {
  const oldOwnerId = destroyedCore.ownerId;

  destroyedCore.ownerId = newOwnerId;
  destroyedCore.maxHp = this.config.coreHp;
  destroyedCore.hp = this.config.coreHp;
  destroyedCore.active = true;

  const spawnTransfers: { spawnId: number; hp: number; maxHp: number; active: boolean }[] = [];
  for (const sp of this.spawnPoints) {
    if (sp.ownerId === oldOwnerId) {
      // NEW: grant gold for each active (non-destroyed, non-locked) spawn
      const box = this.towerBoxes.get(sp.id);
      const isLocked = box && !box.broken;
      if (sp.active && !isLocked) {
        this.addGold(newOwnerId, 30);
      }

      sp.ownerId = newOwnerId;
      if (!sp.active) {
        const isLockedNow = box && !box.broken;
        if (!isLockedNow) {
          sp.hp = this.config.spawnHp;
          sp.maxHp = this.config.spawnHp;
          sp.active = true;
          this.spawnRespawnTimers.delete(sp.id);
        }
      }
      spawnTransfers.push({ spawnId: sp.id, hp: sp.hp, maxHp: sp.maxHp, active: sp.active });
    }
  }
  // ... rest of method unchanged
```

**Step 13: Add spawnAll shield check for tower attack blocking**

In `spawnAll()` or wherever individual spawns fire, add a check for shielded towers. Find the spawn firing logic and add:
```typescript
// Skip firing if spawn is shielded
if (this.shields.has(sp.id.toString())) continue;
```

(Find where `sp.active` is checked and balls are spawned from spawn points — add the shield skip there)

**Step 14: Add private addGold helper method**

Add before `placeWall()`:
```typescript
private addGold(playerId: number, amount: number): void {
  const current = this.playerGold.get(playerId) ?? 0;
  const newAmount = current + amount;
  this.playerGold.set(playerId, newAmount);
  this.onGoldUpdated?.(playerId, newAmount);
}
```

**Step 15: Replace placeWall() with gold-based version**

Replace entire `placeWall()` method (lines ~1033-1049):
```typescript
placeWall(playerId: number, x: number, y: number): boolean {
  const gold = this.playerGold.get(playerId) ?? 0;
  if (gold < this.config.wallCostGold) return false;

  const tile = this.map.getTile(x, y);
  if (!tile || !tile.isReflectorSetable) return false;
  if (this.map.reflectors.has(x + y * 100)) return false;
  if (this.walls.has(`${x},${y}`)) return false;
  if (this.spawnPoints.some(s => s.tile.x === x && s.tile.y === y)) return false;

  // Wall HP = current attack power × 100
  const power = this.playerBasePower.get(playerId) ?? this.config.initialBallPower;
  const wallHp = power * 100;

  this.playerGold.set(playerId, gold - this.config.wallCostGold);
  this.onGoldUpdated?.(playerId, gold - this.config.wallCostGold);

  const wall: WallState = { x, y, hp: wallHp, maxHp: wallHp, ownerId: playerId };
  this.walls.set(`${x},${y}`, wall);
  this.onWallPlaced?.({ x, y, hp: wall.hp, maxHp: wall.maxHp, playerId });
  return true;
}
```

**Step 16: Replace useTimeStop() with useSword() and useShield()**

Delete `useTimeStop()` (lines ~1051-1061) entirely and add:
```typescript
useSword(playerId: number, x: number, y: number): boolean {
  const gold = this.playerGold.get(playerId) ?? 0;
  if (gold < this.config.swordCostGold) return false;

  const tileIndex = x + y * 100;
  const reflector = this.map.reflectors.get(tileIndex);
  if (!reflector) return false;
  if (reflector.playerId === playerId) return false; // Can't target own reflectors

  // Remove the reflector from map
  this.map.reflectors.delete(tileIndex);

  // Remove from the owner's queue
  const queue = this.reflectorQueues.get(reflector.playerId);
  if (queue) {
    const idx = queue.indexOf(tileIndex);
    if (idx !== -1) queue.splice(idx, 1);
  }

  // Restore a stock to the target player (same as normal removal)
  const targetStock = this.reflectorStocks.get(reflector.playerId) ?? 0;
  const newStock = Math.min(targetStock + 1, this.config.maxReflectorStock);
  this.reflectorStocks.set(reflector.playerId, newStock);

  this.playerGold.set(playerId, gold - this.config.swordCostGold);
  this.onGoldUpdated?.(playerId, gold - this.config.swordCostGold);
  this.onReflectorRemoved?.(x, y, reflector.playerId);
  this.onSwordUsed?.(playerId, x, y);
  return true;
}

useShield(playerId: number, targetType: 'spawn' | 'core' | 'wall', targetId: string): boolean {
  const gold = this.playerGold.get(playerId) ?? 0;
  if (gold < this.config.shieldCostGold) return false;

  // Validate target belongs to player
  if (targetType === 'spawn') {
    const sp = this.spawnPoints.find(s => s.id === parseInt(targetId));
    if (!sp || sp.ownerId !== playerId) return false;
  } else if (targetType === 'core') {
    const core = this.cores.find(c => c.id === parseInt(targetId));
    if (!core || core.ownerId !== playerId) return false;
  } else if (targetType === 'wall') {
    const wall = this.walls.get(targetId);
    if (!wall || wall.ownerId !== playerId) return false;
  }

  // Already shielded
  if (this.shields.has(targetId)) return false;

  this.playerGold.set(playerId, gold - this.config.shieldCostGold);
  this.onGoldUpdated?.(playerId, gold - this.config.shieldCostGold);
  this.shields.set(targetId, { targetType, remaining: this.config.shieldDuration, ownerId: playerId });
  this.onShieldApplied?.(targetType, targetId, this.config.shieldDuration, playerId);
  return true;
}
```

**Step 17: Find and fix spawnAll shield check**

Search for where spawns fire balls (the `spawnAll()` method or similar). Find where it iterates active spawns and fires:
```bash
grep -n "spawnAll\|sp\.active\|spawnBall\|spawnQueues" packages/shared/src/core/BattleSimulator.ts | head -30
```

In the spawn firing loop, add shield check to prevent shielded towers from firing.

**Step 18: Build shared**
```bash
cd C:/Projects/PuzzlePvp && npm run build:shared
```
Expected: No TypeScript errors.

---

### Task 3: GameRoom.ts — Wire New Simulator Events

**Files:**
- Modify: `packages/server/src/rooms/GameRoom.ts`

**Step 1: Update imports at top**

Remove from imports:
```typescript
TimeStopStartedMsg,
TimeStopEndedMsg,
// Also remove from SocketEvent usage: USE_TIME_STOP, TIME_STOP_STARTED, TIME_STOP_ENDED
```

Add new imports:
```typescript
UseSwordMsg,
UseShieldMsg,
GoldUpdatedMsg,
SwordUsedMsg,
ShieldAppliedMsg,
ShieldExpiredMsg,
```

**Step 2: Remove timeStop callbacks, add new callbacks**

Delete in constructor (lines ~186-195):
```typescript
// DELETE:
this.simulator.onTimeStopStarted = (event) => { ... };
this.simulator.onTimeStopEnded = () => { ... };
```

Add new callbacks after `onTowerBoxBroken`:
```typescript
this.simulator.onGoldUpdated = (playerId, gold) => {
  const msg: GoldUpdatedMsg = { playerId, gold };
  // Only send to that specific player, not broadcast
  for (const [pid, socket] of this.players) {
    if (pid === playerId && socket) socket.emit(SocketEvent.GOLD_UPDATED, msg);
  }
};

this.simulator.onSwordUsed = (attackerId, x, y) => {
  const msg: SwordUsedMsg = { attackerId, x, y };
  this.broadcast(SocketEvent.SWORD_USED, msg);
};

this.simulator.onShieldApplied = (targetType, targetId, duration, ownerId) => {
  const msg: ShieldAppliedMsg = { targetType, targetId, duration, ownerId };
  this.broadcast(SocketEvent.SHIELD_APPLIED, msg);
};

this.simulator.onShieldExpired = (targetType, targetId) => {
  const msg: ShieldExpiredMsg = { targetType, targetId };
  this.broadcast(SocketEvent.SHIELD_EXPIRED, msg);
};
```

**Step 3: Replace timeStop socket listener with sword/shield listeners**

In `start()`, replace the `USE_TIME_STOP` listener:
```typescript
// DELETE:
socket.on(SocketEvent.USE_TIME_STOP, () => { ... });

// ADD:
socket.on(SocketEvent.USE_SWORD, (msg: UseSwordMsg) => {
  this.simulator.useSword(playerId, msg.x, msg.y);
});

socket.on(SocketEvent.USE_SHIELD, (msg: UseShieldMsg) => {
  this.simulator.useShield(playerId, msg.targetType, msg.targetId);
});
```

**Step 4: Update stop() cleanup**

In `stop()`, replace:
```typescript
// DELETE:
socket.removeAllListeners(SocketEvent.USE_TIME_STOP);

// ADD:
socket.removeAllListeners(SocketEvent.USE_SWORD);
socket.removeAllListeners(SocketEvent.USE_SHIELD);
```

**Step 5: Build server**
```bash
cd C:/Projects/PuzzlePvp && npm run build:shared && npx tsc -p packages/server/tsconfig.json --noEmit
```
Expected: No TypeScript errors.

---

### Task 4: SocketClient.ts — Update Client Network Layer

**Files:**
- Modify: `packages/client/src/network/SocketClient.ts`

**Step 1: Update imports**

Remove from imports:
```typescript
TimeStopStartedMsg,
TimeStopEndedMsg,
```

Add new imports:
```typescript
UseSwordMsg,
UseShieldMsg,
GoldUpdatedMsg,
SwordUsedMsg,
ShieldAppliedMsg,
ShieldExpiredMsg,
```

**Step 2: Remove timeStop callbacks, add new callbacks**

Delete callback properties:
```typescript
// DELETE:
onTimeStopStarted?: (msg: TimeStopStartedMsg) => void;
onTimeStopEnded?: (msg: TimeStopEndedMsg) => void;
```

Add new callback properties:
```typescript
onGoldUpdated?: (msg: GoldUpdatedMsg) => void;
onSwordUsed?: (msg: SwordUsedMsg) => void;
onShieldApplied?: (msg: ShieldAppliedMsg) => void;
onShieldExpired?: (msg: ShieldExpiredMsg) => void;
```

**Step 3: Update socket.on registrations**

Delete (lines ~127-128):
```typescript
// DELETE:
this.socket.on(SocketEvent.TIME_STOP_STARTED, (msg: TimeStopStartedMsg) => this.onTimeStopStarted?.(msg));
this.socket.on(SocketEvent.TIME_STOP_ENDED, (msg: TimeStopEndedMsg) => this.onTimeStopEnded?.(msg));
```

Add:
```typescript
this.socket.on(SocketEvent.GOLD_UPDATED, (msg: GoldUpdatedMsg) => this.onGoldUpdated?.(msg));
this.socket.on(SocketEvent.SWORD_USED, (msg: SwordUsedMsg) => this.onSwordUsed?.(msg));
this.socket.on(SocketEvent.SHIELD_APPLIED, (msg: ShieldAppliedMsg) => this.onShieldApplied?.(msg));
this.socket.on(SocketEvent.SHIELD_EXPIRED, (msg: ShieldExpiredMsg) => this.onShieldExpired?.(msg));
```

**Step 4: Replace useTimeStop() method**

Delete:
```typescript
// DELETE:
useTimeStop(): void {
  this.socket.emit(SocketEvent.USE_TIME_STOP);
}
```

Add:
```typescript
useSword(x: number, y: number): void {
  const msg: UseSwordMsg = { x, y };
  this.socket.emit(SocketEvent.USE_SWORD, msg);
}

useShield(targetType: 'spawn' | 'core' | 'wall', targetId: string): void {
  const msg: UseShieldMsg = { targetType, targetId };
  this.socket.emit(SocketEvent.USE_SHIELD, msg);
}
```

---

### Task 5: Constants.ts — Update UI Constants

**Files:**
- Modify: `packages/client/src/visual/Constants.ts`

**Step 1: Remove timeStop constants**

Delete:
```typescript
// DELETE:
export const INITIAL_TIME_STOP_COUNT = 1;
export const TIME_STOP_OVERLAY_ALPHA = 0.5;
export const TIME_STOP_GAUGE_COLOR = 0x8844ff;
export const TIME_STOP_DURATION = 5;
```

**Step 2: Add new constants**

Replace with:
```typescript
// Item gold costs
export const ITEM_COST_WALL = 100;
export const ITEM_COST_SWORD = 10;
export const ITEM_COST_SHIELD = 300;

// Shield visual
export const SHIELD_COLOR = 0x4488ff;
export const SHIELD_ALPHA = 0.35;
```

---

### Task 6: GameScene.ts — Full UI Overhaul

**Files:**
- Modify: `packages/client/src/scenes/GameScene.ts`

**Step 1: Update imports from Constants.ts**

Remove:
```typescript
INITIAL_TIME_STOP_COUNT, TIME_STOP_OVERLAY_ALPHA, TIME_STOP_GAUGE_COLOR, TIME_STOP_DURATION,
```

Add:
```typescript
ITEM_COST_WALL, ITEM_COST_SWORD, ITEM_COST_SHIELD, SHIELD_COLOR, SHIELD_ALPHA,
```

**Step 2: Update imports from NetworkMessage (if any timeStop types are imported)**

Remove any direct import of `TimeStopStartedMsg`, `TimeStopEndedMsg`, `UseTimeStopMsg`.
Add imports for: `GoldUpdatedMsg`, `SwordUsedMsg`, `ShieldAppliedMsg`, `ShieldExpiredMsg`.

**Step 3: Remove timeStop fields, add gold/sword/shield fields**

In the class body, remove:
```typescript
// DELETE:
private itemUiTexts: { wall: [...], timeStop: [...] } = ...
private itemCounts: { wall: [...], timeStop: [...] } = ...
private itemSlotTsBg: Phaser.GameObjects.Rectangle | null = null;
private itemSlotTsText: Phaser.GameObjects.Text | null = null;
private timeStopOverlay: Phaser.GameObjects.Rectangle | null = null;
private timeStopLabel: Phaser.GameObjects.Text | null = null;
private timeStopGaugeBg: Phaser.GameObjects.Rectangle | null = null;
private timeStopGauge: Phaser.GameObjects.Rectangle | null = null;
private timeStopRemaining: number = 0;
private timeStopTotal: number = TIME_STOP_DURATION;
```

Add:
```typescript
// Gold display
private myGold: number = 0;
private goldText: Phaser.GameObjects.Text | null = null;

// Item mode state
private wallMode: boolean = false;   // (already exists, keep)
private swordMode: boolean = false;
private shieldMode: boolean = false;

// Item slots
private itemSlotWallBg: Phaser.GameObjects.Rectangle | null = null;  // (already exists)
private itemSlotWallText: Phaser.GameObjects.Text | null = null;      // (already exists)
private itemSlotSwordBg: Phaser.GameObjects.Rectangle | null = null;
private itemSlotSwordText: Phaser.GameObjects.Text | null = null;
private itemSlotShieldBg: Phaser.GameObjects.Rectangle | null = null;
private itemSlotShieldText: Phaser.GameObjects.Text | null = null;

// Mode labels
private wallModeText: Phaser.GameObjects.Text | null = null;          // (already exists)
private swordModeText: Phaser.GameObjects.Text | null = null;
private shieldModeText: Phaser.GameObjects.Text | null = null;

// Shield visuals: targetId → graphicsObject
private shieldVisuals: Map<string, Phaser.GameObjects.Rectangle> = new Map();
```

**Step 4: Update scene reset (clearState / create reset)**

In the reset section that sets fields to null/default, remove timeStop resets and add:
```typescript
this.myGold = 0;
this.goldText = null;
this.swordMode = false;
this.shieldMode = false;
this.itemSlotSwordBg = null;
this.itemSlotSwordText = null;
this.itemSlotShieldBg = null;
this.itemSlotShieldText = null;
this.swordModeText = null;
this.shieldModeText = null;
this.shieldVisuals.clear();
```

Remove timeStop resets:
```typescript
// DELETE:
this.itemCounts = { wall: [...], timeStop: [...] };
this.itemUiTexts = { wall: [...], timeStop: [...] };
this.itemSlotTsBg = null;
this.itemSlotTsText = null;
this.timeStopOverlay = null;
// etc.
```

**Step 5: Update setupUI() — replace TS slot with sword + shield**

In `setupUI()`, the layout is:
- Slot 1 (bottom-left): 🧱 Wall (100g)
- Slot 2 (next right): ⚔️ Sword (10g)
- Slot 3 (next right): 🛡️ Shield (300g)
- Gold text: above the slots

Replace the timeStop slot creation with sword and shield slots:

```typescript
private setupItemSlots(): void {
  const { height } = this.scale;
  const SLOT = 56;
  const GAP = 8;
  const baseX = 8 + SLOT / 2;
  const slotY = height - 8 - SLOT / 2;
  const goldY = slotY - SLOT / 2 - 20;

  // Gold display (above slots)
  this.goldText = this.add.text(baseX, goldY, '💰 0', {
    fontSize: '14px', color: '#FFD700', fontFamily: 'monospace',
  }).setOrigin(0, 0.5).setDepth(10);
  this.uiLayer.add(this.goldText);

  // Slot 1: Wall
  const wallCX = baseX;
  this.itemSlotWallBg = this.add.rectangle(wallCX, slotY, SLOT, SLOT, 0x332211)
    .setStrokeStyle(2, 0x886633).setInteractive({ useHandCursor: true }).setDepth(10);
  const wallEmoji = this.add.text(wallCX, slotY - 8, '🧱', { fontSize: '20px' }).setOrigin(0.5).setDepth(10);
  const wallKey = this.add.text(wallCX - SLOT/2 + 4, slotY - SLOT/2 + 4, '1', { fontSize: '10px', color: '#aaaaaa' }).setDepth(10);
  this.itemSlotWallText = this.add.text(wallCX, slotY + 18, `${ITEM_COST_WALL}g`, { fontSize: '11px', color: '#ccaa44', fontFamily: 'monospace' }).setOrigin(0.5).setDepth(10);
  this.uiLayer.add([this.itemSlotWallBg, wallEmoji, wallKey, this.itemSlotWallText]);
  this.itemSlotWallBg.on('pointerdown', (_p: any, _x: any, _y: any, e: any) => {
    e.stopPropagation(); this.toggleWallMode();
  });

  // Slot 2: Sword
  const swordCX = baseX + SLOT + GAP;
  this.itemSlotSwordBg = this.add.rectangle(swordCX, slotY, SLOT, SLOT, 0x111122)
    .setStrokeStyle(2, 0x4466aa).setInteractive({ useHandCursor: true }).setDepth(10);
  const swordEmoji = this.add.text(swordCX, slotY - 8, '⚔️', { fontSize: '20px' }).setOrigin(0.5).setDepth(10);
  const swordKey = this.add.text(swordCX - SLOT/2 + 4, slotY - SLOT/2 + 4, '2', { fontSize: '10px', color: '#aaaaaa' }).setDepth(10);
  this.itemSlotSwordText = this.add.text(swordCX, slotY + 18, `${ITEM_COST_SWORD}g`, { fontSize: '11px', color: '#4488cc', fontFamily: 'monospace' }).setOrigin(0.5).setDepth(10);
  this.uiLayer.add([this.itemSlotSwordBg, swordEmoji, swordKey, this.itemSlotSwordText]);
  this.itemSlotSwordBg.on('pointerdown', (_p: any, _x: any, _y: any, e: any) => {
    e.stopPropagation(); this.toggleSwordMode();
  });

  // Slot 3: Shield
  const shieldCX = baseX + (SLOT + GAP) * 2;
  this.itemSlotShieldBg = this.add.rectangle(shieldCX, slotY, SLOT, SLOT, 0x112233)
    .setStrokeStyle(2, 0x2255aa).setInteractive({ useHandCursor: true }).setDepth(10);
  const shieldEmoji = this.add.text(shieldCX, slotY - 8, '🛡️', { fontSize: '20px' }).setOrigin(0.5).setDepth(10);
  const shieldKey = this.add.text(shieldCX - SLOT/2 + 4, slotY - SLOT/2 + 4, '3', { fontSize: '10px', color: '#aaaaaa' }).setDepth(10);
  this.itemSlotShieldText = this.add.text(shieldCX, slotY + 18, `${ITEM_COST_SHIELD}g`, { fontSize: '11px', color: '#2266cc', fontFamily: 'monospace' }).setOrigin(0.5).setDepth(10);
  this.uiLayer.add([this.itemSlotShieldBg, shieldEmoji, shieldKey, this.itemSlotShieldText]);
  this.itemSlotShieldBg.on('pointerdown', (_p: any, _x: any, _y: any, e: any) => {
    e.stopPropagation(); this.toggleShieldMode();
  });

  // Wall mode label (already exists, keep)
  // Add sword/shield mode labels:
  const { width } = this.scale;
  this.swordModeText = this.add.text(width / 2, height / 2 - 80, '⚔️ 칼 모드: 적 반사판 클릭', {
    fontSize: '18px', color: '#4488ff', backgroundColor: '#00000099', padding: { x: 12, y: 6 },
  }).setOrigin(0.5).setDepth(20).setVisible(false);
  this.uiLayer.add(this.swordModeText);

  this.shieldModeText = this.add.text(width / 2, height / 2 - 80, '🛡️ 쉴드 모드: 내 타워/코어/방어벽 클릭', {
    fontSize: '18px', color: '#4466ff', backgroundColor: '#00000099', padding: { x: 12, y: 6 },
  }).setOrigin(0.5).setDepth(20).setVisible(false);
  this.uiLayer.add(this.shieldModeText);
}
```

**Step 6: Add mode toggle methods**

Replace `useTimeStop()` with new methods:

```typescript
private toggleSwordMode(): void {
  if (this.swordMode) {
    this.setSwordMode(false);
  } else {
    // Deactivate other modes
    this.setWallMode(false);
    this.setShieldMode(false);
    this.setSwordMode(true);
  }
}

private setSwordMode(active: boolean): void {
  if (active && this.myGold < ITEM_COST_SWORD) {
    this.showToast('골드가 부족합니다. (10g 필요)');
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
    this.showToast('골드가 부족합니다. (300g 필요)');
    return;
  }
  this.shieldMode = active;
  this.shieldModeText?.setVisible(active);
  this.itemSlotShieldBg?.setFillStyle(active ? 0x223366 : 0x112233);
  this.itemSlotShieldBg?.setStrokeStyle(2, active ? 0x66aaff : 0x2255aa);
}
```

Also update the existing `setWallMode()` to deactivate sword/shield:
```typescript
// In setWallMode(), when activating:
this.setSwordMode(false);
this.setShieldMode(false);
```

**Step 7: Update pointer/click handler for sword and shield modes**

In the existing pointer handler where wall mode is checked, add sword and shield handling:

```typescript
// In the left-click / pointerdown handler on the grid:

// Sword mode: click on opponent reflector
if (this.swordMode) {
  const key = `${gridX},${gridY}`;
  const visual = this.reflectorVisuals.get(key);
  if (visual && visual.playerId !== this.myPlayerId) {
    this.socket.useSword(gridX, gridY);
    this.setSwordMode(false);
  } else {
    this.showToast('적 반사판을 클릭하세요.');
  }
  return;
}

// Shield mode: click on own spawn, core, or placed wall
if (this.shieldMode) {
  // Check if clicked on own spawn
  const spawn = this.spawnPoints?.find(sp => sp.x === gridX && sp.y === gridY && sp.ownerId === this.myPlayerId);
  if (spawn) {
    this.socket.useShield('spawn', spawn.id.toString());
    this.setShieldMode(false);
    return;
  }
  // Check if clicked on own core
  const core = this.cores?.find(c => c.x === gridX && c.y === gridY && c.ownerId === this.myPlayerId);
  if (core) {
    this.socket.useShield('core', core.id.toString());
    this.setShieldMode(false);
    return;
  }
  // Check if clicked on own placed wall
  const wallKey = `${gridX},${gridY}`;
  if (this.wallVisuals.has(wallKey)) {
    // Wall visuals don't track ownerId — need to check if it's my wall
    // Use wallVisuals map which tracks walls placed (all walls visible)
    // For simplicity: check if wall ownerId matches myPlayerId via server-tracked data
    // The client tracks walls via wallVisuals — need to add ownerId to WallVisual
    // See Step 8 for this change
    const wallVisual = this.wallVisuals.get(wallKey);
    if (wallVisual && wallVisual.ownerId === this.myPlayerId) {
      this.socket.useShield('wall', wallKey);
      this.setShieldMode(false);
    } else {
      this.showToast('내 방어벽을 클릭하세요.');
    }
    return;
  }
  this.showToast('내 타워, 코어, 또는 방어벽을 클릭하세요.');
  return;
}
```

**Step 8: Add ownerId to wall visual tracking**

The `wallVisuals` map needs to track owner. Check the `WallVisual` type definition and add `ownerId`. In `drawWall()`, pass and store `ownerId`. In `onWallPlaced` handler, the `WallPlacedMsg` already has `playerId`.

Find `private wallVisuals` definition and add `ownerId: number` to the visual data structure.

Update `drawWall(gridX, gridY, hp, maxHp, ownerId)` signature to include ownerId.

**Step 9: Update keyboard hotkeys**

Replace key 2 binding:
```typescript
// DELETE:
this.input.keyboard?.on('keydown-TWO', () => this.useTimeStop());

// ADD:
this.input.keyboard?.on('keydown-TWO', () => this.toggleSwordMode());
this.input.keyboard?.on('keydown-THREE', () => this.toggleShieldMode());
```

Update ESC key to cancel all modes:
```typescript
this.input.keyboard?.on('keydown-ESC', () => {
  if (this.wallMode) this.setWallMode(false);
  if (this.swordMode) this.setSwordMode(false);
  if (this.shieldMode) this.setShieldMode(false);
});
```

**Step 10: Remove updateItemUI() and replace with updateItemSlots()**

Replace the existing `updateItemUI()` method:
```typescript
private updateItemSlots(): void {
  // Update gold display
  this.goldText?.setText(`💰 ${this.myGold}`);

  // Update slot alpha based on affordability
  const canWall = this.myGold >= ITEM_COST_WALL;
  const canSword = this.myGold >= ITEM_COST_SWORD;
  const canShield = this.myGold >= ITEM_COST_SHIELD;

  if (!this.wallMode) this.itemSlotWallBg?.setAlpha(canWall ? 1 : 0.4);
  this.itemSlotSwordBg?.setAlpha(canSword ? 1 : 0.4);
  this.itemSlotShieldBg?.setAlpha(canShield ? 1 : 0.4);
}
```

Remove all calls to `updateItemUI()` and replace with `updateItemSlots()`.

**Step 11: Add gold update socket handler**

In the socket setup section (near other socket handlers):
```typescript
this.socket.onGoldUpdated = (msg: GoldUpdatedMsg) => {
  if (msg.playerId === this.myPlayerId) {
    this.myGold = msg.gold;
    this.updateItemSlots();
  }
};

this.socket.onSwordUsed = (msg: SwordUsedMsg) => {
  // The reflector removal is already handled via onReflectorRemoved callback
  // Just close sword mode if we were the attacker
  if (msg.attackerId === this.myPlayerId) {
    this.setSwordMode(false);
  }
};

this.socket.onShieldApplied = (msg: ShieldAppliedMsg) => {
  this.drawShieldVisual(msg.targetType, msg.targetId);
};

this.socket.onShieldExpired = (msg: ShieldExpiredMsg) => {
  this.removeShieldVisual(msg.targetId);
};
```

**Step 12: Add shield visual methods**

```typescript
private drawShieldVisual(targetType: 'spawn' | 'core' | 'wall', targetId: string): void {
  // Remove existing visual for this target
  this.removeShieldVisual(targetId);

  let worldX: number | null = null;
  let worldY: number | null = null;

  if (targetType === 'spawn') {
    const sp = this.spawnPoints?.find(s => s.id === parseInt(targetId));
    if (sp) { worldX = sp.x; worldY = sp.y; }
  } else if (targetType === 'core') {
    const core = this.cores?.find(c => c.id === parseInt(targetId));
    if (core) { worldX = core.x; worldY = core.y; }
  } else if (targetType === 'wall') {
    const [wx, wy] = targetId.split(',').map(Number);
    worldX = wx; worldY = wy;
  }

  if (worldX === null || worldY === null) return;

  // Convert grid to pixel position
  const px = this.gridOriginX + worldX * this.tileSize + this.tileSize / 2;
  const py = this.gridOriginY + worldY * this.tileSize + this.tileSize / 2;
  const size = this.tileSize + 6;

  const shield = this.add.rectangle(px, py, size, size, SHIELD_COLOR, SHIELD_ALPHA)
    .setDepth(8)
    .setStrokeStyle(2, SHIELD_COLOR);

  // Pulsing animation
  this.tweens.add({
    targets: shield,
    alpha: { from: SHIELD_ALPHA, to: SHIELD_ALPHA * 1.8 },
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
```

**Step 13: Remove showTimeStop() and hideTimeStop() methods**

Delete both methods entirely (lines ~2480-2506).

**Step 14: Remove old top-bar item count UI (if any)**

The existing code has item count texts in a top bar (`itemUiTexts`). Remove all references to `itemUiTexts.timeStop` and the timeStop-related top display. Keep or update the wall display if needed (or remove entirely since gold-based now).

Search for `itemUiTexts` usage and update to remove timeStop text rendering from the top-bar. The top-bar item display for the opponent can be simplified or removed as it's no longer count-based.

**Step 15: Client build verification**

Start the dev server to check for TypeScript errors:
```bash
cd C:/Projects/PuzzlePvp && npm run build:shared
# Then check client for type errors (Vite will show them on dev start)
```

---

### Task 7: Integration Verification

**Step 1: Start server and client**
```bash
# Terminal 1:
cd C:/Projects/PuzzlePvp && npm run dev:server

# Terminal 2:
cd C:/Projects/PuzzlePvp && npm run dev:client
```

**Step 2: Manual smoke test checklist**
- [ ] Game starts without console errors
- [ ] Gold display shows "💰 0" at bottom-left above item slots
- [ ] Three item slots visible: 🧱100g, ⚔️10g, 🛡️300g
- [ ] Item slots are dimmed at 0 gold
- [ ] Destroying a zone wall grants +10 gold
- [ ] Destroying an enemy tower grants +30 gold
- [ ] Destroying an enemy core grants +300 gold
- [ ] After core destruction, remaining towers give +30 each
- [ ] Wall can be placed when gold ≥ 100, HP = currentPower × 100
- [ ] Sword mode activates on key 2 or click, shows mode label
- [ ] Clicking opponent reflector in sword mode removes it, deducts 10g
- [ ] Shield mode activates on key 3 or click, shows mode label
- [ ] Clicking own tower/core/wall in shield mode applies 30s shield
- [ ] Shielded entity shows blue pulsing aura
- [ ] Shielded entity takes no damage
- [ ] Shielded tower cannot fire
- [ ] Shield aura disappears after 30 seconds
- [ ] ESC cancels all active modes

**Step 3: Commit**
```bash
git add -A
git commit -m "feat: 골드 시스템 + 아이템 개편 (시간정지→칼/쉴드, 재화 획득)"
```
