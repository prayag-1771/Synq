import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Track whether Redis is available
export let redisAvailable = false;

const createRedisClient = (label: string) => {
  let warnedOnce = false;

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
    // Stop retrying after first failure — no Redis means degraded mode
    retryStrategy: () => null,
  });

  client.on('connect', () => {
    redisAvailable = true;
    console.log(`[Redis] ${label} connected ✓`);
  });

  client.on('error', (err) => {
    if (!warnedOnce && (err as any).code === 'ECONNREFUSED') {
      warnedOnce = true;
      console.warn(`[Redis] ${label} — not available. Server running in degraded mode (no Redis).`);
    }
  });

  // Attempt connection but don't block startup
  client.connect().catch(() => {
    // Swallow — the error event above handles logging
  });

  return client;
};

// Main client for querying presence maps
export const redisClient = createRedisClient('Main Client');

// Pub/Sub clients for Socket.IO Redis adapter (DEDICATED — do not share)
export const pubClient = createRedisClient('Pub Client');
export const subClient = createRedisClient('Sub Client');

// Pub/Sub clients for Internal Event Bus (DEDICATED — separate from Socket.IO)
export const eventPubClient = createRedisClient('Event Pub Client');
export const eventSubClient = createRedisClient('Event Sub Client');

// Set available flag on first successful connection
redisClient.once('connect', () => { redisAvailable = true; });

const PRESENCE_KEY = 'synq:active_users';

/**
 * Registers a user connection. Increments connection count.
 * Returns true if the user transitioned from offline -> online (count became 1).
 */
export const registerUserPresence = async (userId: string): Promise<boolean> => {
  try {
    const newCount = await redisClient.hincrby(PRESENCE_KEY, userId, 1);
    return newCount === 1;
  } catch (err) {
    console.error(`Failed to register presence for user ${userId}:`, err);
    return false;
  }
};

/**
 * Deregisters a user connection. Decrements connection count.
 * Returns true if the user transitioned from online -> offline (count <= 0).
 */
export const deregisterUserPresence = async (userId: string): Promise<boolean> => {
  try {
    const luaScript = `
      local count = redis.call('hincrby', KEYS[1], ARGV[1], -1)
      if count <= 0 then
        redis.call('hdel', KEYS[1], ARGV[1])
        return 1
      end
      return 0
    `;
    
    // Eval returns 1 if user transitioned offline, 0 if still online
    const result = await redisClient.eval(luaScript, 1, PRESENCE_KEY, userId);
    return result === 1;
  } catch (err) {
    console.error(`Failed to deregister presence for user ${userId}:`, err);
    return false;
  }
};

/**
 * Checks if a user is online.
 */
export const isUserOnline = async (userId: string): Promise<boolean> => {
  try {
    const exists = await redisClient.hexists(PRESENCE_KEY, userId);
    return exists === 1;
  } catch (err) {
    console.error(`Failed to check online status for user ${userId}:`, err);
    return false;
  }
};

/**
 * Gets all online user IDs.
 */
export const getActiveUsers = async (): Promise<string[]> => {
  try {
    return await redisClient.hkeys(PRESENCE_KEY);
  } catch (err) {
    console.error('Failed to get active users:', err);
    return [];
  }
};

/**
 * Clears the presence cache (run on startup).
 */
export const clearPresenceStore = async (): Promise<void> => {
  try {
    await redisClient.del(PRESENCE_KEY);
    console.log('Redis presence store cleared successfully on startup.');
  } catch (err) {
    console.error('Failed to clear presence store on startup:', err);
  }
};
