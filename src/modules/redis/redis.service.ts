import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly defaultTtl: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.defaultTtl = this.config.get<number>('REDIS_DEFAULT_TTL') ?? 300;
  }

  /* ------------------ Connection State ------------------ */

  isConnected(): boolean {
    return this.redis.status === 'ready';
  }

  /* ------------------ Safe Wrappers ------------------ */

  async safeGet<T>(key: string): Promise<T | null> {
    if (!this.isConnected()) return null;

    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      this.logger.warn(`Redis GET failed for key=${key}`, error);
      return null; // graceful fallback
    }
  }

  async safeSet(
    key: string,
    value: unknown,
    ttl: number = this.defaultTtl,
  ): Promise<void> {
    if (!this.isConnected()) return;

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logger.warn(`Redis SET failed for key=${key}`, error);
    }
  }

  async safeDel(key: string): Promise<void> {
    if (!this.isConnected()) return;

    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`Redis DEL failed for key=${key}`, error);
    }
  }

  /* ------------------ Strict Methods (optional) ------------------ */

  async getOrThrow<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      this.logger.error(`Redis GET failed for key=${key}`, error.stack);
      throw error;
    }
  }

  /* ------------------ Metrics / Debug ------------------ */

  async ping(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------ Shutdown ------------------ */

  async onModuleDestroy() {
    if (this.redis.status === 'ready') {
      this.logger.log('Closing Redis connection...');
      await this.redis.quit();
    }
  }
}
