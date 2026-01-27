import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    const logger = new Logger('RedisProvider');
    const client = new Redis({
      host: config.get<string>('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT'),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: config.get<number>('REDIS_DB') ?? 0,
      keyPrefix: `${config.get<string>('REDIS_KEY_PREFIX')}:`,
      lazyConnect: true, // ✅ non-blocking
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 2000),
      //tls: config.get<boolean>('REDIS_TLS') ? {} : undefined,
    });

    client.on('connect', () => {
      logger.log('Redis socket connected');
    });

    client.on('ready', () => {
      logger.log('Redis ready');
    });

    client.on('error', (err) => {
      logger.error('Redis error', err.stack);
    });

    client.on('close', () => {
      logger.warn(
        'Redis connection closed',
        config.get<string>('REDIS_HOST') || 'redischeck',
      );
    });

    // Do NOT await — service will degrade gracefully if Redis is down
    client.connect().catch((err) => {
      logger.error('Initial Redis connection failed', err.stack);
    });

    return client;
  },
};
