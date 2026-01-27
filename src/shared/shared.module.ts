
import { Global, Module, Logger } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';
import { CloudinaryService } from './services/cloudinary.service';
import { RedisModule } from '../modules/redis/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [PrismaService, CloudinaryService],
  exports: [PrismaService, CloudinaryService, RedisModule],
})
export class SharedModule {}
