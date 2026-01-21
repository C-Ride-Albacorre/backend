import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { RedisClientType, createClient } from 'redis';

export interface CacheServiceOptions {
  defaultTtl?: number;
  namespace?: string;
}

export interface CacheHealth {
  status: 'healthy' | 'unhealthy';
  latency?: number;
  error?: string;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private cache!: Keyv;
  private redisClient?: RedisClientType;
  private isRedis = false;
  private redisConnected = false;

  // Metrics
  private hitCount = 0;
  private missCount = 0;

  private readonly DEFAULT_TTL =
    parseInt(process.env.REDIS_TTL || '600', 10) * 1000;

  constructor(@Inject(CACHE_MANAGER) cache: Keyv) {
    this.cache = cache;
    this.isRedis = !!(cache as any)?.opts?.store;

    if (this.isRedis) {
      this.logger.log('⚡ CacheService initialized with Redis store');
      this.redisClient = (this.cache.opts.store as KeyvRedis<RedisClientType>)
        .client as RedisClientType;

      this.setupRedisEvents();
    } else {
      this.logger.warn(
        '⚠️ CacheService using in-memory cache (Redis not configured)',
      );
    }

    this.cache.on('error', (err) => {
      this.logger.error('Cache error', err);
    });
  }

  /** Setup Redis events for hot-reconnect and graceful fallback */
  private setupRedisEvents() {
    if (!this.redisClient) return;

    this.redisClient.on('connect', () => {
      this.logger.debug('Redis connecting...');
    });

    this.redisClient.on('ready', () => {
      this.redisConnected = true;
      this.logger.log('✅ Redis connected and ready');
    });

    this.redisClient.on('end', () => {
      this.redisConnected = false;
      this.logger.warn(
        '⚠️ Redis connection closed, falling back to memory cache',
      );
    });

    this.redisClient.on('error', (err) => {
      this.redisConnected = false;
      this.logger.error('Redis client error', err);
    });

    // Hot-reconnect logic
    this.redisClient.on('reconnecting', (delay: number) => {
      this.logger.warn(`Redis reconnecting in ${delay}ms...`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.redisClient?.isOpen) {
        await this.redisClient.quit();
      }
      await this.cache.clear();
      this.logger.log('CacheService shutdown complete');
    } catch (err) {
      this.logger.error('Error during CacheService shutdown', err);
    }
  }

  /** Health check + latency */
  async checkHealth(): Promise<CacheHealth> {
    try {
      const start = Date.now();
      await this.cache.set('__health__', 'ok', 1000);
      const value = await this.cache.get('__health__');
      const latency = Date.now() - start;

      if (value === 'ok') return { status: 'healthy', latency };
      return { status: 'unhealthy', error: 'Health check value mismatch' };
    } catch (err: any) {
      return { status: 'unhealthy', error: err.message };
    }
  }

  /** Get value with hit/miss metrics */
  async get<T = any>(key: string): Promise<T | undefined> {
    try {
      const value = await this.cache.get<T>(key);
      if (value === undefined) this.missCount++;
      else this.hitCount++;

      this.logger.debug(
        value === undefined ? `Cache miss: ${key}` : `Cache hit: ${key}`,
      );

      return value;
    } catch (err: any) {
      this.logger.error(`Cache get failed: ${key}`, err.stack);
      this.missCount++;
      return undefined;
    }
  }

  /** Set value */
  async set<T = any>(
    key: string,
    value: T,
    ttlSeconds?: number,
  ): Promise<boolean> {
    try {
      const ttl = ttlSeconds ? ttlSeconds * 1000 : this.DEFAULT_TTL;
      await this.cache.set(key, value, ttl);
      return true;
    } catch (err: any) {
      this.logger.error(`Cache set failed: ${key}`, err.stack);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      return await this.cache.delete(key);
    } catch (err: any) {
      this.logger.error(`Cache delete failed: ${key}`, err.stack);
      return false;
    }
  }

  async clear(): Promise<boolean> {
    try {
      await this.cache.clear();
      return true;
    } catch (err: any) {
      this.logger.error('Cache clear failed', err.stack);
      return false;
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async mget<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const value = await this.get<T>(key);
      if (value !== undefined) result.set(key, value);
    }
    return result;
  }

  async mset<T>(entries: [string, T][], ttlSeconds?: number): Promise<boolean> {
    const results = await Promise.all(
      entries.map(([k, v]) => this.set(k, v, ttlSeconds)),
    );
    return results.every(Boolean);
  }

  async has(key: string): Promise<boolean> {
    try {
      return (await this.cache.get(key)) !== undefined;
    } catch {
      return false;
    }
  }

  /** Metrics getters */
  getHitRate(): number {
    const total = this.hitCount + this.missCount;
    return total === 0 ? 0 : this.hitCount / total;
  }

  getMissRate(): number {
    const total = this.hitCount + this.missCount;
    return total === 0 ? 0 : this.missCount / total;
  }

  getConnectionStatus(): boolean {
    return this.redisConnected;
  }

  async getStats(): Promise<{
    connected: boolean;
    hitRate: number;
    missRate: number;
    health: CacheHealth;
  }> {
    const health = await this.checkHealth();
    return {
      connected: this.redisConnected,
      hitRate: this.getHitRate(),
      missRate: this.getMissRate(),
      health,
    };
  }
}
