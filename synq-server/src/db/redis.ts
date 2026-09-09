import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Track whether Redis is available
export let redisAvailable = false;

const createRedisClient = (label: string) => {
  let warnedOnce = false;

  const client = new Redis(redisUrl, {
    // Only retry requests once if they fail
    maxRetriesPerRequest: 1,
    // Disable internal INFO ready check to prevent subscriber mode crashes
    enableReadyCheck: false,
    // Try to connect 3 times, then give up (degraded mode)
    retryStrategy: (times) => {
      if (times > 3) return null;
      return 1000;
    },
  });

  client.on('connect', () => {
    redisAvailable = true;
    console.log(`[Redis] ${label} connected ✓`);
  });

  client.on('error', (err) => {
    if (!warnedOnce && ((err as any).code === 'ECONNREFUSED' || (err as any).code === 'ENOTFOUND')) {
      warnedOnce = true;
      console.warn(`[Redis] ${label} — not available. Server running in degraded mode.`);
    }
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
 * Presence falls back to an in-process counter when Redis is unavailable.
 *
 * Redis exists here to share presence across instances; without it the server
 * already runs single-instance (no Socket.IO adapter), so a local map is the
 * correct source of truth rather than reporting everyone as offline.
 */
const localPresence = new Map<string, number>();

const useLocalPresence = () => !redisAvailable;

/**
 * Registers a user connection. Increments connection count.
 * Returns true if the user transitioned from offline -> online (count became 1).
 */
export const registerUserPresence = async (userId: string): Promise<boolean> => {
  if (useLocalPresence()) {
    const next = (localPresence.get(userId) || 0) + 1;
    localPresence.set(userId, next);
    return next === 1;
  }

  try {
    const newCount = await redisClient.hincrby(PRESENCE_KEY, userId, 1);
    return newCount === 1;
  } catch (err) {
    console.error(`Failed to register presence for user ${userId}:`, err);
    const next = (localPresence.get(userId) || 0) + 1;
    localPresence.set(userId, next);
    return next === 1;
  }
};

/**
 * Deregisters a user connection. Decrements connection count.
 * Returns true if the user transitioned from online -> offline (count <= 0).
 */
export const deregisterUserPresence = async (userId: string): Promise<boolean> => {
  const dropLocal = (): boolean => {
    const next = (localPresence.get(userId) || 0) - 1;
    if (next <= 0) {
      localPresence.delete(userId);
      return true;
    }
    localPresence.set(userId, next);
    return false;
  };

  if (useLocalPresence()) return dropLocal();

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
    return dropLocal();
  }
};

/**
 * Checks if a user is online.
 */
export const isUserOnline = async (userId: string): Promise<boolean> => {
  if (useLocalPresence()) return localPresence.has(userId);

  try {
    const exists = await redisClient.hexists(PRESENCE_KEY, userId);
    return exists === 1;
  } catch (err) {
    console.error(`Failed to check online status for user ${userId}:`, err);
    return localPresence.has(userId);
  }
};

/**
 * Gets all online user IDs.
 */
export const getActiveUsers = async (): Promise<string[]> => {
  if (useLocalPresence()) return Array.from(localPresence.keys());

  try {
    return await redisClient.hkeys(PRESENCE_KEY);
  } catch (err) {
    console.error('Failed to get active users:', err);
    return Array.from(localPresence.keys());
  }
};

/**
 * Clears the presence cache (run on startup).
 */
export const clearPresenceStore = async (): Promise<void> => {
  localPresence.clear();

  if (useLocalPresence()) return;

  try {
    await redisClient.del(PRESENCE_KEY);
    console.log('Redis presence store cleared successfully on startup.');
  } catch (err) {
    console.error('Failed to clear presence store on startup:', err);
  }
};
