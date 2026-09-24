// src/users/repositories/abstract-user.repository.ts

// import { UserStatus } from "../../../shared/enums";
import { DocumentStatus, Prisma, VendorDocument } from '@prisma/client';
import { BusinessInfo, User } from '../entities/user.entity';
import { DocumentType } from '../../../shared/enums';

export abstract class AbstractUserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findByPhone(phoneNumber: string): Promise<User | null>;
  abstract findExistingUser(
    email?: string,
    phoneNumber?: string,
  ): Promise<User | null>;
  abstract create(userData: Partial<User>): Promise<User>;
  abstract update(id: string, userData: Partial<User>): Promise<User>;
  abstract updateVendor(
    id: string,
    userData: Prisma.UserUpdateInput,
  ): Promise<User>;
  abstract updateRefreshTokenHash(
    id: string,
    refreshTokenHash: string | null,
  ): Promise<void>;
  //////

  abstract completeVendorOnboarding(
    id: string,
    businessDetails: Partial<BusinessInfo>,
    documents?: Array<{
      documentType: DocumentType;
      documentUrl: string;
      publicId?: string;
      metadata?: any;
    }>,
  ): Promise<User>;

  // Document methods with vendor relations
  abstract createVendorDocuments(
    vendorId: string,
    documents: Array<{
      documentType: DocumentType;
      documentUrl: string;
      publicId?: string;
      metadata?: any;
      status?: DocumentStatus;
    }>,
  ): Promise<VendorDocument[]>;

  abstract getVendorWithRelations(vendorId: string): Promise<User | null>;

  /**
   * Create a vendor document record
   */
  abstract createVendorDocument(data: {
    vendorId: string;
    documentType: DocumentType;
    documentUrl: string;
    publicId: string;
    originalName: string;
    mimeType: string;
    size: number;
    description?: string;
    isVerified?: boolean;
  }): Promise<any>;

  /**
   * Find a single vendor document by vendorId and documentType
   */
  abstract findVendorDocument(params: {
    vendorId: string;
    documentType: DocumentType;
  }): Promise<VendorDocument | null>;

  /**
   * Update an existing vendor document by ID
   */
  abstract updateVendorDocument(
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
  ): Promise<VendorDocument>;

  abstract updateDriver(
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<User>;


}
