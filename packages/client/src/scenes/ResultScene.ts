import Phaser from 'phaser';

export class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ResultScene' });
  }

  create(data: { winnerId: number; myPlayerId: number }): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0, 0);

    let resultText: string;
    let color: string;

    if (data.winnerId === -1) {
      resultText = '무승부';
      color = '#cccc44';
    } else if (data.winnerId === data.myPlayerId) {
      resultText = '승리!';
      color = '#44cc44';
    } else {
      resultText = '패배...';
      color = '#cc4444';
    }

    this.add.text(width / 2, height * 0.35, resultText, {
      fontSize: '64px',
      color,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 다시 시작 버튼
    const btn = this.add.rectangle(width / 2, height * 0.6, 200, 60, 0x4444aa)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height * 0.6, '다시 플레이', {
      fontSize: '22px',
      color: '#ffffff',
    }).setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x6666cc));
    btn.on('pointerout', () => btn.setFillStyle(0x4444aa));
    btn.on('pointerdown', () => {
      this.scene.start('MainMenuScene');
    });
  }
}
