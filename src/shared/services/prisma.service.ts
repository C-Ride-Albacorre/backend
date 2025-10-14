import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAY_MS = 2000;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    // Log long-running queries (>2s)
    this.$on('query', (event) => {
      if (event.duration > 2000) {
        this.logger.warn(`⚠️ Slow query (${event.duration}ms): ${event.query}`);
      }
    });

    // Log any Prisma warnings or errors
    this.$on('warn', (event) => this.logger.warn(event.message));
    this.$on('error', (event) => this.logger.error(event.message));
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    this.logger.log('🔌 Disconnecting Prisma...');
    await this.$disconnect();
  }

  /**
   * Graceful shutdown handler for Docker/K8s/PM2
   */
  async enableShutdownHooks(): Promise<void> {
    const shutdown = async (signal: string) => {
      this.logger.log(`Received ${signal}. Cleaning up Prisma connections...`);
      await this.$disconnect();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * Retry connection with exponential backoff
   */
  private async connectWithRetry(retries = this.MAX_RETRIES): Promise<void> {
    while (retries > 0) {
      try {
        this.logger.log('🔗 Connecting to Prisma database...');
        await this.$connect();
        this.logger.log('✅ Prisma successfully connected');
        return;
      } catch (error) {
        retries--;
        this.logger.error(
          `❌ Prisma connection failed (${this.MAX_RETRIES - retries}/${this.MAX_RETRIES}): ${error.message}`,
        );
        if (retries === 0) {
          this.logger.error(
            '🚨 Could not connect to the database after multiple attempts',
          );
          throw error;
        }
        this.logger.warn(`Retrying in ${this.RETRY_DELAY_MS / 1000}s...`);
        await new Promise((resolve) =>
          setTimeout(resolve, this.RETRY_DELAY_MS),
        );
      }
    }
  }
}
