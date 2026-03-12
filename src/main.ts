import './otel';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import * as morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import * as compression from 'compression';
import * as xss from 'xss-clean';
import * as hpp from 'hpp';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { ConfigService } from '@nestjs/config';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { setupHandlebars } from './views/bootstrap/views.bootstrap';
import * as cookieParser from 'cookie-parser';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { SuccessResponseInterceptor } from './common/filters/success-response.interceptor';

async function bootstrap() {
  const logger = WinstonModule.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [new winston.transports.Console()],
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bufferLogs: true,
  });

  const config = app.get(ConfigService);

  if (config.get('ENABLE_VIEWS') === 'true') {
    setupHandlebars(app);
  }

  // Parse cookies for OAuth role handling
  app.use(cookieParser());

  app.use(requestIdMiddleware);

  // ================= Security Middlewares =================

  app.use(helmet());

  //   // ================= Global Configurations =================
  // app.enableCors({
  //   origin: process.env.FRONTEND_URL,
  //   credentials: true,
  // });
  app.enableCors({
    origin: ['http://localhost:3000', process.env.FRONTEND_UR],
    credentials: true,
  });

  // ================= Performance =================
  app.use(compression({ threshold: 1024 })); // Reduce response payload size

  // =================  Sanitization =================
  app.use(hpp());
  app.use(xss());

  // ================= Security Middlewares =================
  app.use(
    rateLimit({
      windowMs: config.get('RATE_LIMIT_WINDOW_MS', 60000),
      max: config.get('RATE_LIMIT_MAX', 100),
    }),
  );

  // ================= Observability =================
  app.use(morgan('combined'));

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      forbidNonWhitelisted: true,
      skipMissingProperties: false,
      // Important: disable auto-validation for unknown types
      disableErrorMessages: false,
    }),
  );

  // ================= GlobalExceptionFilter =================

  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new SuccessResponseInterceptor(),
  );

  app.useGlobalFilters(new GlobalExceptionFilter(app.get(HttpAdapterHost)));

  // ================= Apply Swagger API documentation =================
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('C-RIDE API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  await app.listen(config.get('PORT', 4000));
}

bootstrap();
