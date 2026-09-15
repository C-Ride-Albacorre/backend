// src/commission/commission.controller.ts
import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiParam,
  ApiNoContentResponse,
  getSchemaPath,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CommissionService } from './comission.service';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { CommissionResponseDto } from './dto/commission-response.dto';
import { CommissionStatsResponseDto } from './dto/commission-stats-response.dto';

import { Roles } from '../../common/decorators/role.decorator';
import { RolesGuard } from '../../common/guards/role.guard';
import { UserRole } from '../../shared/enums';
import { JwtAuthGuard } from '../../common/guards/auth.guard';


@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
@ApiTags('Vendor Commission Rate & Service Charge')
@Controller('commission')
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  // ─── CREATE ───
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a commission for a vendor' })
  @ApiCreatedResponse({ description: 'Commission created.', type: CommissionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid input.' })
  async create(@Body() dto: CreateCommissionDto) {
    return this.commissionService.create(dto);
  }

  // ─── READ ALL (paginated + search) ───
  @Get()
  @ApiOperation({ summary: 'Get all commissions (paginated, searchable)' })
  @ApiOkResponse({
    description: 'Paginated list of commissions.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(CommissionResponseDto) } },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 42 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 10 },
            totalPages: { type: 'number', example: 5 },
          },
        },
      },
    },
  })
  async findAll(@Query() pagination: PaginationQueryDto) {
    return this.commissionService.findAll(pagination);
  }

  // ─── STATS ───
  @Get('stats')
  @ApiOperation({ summary: 'Get commission statistics (counts + averages)' })
  @ApiOkResponse({ description: 'Commission statistics.', type: CommissionStatsResponseDto })
  async getStats() {
    return this.commissionService.getStats();
  }

  // ─── READ ONE ───
  @Get(':id')
  @ApiOperation({ summary: 'Get a commission by ID' })
  @ApiParam({ name: 'id', description: 'Commission UUID' })
  @ApiOkResponse({ description: 'Commission found.', type: CommissionResponseDto })
  @ApiNotFoundResponse({ description: 'Commission not found.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.commissionService.findOne(id);
  }

  // ─── UPDATE ───
  @Patch(':id')
  @ApiOperation({ summary: 'Update a commission' })
  @ApiParam({ name: 'id', description: 'Commission UUID' })
  @ApiOkResponse({ description: 'Commission updated.', type: CommissionResponseDto })
  @ApiNotFoundResponse({ description: 'Commission not found.' })
  @ApiBadRequestResponse({ description: 'Invalid input.' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommissionDto) {
    return this.commissionService.update(id, dto);
  }

  // ─── DELETE ───
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a commission' })
  @ApiParam({ name: 'id', description: 'Commission UUID' })
  @ApiNoContentResponse({ description: 'Commission deleted.' })
  @ApiNotFoundResponse({ description: 'Commission not found.' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.commissionService.remove(id);
  }
}