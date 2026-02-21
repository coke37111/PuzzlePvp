import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import { MatchFoundMsg } from '@puzzle-pvp/shared';

export class MatchmakingScene extends Phaser.Scene {
  private socket!: SocketClient;
  private dots: string = '';
  private dotsTimer: number = 0;
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MatchmakingScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0, 0);

    this.add.text(width / 2, height * 0.35, '매칭 중', {
      fontSize: '36px',
      color: '#e0e0ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.statusText = this.add.text(width / 2, height * 0.5, '상대를 찾는 중...', {
      fontSize: '20px',
      color: '#8888cc',
    }).setOrigin(0.5);

    // 취소 버튼
    const cancelBtn = this.add.rectangle(width / 2, height * 0.65, 160, 50, 0x444444)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height * 0.65, '취소', {
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5);

    cancelBtn.on('pointerdown', () => {
      this.socket?.disconnect();
      this.scene.start('MainMenuScene');
    });

    // 소켓 연결 및 매칭 요청
    this.socket = SocketClient.instance;
    this.socket.onConnected = () => {
      this.socket.joinQueue();
    };
    this.socket.onMatchFound = (msg: MatchFoundMsg) => {
      this.scene.start('GameScene', { matchData: msg, socket: this.socket });
    };
    this.socket.connect();
  }

  update(time: number, delta: number): void {
    this.dotsTimer += delta;
    if (this.dotsTimer > 500) {
      this.dotsTimer = 0;
      this.dots = this.dots.length >= 3 ? '' : this.dots + '.';
      this.statusText.setText(`상대를 찾는 중${this.dots}`);
    }
  }
}
