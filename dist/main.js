"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const common_1 = require("@nestjs/common");
const core_2 = require("@nestjs/core");
const helmet_1 = require("helmet");
const express_rate_limit_1 = require("express-rate-limit");
const compression = require("compression");
const swagger_1 = require("@nestjs/swagger");
const nest_winston_1 = require("nest-winston");
const winston = require("winston");
const client = require("prom-client");
const express = require("express");
const global_exception_filter_1 = require("./common/filters/global-exception.filter");
const prisma_service_1 = require("./shared/services/prisma.service");
async function bootstrap() {
    const logger = nest_winston_1.WinstonModule.createLogger({
        transports: [
            new winston.transports.Console({
                format: winston.format.combine(winston.format.timestamp(), winston.format.colorize(), winston.format.printf(({ timestamp, level, message, context }) => {
                    return `[${timestamp}] ${level} ${context ? `[${context}]` : ''}: ${message}`;
                })),
            }),
            new winston.transports.File({
                filename: 'logs/combined.log',
                format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
            }),
        ],
    });
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        bufferLogs: true,
        logger,
    });
    const appLogger = new common_1.Logger('Bootstrap');
    app.use((0, helmet_1.default)());
    app.use((0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
    }));
    app.use(compression());
    app.enableCors({
        origin: process.env.CLIENT_URL || '*',
        credentials: true,
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    app.enableVersioning({
        type: common_1.VersioningType.URI,
        defaultVersion: '1',
    });
    const httpAdapterHost = app.get(core_2.HttpAdapterHost);
    app.useGlobalFilters(new global_exception_filter_1.GlobalExceptionFilter(httpAdapterHost));
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('Clear Essence API')
        .setDescription('API documentation for the Clear Essence backend.')
        .setVersion('1.0')
        .addBearerAuth()
        .addTag('clear-essence')
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    swagger_1.SwaggerModule.setup('api/docs', app, document, {
        swaggerOptions: { persistAuthorization: true },
    });
    const collectDefaultMetrics = client.collectDefaultMetrics;
    collectDefaultMetrics();
    const metricsApp = express();
    metricsApp.get('/metrics', async (req, res) => {
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
    });
    const metricsPort = process.env.METRICS_PORT || 9100;
    metricsApp.listen(metricsPort, () => appLogger.log(`✅ Prometheus metrics available on: http://localhost:${metricsPort}/metrics`));
    const prismaService = app.get(prisma_service_1.PrismaService);
    await prismaService.enableShutdownHooks();
    const port = process.env.PORT || 3000;
    await app.listen(port);
    appLogger.log(`🚀 Application running on: http://localhost:${port}/api`);
    appLogger.log(`📘 Swagger docs available at: http://localhost:${port}/api/docs`);
    appLogger.log(`📊 Metrics available at: http://localhost:${metricsPort}/metrics`);
    const shutdown = async (signal) => {
        appLogger.warn(`\n🛑 Received ${signal}. Shutting down gracefully...`);
        await app.close();
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}
bootstrap();
//# sourceMappingURL=main.js.map