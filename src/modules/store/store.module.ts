import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreDiscoveryService } from '../customer/store-discovery.service';
import { QueueModule } from '../../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [StoreController],
  providers: [StoreService, StoreDiscoveryService],
  exports: [StoreDiscoveryService, StoreService],
})
export class StoreModule {}
