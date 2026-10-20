import { Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../modules/redis/redis.provider';
import { QUEUES } from '../shared/constants';

export const GEOCODE_QUEUE = 'GEOCODE_QUEUE';

export const GeocodeQueueProvider: Provider = {
  provide: GEOCODE_QUEUE,
  inject: [REDIS_CLIENT],
  useFactory: (redis: Redis) => {
    if (!redis) {
      throw new Error('Redis not available for BullMQ');
    }

    // return new Queue('geocode-store', {
    //   connection: redis.duplicate() as any,
    // });
    return new Queue(QUEUES.GEOCODE_STORE, {
      connection: redis.duplicate() as any,
    });
  },
};
