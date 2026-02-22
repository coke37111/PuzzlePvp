import Phaser from 'phaser';
import {
  TILE_SIZE,
  ANIM_BALL_SPAWN,
  ANIM_BALL_END,
  ANIM_REFLECTOR_PLACE,
  ANIM_HP_BAR,
  ANIM_DAMAGE_FLASH,
  ANIM_DESTROY_SHAKE_STEP,
  HP_BAR_HEIGHT,
  HP_COLOR_HIGH, HP_COLOR_MID, HP_COLOR_LOW,
  ANIM_DAMAGE_POPUP_DURATION,
  ANIM_DAMAGE_POPUP_MOVE_Y,
  ANIM_DAMAGE_POPUP_FADE_START,
} from './Constants';

/** 공 스폰: scale 0.3→1.0, alpha 0.5→1.0 */
export function animBallSpawn(
  scene: Phaser.Scene,
  targets: Phaser.GameObjects.Arc[],
): void {
  for (const t of targets) {
    t.setScale(0.3).setAlpha(0.5);
  }
  scene.tweens.add({
    targets,
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    duration: ANIM_BALL_SPAWN,
    ease: 'Back.easeOut',
  });
}

/** 공 종료: scale→1.5, alpha→0 + 파티클 버스트 */
export function animBallEnd(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  targets: Phaser.GameObjects.GameObject[],
  cx: number,
  cy: number,
  color: number,
  onComplete: () => void,
): void {
  scene.tweens.add({
    targets,
    scaleX: 1.5,
    scaleY: 1.5,
    alpha: 0,
    duration: ANIM_BALL_END,
    ease: 'Quad.easeOut',
    onComplete,
  });

  // 6방향 파티클 버스트
  const angles = [0, 60, 120, 180, 240, 300];
  for (const angle of angles) {
    const rad = Phaser.Math.DegToRad(angle);
    const particle = scene.add.graphics();
    particle.fillStyle(color, 0.8);
    particle.fillCircle(0, 0, 3);
    particle.setPosition(cx, cy);
    container.add(particle);

    scene.tweens.add({
      targets: particle,
      x: cx + Math.cos(rad) * 24,
      y: cy + Math.sin(rad) * 24,
      alpha: 0,
      duration: ANIM_BALL_END,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    });
  }
}

/** 충돌 소멸: 흰색+노란색 12방향 파티클 폭발 */
export function animBallCrash(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  targets: Phaser.GameObjects.GameObject[],
  cx: number,
  cy: number,
  onComplete: () => void,
): void {
  scene.tweens.add({
    targets,
    scaleX: 0.1,
    scaleY: 0.1,
    alpha: 0,
    duration: 100,
    ease: 'Quad.easeIn',
    onComplete,
  });

  const colors = [0xffffff, 0xffee44, 0xffffff, 0xffee44, 0xffffff, 0xffee44,
                  0xffffff, 0xffee44, 0xffffff, 0xffee44, 0xffffff, 0xffee44];
  for (let i = 0; i < 12; i++) {
    const rad = Phaser.Math.DegToRad(i * 30);
    const particle = scene.add.graphics();
    particle.fillStyle(colors[i], 1.0);
    particle.fillCircle(0, 0, i % 2 === 0 ? 4 : 2);
    particle.setPosition(cx, cy);
    container.add(particle);

    scene.tweens.add({
      targets: particle,
      x: cx + Math.cos(rad) * 32,
      y: cy + Math.sin(rad) * 32,
      alpha: 0,
      duration: 150,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    });
  }
}

/** 반사판 설치 피드백: 타일 플래시 + scale 바운스 */
export function animReflectorPlace(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  gridX: number,
  gridY: number,
  color: number,
): void {
  const px = gridX * TILE_SIZE + TILE_SIZE / 2;
  const py = gridY * TILE_SIZE + TILE_SIZE / 2;

  const flash = scene.add.rectangle(px, py, TILE_SIZE - 2, TILE_SIZE - 2, color, 0.4);
  flash.setScale(1.3);
  container.add(flash);

  scene.tweens.add({
    targets: flash,
    alpha: 0,
    scaleX: 1,
    scaleY: 1,
    duration: ANIM_REFLECTOR_PLACE,
    ease: 'Back.easeOut',
    onComplete: () => flash.destroy(),
  });
}

/** HP바 스무스 전환 (tween) */
export function animHpBar(
  scene: Phaser.Scene,
  hpBar: Phaser.GameObjects.Rectangle,
  baseX: number,
  ratio: number,
  tweenKey: string,
  tweenMap: Map<string, Phaser.Tweens.Tween>,
): void {
  const fullWidth = TILE_SIZE - 4;
  const targetW = fullWidth * ratio;
  const targetX = baseX - (fullWidth * (1 - ratio)) / 2;

  // 기존 tween 제거
  const existing = tweenMap.get(tweenKey);
  if (existing) {
    existing.destroy();
    tweenMap.delete(tweenKey);
  }

  const proxy = { w: hpBar.width, x: hpBar.x };
  const tween = scene.tweens.add({
    targets: proxy,
    w: targetW,
    x: targetX,
    duration: ANIM_HP_BAR,
    ease: 'Quad.easeOut',
    onUpdate: () => {
      hpBar.setSize(proxy.w, HP_BAR_HEIGHT);
      hpBar.setX(proxy.x);
    },
    onComplete: () => tweenMap.delete(tweenKey),
  });
  tweenMap.set(tweenKey, tween);
}

/** 데미지 플래시 (배경 빨간 플래시) */
export function animDamageFlash(
  scene: Phaser.Scene,
  bg: Phaser.GameObjects.Rectangle,
  originalColor: number,
  originalAlpha: number,
): void {
  bg.setFillStyle(0xff2222, 0.6);
  scene.time.delayedCall(ANIM_DAMAGE_FLASH, () => {
    bg.setFillStyle(originalColor, originalAlpha);
  });
}

/** 스폰포인트 파괴 애니메이션: 흔들림 + 페이드 */
export function animSpawnDestroy(
  scene: Phaser.Scene,
  bg: Phaser.GameObjects.Rectangle,
  hpBar: Phaser.GameObjects.Rectangle,
  hpBarBg: Phaser.GameObjects.Rectangle,
  label: Phaser.GameObjects.Text,
  dirArrow: Phaser.GameObjects.Graphics,
): void {
  const parts = [bg, hpBar, hpBarBg, label, dirArrow];
  const origPositions = parts.map(p => p.x);
  const shakeSeq = [4, -4, 3, -3, 2, -2, 0];
  let step = 0;

  const doShake = () => {
    if (step >= shakeSeq.length) {
      parts.forEach((p, i) => p.setX(origPositions[i]));
      // 페이드 후 X 표시
      scene.tweens.add({
        targets: [bg],
        alpha: 0.3,
        duration: 200,
        onComplete: () => {
          bg.setFillStyle(0x222222, 0.3);
          hpBar.setVisible(false);
          hpBarBg.setVisible(false);
          dirArrow.setVisible(false);
          label.setText('X').setColor('#ff4444');
        },
      });
      return;
    }
    const offset = shakeSeq[step];
    parts.forEach((p, i) => p.setX(origPositions[i] + offset));
    step++;
    scene.time.delayedCall(ANIM_DESTROY_SHAKE_STEP, doShake);
  };
  doShake();
}

/** HP 비율(0~1)에 따른 그래디언트 색상 반환 */
export function getHpColor(ratio: number): number {
  if (ratio >= 0.5) {
    const t = (ratio - 0.5) * 2;
    return lerpColor(HP_COLOR_MID, HP_COLOR_HIGH, t);
  } else {
    const t = ratio * 2;
    return lerpColor(HP_COLOR_LOW, HP_COLOR_MID, t);
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** 데미지 팝업: "-N" 텍스트가 위로 날아가며 페이드 아웃 */
export function animDamagePopup(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  worldX: number,
  worldY: number,
  damage: number,
): void {
  const text = scene.add.text(worldX, worldY, `-${damage}`, {
    fontSize: '16px',
    color: '#ffffff',
    fontStyle: 'bold',
    stroke: '#000000',
    strokeThickness: 3,
  }).setOrigin(0.5, 1);
  container.add(text);

  scene.tweens.add({
    targets: text,
    y: worldY + ANIM_DAMAGE_POPUP_MOVE_Y,
    duration: ANIM_DAMAGE_POPUP_DURATION,
    ease: 'Quad.easeOut',
    onComplete: () => text.destroy(),
  });

  scene.time.delayedCall(ANIM_DAMAGE_POPUP_FADE_START, () => {
    scene.tweens.add({
      targets: text,
      alpha: 0,
      duration: ANIM_DAMAGE_POPUP_DURATION - ANIM_DAMAGE_POPUP_FADE_START,
      ease: 'Linear',
    });
  });
}
