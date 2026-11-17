// src/modules/store/store-geocode.processor.ts
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../shared/services/prisma.service';
import { QUEUES } from '../../../shared/constants';
import Helper from '../../../shared/utils/helpers';

@Processor(QUEUES.GEOCODE_STORE)
export class StoreGeocodeProcessor extends WorkerHost {
  private readonly logger = new Logger(StoreGeocodeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.GEOCODE_STORE)
    private readonly geocodeQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== QUEUES.GEOCODE_STORE_JOB) return;

    const { storeId, address } = job.data;
    this.logger.log(`Geocoding store: ${storeId} — ${address}`);

    const location = await Helper.geocodeAddress(address);
    if (!location || location.lat == null || location.lng == null) {
      throw new Error(`Geocoding failed for store ${storeId}: ${address}`);
    }

    await this.prisma.store.update({
      where: { id: storeId },
      data: { latitude: location.lat, longitude: location.lng },
    });

    this.logger.log(`Store ${storeId} updated: ${location.lat}, ${location.lng}`);
  }
}