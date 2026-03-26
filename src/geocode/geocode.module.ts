import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { GeocodeProcessor } from './geocode.processor';

@Module({
  imports: [QueueModule],
  providers: [GeocodeProcessor],
})
export class GeocodeModule {}
