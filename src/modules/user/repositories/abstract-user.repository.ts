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

  /**
   * Complete vendor onboarding with business info and documents
   */

  // abstract completeVendorOnboarding(
  //   id: string,
  //   businessInfo: Partial<BusinessInfo>,
  // ): Promise<User>;

  // Vendor-specific methods
  // abstract createVendor(
  //   userData: CreateVendorInput
  // ): Promise<User>;
  //   abstract createVendor(userData: Partial<User>): Promise<User>;

  //   abstract updateVendorStatus(id: string, status: UserStatus): Promise<User>;
  //   abstract findVendorsWithFilters(filters: {
  //     status?: UserStatus;
  //     isVerified?: boolean;
  //     isEmailVerified?: boolean;
  //     isPhoneVerified?: boolean;
  //     skip?: number;
  //     take?: number;
  //   }): Promise<{ users: User[]; total: number }>;
  //   abstract findByIdAndRole(id: string, role: string): Promise<User | null>;

  //   // Business Info
  // abstract createBusinessInfo(
  //   businessInfo: Partial<BusinessInfo>,
  // ): Promise<BusinessInfo>;
  // abstract updateBusinessInfo(
  //   id: string,
  //   businessInfo: Partial<BusinessInfo>,
  // ): Promise<BusinessInfo>;
  // abstract findBusinessInfoByVendorId(
  //   vendorId: string,
  // ): Promise<BusinessInfo | null>;

  //   // Documents
  //   // abstract createDocument(
  //   //   document: Partial<VendorDocument>,
  //   // ): Promise<VendorDocument>;
  //   abstract createDocument(
  //   document: VendorDocument,
  // ): Promise<VendorDocument>;

  //   abstract getVendorDocuments(vendorId: string): Promise<VendorDocument[]>;
  //   abstract getDocumentByType(
  //     vendorId: string,
  //     documentType: DocumentType,
  //   ): Promise<VendorDocument | null>;
  //   abstract updateDocument(
  //     id: string,
  //     document: Partial<VendorDocument>,
  //   ): Promise<VendorDocument>;
  //   abstract deleteDocument(id: string): Promise<void>;
}
