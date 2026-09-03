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
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };

  const logger = WinstonModule.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [new winston.transports.Console()],
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bufferLogs: true,
    rawBody: true,
  });

  // ✅ Enable trust proxy (required when behind a reverse proxy like Render)
  app.set('trust proxy', 1);

  // ✅ HEAD
  app.use((req, res, next) => {
    if (req.method === 'HEAD' && req.url === '/') {
      return res.status(200).end();
    }
    next();
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
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:8081',
    'http://localhost:8082',
    'http://localhost:4000',
    'https://backend-service-1rc7.onrender.com',
    'https://c-ride.co',
    'https://joinwaitlist.c-ride.co',
    process.env.FRONTEND_URL,
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
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

  app.setGlobalPrefix('api', {
    exclude: ['/', '/health'],
  });

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
      forbidNonWhitelisted: false, //true,
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
