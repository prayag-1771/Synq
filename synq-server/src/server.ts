import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import authRoutes from './routes/auth.routes';
import chatRoutes from './routes/chat.routes';
import keysRoutes from './routes/keys.routes';
import aiRoutes from './routes/ai.routes';
import { setupSocketHandlers } from './sockets/socket';
import { createAdapter } from '@socket.io/redis-adapter';
import { pubClient, subClient, clearPresenceStore, redisClient } from './db/redis';
import { initializeSubscribers } from './events/subscribers';

dotenv.config();

// Initialize internal event bus subscribers
initializeSubscribers();

const app = express();
const server = http.createServer(app);
const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : ['http://localhost:3000'];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Configure Socket.IO Redis adapter
io.adapter(createAdapter(pubClient, subClient));

// Clear stale active presence lists on start
clearPresenceStore();

const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Global Rate Limiter
const limiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args: string[]) => redisClient.call(...args),
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // Limit each IP to 150 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' }
});

// Apply rate limiter to all API routes
app.use('/api/', limiter);

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
