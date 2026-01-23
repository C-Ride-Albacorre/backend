import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ConfigService } from '@nestjs/config';
import { MailGunService } from '../../shared/services/mailgun.service';
import * as jwt from 'jsonwebtoken';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { OAuthProviderType } from '@prisma/client';
import Helper from '../../shared/utils/helpers';
import {
  AuthResponse,
  TokenPayload,
} from './interface/auth-response.interface';
import { User } from '../user/entities/user.entity';
import { UserRole } from 'src/shared/enums';
import { randomBytes } from 'crypto';
import { StringValue } from 'ms';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshTokenSecret: string;
  private readonly accessTokenExpiresIn: string;
  private readonly refreshTokenExpiresIn: string;
  private readonly refreshTokenRotationEnabled: boolean;
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mailGunService: MailGunService,
  ) {
    this.refreshTokenSecret = this.config.get<string>('REFRESH_TOKEN_SECRET');
    this.accessTokenExpiresIn =
      this.config.get<string>('JWT_EXPIRES_IN') || '3600s';
    this.refreshTokenExpiresIn =
      this.config.get<string>('REFRESH_TOKEN_EXPIRES_IN') || '7d';
    this.refreshTokenRotationEnabled =
      this.config.get<boolean>('REFRESH_TOKEN_ROTATION_ENABLED') || false;
  }

  async registerCustomer(dto: CreateCustomerDto) {
    const { email, phoneNumber, firstName, lastName, password } = dto;
    this.logger.log(`Registering customer: ${email || phoneNumber}`);

    const user = await this.userService.createCustomer({
      email: email,
      phoneNumber: phoneNumber,
      password: password,
      firstName: firstName,
      lastName: lastName,
    });

    return this.generateAuthResponse(user);
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto): Promise<AuthResponse> {
    const { refreshToken } = refreshTokenDto;

    try {
      // Verify the refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.refreshTokenSecret,
      });

      const user = await this.userService.findById(payload.sub);

      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      // If rotation is enabled, verify stored hash
      if (this.refreshTokenRotationEnabled && user.refreshTokenHash) {
        const isValid = await bcrypt.compare(
          refreshToken,
          user.refreshTokenHash,
        );
        if (!isValid) {
          this.logger.warn(`Invalid refresh token used for user: ${user.id}`);
          // Invalidate all refresh tokens for this user (potential token theft)
          await this.userService.updateRefreshToken(user.id, null);
          throw new UnauthorizedException('Invalid refresh token');
        }
      }

      // Generate new tokens
      const newTokens = await this.generateAuthResponse(user);

      // Invalidate old refresh token if rotation is enabled
      if (this.refreshTokenRotationEnabled) {
        await this.rotateRefreshToken(
          user.id,
          refreshToken,
          newTokens.refreshToken,
        );
      }

      this.logger.log(`Tokens refreshed for user: ${user.id}`);
      return newTokens;
    } catch (error) {
      this.logger.error(`Token refresh failed: ${error.message}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    this.logger.log(`Logging out user: ${userId}`);
    await this.userService.updateRefreshToken(userId, null);
  }

  private async generateAuthResponse(user: User): Promise<AuthResponse> {
    const tokens = await this.generateTokens(user);

    // Hash and store refresh token if rotation is enabled
    if (this.refreshTokenRotationEnabled) {
      const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
      await this.userService.updateRefreshToken(user.id, refreshTokenHash);
    }

    await this.userService.markUserLogin(user.id);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        role: UserRole.CUSTOMER,
      },
    };
  }

  private async generateTokens(user: User) {
    const accessTokenPayload = this.createAccessTokenPayload(user);
    const refreshTokenPayload = this.createRefreshTokenPayload(user);

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessTokenPayload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.accessTokenExpiresIn as number | StringValue,
      }),
      this.jwtService.signAsync(refreshTokenPayload, {
        secret: this.refreshTokenSecret,
        expiresIn: this.refreshTokenExpiresIn as number | StringValue,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private createAccessTokenPayload(user: User): TokenPayload {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
  }

  private createRefreshTokenPayload(user: User): TokenPayload {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'refresh',
      jti: randomBytes(16).toString('hex'), // Unique token identifier
    };
  }

  private async rotateRefreshToken(
    userId: string,
    oldRefreshToken: string,
    newRefreshToken: string,
  ): Promise<void> {
    // Store old token in blacklist or database for short period
    // This prevents replay attacks
    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 12);
    await this.userService.updateRefreshToken(userId, newRefreshTokenHash);

    // Optional: Store old token hash in blacklist
    this.logger.log(`Refresh token rotated for user: ${userId}`);
  }

  ////////////////////////////////////////////////////

  async createCustomer(dto: CreateCustomerDto) {
    const { email, password } = dto;
    const existing = await this.userService.findByEmail(email);
    if (existing) throw new BadRequestException('Email already in use');
    const hashedPassword = await Helper.hashText(password);

    const user = await this.userService.createUser(dto, hashedPassword);
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
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: this.config.get('JWT_EXPIRES_IN') || '3600s',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: '7d',
    });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
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
    const context = {
      user: user?.firstName + ' ' + user?.lastName || 'there',
      resetLink,
      timeframe,
    };
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
      firstName: name?.firstName,
      lastName: name?.lastName,
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
      firstName: profile.firstName,
      lastName: profile.lastName,
      provider,
      providerId: profile.id, // Google ID
    });

    // Sign JWT (same as manual signup)
    return this.signJwt(user);
  }
}
