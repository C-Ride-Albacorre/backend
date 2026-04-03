import { Module } from '@nestjs/common';
import { DriverService } from './driver.service';
import { DriverController } from './driver.controller';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  controllers: [DriverController],
  providers: [DriverService],
})
export class DriverModule {}
