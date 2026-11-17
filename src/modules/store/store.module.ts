import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreDiscoveryService } from '../customer/store-discovery.service';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '../../shared/constants';
import { StoreGeocodeProcessor } from './processor/store-geocode.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.GEOCODE_STORE,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  controllers: [StoreController],
  providers: [StoreService, StoreDiscoveryService, StoreGeocodeProcessor],
  exports: [StoreDiscoveryService, StoreService],
})
export class StoreModule {}
