// src/admin/dto/admin-wallet.dto.ts
import {
  IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, MaxLength, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum WalletUserType {
  CUSTOMER = 'CUSTOMER',
  DISPATCHER = 'DISPATCHER',
}

export class SearchWalletUsersDto {
  @ApiPropertyOptional({ enum: WalletUserType })
  @IsEnum(WalletUserType)
  @IsOptional()
  userType?: WalletUserType;

  @ApiPropertyOptional({ description: 'Name, email, phone, or user ID' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}

export class CreditWalletDto {
  @ApiProperty({ description: 'User ID to credit' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: WalletUserType })
  @IsEnum(WalletUserType)
  userType: WalletUserType;

  @ApiProperty({ example: 5000, minimum: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1, { message: 'Credit amount must be greater than 0' })
  amount: number;

  @ApiProperty({ example: 'Incentive bonus for top performance this week' })
  @IsString()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ example: 'ORD-8851' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  relatedOrderId?: string;
}