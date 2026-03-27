import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
  Min,
  IsPhoneNumber,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DayOfWeek, StoreStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

// export class OperatingHoursDto {
//   @ApiProperty({ enum: DayOfWeek })
//   @IsEnum(DayOfWeek)
//   dayOfWeek: DayOfWeek;

//   @ApiProperty()
//   @IsBoolean()
//   isOpen: boolean;

//   @ApiProperty({ required: false })
//   @IsOptional()
//   @IsString()
//   openingTime?: string;

//   @ApiProperty({ required: false })
//   @IsOptional()
//   @IsString()
//   closingTime?: string;

//   @ApiProperty({ required: false })
//   @IsOptional()
//   @IsString()
//   breakStart?: string;

//   @ApiProperty({ required: false })
//   @IsOptional()
//   @IsString()
//   breakEnd?: string;
// }

export class OperatingHoursDto {
  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek: DayOfWeek;

  @ApiProperty()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isOpen: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  openingTime?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  closingTime?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  breakStart?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  breakEnd?: string;
}

export class CreateStoreDto {
  @ApiProperty()
  @IsString()
  storeName: string;

  @ApiProperty({
    description: 'Store Id',
    example: 'd8440fe0-da81-4ff1-acaa-685f6351a203',
  })
  @IsString()
  storeCategory: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  storeDescription?: string;

  @ApiProperty()
  @IsString()
  storeAddress: string;

  @ApiProperty()
  @IsString()
  phoneNumber: string;

  @ApiProperty()
  @IsString()
  email: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimumOrder?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  preparationTime?: number;

  // @IsString()
  // @Transform(({ value }) => {
  //   try {
  //     return typeof value === 'string' ? JSON.parse(value) : value;
  //   } catch {
  //     throw new BadRequestException('Invalid JSON for operatingHours');
  //   }
  // })
  // @IsArray()
  // @ValidateNested({ each: true })
  // @Type(() => OperatingHoursDto)
  // operatingHours: OperatingHoursDto[];
  // @ApiProperty({ type: [OperatingHoursDto] })
  //   @IsArray()
  //   @ValidateNested({ each: true })
  //   @Type(() => OperatingHoursDto)
  //   operatingHours: OperatingHoursDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperatingHoursDto)
  @ApiProperty({ type: [OperatingHoursDto] })
  @Transform(({ value }) => {
    if (!value) return [];
    let arr;
    try {
      arr = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      throw new BadRequestException('Invalid JSON for operatingHours');
    }

    // Convert each item to DTO instance so ValidationPipe sees them
    return arr.map((item: any) => Object.assign(new OperatingHoursDto(), item));
  })
  operatingHours: OperatingHoursDto[];

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  logo?: any;
}

export class UpdateStoreDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  storeName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  storeCategory?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  storeDescription?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  storeAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimumOrder?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  preparationTime?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @ApiProperty({ enum: StoreStatus, required: false })
  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  logo?: any;
}
