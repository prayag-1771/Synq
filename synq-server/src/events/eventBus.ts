import { EventEmitter } from 'events';
import crypto from 'crypto';
import { eventPubClient, eventSubClient, redisAvailable } from '../db/redis';
import { AppEvent, EventPayloads } from './types';

class SynqEventBus extends EventEmitter {
  private redisChannel = 'synq:events';

  constructor() {
    super();
    // Delay Redis subscription setup to allow connection time
    setTimeout(() => this.setupRedisSubscription(), 600);
  }

  private setupRedisSubscription() {
    if (!redisAvailable) {
      console.warn('[EventBus] Redis unavailable — running in local-only mode (single instance).');
      return;
    }

    // Subscribe to the Redis channel for cross-instance events
    eventSubClient.subscribe(this.redisChannel, (err) => {
      if (err) {
        console.error('[EventBus] Failed to subscribe to Redis event channel:', err);
      } else {
        console.log(`[EventBus] Subscribed to Redis event channel: ${this.redisChannel} ✓`);
      }
    });

    // Listen for messages from Redis (which could originate from any server instance)
    eventSubClient.on('message', (channel, message) => {
      if (channel === this.redisChannel) {
        try {
          const parsedEvent: AppEvent = JSON.parse(message);
          // Emit locally for subscribers in this Node process
          this.emitLocal(parsedEvent);
        } catch (err) {
          console.error('[EventBus] Failed to parse incoming Redis event:', err);
        }
      }
    });
  }

  /**
   * Publish an event to the distributed system.
   * If Redis is available, broadcasts to all instances. Otherwise fires locally only.
   */
  public async publish<K extends AppEvent['type']>(type: K, data: EventPayloads[K]): Promise<void> {
    const event: AppEvent = {
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: type as any,
      data: data as any,
    };

    if (redisAvailable) {
      try {
        await eventPubClient.publish(this.redisChannel, JSON.stringify(event));
        return; // Redis publish will trigger emitLocal via the subscriber above
      } catch (err) {
        console.error(`[EventBus] Failed to publish event ${type} to Redis, emitting locally:`, err);
      }
    }

    // Fallback: emit locally when Redis is unavailable
    this.emitLocal(event);
  }

  /**
   * Strongly typed subscribe method for local event handlers.
   */
  public subscribe<K extends AppEvent['type']>(
    type: K,
    handler: (data: EventPayloads[K], event: AppEvent) => void
  ): void {
    this.on(type, (event: AppEvent) => {
      handler(event.data as EventPayloads[K], event);
    });
  }

  private emitLocal(event: AppEvent) {
    this.emit(event.type, event);
  }
}

export const eventBus = new SynqEventBus();

