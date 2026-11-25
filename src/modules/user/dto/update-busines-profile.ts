
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  IsEmail,
} from 'class-validator';

export class UpdateBusinessProfileDto {
  // STEP 1 - Business Information

  @ApiPropertyOptional({ example: 'Esko Venture' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessName?: string;

  @ApiPropertyOptional({ example: 'Italian Restaurant' })
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({ example: '0102293993' })
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiPropertyOptional({ example: 'TX0000000000' })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional({ example: 'Best Italian Delicacy' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // STEP 2 - Contact Details

  @ApiPropertyOptional({ example: '07060875593' })
  @IsOptional()
  @IsString()
  businessPhone?: string;

  @ApiPropertyOptional({ example: 'esko@gmail.com' })
  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  // STEP 3 - Business Address

  @ApiPropertyOptional({
    example: 'First Gate, Ikota Estate, KM 14, Lekki-Epe Expressway',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Lekki' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  state?: string;

  // STEP 4 - Bank Details

  @ApiPropertyOptional({ example: 'Zenith Bank' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: 'Esko Ventures' })
  @IsOptional()
  @IsString()
  accountName?: string;

  @ApiPropertyOptional({ example: '01099022334' })
  @IsOptional()
  @IsString()
  accountNumber?: string;
}
