// src/waitlist/waitlist.service.ts
import { Injectable } from '@nestjs/common';
import { CreateVendorWaitlistDto } from './dto/create-vendor-waitlist.dto';
import { CreateDriverWaitlistDto } from './dto/create-driver-waitlist.dto';
import { PrismaService } from '../../shared/services/prisma.service';

@Injectable()
export class WaitlistService {
  constructor(private prisma: PrismaService) {}

  async addVendor(data: CreateVendorWaitlistDto) {
    return this.prisma.vendorWaitlist.create({
      data,
    });
  }

  async addDriver(data: CreateDriverWaitlistDto) {
    return this.prisma.driverWaitlist.create({
      data,
    });
  }
}