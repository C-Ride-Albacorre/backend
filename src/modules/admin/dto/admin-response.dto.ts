// src/admin/dto/admin-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
// import { UserStatus, StoreStatus } from '@prisma/client';
import { StoreStatus, UserRole, UserStatus } from '../../../shared/enums';
import { IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';

export class AdminResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email?: string;

  // @ApiProperty()
  // phoneNumber?: string;

  @ApiProperty({ example: 'NG', required: false })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiProperty({
    example: '+2347060875593',
    description: 'Phone number in E.164 format',
  })
  @IsOptional()
  @IsPhoneNumber(null) // supports ALL countries
  phoneNumber?: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty()
  createdAt: Date;
}

export class VendorListResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  businessName: string;

  @ApiProperty()
  businessEmail?: string;

  @ApiProperty()
  businessPhone?: string;

  @ApiProperty()
  status: UserStatus;

  @ApiProperty()
  totalStores: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: () => UserSummaryDto })
  user: UserSummaryDto;
}

export class StoreListResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  status: StoreStatus;

  @ApiProperty()
  featured: boolean;

  @ApiProperty()
  totalProducts: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: () => VendorSummaryDto })
  vendor: VendorSummaryDto;
}

export class UserSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email?: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;
}

export class VendorSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  businessName: string;

  @ApiProperty()
  businessEmail?: string;

  @ApiProperty()
  userId: string;
}
