import { ResponseData } from "../interfaces";
import { PrismaService } from "../../shared/services/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { MailGunService } from "../services/mailgun.service";
export interface paginationQuery {
    q?: string;
    search?: string;
    pageNumber?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    startDate?: string;
    endDate?: string;
    read?: boolean;
}
export declare function capitalizeFirstLetter(str: string): string;
export declare class Utils {
    private prisma;
    jwtService: JwtService;
    private mailGunService;
    constructor(prisma: PrismaService, jwtService: JwtService, mailGunService: MailGunService);
    static response(data: Partial<ResponseData>): ResponseData;
    static unixTimestamp(): number;
    static checkEntityExists<T>(entity: T | null, id: string, entityName: string): T;
    static generateListName(): string;
}
