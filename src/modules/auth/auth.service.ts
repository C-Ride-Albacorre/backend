import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UserService } from '../user/user.service';
import { PrismaService } from '../../shared/services/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignupDto } from './dto/signup.dto';
import { ConfigService } from '@nestjs/config';
import { MailGunService } from '../../shared/services/mailgun.service';
import * as jwt from 'jsonwebtoken';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthProviderType } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mailGunService: MailGunService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.userService.findByEmail(dto.email);
    if (existing) throw new BadRequestException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 12);
    const user = await this.userService.createUser(dto, hashed);

    // optional: send confirmation email

    return this.signJwt(user);
  }

  async validateUser(email: string, pass: string) {
    const user = await this.userService.findByEmail(email);
    if (!user || !user.password) return null;

    const match = await bcrypt.compare(pass, user.password);
    if (!match) return null;

    const { password, ...rest } = user;
    return rest;
  }

  async login(dto: LoginDto) {
    const { email, password } = dto;
    const user = await this.validateUser(email, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    return this.signJwt(user);
  }

  private signJwt(user: any) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');

    const payload = {
      email: user.email,
      sub: user.id,
      roles: user.roles || ['USER'],
    };

    const token = this.jwtService.sign(payload, {
      secret,
      expiresIn: this.config.get('JWT_EXPIRES_IN') || '3600s',
    });

    return {
      accessToken: token,
      user: { id: user.id, email: user.email, roles: user.roles },
    };
  }

  /* ---------- Forgot Password flow ---------- */

  async forgotPassword(dto: ForgotPasswordDto) {
    const { email } = dto;
    if (!email) throw new BadRequestException('Email is required');

    const user = await this.userService.findByEmail(email);
    if (!user) {
      return { ok: true }; // do not reveal if user exists
    }

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');

    const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '1d' });

    console.log('Generated reset token:', token);

    const expiresAt = new Date(
      Date.now() +
        Number(this.config.get('PASSWORD_RESET_TOKEN_EXPIRES_MIN') || 60) *
          60000,
    );

    const frontendUrl = this.config.get('FRONTEND_URL');
    if (!frontendUrl) throw new Error('FRONTEND_URL not configured');

    const resetLink = `${frontendUrl}/auth/reset-password?token=${token}`;
    const timeframe = expiresAt;
    const subject = 'Password reset';
    const context = { user: user?.name || 'there', resetLink, timeframe };
    const templateName = 'forgotPassword';

    try {
      await this.mailGunService.sendEmailWithTemplate({
        to: email,
        subject,
        templateName,
        context,
      });
    } catch (error) {
      console.error('Mail sending failed:', error);
      throw new InternalServerErrorException(
        'Failed to send password reset email',
      );
    }

    return { ok: true, message: 'Password reset email sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const { token, newPassword } = dto;
    if (!token || !newPassword) {
      throw new BadRequestException('Token and new password are required');
    }
    const decoded = this.jwtService.verify(token);
    if (!decoded || !decoded.userId) {
      throw new UnauthorizedException('Invalid token');
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.userService.updatePassword(decoded.userId, hashed);

    return 'Password successfully reset';
  }

  /* ---------- OAuth (Google) ---------- */
  async validateOAuthLogin({ provider, providerId, email, name }: any) {
    // find or create user using UsersService
    const user = await this.userService.createOrGetOAuthUser({
      provider,
      providerId,
      email,
      name,
    });

    // sign token
    return this.signJwt(user);
  }
  
  /* ---------- OAuth (Google) ---------- */
  async handleOAuthCallback(profile: any, provider: OAuthProviderType) {
    if (!profile?.email) {
      throw new BadRequestException(`${provider} account has no email`);
    }

    // Call existing helper in UserService
    const user = await this.userService.createOrGetOAuthUser({
      email: profile.email,
      name: `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim(),
      provider,
      providerId: profile.id, // Google ID
    });

    // Sign JWT (same as manual signup)
    return this.signJwt(user);
  }
}
