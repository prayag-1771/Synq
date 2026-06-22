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
import { pubClient, subClient, clearPresenceStore, redisClient, redisAvailable } from './db/redis';
import { initializeSubscribers } from './events/subscribers';

dotenv.config();

// Initialize internal event bus subscribers
initializeSubscribers();

const app = express();
const server = http.createServer(app);
const allowedOrigins: string[] = [
  'http://localhost:3000',
  'https://synq-wcbp.vercel.app',
];

// Add FRONTEND_URL from env if set (Render dashboard config)
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

// CORS origin handler — supports exact matches + Vercel preview deployments
const corsOriginHandler = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  // Allow requests with no origin (server-to-server, curl, health checks)
  if (!origin) return callback(null, true);
  // Allow exact matches
  if (allowedOrigins.includes(origin)) return callback(null, true);
  // Allow any Vercel preview deployment for this project
  if (origin.endsWith('.vercel.app')) return callback(null, true);
  // Reject everything else
  callback(new Error(`CORS: origin ${origin} not allowed`));
};

const io = new Server(server, {
  cors: {
    origin: corsOriginHandler,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 5000;

// Middleware — cors MUST be before helmet so CORS headers are always present
app.use(cors({ origin: corsOriginHandler, credentials: true }));
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'unsafe-none' },
}));
app.use(express.json());

// Give Redis clients 500ms to connect before deciding on rate limiter store
const startServer = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  // Configure Socket.IO Redis adapter only if Redis is available
  if (redisAvailable) {
    try {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[Server] Socket.IO Redis adapter enabled ✓');
    } catch (err) {
      console.warn('[Server] Could not enable Redis adapter, running single-instance mode.');
    }
  } else {
    console.warn('[Server] Redis unavailable — Socket.IO running in single-instance mode (no horizontal scaling).');
  }

  // Clear stale presence on start (only if Redis is available)
  if (redisAvailable) {
    clearPresenceStore();
  }

  // Global Rate Limiter — uses Redis store when available, memory store as fallback
  const limiterOptions: any = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
  };

  if (redisAvailable) {
    limiterOptions.store = new RedisStore({
      sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any,
    });
    console.log('[Server] Rate limiter using Redis store ✓');
  } else {
    console.warn('[Server] Rate limiter using in-memory store (Redis unavailable).');
  }

  const limiter = rateLimit(limiterOptions);
  app.use('/api/', limiter);

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/chats', chatRoutes);
  app.use('/api/keys', keysRoutes);
  app.use('/api/ai', aiRoutes);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date(), redis: redisAvailable });
  });

  // Socket handlers
  setupSocketHandlers(io);

  // Start server
  server.listen(PORT, () => {
    console.log(`\n🚀 Synq server listening on port ${PORT}`);
    console.log(`   Redis: ${redisAvailable ? '✅ Connected' : '⚠️  Not available (degraded mode)'}`);
  });
};

startServer();

