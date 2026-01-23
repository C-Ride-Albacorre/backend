
import { Global, Module, Logger } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaService } from './services/prisma.service';
import { CloudinaryService } from './services/cloudinary.service';
import { GoogleService } from './services/google.service';
import { CacheService } from './services/cache.service';

import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { createClient } from 'redis';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      useFactory: async () => {
        const logger = new Logger('CacheModule');
        const redisUrl = process.env.REDIS_URL;

        // 🟢 No Redis configured → use in-memory cache
        if (!redisUrl) {
          logger.warn('REDIS_URL not set, using in-memory cache');
          return new Keyv(); // default in-memory
        }

        try {
          const client = createClient({ url: redisUrl });

          client.on('error', (err) => {
            logger.error('Redis client error', err);
          });

          await client.connect();

          logger.log('Connected to Redis');

          return new Keyv({
            store: new KeyvRedis(client),
          });
        } catch (err) {
          // 🟡 Redis down → fallback gracefully
          logger.error(
            'Redis connection failed, falling back to memory cache',
            err,
          );
          return new Keyv();
        }
      },
    }),
  ],
  providers: [
    PrismaService,
    CloudinaryService,
    GoogleService,
    CacheService,
  ],
  exports: [
    PrismaService,
    CloudinaryService,
    GoogleService,
    CacheService,
  ],
})
export class SharedModule {}
