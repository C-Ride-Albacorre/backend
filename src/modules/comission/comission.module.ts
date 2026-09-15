import { Module } from '@nestjs/common';
import { CommissionService } from './comission.service';
import { CommissionController } from './comission.controller';

@Module({
  controllers: [CommissionController],
  providers: [CommissionService],
})
export class CommissionModule {}
