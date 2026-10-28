import { Injectable } from '@nestjs/common';
import { Prisma, VehicleType } from '@prisma/client';
import { VehicleTypeConfigOptionDto } from './dto/vehicle-type-config-response.dto';
import { PrismaService } from '../../shared/services/prisma.service';

@Injectable()
export class VehicleTypeService {
  constructor(private readonly prisma: PrismaService) {}


  async getActiveConfigs(
    location?: string,
  ): Promise<VehicleTypeConfigOptionDto[]> {
    const where: Prisma.VehicleTypeConfigWhereInput = { isActive: true };
    if (location) where.location = location;

    const configs = await this.prisma.vehicleTypeConfig.findMany({
      where,
      select: { id: true, name: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    return configs.map((c) => ({
      id: c.id,
      name: c.name,
    }));
  }
}