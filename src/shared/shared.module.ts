import { Global, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaService } from './services/prisma.service';
import { MailGunService } from './services/mailgun.service';
import { CloudinaryService } from './services/cloudinary.service';
import { GoogleService } from './services/google.service';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { createClient } from 'redis';
import { CacheService } from './services/cache.service';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      useFactory: async () => {
        const redisUri = process.env.REDIS_URL || 'redis://localhost:6379';
        // Keyv instance with Redis store
        const client = createClient({ url: redisUri });
        await client.connect();
        const keyv = new Keyv({
          store: new KeyvRedis(client),
        });
        return keyv;
      },
    }),
  ],
  providers: [
    PrismaService,
    MailGunService,
    CloudinaryService,
    GoogleService,
    CacheService,
  ],
  exports: [PrismaService, MailGunService, CloudinaryService, GoogleService, CacheService],
})
export class SharedModule {}
