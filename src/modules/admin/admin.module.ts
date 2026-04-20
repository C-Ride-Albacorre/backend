import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AbstractUserRepository } from '../user/repositories/abstract-user.repository';
import { PrismaService } from '../../shared/services/prisma.service';
import { PrismaUserRepository } from '../user/repositories/prisma-user.repository';
import { UserService } from '../user/user.service';
import { VerificationService } from '../verification/verification.service';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { VerificationModule } from '../verification/verification.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  controllers: [AdminController],
  imports: [VerificationModule, AuthModule],
  providers: [
    AdminService,
    PrismaService,
    UserService,
    CloudinaryService,
    {
      provide: AbstractUserRepository,
      useClass: PrismaUserRepository,
    },
    VerificationService,
  ],
  exports: [UserService, AbstractUserRepository, VerificationService],
})
export class AdminModule {}
