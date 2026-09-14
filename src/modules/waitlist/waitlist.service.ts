// src/waitlist/waitlist.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateVendorWaitlistDto } from './dto/create-vendor-waitlist.dto';
import { CreateDriverWaitlistDto } from './dto/create-driver-waitlist.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { CreateCustomerWaitlistDto } from './dto/create-customer-waitlist.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';

@Injectable()
export class WaitlistService {
    constructor(private prisma: PrismaService) { }

    async addVendor(data: CreateVendorWaitlistDto) {
        return this.prisma.vendorWaitlist.create({
            data,
        });
    }

    async getVendors(pagination: PaginationQueryDto) {
        const { page = 1, limit = 10, search } = pagination;
        const skip = (page - 1) * limit;

        const where = search
            ? {
                OR: [
                    { name: { contains: search, mode: 'insensitive' as const } },
                    { businessName: { contains: search, mode: 'insensitive' as const } },
                    { workEmail: { contains: search, mode: 'insensitive' as const } },
                    { businessType: { contains: search, mode: 'insensitive' as const } },
                    { phoneNumber: { contains: search, mode: 'insensitive' as const } },
                    { businessAddress: { contains: search, mode: 'insensitive' as const } },
                ],
            }
            : {};

        const [total, data] = await this.prisma.$transaction([
            this.prisma.vendorWaitlist.count({ where }),
            this.prisma.vendorWaitlist.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        return {
            data,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }

    async getVendorById(id: string) {
        const vendor = await this.prisma.vendorWaitlist.findUnique({ where: { id } });
        if (!vendor) throw new NotFoundException(`Vendor with ID ${id} not found`);
        return vendor;
    }

    async addDriver(data: CreateDriverWaitlistDto) {
        return this.prisma.driverWaitlist.create({
            data,
        });
    }


    async getDrivers(pagination: PaginationQueryDto) {
        const { page = 1, limit = 10, search } = pagination;
        const skip = (page - 1) * limit;

        const where = search
            ? {
                OR: [
                    { fullName: { contains: search, mode: 'insensitive' as const } },
                    { email: { contains: search, mode: 'insensitive' as const } },
                    { phoneNumber: { contains: search, mode: 'insensitive' as const } },
                    { city: { contains: search, mode: 'insensitive' as const } },
                    { vehicleType: { contains: search, mode: 'insensitive' as const } },
                    // vehicleYear is an Int – we could add an exact match if numeric
                    ...(/^\d+$/.test(search) ? [{ vehicleYear: Number(search) }] : []),
                ],
            }
            : {};

        const [total, data] = await this.prisma.$transaction([
            this.prisma.driverWaitlist.count({ where }),
            this.prisma.driverWaitlist.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        return {
            data,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }

    async getDriverById(id: string) {
        const driver = await this.prisma.driverWaitlist.findUnique({ where: { id } });
        if (!driver) throw new NotFoundException(`Driver with ID ${id} not found`);
        return driver;
    }

    async addCustomer(data: CreateCustomerWaitlistDto) {
        return this.prisma.customerWaitlist.create({ data });
    }


    async getCustomers(pagination: PaginationQueryDto) {
        const { page = 1, limit = 10, search } = pagination;
        const skip = (page - 1) * limit;

        const where = search
            ? {
                OR: [
                    { fullName: { contains: search, mode: 'insensitive' as const } },
                    { email: { contains: search, mode: 'insensitive' as const } },
                    { phoneNumber: { contains: search, mode: 'insensitive' as const } },
                    { city: { contains: search, mode: 'insensitive' as const } },
                    { orderCategory: { contains: search, mode: 'insensitive' as const } },
                    { purpose: { contains: search, mode: 'insensitive' as const } },
                ],
            }
            : {};

        const [total, data] = await this.prisma.$transaction([
            this.prisma.customerWaitlist.count({ where }),
            this.prisma.customerWaitlist.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        return {
            data,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }


    async getCustomerById(id: string) {
        const customer = await this.prisma.customerWaitlist.findUnique({ where: { id } });
        if (!customer) throw new NotFoundException(`Customer with ID ${id} not found`);
        return customer;
    }



    // ═══ STATS ═══
    async getStats() {
        const [totalVendors, totalDrivers, totalCustomers] = await this.prisma.$transaction([
            this.prisma.vendorWaitlist.count(),
            this.prisma.driverWaitlist.count(),
            this.prisma.customerWaitlist.count(),
        ]);

        return {
            totalVendors,
            totalDrivers,
            totalCustomers,
            total: totalVendors + totalDrivers + totalCustomers,
        };
    }

}