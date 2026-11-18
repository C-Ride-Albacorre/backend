// src/vacancy/vacancy.controller.ts
import {
  Body, Controller, Post, Get, Patch, Delete,
  Param, Query, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiCreatedResponse, ApiOkResponse,
  ApiNotFoundResponse, ApiBadRequestResponse, ApiParam,
  ApiNoContentResponse, getSchemaPath,
} from '@nestjs/swagger';
import { VacancyService } from './vacancy.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { VacancyPaginationDto } from './dto/vacancy-pagination.dto';
import { VacancyResponseDto, VacancyStatsDto } from './dto/vacancy-response.dto';

@ApiTags('Vacancy')
@Controller('vacancies')
export class VacancyController {
  constructor(private readonly vacancyService: VacancyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new job vacancy' })
  @ApiCreatedResponse({ description: 'Vacancy created successfully.', type: VacancyResponseDto })
  async create(@Body() dto: CreateVacancyDto) {
    return this.vacancyService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all vacancies (paginated, searchable, sorted PUBLISHED->DRAFT->CLOSED)' })
  @ApiOkResponse({
    description: 'Paginated list of vacancies.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(VacancyResponseDto) } },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 3 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 10 },
            totalPages: { type: 'number', example: 1 },
          },
        },
      },
    },
  })
  async findAll(@Query() query: VacancyPaginationDto) {
    return this.vacancyService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get vacancy stats for the dashboard cards' })
  @ApiOkResponse({ description: 'Vacancy statistics.', type: VacancyStatsDto })
  async getStats() {
    return this.vacancyService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a vacancy by ID' })
  @ApiParam({ name: 'id', description: 'Vacancy UUID' })
  @ApiOkResponse({ description: 'Vacancy found.', type: VacancyResponseDto })
  @ApiNotFoundResponse({ description: 'Vacancy not found.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.vacancyService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a vacancy' })
  @ApiParam({ name: 'id', description: 'Vacancy UUID' })
  @ApiOkResponse({ description: 'Vacancy updated.', type: VacancyResponseDto })
  @ApiNotFoundResponse({ description: 'Vacancy not found.' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVacancyDto) {
    return this.vacancyService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a vacancy' })
  @ApiParam({ name: 'id', description: 'Vacancy UUID' })
  @ApiNoContentResponse({ description: 'Vacancy deleted.' })
  @ApiNotFoundResponse({ description: 'Vacancy not found.' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.vacancyService.remove(id);
  }
}