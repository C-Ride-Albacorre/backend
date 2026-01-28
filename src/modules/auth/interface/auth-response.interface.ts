// import { UserRole } from '../../../shared/enums';

// import { UserRole } from "src/shared/constants";
import { Role } from "@prisma/client";

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email?: string;
    phoneNumber?: string;
    role: Role;
  };
}

export interface TokenPayload {
  sub: string;
  email?: string;
  role: Role;
  type: 'access' | 'refresh';
  jti?: string; // JWT ID for refresh tokens
  iat?: number; // Issued at (timestamp)
  exp?: number; // Expiration (timestamp)
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}