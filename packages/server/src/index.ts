import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { MatchmakingQueue } from './matchmaking/MatchmakingQueue';
import { LobbyManager } from './matchmaking/LobbyManager';
import { GameRoom } from './rooms/GameRoom';
import { SocketEvent, SetTargetPlayersMsg } from '@puzzle-pvp/shared';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 프로덕션: 빌드된 클라이언트 정적 파일 서빙
if (IS_PROD) {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

let roomCounter = 1;
const rooms = new Map<string, GameRoom>();

// 레거시 1v1 매칭 (빠른 2인 매칭)
const matchmaking = new MatchmakingQueue((p1: Socket, p2: Socket) => {
  const roomId = `room_${roomCounter++}`;
  const players = new Map<number, Socket | null>();
  players.set(0, p1);
  players.set(1, p2);
  const room = new GameRoom(roomId, players);
  rooms.set(roomId, room);
  room.onDestroy = () => rooms.delete(roomId);
  room.start();
});

// N인 로비 매니저 (10초 카운트다운, AI 채움)
const lobby = new LobbyManager();
lobby.onGameReady = (sockets: Socket[], playerCount: number) => {
  const roomId = `room_${roomCounter++}`;
  const players = new Map<number, Socket | null>();
  for (let i = 0; i < sockets.length; i++) {
    players.set(i, sockets[i]);
  }
  // AI 슬롯 (null)
  for (let i = sockets.length; i < playerCount; i++) {
    players.set(i, null);
  }
  const room = new GameRoom(roomId, players, playerCount);
  rooms.set(roomId, room);
  room.onDestroy = () => rooms.delete(roomId);
  room.start();
};

io.on('connection', (socket: Socket) => {
  console.log(`[Server] 연결: ${socket.id}`);

  socket.on(SocketEvent.JOIN_QUEUE, () => {
    console.log(`[Server] 매칭 요청: ${socket.id}`);
    lobby.enqueue(socket);
  });

  socket.on(SocketEvent.LEAVE_QUEUE, () => {
    console.log(`[Server] 매칭 취소: ${socket.id}`);
    lobby.dequeue(socket);
  });

  socket.on(SocketEvent.SET_TARGET_PLAYERS, (msg: SetTargetPlayersMsg) => {
    console.log(`[Server] 인원 강제 설정: ${socket.id} → ${msg.targetCount}명`);
    lobby.forceLaunch(socket, msg.targetCount);
  });

  socket.on('disconnect', () => {
    console.log(`[Server] 연결 종료: ${socket.id}`);
    lobby.dequeue(socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Server] 실행 중: http://localhost:${PORT}`);
});
