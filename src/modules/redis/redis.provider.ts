import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    const logger = new Logger('RedisProvider');

    const redisUrl = config.get<string>('REDIS_URL');

    if (!redisUrl) {
      logger.warn('REDIS_URL not set. Redis disabled.');
      return null;
    }

    const client = new Redis(redisUrl, {
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });

    client.on('connect', () => {
      logger.log('✅ Redis socket connected');
    });

    client.on('ready', () => {
      logger.log('✅ Redis ready');
    });

    client.on('error', (err) => {
      logger.error('Redis error', err.stack);
    });

    client.on('close', () => {
      logger.warn('Redis connection closed');
    });

    client.connect().catch((err) => {
      logger.error('Initial Redis connection failed', err.stack);
    });

    return client;
  }
}


// import { Provider, Logger } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import Redis from 'ioredis';

// export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// export const RedisProvider: Provider = {
//   provide: REDIS_CLIENT,
//   inject: [ConfigService],

//   useFactory: async (config: ConfigService) => {
//     const logger = new Logger('RedisProvider');

//     const redisUrl = config.get<string>('REDIS_URL');

//     if (!redisUrl) {
//       logger.warn('REDIS_URL not set. Redis disabled.');
//       return null;
//     }

//     const client = new Redis(redisUrl, {
//       lazyConnect: true,

//       enableReadyCheck: true,

//       maxRetriesPerRequest: null,

//       connectTimeout: 10000,

//       keepAlive: 10000,

//       retryStrategy: (times) => {
//         const delay = Math.min(times * 500, 5000);

//         logger.warn(
//           `Redis reconnect attempt ${times}. Waiting ${delay}ms`,
//         );

//         return delay;
//       },
//     });

//     client.on('connect', () => {
//       logger.log('Redis socket connected');
//     });

//     client.on('ready', () => {
//       logger.log('Redis ready');
//     });

//     client.on('error', (err) => {
//       logger.error(`Redis error: ${err.message}`);
//     });

//     client.on('close', () => {
//       logger.warn('Redis connection closed');
//     });

//     client.on('reconnecting', (delay) => {
//       logger.warn(`Redis reconnecting in ${delay}ms`);
//     });

//     try {
//       await client.connect();
//       await client.ping();

//       logger.log('Redis connection established successfully');
//     } catch (err) {
//       logger.error(
//         `Initial Redis connection failed: ${(err as Error).message}`,
//       );

//       // Close the failed client so it doesn't leak.
//       client.disconnect();

//       throw err;
//     }

//     return client;
//   },
// };
