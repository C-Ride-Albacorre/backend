
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { createClient, RedisClientType } from 'redis';

export interface CacheServiceOptions {
  /** Redis connection URL */
  redisUrl?: string;

  /** Default TTL in seconds */
  defaultTtl?: number;

  /** Namespace for cache keys */
  namespace?: string;

  /** Enable compression */
  compression?: boolean;

  /** Connection timeout in milliseconds */
  connectTimeout?: number;
}

export interface CacheHealth {
  status: 'healthy' | 'unhealthy';
  latency?: number;
  error?: string;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private cache: Keyv;
  private redisClient: RedisClientType;
  private isConnected = false;
  private readonly options: Required<CacheServiceOptions>;

  private readonly DEFAULT_OPTIONS: Required<CacheServiceOptions> = {
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    defaultTtl: parseInt(process.env.REDIS_TTL || '600', 10),
    namespace: process.env.REDIS_NAMESPACE || 'app:cache',
    compression: process.env.REDIS_COMPRESSION === 'true',
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '5000', 10),
  };

  constructor(@Optional() options?: CacheServiceOptions) {
    this.options = { ...this.DEFAULT_OPTIONS, ...options };

    this.initializeRedisClient();
  }

  private initializeRedisClient(): void {
    this.redisClient = createClient({
      url: this.options.redisUrl,
      socket: {
        connectTimeout: this.options.connectTimeout,
        reconnectStrategy: (retries) => {
          this.logger.warn(`Redis reconnecting attempt ${retries}`);
          return Math.min(retries * 100, 3000);
        },
      },
    });

    // Event listeners
    this.redisClient.on('connect', () => {
      this.logger.debug('Redis client connecting...');
    });

    this.redisClient.on('ready', () => {
      this.isConnected = true;
      this.logger.log('✅ Redis client ready');
    });

    this.redisClient.on('end', () => {
      this.isConnected = false;
      this.logger.warn('Redis client disconnected');
    });

    this.redisClient.on('error', (error) => {
      this.logger.error(`Redis client error: ${error.message}`, error.stack);
    });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing CacheService...');

    try {
      // Connect Redis client with timeout
      await Promise.race([
        this.redisClient.connect(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis connection timeout')),
            this.options.connectTimeout,
          ),
        ),
      ]);

      // Initialize Keyv with Redis store
      this.cache = new Keyv({
        store: new KeyvRedis(this.redisClient),
        ttl: this.options.defaultTtl * 1000, // Convert to milliseconds
        namespace: this.options.namespace,
        compression: this.options.compression,
        serialize: JSON.stringify,
        deserialize: JSON.parse,
      });

      // Keyv error handling
      this.cache.on('error', (error) => {
        this.logger.error(`Keyv error: ${error.message}`, error.stack);
      });

      // Health check
      const health = await this.checkHealth();
      if (health.status === 'healthy') {
        this.logger.log(`✅ CacheService ready (latency: ${health.latency}ms)`);
      } else {
        throw new Error(`Cache health check failed: ${health.error}`);
      }
    } catch (error) {
      this.logger.error('❌ CacheService failed to initialize', error);
      throw error; // Re-throw to fail startup
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting CacheService...');

    try {
      if (this.redisClient && this.redisClient.isOpen) {
        await this.redisClient.quit();
      }
      this.logger.log('✅ CacheService disconnected');
    } catch (error) {
      this.logger.error('Error during CacheService disconnect', error);
    } finally {
      this.isConnected = false;
    }
  }

  /**
   * Check cache health and latency
   */
  async checkHealth(): Promise<CacheHealth> {
    try {
      const start = Date.now();
      await this.cache.set('healthcheck', 'ok', 1000);
      const value = await this.cache.get('healthcheck');
      const latency = Date.now() - start;

      if (value === 'ok') {
        return { status: 'healthy', latency };
      }
      return {
        status: 'unhealthy',
        error: 'Health check value mismatch',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
      };
    }
  }

  /**
   * Get cached value with type safety
   */
  async get<T = any>(key: string): Promise<T | undefined> {
    if (!this.isConnected) {
      this.logger.warn(`Cache not connected, skipping get for key: ${key}`);
      return undefined;
    }

    try {
      const value = await this.cache.get<T>(key);

      if (value === undefined) {
        this.logger.debug(`Cache miss for key: ${key}`);
      } else {
        this.logger.debug(`Cache hit for key: ${key}`);
      }

      return value;
    } catch (error) {
      this.logger.error(`Failed to get cache key "${key}"`, error.stack);
      return undefined;
    }
  }

  /**
   * Set cached value with optional TTL
   * @param ttl Time to live in seconds
   */
  async set<T = any>(key: string, value: T, ttl?: number): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn(`Cache not connected, skipping set for key: ${key}`);
      return false;
    }

    try {
      const ttlMs = ttl ? ttl * 1000 : undefined;
      await this.cache.set(key, value, ttlMs);
      this.logger.debug(`Cache set for key: ${key}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to set cache key "${key}"`, error.stack);
      return false;
    }
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn(`Cache not connected, skipping delete for key: ${key}`);
      return false;
    }

    try {
      const result = await this.cache.delete(key);
      this.logger.debug(
        `Cache delete for key: ${key} - ${result ? 'success' : 'not found'}`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to delete cache key "${key}"`, error.stack);
      return false;
    }
  }

  /**
   * Clear all cache entries in namespace
   */
  async clear(): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn('Cache not connected, skipping clear');
      return false;
    }

    try {
      await this.cache.clear();
      this.logger.debug('Cache cleared');
      return true;
    } catch (error) {
      this.logger.error('Failed to clear cache', error.stack);
      return false;
    }
  }

  /**
   * Get or set pattern with cache stampede protection
   */
  async getOrSet<T = any>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const value = await factory();
      await this.set(key, value, ttl);
      return value;
    } catch (error) {
      this.logger.error(
        `Factory function failed for key "${key}"`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get multiple keys at once
   */
  async mget<T = any>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    if (!this.isConnected) {
      this.logger.warn('Cache not connected, skipping mget');
      return result;
    }

    for (const key of keys) {
      const value = await this.get<T>(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }

    return result;
  }

  /**
   * Set multiple values at once
   */
  async mset<T = any>(entries: [string, T][], ttl?: number): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn('Cache not connected, skipping mset');
      return false;
    }

    try {
      const promises = entries.map(([key, value]) => this.set(key, value, ttl));

      const results = await Promise.all(promises);
      return results.every((result) => result === true);
    } catch (error) {
      this.logger.error('Failed to mset cache entries', error.stack);
      return false;
    }
  }

  /**
   * Check if cache has key (exists and not expired)
   */
  async has(key: string): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const value = await this.cache.get(key);
      return value !== undefined;
    } catch (error) {
      this.logger.error(`Failed to check cache key "${key}"`, error.stack);
      return false;
    }
  }

  /**
   * Get cache connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    namespace: string;
    health: CacheHealth;
  }> {
    const health = await this.checkHealth();

    return {
      connected: this.isConnected,
      namespace: this.options.namespace,
      health,
    };
  }
}