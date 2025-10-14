import { Cache } from "cache-manager";
import { PrismaService } from "./prisma.service";
export declare class GoogleService {
    private cacheManager;
    private prisma;
    private oauth2Client;
    private callbackPath;
    private googleRedirectUrl;
    constructor(cacheManager: Cache, prisma: PrismaService);
    getConsentUrl(state: string): string;
}
