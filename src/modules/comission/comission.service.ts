// src/commission/commission.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from 'src/shared/services/prisma.service';

@Injectable()
export class CommissionService {
  constructor(private prisma: PrismaService) {}

  // ─── CREATE ───
  async create(dto: CreateCommissionDto) {
    // Verify vendor exists & has VENDOR role
    const vendor = await this.prisma.user.findUnique({
      where: { id: dto.vendorId, role: 'VENDOR' },
    });
    if (!vendor) throw new NotFoundException(`Vendor with ID ${dto.vendorId} not found`);

    return this.prisma.commission.create({
      data: dto,
      include: {
        vendor: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  // ─── READ ALL (paginated + search) ───
  async findAll(pagination: PaginationQueryDto) {
    const { page = 1, limit = 10, search } = pagination;
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { location: { contains: search, mode: 'insensitive' as const } },
            { city: { contains: search, mode: 'insensitive' as const } },
            { vendor: { firstName: { contains: search, mode: 'insensitive' as const } } },
            { vendor: { lastName: { contains: search, mode: 'insensitive' as const } } },
            { vendor: { email: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {};

    const [total, data] = await this.prisma.$transaction([
      this.prisma.commission.count({ where }),
      this.prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          vendor: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── READ ONE ───
  async findOne(id: string) {
    const commission = await this.prisma.commission.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!commission) throw new NotFoundException(`Commission with ID ${id} not found`);
    return commission;
  }

  // ─── UPDATE ───
  async update(id: string, dto: UpdateCommissionDto) {
    await this.findOne(id); // ensure exists

    if (dto.vendorId) {
      const vendor = await this.prisma.user.findUnique({ where: { id: dto.vendorId } });
      if (!vendor) throw new NotFoundException(`Vendor with ID ${dto.vendorId} not found`);
    }

    return this.prisma.commission.update({
      where: { id },
      data: dto,
      include: {
        vendor: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  // ─── DELETE ───
  async remove(id: string) {
    await this.findOne(id); // ensure exists
    return this.prisma.commission.delete({ where: { id } });
  }

  // ─── STATS ───
  async getStats() {
    const [totalCommissions, totalActive, totalInactive, agg] = await this.prisma.$transaction([
      this.prisma.commission.count(),
      this.prisma.commission.count({ where: { status: CommissionStatus.ACTIVE } }),
      this.prisma.commission.count({ where: { status: CommissionStatus.INACTIVE } }),
      this.prisma.commission.aggregate({
        _avg: { vendorCommission: true, serviceCharge: true },
      }),
    ]);

    return {
      totalCommissions,
      totalActive,
      totalInactive,
      avgVendorCommission: Number((agg._avg.vendorCommission ?? 0).toFixed(2)),
      avgServiceCharge: Number((agg._avg.serviceCharge ?? 0).toFixed(2)),
    };
  }
}