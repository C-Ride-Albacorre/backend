import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import { Cache } from "cache-manager";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { google } from "googleapis";
import { PrismaService } from "./prisma.service";

@Injectable()
export class GoogleService {
  private oauth2Client;
  private callbackPath = process.env.GOOGLE_REDIRECT_PATH;
  private googleRedirectUrl = `${process.env.BACKEND_URI}/${this.callbackPath}`;
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private prisma: PrismaService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      this.googleRedirectUrl,
    );
  }

  getConsentUrl(state: string): string {
    const scopes = [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/business.manage",
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
      state: state,
    });
  }

}
