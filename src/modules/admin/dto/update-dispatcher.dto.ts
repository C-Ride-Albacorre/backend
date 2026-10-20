import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty } from '@nestjs/swagger';
import { DriverType } from '@prisma/client';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateDispatcherProfileDto {
    @ApiProperty()
    @IsOptional()
    @IsString()
    address?: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    city?: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    state?: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    country?: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    vehicleMake?: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    vehicleModel?: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    licensePlate?: string;

    @IsOptional()
    @ApiProperty({ enum: DriverType })
    role: DriverType;
}

export class UpdateDispatcherDto {
    @ApiProperty()
    @IsOptional()
    @IsString()
    firstName?: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    lastName?: string;

    @ApiProperty()
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiProperty()
    @IsOptional()
    driverProfile?: UpdateDispatcherProfileDto;
}

