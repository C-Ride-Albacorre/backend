import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationStatus, QueryLocationDto } from './dto/query-location.dto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createLocationDto: CreateLocationDto) {
    return this.prisma.location.create({
      data: createLocationDto,
    });
  }

  async findAll(query: QueryLocationDto) {
    const { page = 1, limit = 10, search, status } = query;
    const skip = (page - 1) * limit;

    // Build the where clause
    const where: Prisma.LocationWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { state: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== LocationStatus.ALL) {
      where.isActive = status === LocationStatus.ACTIVE;
    }

    // Execute queries in parallel
    const [total, data] = await Promise.all([
      this.prisma.location.count({ where }),
      this.prisma.location.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Returns all locations without pagination.
   * @param activeOnly Optional boolean to fetch only active locations (useful for dropdowns)
   */
  async findAllUnpaginated(activeOnly: boolean = false) {
    // If activeOnly is true, filter to return only active locations
    const whereClause = activeOnly ? { isActive: true } : {};

    return this.prisma.location.findMany({
      where: whereClause,
      orderBy: {
        name: 'asc', // Alphabetical order is best practice for unpaginated lists
      },
    });
  }

  // Endpoint for the dashboard stat cards (Total, Active, Inactive)
  async getStats() {
    const [total, active, inactive] = await Promise.all([
      this.prisma.location.count(),
      this.prisma.location.count({ where: { isActive: true } }),
      this.prisma.location.count({ where: { isActive: false } }),
    ]);

    return { total, active, inactive };
  }

  async findOne(id: string) {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) {
      throw new NotFoundException(`Location with ID ${id} not found`);
    }
    return location;
  }

  async update(id: string, updateLocationDto: UpdateLocationDto) {
    await this.findOne(id); // Ensure it exists
    return this.prisma.location.update({
      where: { id },
      data: updateLocationDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Ensure it exists
    return this.prisma.location.delete({ where: { id } });
  }
}