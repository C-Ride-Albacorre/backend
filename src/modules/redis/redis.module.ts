import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisProvider } from './redis.provider';
import { RedisService } from './redis.service';
import { RedisHealthIndicator } from './redis.health';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisProvider, RedisService, RedisHealthIndicator],
  exports: [RedisProvider, RedisService, RedisHealthIndicator],
})
export class RedisModule {}
