// import { UserRole } from '../../../shared/enums';

// import { UserRole } from "src/shared/constants";
import { Role } from '@prisma/client';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  identifier: string;
  verificationMethod: 'email' | 'phone';
  user: {
    id: string;
    email?: string;
    phoneNumber?: string;
    role: Role;
    isNewUser?: boolean;
  };
}

// export interface TokenPayload {
export interface TokenPayload {
  sub: string;
  email?: string;
  role: Role;
  type: 'access' | 'refresh';
  jti?: string; // JWT ID for refresh tokens
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}
