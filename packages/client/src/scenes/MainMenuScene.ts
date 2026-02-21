import Phaser from 'phaser';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create(): void {
    const { width, height } = this.scale;

    // 배경
    this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0, 0);

    // 타이틀
    this.add.text(width / 2, height * 0.3, 'PuzzlePvP', {
      fontSize: '52px',
      color: '#e0e0ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.42, '1v1 실시간 반사판 대전', {
      fontSize: '20px',
      color: '#8888cc',
    }).setOrigin(0.5);

    // 플레이 버튼
    const btn = this.add.rectangle(width / 2, height * 0.6, 220, 60, 0x4444aa, 1)
      .setInteractive({ useHandCursor: true });

    const btnText = this.add.text(width / 2, height * 0.6, '게임 시작', {
      fontSize: '24px',
      color: '#ffffff',
    }).setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x6666cc));
    btn.on('pointerout', () => btn.setFillStyle(0x4444aa));
    btn.on('pointerdown', () => {
      this.scene.start('MatchmakingScene');
    });
  }
}
