import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import { MatchFoundMsg } from '@puzzle-pvp/shared';

export class MatchmakingScene extends Phaser.Scene {
  private socket!: SocketClient;
  private dots: string = '';
  private dotsTimer: number = 0;
  private statusText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private playerCountText!: Phaser.GameObjects.Text;
  private hasLobbyInfo: boolean = false;

  constructor() {
    super({ key: 'MatchmakingScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    this.hasLobbyInfo = false;
    this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0, 0);

    this.add.text(width / 2, height * 0.25, '매칭 중', {
      fontSize: '36px',
      color: '#e0e0ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 카운트다운 숫자 (큰 글씨)
    this.countdownText = this.add.text(width / 2, height * 0.42, '', {
      fontSize: '64px',
      color: '#ffdd44',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5);

    // 플레이어 수 표시
    this.playerCountText = this.add.text(width / 2, height * 0.57, '', {
      fontSize: '20px',
      color: '#aaaacc',
    }).setOrigin(0.5);

    // 기본 상태 텍스트 (로비 정보 없을 때 표시)
    this.statusText = this.add.text(width / 2, height * 0.5, '상대를 찾는 중...', {
      fontSize: '20px',
      color: '#8888cc',
    }).setOrigin(0.5);

    // 인원 선택 버튼 (현재 대기 인원 + AI 채움으로 즉시 시작)
    const sizeOptions: { count: number; label: string }[] = [
      { count: 2,  label: '2\n(2×1)' },
      { count: 4,  label: '4\n(2×2)' },
      { count: 6,  label: '6\n(2×3)' },
      { count: 12, label: '12\n(3×4)' },
      { count: 16, label: '16\n(4×4)' },
    ];
    const btnW = 100, btnH = 52, gap = 10;
    const totalW = sizeOptions.length * btnW + (sizeOptions.length - 1) * gap;
    const startX = (width - totalW) / 2 + btnW / 2;
    const btnY = height * 0.72;

    this.add.text(width / 2, btnY - 38, '인원 선택 후 즉시 시작 (부족 시 AI 충원)', {
      fontSize: '14px',
      color: '#888899',
    }).setOrigin(0.5);

    sizeOptions.forEach(({ count, label }, i) => {
      const x = startX + i * (btnW + gap);
      const btn = this.add.rectangle(x, btnY, btnW, btnH, 0x2a2a4a)
        .setStrokeStyle(1, 0x5555aa)
        .setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, btnY, label, {
        fontSize: '14px',
        color: '#aaaadd',
        align: 'center',
      }).setOrigin(0.5);

      btn.on('pointerover', () => { btn.setFillStyle(0x3a3a6a); txt.setColor('#ffffff'); });
      btn.on('pointerout',  () => { btn.setFillStyle(0x2a2a4a); txt.setColor('#aaaadd'); });
      btn.on('pointerdown', () => {
        this.socket?.setTargetPlayers(count);
      });
    });

    // 취소 버튼
    const cancelBtn = this.add.rectangle(width / 2, height * 0.88, 160, 50, 0x444444)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height * 0.88, '취소', {
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5);

    cancelBtn.on('pointerdown', () => {
      this.socket?.leaveQueue();
      this.socket?.disconnect();
      this.scene.start('MainMenuScene');
    });

    // 소켓 연결 및 매칭 요청
    this.socket = SocketClient.instance;

    this.socket.onLobbyUpdate = (msg) => {
      this.hasLobbyInfo = true;
      this.statusText.setVisible(false);
      this.playerCountText.setText(`${msg.currentPlayers}명 대기 중`);
      this.countdownText.setText(msg.countdown >= 0 ? `${msg.countdown}` : '');
    };

    this.socket.onConnected = () => {
      this.socket.joinQueue();
    };
    this.socket.onMatchFound = (msg: MatchFoundMsg) => {
      this.socket.onLobbyUpdate = undefined;
      this.scene.start('GameScene', { matchData: msg, socket: this.socket });
    };
    if (this.socket.isConnected) {
      this.socket.joinQueue();
    } else {
      this.socket.connect();
    }
  }

  update(_time: number, delta: number): void {
    if (this.hasLobbyInfo) return;
    this.dotsTimer += delta;
    if (this.dotsTimer > 500) {
      this.dotsTimer = 0;
      this.dots = this.dots.length >= 3 ? '' : this.dots + '.';
      this.statusText.setText(`상대를 찾는 중${this.dots}`);
    }
  }

  shutdown(): void {
    if (this.socket) {
      this.socket.onLobbyUpdate = undefined;
      this.socket.onConnected = undefined;
      this.socket.onMatchFound = undefined;
    }
  }
}
