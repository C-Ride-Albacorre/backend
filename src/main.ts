import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as compression from 'compression';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import * as client from 'prom-client';
import * as express from 'express';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { PrismaService } from './shared/services/prisma.service';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import * as path from 'path';
import * as fs from 'fs';
import { engine } from 'express-handlebars';
import * as Handlebars from 'handlebars';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  // ================= Winston Logger Setup =================
  const logger = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, context }) => {
            return `[${timestamp}] ${level} ${context ? `[${context}]` : ''}: ${message}`;
          }),
        ),
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    ],
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger,
  });

  const appLogger = new Logger('Bootstrap');

  // ================= Security Middlewares =================
  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 mins
      max: 100, // limit each IP
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ================= Performance =================
  app.use(compression()); // Reduce response payload size

  // ================= Global Configurations =================
  app.enableCors({
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // ================= Global Exception Filter =================
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapterHost));

  // ================= Global Response Transform Interceptor =================
  app.useGlobalInterceptors(new TransformInterceptor());

  // ================= Handlebars View Engine Setup =================
  const partialsDir = path.join(__dirname, '..', 'views', 'partials');
  const layoutsDir = path.join(__dirname, '..', 'views', 'layouts');
  const viewsDir = path.join(__dirname, '..', 'views');
  const publicDir = path.join(__dirname, '..', 'public');

  if (fs.existsSync(partialsDir)) {
    fs.readdirSync(partialsDir).forEach((file) => {
      const filePath = path.join(partialsDir, file);
      const partialName = path.basename(file, '.hbs');
      const partialTemplate = fs.readFileSync(filePath, 'utf8');
      Handlebars.registerPartial(partialName, partialTemplate);
    });
    appLogger.log(`🧩 Handlebars partials loaded from: ${partialsDir}`);
  } else {
    appLogger.warn(`⚠️ Partials directory not found: ${partialsDir}`);
  }

  app.engine(
    'hbs',
    engine({
      extname: '.hbs',
      defaultLayout: false,
      layoutsDir,
      partialsDir,
    }),
  );

  app.setBaseViewsDir(viewsDir);
  app.useStaticAssets(publicDir);
  app.setViewEngine('hbs');

  // ================= Swagger Documentation =================
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Clear Essence API')
    .setDescription('API documentation for the Clear Essence backend.')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('clear-essence')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // ================= Prometheus Metrics Setup =================
  const collectDefaultMetrics = client.collectDefaultMetrics;
  collectDefaultMetrics();

  const metricsApp = express();
  metricsApp.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  });

  const metricsPort = process.env.METRICS_PORT || 9100;
  metricsApp.listen(metricsPort, () =>
    appLogger.log(
      `✅ Prometheus metrics available on: http://localhost:${metricsPort}/metrics`,
    ),
  );

  // ================= Prisma Graceful Shutdown =================
  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(); // handled via signals

  // ================= Start Application =================
  const port = process.env.PORT || 3000;
  await app.listen(port);

  appLogger.log(`🚀 Application running on: http://localhost:${port}/api`);
  appLogger.log(
    `📘 Swagger docs available at: http://localhost:${port}/api/docs`,
  );
  appLogger.log(
    `📊 Metrics available at: http://localhost:${metricsPort}/metrics`,
  );

  // ================= Graceful Exit (Optional Extra Safety) =================
  const shutdown = async (signal: string) => {
    appLogger.warn(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();
