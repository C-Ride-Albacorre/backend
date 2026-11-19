// src/modules/store/store-geocode.processor.ts
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../shared/services/prisma.service';
import { QUEUES } from '../../../shared/constants';
import Helper from '../../../shared/utils/helpers';
import { Prisma } from '@prisma/client';

@Processor(QUEUES.GEOCODE_STORE)
export class StoreGeocodeProcessor extends WorkerHost {
  private readonly logger = new Logger(StoreGeocodeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
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

  try {
    await this.prisma.store.update({
      where: { id: storeId },
      data: { latitude: location.lat, longitude: location.lng },
    });
    this.logger.log(`Store ${storeId} updated: ${location.lat}, ${location.lng}`);
  } catch (err) {
    // P2025: record not found → the store was deleted after the job was
    // enqueued. Treat as an obsolete job and stop retrying.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2025'
    ) {
      this.logger.warn(`Store ${storeId} no longer exists — skipping geocode update`);
      return;
    }
    throw err; // anything else is a real failure → let BullMQ retry
  }
}
}