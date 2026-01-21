import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '../../shared/services/prisma.service';
import { CacheService, CacheHealth } from '../../shared/services/cache.service';
import { ApiTags } from '@nestjs/swagger';

export interface HealthCheckResponse {
  status: string;
  info?: {
    timestamp: string;
    uptime: number;
    memory: NodeJS.MemoryUsage;
    environment: string;
    [key: string]: any; // Allow additional properties
  };
  details?: Record<string, any>;
  error?: string;
  metrics?: {
    databaseLatency?: number;
    cacheLatency?: number;
  };
}

@ApiTags('Health Check')
@Controller('health')
export class HealthController {
  private readonly startupTime: Date;

  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {
    this.startupTime = new Date();
  }

  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResponse> {
    let databaseLatency: number | undefined;
    let cacheLatency: number | undefined;

    const healthChecks = [
      // Database health check
      async (): Promise<HealthIndicatorResult> => {
        try {
          const start = Date.now();
          await this.prisma.$queryRaw`SELECT 1`;
          const end = Date.now();
          databaseLatency = end - start;

          return {
            database: {
              status: 'up',
              latency: `${databaseLatency}ms`,
              details: {
                connection: 'established',
                timestamp: new Date().toISOString(),
              },
            },
          };
        } catch (error) {
          return {
            database: {
              status: 'down',
              message: error.message,
              error: error.name,
              timestamp: new Date().toISOString(),
            },
          };
        }
      },

      // Cache health check
      async (): Promise<HealthIndicatorResult> => {
        try {
          const cacheHealth = await this.cacheService.checkHealth();
          cacheLatency = cacheHealth.latency;

          if (cacheHealth.status === 'healthy') {
            return {
              cache: {
                status: 'up',
                latency: `${cacheHealth.latency}ms`,
                details: {
                  connection: 'established',
                  timestamp: new Date().toISOString(),
                },
              },
            };
          }

          return {
            cache: {
              status: 'down',
              message: cacheHealth.error || 'Cache health check failed',
              timestamp: new Date().toISOString(),
            },
          };
        } catch (error) {
          return {
            cache: {
              status: 'down',
              message: error.message,
              error: error.name,
              timestamp: new Date().toISOString(),
            },
          };
        }
      },

      // Memory health check
      async (): Promise<HealthIndicatorResult> => {
        const memory = process.memoryUsage();
        const memoryUsage = {
          heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
          rss: Math.round(memory.rss / 1024 / 1024),
          external: Math.round(memory.external / 1024 / 1024),
        };

        // Warning if heap usage exceeds 80%
        const heapUsagePercentage = (memory.heapUsed / memory.heapTotal) * 100;
        const status: 'up' | 'down' = heapUsagePercentage > 80 ? 'down' : 'up';

        return {
          memory: {
            status,
            usage: memoryUsage,
            percentage: `${Math.round(heapUsagePercentage)}%`,
            details: {
              warning:
                heapUsagePercentage > 80
                  ? 'High memory usage detected'
                  : undefined,
            },
          },
        };
      },

      // Disk storage health check
      async (): Promise<HealthIndicatorResult> => {
        try {
          const fs = await import('fs/promises');
          const path = await import('path');

          const testFilePath = path.join(process.cwd(), 'health-test.tmp');

          const testData = `Health check at ${new Date().toISOString()}`;

          await fs.writeFile(testFilePath, testData);
          const readData = await fs.readFile(testFilePath, 'utf8');
          await fs.unlink(testFilePath);

          const isValid = readData === testData;

          return {
            storage: {
              status: isValid ? 'up' : 'down',
              details: {
                writable: true,
                readable: true,
                timestamp: new Date().toISOString(),
              },
            },
          };
        } catch (error) {
          return {
            storage: {
              status: 'down',
              message: error.message,
              error: error.name,
              timestamp: new Date().toISOString(),
            },
          };
        }
      },
    ];

    // Execute health checks
    const result = await this.health.check(healthChecks);

    // Add additional info and metrics
    const response: HealthCheckResponse = {
      ...result,
      error: result.error ? JSON.stringify(result.error) : undefined,
      info: {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development',
      },
      metrics: {
        databaseLatency,
        cacheLatency,
      },
    };

    return response;
  }

  @Get('readiness')
  async readiness(): Promise<{ status: string; services: any }> {
    const checks = [];

    // Database readiness
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.push({ database: 'ready' });
    } catch (error) {
      checks.push({ database: 'not_ready', error: error.message });
    }

    // Cache readiness
    const cacheHealth = await this.cacheService.checkHealth();
    checks.push({
      cache: cacheHealth.status === 'healthy' ? 'ready' : 'not_ready',
      latency: cacheHealth.latency,
    });

    const allReady = checks.every(
      (check) => Object.values(check)[0] === 'ready',
    );

    return {
      status: allReady ? 'ready' : 'not_ready',
      services: checks,
    };
  }

  @Get('liveness')
  liveness(): { status: string; timestamp: string; uptime: number } {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('detailed')
  async detailed(): Promise<HealthCheckResponse> {
    const basicHealth = await this.check();

    // Add additional detailed information
    const detailedHealth: HealthCheckResponse = {
      ...basicHealth,
      info: {
        ...basicHealth.info,
        nodeVersion: process.version,
        platform: process.platform,
        startupTime: this.startupTime.toISOString(),
        pid: process.pid,
      },
    };

    return detailedHealth;
  }

  @Get('cache')
  async cacheHealth(): Promise<{
    status: string;
    health: CacheHealth;
    connection: boolean;
    stats: any;
  }> {
    const health = await this.cacheService.checkHealth();
    const stats = await this.cacheService.getStats();

    return {
      status: health.status,
      health,
      connection: this.cacheService.getConnectionStatus(),
      stats,
    };
  }

  @Get('database')
  async databaseHealth(): Promise<{
    status: string;
    latency?: number;
    error?: string;
  }> {
    try {
      const start = Date.now();
      const result = await this.prisma.$queryRaw`SELECT 1, NOW() as time`;
      const latency = Date.now() - start;

      return {
        status: 'up',
        latency,
      };
    } catch (error) {
      return {
        status: 'down',
        error: error.message,
      };
    }
  }
}