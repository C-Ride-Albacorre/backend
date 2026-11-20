import { IsEnum, IsOptional } from 'class-validator';
import { DriverActivityStatus } from '@prisma/client';
import { PaginationSearchFilterDto } from '../../../common/dto/pagination-search-filter.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';


export class GodViewFleetQueryDto  extends PaginationSearchFilterDto {
   @ApiPropertyOptional({
    enum: DriverActivityStatus,
    description: 'Filter by driver activity status'
   }) 
  @IsOptional()
  @IsEnum(DriverActivityStatus)
  status?: DriverActivityStatus;

}