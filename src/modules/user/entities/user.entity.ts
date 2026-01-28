import { Role } from "@prisma/client";
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
  isVerified: boolean;
  verifiedAt?: Date;
  referralCode?: string;
  referredBy?: string;
}
