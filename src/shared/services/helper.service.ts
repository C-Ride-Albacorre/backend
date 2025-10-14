import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class HelperService {
    constructor(private prisma: PrismaService,){}

}