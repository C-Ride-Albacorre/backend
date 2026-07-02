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
      'geocode-store',
      async (job) => this.handleJob(job),
      {
        connection: this.redis.duplicate({
          maxRetriesPerRequest: null,
        }) as any,
      },
    );

    //     Bonus (very important for Google API)
    // Since you're calling external API:
    // Add limiter to worker:
    //     new Worker('geocode-store', processor, {
    //   connection: this.redis.duplicate({
    //     maxRetriesPerRequest: null,
    //   }) as any,
    //   limiter: {
    //     max: 5,       // 5 jobs
    //     duration: 1000, // per second
    //   },
    // });

    this.worker.on('completed', (job) => {
      this.logger.log(`✅ Job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`❌ Job failed: ${job?.id}`, err.stack);
    });
  }

  async handleJob(job: Job) {
    const { storeId, address } = job.data;

    this.logger.log(`Geocoding store: ${storeId}`);

    const location = await Helper.geocodeAddress(address);
    //const location = await this.geocodeAddress(address);

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
