"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PrismaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
let PrismaService = PrismaService_1 = class PrismaService extends client_1.PrismaClient {
    constructor() {
        super({
            log: [
                { emit: 'event', level: 'query' },
                { emit: 'event', level: 'error' },
                { emit: 'event', level: 'warn' },
            ],
        });
        this.logger = new common_1.Logger(PrismaService_1.name);
        this.MAX_RETRIES = 5;
        this.RETRY_DELAY_MS = 2000;
        this.$on('query', (event) => {
            if (event.duration > 2000) {
                this.logger.warn(`⚠️ Slow query (${event.duration}ms): ${event.query}`);
            }
        });
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
    async enableShutdownHooks() {
        const shutdown = async (signal) => {
            this.logger.log(`Received ${signal}. Cleaning up Prisma connections...`);
            await this.$disconnect();
            process.exit(0);
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }
    async connectWithRetry(retries = this.MAX_RETRIES) {
        while (retries > 0) {
            try {
                this.logger.log('🔗 Connecting to Prisma database...');
                await this.$connect();
                this.logger.log('✅ Prisma successfully connected');
                return;
            }
            catch (error) {
                retries--;
                this.logger.error(`❌ Prisma connection failed (${this.MAX_RETRIES - retries}/${this.MAX_RETRIES}): ${error.message}`);
                if (retries === 0) {
                    this.logger.error('🚨 Could not connect to the database after multiple attempts');
                    throw error;
                }
                this.logger.warn(`Retrying in ${this.RETRY_DELAY_MS / 1000}s...`);
                await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY_MS));
            }
        }
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = PrismaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map