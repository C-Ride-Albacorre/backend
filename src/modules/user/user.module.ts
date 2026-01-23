import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from '../../shared/services/prisma.service';
import { AbstractUserRepository } from './repositories/abstract-user.repository';
import { PrismaUserRepository } from './repositories/prisma-user.repository';

@Module({
  controllers: [UserController],
  providers: [
    UserService,
    PrismaService,
    {
      provide: AbstractUserRepository,
      useClass: PrismaUserRepository,
    },
  ],
  exports: [UserService, AbstractUserRepository],
})
export class UserModule {}
