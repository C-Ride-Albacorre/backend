
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DriverStatus, UserStatus } from '@prisma/client';

export class ApproveDispatcherDto {
  @ApiProperty({ enum: DriverStatus })
  @IsEnum(DriverStatus)
  action: DriverStatus;

  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  userAction: UserStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
