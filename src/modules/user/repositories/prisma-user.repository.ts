// src/users/repositories/prisma-user.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/services/prisma.service';
import { AbstractUserRepository } from './abstract-user.repository';
import { Prisma } from '@prisma/client';
import { User } from '../entities/user.entity';

@Injectable()
export class PrismaUserRepository implements AbstractUserRepository {
  private readonly logger = new Logger(PrismaUserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({ where: { id } });
    } catch (error) {
      this.logger.error(`Failed to find user by id ${id}: ${error.message}`);
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({ where: { email } });
    } catch (error) {
      this.logger.error(
        `Failed to find user by email ${email}: ${error.message}`,
      );
      throw error;
    }
  }

  async findByPhone(phoneNumber: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({ where: { phoneNumber } });
    } catch (error) {
      this.logger.error(
        `Failed to find user by phone number ${phoneNumber}: ${error.message}`,
      );
      throw error;
    }
  }

  async findExistingUser0(email?: string, phone?: string): Promise<User | null> {
    try {
      const conditions = [];
      if (email) conditions.push({ email });
      if (phone) conditions.push({ phone });

      return await this.prisma.user.findFirst({
        where: { OR: conditions },
      });
    } catch (error) {
      this.logger.error(`Failed to find existing user: ${error.message}`);
      throw error;
    }
  }

  async findExistingUser(
  email?: string,
  phone?: string,
): Promise<User | null> {
  try {
    const conditions: any[] = [];

    if (email) conditions.push({ email });
    if (phone) conditions.push({ phone });

    if (conditions.length === 0) {
      return null;
    }

    return await this.prisma.user.findFirst({
      where: {
        OR: conditions,
      },
    });
  } catch (error) {
    this.logger.error(`Failed to find existing user: ${error.message}`);
    throw error;
  }
}


  async create(userData: Partial<User>): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: userData as Prisma.UserCreateInput,
      });
    } catch (error) {
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }
  }

  async update(id: string, userData: Partial<User>): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: userData,
      });
    } catch (error) {
      this.logger.error(`Failed to update user ${id}: ${error.message}`);
      throw error;
    }
  }

  async updateRefreshTokenHash(
    id: string,
    refreshTokenHash: string | null,
  ): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id },
        data: { refreshTokenHash, updatedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(
        `Failed to update refresh token for user ${id}: ${error.message}`,
      );
      throw error;
    }
  }
}
