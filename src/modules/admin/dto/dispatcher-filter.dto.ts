import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { UserStatus, DriverType } from '@prisma/client';

export class DispatcherFilterDto {
  @ApiPropertyOptional({
    description: 'Search by first name, last name, email or phone number',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter dispatchers by account status',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Filter dispatchers by driver type',
    enum: DriverType,
    example: DriverType.PARTNER,
  })
  @IsOptional()
  @IsEnum(DriverType)
  driverType?: DriverType;

  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of records per page',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

// export class DispatcherFilterDto {
//   search?: string;
//   status?: UserStatus;
//   page?: number;
//   limit?: number;
// }