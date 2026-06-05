import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Main client for querying presence maps
export const redisClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

// Pub/Sub clients for Socket.IO Redis adapter (DEDICATED — do not share)
export const pubClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

export const subClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

// Pub/Sub clients for Internal Event Bus (DEDICATED — separate from Socket.IO)
export const eventPubClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

export const eventSubClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

redisClient.on('connect', () => console.log('Redis Client connected'));
redisClient.on('error', (err) => console.error('Redis Client Error:', err));

pubClient.on('error', (err) => console.error('Redis Pub Client Error:', err));
subClient.on('error', (err) => console.error('Redis Sub Client Error:', err));
eventPubClient.on('error', (err) => console.error('Redis Event Pub Client Error:', err));
eventSubClient.on('error', (err) => console.error('Redis Event Sub Client Error:', err));

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
    const currentCountStr = await redisClient.hget(PRESENCE_KEY, userId);
    if (!currentCountStr) return true; // Already offline

    const newCount = parseInt(currentCountStr, 10) - 1;
    if (newCount <= 0) {
      await redisClient.hdel(PRESENCE_KEY, userId);
      return true;
    } else {
      await redisClient.hset(PRESENCE_KEY, userId, newCount.toString());
      return false;
    }
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
