import Phaser from 'phaser';
import { MainMenuScene } from './scenes/MainMenuScene';
import { MatchmakingScene } from './scenes/MatchmakingScene';
import { GameScene } from './scenes/GameScene';
import { ResultScene } from './scenes/ResultScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 780,
  height: 680,
  backgroundColor: '#1a1a2e',
  parent: document.body,
  scene: [MainMenuScene, MatchmakingScene, GameScene, ResultScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);
