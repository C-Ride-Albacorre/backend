import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { CreateCustomerDto } from '../auth/dto/signup.dto';
import { OAuthProviderType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateBusinessProfileDto } from './dto/create-business-profile.dto';
import { CloudinaryService } from '../../shared/services/cloudinary.service';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
  ) {}

  async createUser(dto: CreateCustomerDto, hashedPassword: string) {
    const emailLower = dto.email.toLowerCase();
    const user = await this.prisma.user.create({
      data: {
        email: emailLower,
        password: hashedPassword,
        name: dto.name,
        roles: ['USER'],
      },
    });
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async attachOAuthProvider(
    userId: string,
    provider: OAuthProviderType,
    providerId: string,
  ) {
    return this.prisma.oAuthProvider.create({
      data: {
        provider,
        providerId,
        user: { connect: { id: userId } },
      },
    });
  }

  async createOrGetOAuthUserold({
    email,
    name,
    provider,
    providerId,
  }: {
    email?: string;
    name?: string;
    provider: OAuthProviderType;
    providerId: string;
  }) {
    // 1. Check if OAuth provider exists
    const existing = await this.prisma.oAuthProvider.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    });

    if (existing) return existing.user;

    // 2. If user exists by email, attach OAuth provider
    if (email) {
      const userByEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (userByEmail) {
        await this.attachOAuthProvider(userByEmail.id, provider, providerId);
        return userByEmail;
      }
    }

    // 3. Create new user
    const newUser = await this.prisma.user.create({
      data: {
        email,
        name,
        roles: ['USER'],
        oauthProviders: {
          create: { provider, providerId },
        },
      },
    });

    return newUser;
  }

  async createOrGetOAuthUser({
    email,
    name,
    provider,
    providerId,
  }: {
    email?: string;
    name?: string;
    provider: OAuthProviderType;
    providerId: string;
  }) {
    // 1️⃣ Check if OAuth provider already exists (return existing user)
    const existingProvider = await this.prisma.oAuthProvider.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    });

    if (existingProvider) {
      // update user info if needed (e.g., profile name changed on Google)
      await this.prisma.user.update({
        where: { id: existingProvider.user.id },
        data: {
          name: name || existingProvider.user.name,
          updatedAt: new Date(),
        },
      });
      return existingProvider.user;
    }

    // 2️⃣ If no provider found but user exists by email, link provider to user
    if (email) {
      const userByEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (userByEmail) {
        // ensure provider is attached
        await this.attachOAuthProvider(userByEmail.id, provider, providerId);
        return userByEmail;
      }
    }

    // 3️⃣ Create a new user (first-time Google signup)
    const newUser = await this.prisma.user.create({
      data: {
        email,
        name,
        roles: ['USER'],
        oauthProviders: {
          create: { provider, providerId },
        },
      },
    });

    return newUser;
  }

  async updatePassword(userId: string, hashedPassword: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }

  /**
   * Get profile of the currently authenticated user
   * @param userId string
   * @returns user info (excluding sensitive fields)
   */
  async profile(userId: string) {
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        //profileImage: true,
        createdAt: true,
        updatedAt: true,
        oauthProviders: {
          select: {
            provider: true,
            providerId: true,
          },
        },
        businessProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async createOrUpdateProfile(
    userId: string,
    dto: CreateBusinessProfileDto,
    file?: Express.Multer.File,
  ) {
    let logoUrl: string | undefined;

    if (file) {
      const uploadResult = await this.cloudinary.uploadLogo(file);
      logoUrl = uploadResult.secure_url;
    }

    const existingProfile = await this.prisma.businessProfile.findUnique({
      where: { userId },
    });

    const data = {
      businessName: dto.businessName,
      type: dto.type,
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      address: dto.address,
      openingHours: dto.openingHours,
      shortDesc: dto.shortDescription,
      ...(logoUrl && { logoUrl }),
    };

    if (existingProfile) {
      return this.prisma.businessProfile.update({
        where: { userId },
        data,
      });
    }

    return this.prisma.businessProfile.create({
      data: { ...data, userId },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.password) {
      throw new BadRequestException(
        'Password change not allowed for OAuth users',
      );
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      throw new BadRequestException(
        'New password cannot be the same as the old password',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Password changed successfully' };
  }

  
}
