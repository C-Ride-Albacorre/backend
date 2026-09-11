import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateVehicleTypeConfigDto } from './dto/create-vehicle-type-config.dto';
import { UpdateVehicleTypeConfigDto } from './dto/update-vehicle-type-config.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { Prisma, VehicleType } from '@prisma/client';

@Injectable()
export class VehicleTypesService {
    constructor(private readonly prisma: PrismaService) { }

    async create(createDto: CreateVehicleTypeConfigDto) {
        const { distanceBands, name, ...configData } = createDto;

        try {
            return await this.prisma.vehicleTypeConfig.create({
                data: {
                    ...configData,
                    name: name as VehicleType,
                    distanceBands: distanceBands ? {
                        create: distanceBands,
                    } : undefined,
                },
                include: {
                    distanceBands: true,
                },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new BadRequestException('A configuration for this vehicle type and location already exists.');
            }
            throw error;
        }
    }

    async findAll(location?: string, isActive?: boolean) {
        const where: any = {};
        if (location) where.location = location;
        if (isActive !== undefined) where.isActive = isActive;

        return this.prisma.vehicleTypeConfig.findMany({
            where,
            include: {
                distanceBands: true,
            },
            orderBy: {
                displayOrder: 'asc',
            },
        });
    }

    async getDashboardStats() {
        const totalConfigurations = await this.prisma.vehicleTypeConfig.count();
        const activeCount = await this.prisma.vehicleTypeConfig.count({ where: { isActive: true } });

        // Get distinct locations covered
        const locations = await this.prisma.vehicleTypeConfig.findMany({
            select: { location: true },
            distinct: ['location'],
        });

        return {
            totalConfigurations,
            activeCount,
            locationsCovered: locations.length,
        };
    }

    async findOne(id: string) {
        const config = await this.prisma.vehicleTypeConfig.findUnique({
            where: { id },
            include: { distanceBands: true },
        });

        if (!config) {
            throw new NotFoundException(`Vehicle Type Config with ID ${id} not found`);
        }
        return config;
    }

    async update(id: string, updateDto: UpdateVehicleTypeConfigDto) {
        await this.findOne(id); // Ensure it exists

        const { distanceBands, name, ...configData } = updateDto;

        // Use a transaction to update the main record and completely replace distance bands if provided
        return this.prisma.$transaction(async (prisma) => {
            // 1. Update the main configuration
            const updatedConfig = await prisma.vehicleTypeConfig.update({
                where: { id },
                data: {
                    ...configData,
                    ...(name !== undefined ? { name: name as VehicleType } : {}),
                },
            });

            // 2. If distanceBands are provided in the update, delete old ones and insert new ones
            if (distanceBands) {
                await prisma.distanceBand.deleteMany({
                    where: { vehicleTypeConfigId: id },
                });

                if (distanceBands.length > 0) {
                    await prisma.distanceBand.createMany({
                        data: distanceBands.map((band) => ({
                            ...band,
                            vehicleTypeConfigId: id,
                        })),
                    });
                }
            }

            // 3. Return the fully updated record
            return prisma.vehicleTypeConfig.findUnique({
                where: { id },
                include: { distanceBands: true },
            });
        });
    }

    async remove(id: string) {
        await this.findOne(id); // Ensure it exists

        return this.prisma.vehicleTypeConfig.delete({
            where: { id },
        });
    }
}