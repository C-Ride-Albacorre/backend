// src/drivers/dto/step4-driver.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class DriverStep4Dto {
  @ApiProperty({ example: true })
  @IsBoolean()
  confirmInformation: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  agreeToTerms?: boolean;
}
