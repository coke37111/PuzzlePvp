import Phaser from 'phaser';

export class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ResultScene' });
  }

  create(data: { winnerId: number; myPlayerId: number }): void {
    const { width, height } = this.scale;

    // 반투명 검은 오버레이 (게임 화면이 비쳐 보임)
    this.add.rectangle(0, 0, width, height, 0x000000, 0.72).setOrigin(0, 0);

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

    // 결과 패널 컨테이너 (페이드인용)
    const panel = this.add.container(width / 2, height / 2).setAlpha(0);

    panel.add(this.add.text(0, -80, resultText, {
      fontSize: '64px',
      color,
      fontStyle: 'bold',
    }).setOrigin(0.5));

    const btn = this.add.rectangle(0, 60, 200, 60, 0x4444aa)
      .setInteractive({ useHandCursor: true });
    const btnText = this.add.text(0, 60, '다시 플레이', {
      fontSize: '22px',
      color: '#ffffff',
    }).setOrigin(0.5);

    panel.add(btn);
    panel.add(btnText);

    btn.on('pointerover', () => btn.setFillStyle(0x6666cc));
    btn.on('pointerout', () => btn.setFillStyle(0x4444aa));
    btn.on('pointerdown', () => {
      this.scene.stop('GameScene');
      this.scene.start('MainMenuScene');
    });

    // 페이드인
    this.tweens.add({
      targets: panel,
      alpha: 1,
      duration: 300,
      ease: 'Quad.easeOut',
    });
  }
}
