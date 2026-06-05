import { EventEmitter } from 'events';
import crypto from 'crypto';
import { pubClient, subClient } from '../db/redis';
import { AppEvent, EventPayloads } from './types';

class SynqEventBus extends EventEmitter {
  private redisChannel = 'synq:events';

  constructor() {
    super();
    this.setupRedisSubscription();
  }

  private setupRedisSubscription() {
    // Subscribe to the Redis channel for cross-instance events
    subClient.subscribe(this.redisChannel, (err) => {
      if (err) {
        console.error('Failed to subscribe to Redis event channel:', err);
      } else {
        console.log(`Subscribed to Redis event channel: ${this.redisChannel}`);
      }
    });

    // Listen for messages from Redis (which could originate from any server instance)
    subClient.on('message', (channel, message) => {
      if (channel === this.redisChannel) {
        try {
          const parsedEvent: AppEvent = JSON.parse(message);
          // Emit locally for subscribers in this Node process
          this.emitLocal(parsedEvent);
        } catch (err) {
          console.error('Failed to parse incoming Redis event:', err);
        }
      }
    });
  }

  /**
   * Publish an event to the distributed system.
   * By sending to Redis, ALL active server instances (including this one) will receive and process it.
   */
  public async publish<K extends AppEvent['type']>(type: K, data: EventPayloads[K]): Promise<void> {
    const event: AppEvent = {
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: type as any,
      data: data as any,
    };

    try {
      await pubClient.publish(this.redisChannel, JSON.stringify(event));
    } catch (err) {
      console.error(`Failed to publish event ${type} to Redis:`, err);
    }
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
