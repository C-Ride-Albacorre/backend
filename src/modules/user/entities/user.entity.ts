import { Role } from "@prisma/client";
import { VendorStatus } from "src/shared/enums";
// import { UserRole } from "../../../shared/enums";
// import { UserRole } from "../../../shared/constants";

export class User {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  password: string;
  role: Role;
  refreshTokenHash?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  status?: VendorStatus;
  isVerified?: boolean;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  onboardingCompletedAt?: Date;
  verifiedAt?: Date;
  emailVerifiedAt?: Date;
  phoneVerifiedAt?: Date;
  referralCode?: string;
  referredBy?: string;
  businessInfo?: BusinessInfo;
  documents?: VendorDocument[];
}

export class BusinessInfo {
  id: string;
  userId: string;
  businessName: string;
  address: string;
  businessPhone: string;
  businessEmail: string;
  city: string;
  state: string;
  country: string;
  createdAt: Date;
  updatedAt: Date;
}

export class VendorDocument {
  id: string;
  userId: string;
  type: DocumentType;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}