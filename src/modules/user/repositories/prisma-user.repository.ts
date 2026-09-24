import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/services/prisma.service';
import { AbstractUserRepository } from './abstract-user.repository';
import { DocumentStatus, Prisma, VendorDocument } from '@prisma/client';
import { BusinessInfo, User } from '../entities/user.entity';
import { DocumentType } from '../../../shared/enums';

@Injectable()
export class PrismaUserRepository implements AbstractUserRepository {
  private readonly logger = new Logger(PrismaUserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({ where: { id } });
    } catch (error) {
      this.logger.error(`Failed to find user by id ${id}: ${error}`);
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({ where: { email } });
    } catch (error) {
      this.logger.error(
        `Failed to find user by email ${email}: ${error}`,
      );
      throw error;
    }
  }

  async findByPhone(phoneNumber: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({ where: { phoneNumber } });
    } catch (error) {
      this.logger.error(
        `Failed to find user by phone number ${phoneNumber}: ${error}`,
      );
      throw error;
    }
  }

  async findExistingUser0(
    email?: string,
    phone?: string,
  ): Promise<User | null> {
    try {
      const conditions = [];
      if (email) conditions.push({ email });
      if (phone) conditions.push({ phone });

      return await this.prisma.user.findFirst({
        where: { OR: conditions },
      });
    } catch (error) {
      this.logger.error(`Failed to find existing user: ${error}`);
      throw error;
    }
  }

  async findExistingUser(
    email?: string,
    phoneNumber?: string,
  ): Promise<User | null> {
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
      });
    } catch (error) {
      this.logger.error(`Failed to find existing user: ${error}`);
      throw error;
    }
  }

  async create(userData: Partial<User>): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: userData as Prisma.UserCreateInput,
      });
    } catch (error) {
      this.logger.error(`Failed to create user: ${error}`);
      throw error;
    }
  }

  async update(id: string, userData: Partial<User>): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: userData as Prisma.UserCreateInput,
        include: {
          businessInfo: true,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to update user ${id}: ${error}`);
      throw error;
    }
  }


  async updateVendor(
    id: string,
    userData: Prisma.UserUpdateInput,
  ): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: userData,
        include: {
          businessInfo: true,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to update user ${id}: ${error}`);
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
        `Failed to update refresh token for user ${id}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Create multiple vendor documents at once
   */
  async createVendorDocuments(
    vendorId: string,
    documents: Array<{
      documentType: DocumentType;
      documentUrl: string;
      publicId?: string;
      metadata?: any;
      status?: DocumentStatus;
    }>,
  ): Promise<VendorDocument[]> {
    try {
      const createdDocuments = await Promise.all(
        documents.map((doc) =>
          this.prisma.vendorDocument.create({
            data: {
              user: {
                connect: { id: vendorId },
              },
              documentType: doc.documentType,
              documentUrl: doc.documentUrl,
              publicId: doc.publicId,
              metadata: doc.metadata || {},
              status: doc.status || 'PENDING',
              uploadedAt: new Date(),
            } as Prisma.VendorDocumentCreateInput,
          }),
        ),
      );

      return createdDocuments;
    } catch (error) {
      this.logger.error(`Failed to create vendor documents: ${error}`);
      throw error;
    }
  }

  /**
   * Update an existing vendor document by its ID
   */
  async updateVendorDocument(
    documentId: string,
    data: Partial<{
      documentUrl: string;
      publicId: string;
      originalName: string;
      mimeType: string;
      size: number;
      description?: string;
      isVerified?: boolean;
      updatedAt?: Date;
    }>,
  ): Promise<VendorDocument> {
    try {
      return await this.prisma.vendorDocument.update({
        where: { id: documentId },
        data: {
          ...data,
          updatedAt: data.updatedAt || new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to update vendor document ${documentId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Find a single vendor document by vendorId + documentType
   */
  async findVendorDocument(params: {
    vendorId: string;
    documentType: DocumentType;
  }): Promise<VendorDocument | null> {
    try {
      return await this.prisma.vendorDocument.findFirst({
        where: {
          userId: params.vendorId,
          documentType: params.documentType,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to find vendor document for ${params.vendorId} (${params.documentType}): ${error}`,
      );
      throw error;
    }
  }

  /**
   * Get vendor with all relations (business info and documents)
   */
  async getVendorWithRelations(vendorId: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { id: vendorId },
        include: {
          businessInfo: true,
          documents: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get vendor with relations: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Complete vendor onboarding with business details and documents
   */
  async completeVendorOnboarding(
    id: string,
    businessDetails: Partial<BusinessInfo>,
    documents?: Array<{
      documentType: DocumentType;
      documentUrl: string;
      publicId?: string;
      metadata?: any;
    }>,
  ): Promise<User> {
    try {
      // Use transaction to ensure data consistency
      return await this.prisma.$transaction(async (prisma) => {
        // Update vendor status and onboarding timestamp
        await prisma.user.update({
          where: { id },
          data: {
            status: 'ACTIVE',
            onboardingCompletedAt: new Date(),
            updatedAt: new Date(),
          },
        });

        // Create or update business info
        await prisma.businessInfo.upsert({
          where: { userId: id },
          update: {
            ...businessDetails,
            updatedAt: new Date(),
          },
          create: {
            ...businessDetails,
            user: { connect: { id } },
          } as Prisma.BusinessInfoCreateInput,
        });

        // Create documents if provided
        if (documents && documents.length > 0) {
          await Promise.all(
            documents.map((doc) =>
              prisma.vendorDocument.create({
                data: {
                  documentType: doc.documentType,
                  documentUrl: doc.documentUrl,
                  metadata: doc.metadata ?? null,
                  status: 'PENDING',
                  uploadedAt: new Date(),
                  user: { connect: { id } },
                },
              }),
            ),
          );
        }

        // Return updated user with all relations
        return await prisma.user.findUnique({
          where: { id },
          include: {
            businessInfo: true,
            documents: {
              orderBy: { createdAt: 'desc' },
            },
          },
        });
      });
    } catch (error) {
      this.logger.error(
        `Failed to complete vendor onboarding: ${error}`,
      );
      throw error;
    }
  }

  async createVendorDocument(data: {
    vendorId: string;
    documentType: DocumentType;
    documentUrl: string;
    publicId: string;
    originalName: string;
    mimeType: string;
    size: number;
    description?: string;
    isVerified?: boolean;
  }): Promise<any> {
    return this.prisma.vendorDocument.create({
      data: {
        userId: data.vendorId,
        documentType: data.documentType,
        documentUrl: data.documentUrl,
      },
    });
  }

  async updateDriver(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

}
