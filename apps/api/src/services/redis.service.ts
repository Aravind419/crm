import Redis from 'ioredis';
import { config } from '../config';

let redisClient: Redis | null = null;
let isConnected = false;

export function initRedis(): Redis | null {
  if (!config.redisUrl) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  try {
    redisClient = new Redis(config.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 100, 1000);
      },
    });

    redisClient.on('connect', () => {
      isConnected = true;
      console.log('[Redis] Connected to shared Redis cluster/instance for distributed state');
    });

    redisClient.on('error', (err) => {
      isConnected = false;
      if (err.message && err.message.includes('Connection is closed')) return;
      console.error('[Redis Client Error]:', err.message);
    });

    redisClient.on('close', () => {
      isConnected = false;
    });

    return redisClient;
  } catch (err: any) {
    console.error('[Redis Init Failed]:', err.message);
    return null;
  }
}

export function getRedisClient(): Redis | null {
  if (!redisClient && config.redisUrl) {
    return initRedis();
  }
  return redisClient;
}

export function isRedisConnected(): boolean {
  return isConnected && redisClient !== null && redisClient.status === 'ready';
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch (_) {}
    redisClient = null;
    isConnected = false;
  }
}
