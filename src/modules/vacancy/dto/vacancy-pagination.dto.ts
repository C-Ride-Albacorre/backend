import { ApiPropertyOptional } from "@nestjs/swagger";
import { PaginationSearchFilterDto } from "../../../common/dto/pagination-search-filter.dto";
import { IsEnum, IsOptional } from "class-validator";
import { PostStatus } from "@prisma/client";

export class VacancyPaginationDto extends PaginationSearchFilterDto {
  @ApiPropertyOptional({
    enum: PostStatus,
    description: 'Filter by vacancy status',
  })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}