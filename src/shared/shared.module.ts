import { Global, Module } from "@nestjs/common";
import { CacheModule } from "@nestjs/cache-manager";
import { PrismaService } from "./services/prisma.service";
import { MailGunService } from "./services/mailgun.service";
import { CloudinaryService } from "./services/cloudinary.service";
import { GoogleService } from "./services/google.service";
import { Keyv } from "keyv";
import KeyvMongo from "@keyv/mongo";

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      useFactory: async () => new Keyv(new KeyvMongo(process.env.DATABASE_URL)),
    }),
  ],
  providers: [
    PrismaService,
    MailGunService,
    CloudinaryService,
    GoogleService,
  ],
  exports: [
    PrismaService,
    MailGunService,
    CloudinaryService,
    GoogleService,
  ],
})
export class SharedModule {}
