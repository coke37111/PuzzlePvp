import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { MatchmakingQueue } from './matchmaking/MatchmakingQueue';
import { GameRoom } from './rooms/GameRoom';
import { SocketEvent } from '@puzzle-pvp/shared';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

let roomCounter = 1;
const rooms = new Map<string, GameRoom>();

const matchmaking = new MatchmakingQueue((p1: Socket, p2: Socket) => {
  const roomId = `room_${roomCounter++}`;
  const room = new GameRoom(roomId, p1, p2);
  rooms.set(roomId, room);
  room.onDestroy = () => rooms.delete(roomId);
  room.start();
});

io.on('connection', (socket: Socket) => {
  console.log(`[Server] 연결: ${socket.id}`);

  socket.on(SocketEvent.JOIN_QUEUE, () => {
    console.log(`[Server] 매칭 요청: ${socket.id}`);
    matchmaking.enqueue(socket);
  });

  socket.on('disconnect', () => {
    console.log(`[Server] 연결 종료: ${socket.id}`);
    matchmaking.dequeue(socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Server] 실행 중: http://localhost:${PORT}`);
});
