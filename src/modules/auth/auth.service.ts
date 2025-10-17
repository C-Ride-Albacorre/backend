import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { UserService } from '../user/user.service';
import { PrismaService } from '../../shared/services/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignupDto } from './dto/signup.dto';
import { ConfigService } from '@nestjs/config';
import { MailGunService } from '../../shared/services/mailgun.service';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private prisma: PrismaService,
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
    // strip password before return
    const { password, ...rest } = user as any;
    return rest;
  }

  async login(user: any) {
    // expects validated user (or result from validateUser)
    return this.signJwt(user);
  }

  private signJwt(user: any) {
    const payload = {
      email: user.email,
      sub: user.id,
      roles: user.roles || ['USER'],
    };
    const token = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN') || '3600s',
    });
    return {
      accessToken: token,
      user: { id: user.id, email: user.email, roles: user.roles },
    };
  }

  /* ---------- Forgot Password flow ---------- */
  async forgotPassword(email: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      // do not reveal whether user exists — respond success anyway
      return { ok: true };
    }

    // const token = uuidv4();
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    const expiresAt = new Date(
      Date.now() +
        Number(this.config.get('PASSWORD_RESET_TOKEN_EXPIRES_MIN') || 60) *
          60000,
    );

    // send email with frontend reset link
    const frontendUrl = this.config.get('FRONTEND_URL');
    const resetLink = `${frontendUrl}/auth/reset-password?token=${token}`;

    // await this.mailGunService.sendMail({
    //   to: user.email,
    //   subject: 'Password reset',
    //   text: `Use this link to reset your password: ${resetLink}`,
    //   html: `<p>Click <a href="${resetLink}">here</a> to reset your password. The link expires in ${this.config.get('PASSWORD_RESET_TOKEN_EXPIRES_MIN') || 60} minutes.</p>`,
    // });
    const timeframe = expiresAt;
    const subject = 'Password reset';
    const context = { user: user?.name || 'there', resetLink, timeframe };
    const templateName = 'forgotPassword';
    await this.mailGunService.sendEmailWithTemplate({
      to: email,
      subject,
      templateName,
      context,
    });

    return 'Password reset email sent'; //{ ok: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const decoded = this.jwtService.verify(token);
    if (!decoded || !decoded.userId) {
      throw new UnauthorizedException('Invalid token');
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.userService.updatePassword(decoded.userId, hashed);

    return 'Password successfully reset'; 
  }
  

  /* ---------- OAuth (Google) ---------- */
  async validateOAuthLogin({
    provider,
    providerId,
    email,
    name,
  }: any) {
    // find or create user using UsersService
    const user = await this.userService.createOrGetOAuthUser({
      provider,
      providerId,
      email,
      name
    });

    // sign token
    return this.signJwt(user);
  }
}
