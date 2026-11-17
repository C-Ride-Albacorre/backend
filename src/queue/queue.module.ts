// import { Module } from '@nestjs/common';
// import { GeocodeQueueProvider } from './geocode.queue';
// import { RedisModule } from '../modules/redis/redis.module';

// @Module({
//   imports: [RedisModule],
//   providers: [GeocodeQueueProvider],
//   exports: [GeocodeQueueProvider],
// })
// export class QueueModule {}
// queue.module.ts
import { Module } from '@nestjs/common';
import { GeocodeQueueProvider } from './geocode.queue';
import { RedisModule } from '../modules/redis/redis.module';
import { PrismaService } from '../shared/services/prisma.service';
import { GeocodeProcessor } from '../geocode/geocode.processor';

@Module({
  imports: [RedisModule],
  providers: [
    GeocodeQueueProvider,
    GeocodeProcessor,      // ← THE FIX
    PrismaService,         // ← dependency of GeocodeProcessor
  ],
  exports: [GeocodeQueueProvider],
})
export class QueueModule {}