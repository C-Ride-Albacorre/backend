import { Role, UserStatus, VendorDocument } from '@prisma/client';

export class User {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber?: string;
  country?: string;
  password: string;
  role: Role;
  refreshTokenHash?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  isVerified?: boolean;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  onboardingCompletedAt?: Date;
  verifiedAt?: Date;
  emailVerifiedAt?: Date;
  phoneVerifiedAt?: Date;
  referralCode?: string;
  referredBy?: string;
  status?: UserStatus;
  businessInfo?: BusinessInfo;
  documents?: VendorDocument[];
}

export class BusinessInfo {
  id: string;
  userId: string;
  businessName: string;
  businessType: string;
  description: string;
  logoUrl?: string;
  address: string;
  businessPhone: string;
  businessEmail: string;
  city: string;
  state: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  createdAt: Date;
  updatedAt: Date;
}

// export class VendorDocument {
//   id: string;
//   userId: string;
//   documentType: DocumentType;
//   documentUrl: string;
//   uploadedAt?: Date;
//   reviewedAt?: Date;
//   createdAt: Date;
//   updatedAt: Date;
//   status: DocumentStatus;
// }
