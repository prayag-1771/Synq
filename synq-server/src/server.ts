import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import chatRoutes from './routes/chat.routes';
import keysRoutes from './routes/keys.routes';
import aiRoutes from './routes/ai.routes';
import { setupSocketHandlers } from './sockets/socket';
import { createAdapter } from '@socket.io/redis-adapter';
import { pubClient, subClient, clearPresenceStore } from './db/redis';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all client connections (can narrow down to nextjs client later)
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Configure Socket.IO Redis adapter
io.adapter(createAdapter(pubClient, subClient));

// Clear stale active presence lists on start
clearPresenceStore();

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/ai', aiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Socket handlers
setupSocketHandlers(io);

// Start server
server.listen(PORT, () => {
  console.log(`Synq server listening on port ${PORT}`);
});
