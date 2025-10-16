import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { SignupDto } from '../auth/dto/signup.dto';
import { OAuthProviderType } from '@prisma/client';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async createUser(dto: SignupDto, hashedPassword: string) {
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
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // ✅ Automatically wrapped by TransformInterceptor
    return user;
  }

}
