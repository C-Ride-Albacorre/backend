import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';


export enum VendorAction {
  ACCEPT = 'ACCEPT',
  DECLINE = 'DECLINE',
}


export class VendorActionDto {
@ApiPropertyOptional({
    description: 'Action to perform on the order',
    enum: VendorAction,
    example: VendorAction.ACCEPT,
  })
   @ApiProperty({
    enum: VendorAction,
    example: VendorAction.ACCEPT,
  })
  @IsEnum(VendorAction)
  action: VendorAction;

  
  @ApiPropertyOptional({
    description: 'Reason for declining or providing context for the action',
    example: 'Out of stock',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}