// src/users/repositories/abstract-user.repository.ts

import { BusinessInfo, User, VendorDocument } from "../entities/user.entity";

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
  abstract updateRefreshTokenHash(
    id: string,
    refreshTokenHash: string | null,
  ): Promise<void>;
  //////
  // Business Info
  abstract createBusinessInfo(
    businessInfo: Partial<BusinessInfo>,
  ): Promise<BusinessInfo>;
  abstract updateBusinessInfo(
    id: string,
    businessInfo: Partial<BusinessInfo>,
  ): Promise<BusinessInfo>;
  abstract findBusinessInfoByVendorId(
    vendorId: string,
  ): Promise<BusinessInfo | null>;

  // Documents
  abstract createDocument(
    document: Partial<VendorDocument>,
  ): Promise<VendorDocument>;
  abstract getVendorDocuments(vendorId: string): Promise<VendorDocument[]>;
  abstract getDocumentByType(
    vendorId: string,
    documentType: DocumentType,
  ): Promise<VendorDocument | null>;
  abstract updateDocument(
    id: string,
    document: Partial<VendorDocument>,
  ): Promise<VendorDocument>;
  abstract deleteDocument(id: string): Promise<void>;
}
