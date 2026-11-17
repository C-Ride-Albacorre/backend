import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import axios from 'axios';
import { REDIS_CLIENT } from '../modules/redis/redis.provider';
import { PrismaService } from '../shared/services/prisma.service';
import Helper from '../shared/utils/helpers';
import { QUEUES } from '../shared/constants';

@Injectable()
export class GeocodeProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker;
  private readonly logger = new Logger(GeocodeProcessor.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUES.GEOCODE_STORE,
      async (job) => this.handleJob(job),
      {
        connection: this.redis.duplicate({
          maxRetriesPerRequest: null,
        }) as any,
         concurrency: 5,
      },
    );

    this.worker.on('completed', (job) => {
    this.logger.log(`Job completed: ${job.id}`);
  });

  this.worker.on('failed', (job, err) => {
    this.logger.error(
      `Job failed: ${job?.id}: ${err.message}`,
      err.stack,
    );
  });

  this.worker.on('error', (err) => {
    this.logger.error(`Worker error: ${err.message}`, err.stack);
  });

  this.logger.log('Geocoding worker initialized');
  }

  async handleJob(job: Job) {
  const { storeId, address } = job.data;

  this.logger.log(`Geocoding store: ${storeId}`);
  this.logger.log(`Address: ${address}`);

  const location = await Helper.geocodeAddress(address);

  if (!location || location.lat == null || location.lng == null) {
    throw new Error(
      `Geocoding failed for store ${storeId}: ${address}`,
    );
  }

  await this.prisma.store.update({
    where: { id: storeId },
    data: {
      latitude: location.lat,
      longitude: location.lng,
    },
  });

  this.logger.log(
    `Store ${storeId} updated: ${location.lat}, ${location.lng}`,
  );
}

  async handleJob2(job: Job) {
    const { storeId, address } = job.data;

    this.logger.log(`Geocoding store: ${storeId}`);

    const location = await Helper.geocodeAddress(address);

    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        latitude: location.lat,
        longitude: location.lng,
      },
    });

    this.logger.log(`Store updated with coordinates`);
  }



  async onModuleDestroy() {
    await this.worker?.close();
  }
}
