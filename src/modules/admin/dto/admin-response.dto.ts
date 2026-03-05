// src/admin/dto/admin-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
// import { UserStatus, StoreStatus } from '@prisma/client';
import { StoreStatus, UserRole, UserStatus } from '../../../shared/enums';

export class AdminResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email?: string;

  @ApiProperty()
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
