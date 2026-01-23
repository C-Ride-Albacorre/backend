// src/users/repositories/abstract-user.repository.ts

import { User } from "../entities/user.entity";

export abstract class AbstractUserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findByPhone(phone: string): Promise<User | null>;
  abstract findExistingUser(
    email?: string,
    phone?: string,
  ): Promise<User | null>;
  abstract create(userData: Partial<User>): Promise<User>;
  abstract update(id: string, userData: Partial<User>): Promise<User>;
  abstract updateRefreshTokenHash(
    id: string,
    refreshTokenHash: string | null,
  ): Promise<void>;
}
