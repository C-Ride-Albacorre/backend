// src/users/repositories/prisma-user.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/services/prisma.service';
import { AbstractUserRepository } from './abstract-user.repository';
// import { Prisma } from '@prisma/client';
import { Prisma, User as PrismaUser } from '@prisma/client';

import { User, BusinessInfo, VendorDocument } from '../entities/user.entity';
import { DocumentType } from '../../../shared/enums';

export type CreateUserInput = {
  user: Prisma.UserCreateInput;
  businessInfo?: Prisma.BusinessInfoCreateInput;
  documents?: Prisma.VendorDocumentCreateInput[];
};

@Injectable()
export class PrismaUserRepository implements AbstractUserRepository {
  private readonly logger = new Logger(PrismaUserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // Basic User Methods
  async findById(id: string): Promise<PrismaUser | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { id },
        include: {
          businessInfo: true,
          documents: true,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to find user by id ${id}: ${error.message}`);
      throw error;
    }
  }

  async findByEmail(email: string): Promise<PrismaUser | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { email },
        include: {
          businessInfo: true,
          documents: true,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to find user by email ${email}: ${error.message}`,
      );
      throw error;
    }
  }

  async findByPhone(phoneNumber: string): Promise<PrismaUser | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { phoneNumber },
        include: {
          businessInfo: true,
          documents: true,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to find user by phone number ${phoneNumber}: ${error.message}`,
      );
      throw error;
    }
  }

  async findExistingUser(
    email?: string,
    phoneNumber?: string,
  ): Promise<PrismaUser | null> {
    try {
      const conditions: any[] = [];

      if (email) conditions.push({ email });
      if (phoneNumber) conditions.push({ phoneNumber });

      if (conditions.length === 0) {
        return null;
      }

      return await this.prisma.user.findFirst({
        where: {
          OR: conditions,
        },
        include: {
          businessInfo: true,
          documents: true,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to find existing user: ${error.message}`);
      throw error;
    }
  }

  async create(userData: CreateUserInput): Promise<User> {
    try {
      // Separate businessInfo and documents from user data
      const { businessInfo, documents, ...userFields } = userData;

      const user = await this.prisma.user.create({
        data: userFields as Prisma.UserCreateInput,
      });

      // Create business info if provided
      if (businessInfo) {
        await this.prisma.businessInfo.create({
          data: {
            ...businessInfo,
            vendorId: user.id,
          } as Prisma.BusinessInfoCreateInput,
        });
      }

      // Create documents if provided
      if (documents && Array.isArray(documents)) {
        await Promise.all(
          documents.map((doc) =>
            this.prisma.vendorDocument.create({
              data: {
                ...doc,
                vendorId: user.id,
              } as Prisma.VendorDocumentCreateInput,
            }),
          ),
        );
      }

      // Return user with relations
      return await this.findById(user.id);
    } catch (error) {
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }
  }

  async update(id: string, userData: Partial<PrismaUser>): Promise<PrismaUser> {
    try {
      // Separate businessInfo from user data
      const { businessInfo, ...userFields } = userData;

      // Update user
      const user = await this.prisma.user.update({
        where: { id },
        data: userFields,
      });

      // Update business info if provided
      if (businessInfo) {
        await this.prisma.businessInfo.upsert({
          where: { userId: id },
          update: businessInfo,
          create: {
            ...businessInfo,
            vendorId: id,
          } as Prisma.BusinessInfoCreateInput,
        });
      }

      return await this.findById(id);
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

  // Business Info Methods
  async createBusinessInfo(
    businessInfo: Partial<BusinessInfo>,
  ): Promise<BusinessInfo> {
    try {
      return await this.prisma.businessInfo.create({
        data: businessInfo as Prisma.BusinessInfoCreateInput,
      });
    } catch (error) {
      this.logger.error(`Failed to create business info: ${error.message}`);
      throw error;
    }
  }

  async updateBusinessInfo(
    id: string,
    businessInfo: Partial<BusinessInfo>,
  ): Promise<BusinessInfo> {
    try {
      return await this.prisma.businessInfo.update({
        where: { id },
        data: businessInfo,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update business info ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  async findBusinessInfoByVendorId(
    vendorId: string,
  ): Promise<BusinessInfo | null> {
    try {
      return await this.prisma.businessInfo.findUnique({
        where: { vendorId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to find business info for vendor ${vendorId}: ${error.message}`,
      );
      throw error;
    }
  }

  // Document Methods
  async createDocument(
    document: Partial<VendorDocument>,
  ): Promise<VendorDocument> {
    try {
      return await this.prisma.vendorDocument.create({
        data: document as Prisma.VendorDocumentCreateInput,
      });
    } catch (error) {
      this.logger.error(`Failed to create document: ${error.message}`);
      throw error;
    }
  }

  async getVendorDocuments(vendorId: string): Promise<VendorDocument[]> {
    try {
      return await this.prisma.vendorDocument.findMany({
        where: { vendorId },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get documents for vendor ${vendorId}: ${error.message}`,
      );
      throw error;
    }
  }

  async getDocumentByType(
    vendorId: string,
    documentType: DocumentType,
  ): Promise<VendorDocument | null> {
    try {
      return await this.prisma.vendorDocument.findFirst({
        where: {
          vendorId,
          documentType,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get document by type for vendor ${vendorId}: ${error.message}`,
      );
      throw error;
    }
  }

  async updateDocument(
    id: string,
    document: Partial<VendorDocument>,
  ): Promise<VendorDocument> {
    try {
      return await this.prisma.vendorDocument.update({
        where: { id },
        data: document,
      });
    } catch (error) {
      this.logger.error(`Failed to update document ${id}: ${error.message}`);
      throw error;
    }
  }

  async deleteDocument(id: string): Promise<void> {
    try {
      await this.prisma.vendorDocument.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Failed to delete document ${id}: ${error.message}`);
      throw error;
    }
  }

  // Additional helper methods
  async findByIdAndRole(id: string, role: string): Promise<User | null> {
    try {
      return await this.prisma.user.findFirst({
        where: {
          id,
          //role,
        },
        include: {
          businessInfo: true,
          documents: true,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to find user by id and role ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  async findVendorsWithFilters(filters: {
    status?: string;
    isVerified?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{ users: User[]; total: number }> {
    try {
      const where: any = { role: 'VENDOR' };

      if (filters.status) where.status = filters.status;
      if (filters.isVerified !== undefined)
        where.isVerified = filters.isVerified;

      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          include: {
            businessInfo: true,
            documents: true,
          },
          skip: filters.skip || 0,
          take: filters.take || 10,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.user.count({ where }),
      ]);

      return { users, total };
    } catch (error) {
      this.logger.error(
        `Failed to find vendors with filters: ${error.message}`,
      );
      throw error;
    }
  }
}
