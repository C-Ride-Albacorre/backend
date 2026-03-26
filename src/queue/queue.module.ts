import { Module } from '@nestjs/common';
import { GeocodeQueueProvider } from './geocode.queue';
import { RedisModule } from '../modules/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [GeocodeQueueProvider],
  exports: [GeocodeQueueProvider],
})
export class QueueModule {}
