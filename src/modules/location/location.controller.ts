import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { LocationService } from './location.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { QueryLocationDto } from './dto/query-location.dto';

@ApiTags('Locations')
@Controller('locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new delivery location' })
  @ApiResponse({ status: 201, description: 'Location successfully created.' })
  create(@Body() createLocationDto: CreateLocationDto) {
    return this.locationService.create(createLocationDto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get location statistics for dashboard cards' })
  @ApiResponse({ status: 200, description: 'Returns total, active, and inactive counts.' })
  getStats() {
    return this.locationService.getStats();
  }

  @Get()
  @ApiOperation({ summary: 'Get all locations with pagination, search, and filtering' })
  @ApiResponse({ status: 200, description: 'Returns paginated list of locations.' })
  findAll(@Query() query: QueryLocationDto) {
    return this.locationService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific location by ID' })
  @ApiResponse({ status: 200, description: 'Returns the location details.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  findOne(@Param('id') id: string) {
    return this.locationService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a location' })
  @ApiResponse({ status: 200, description: 'Location successfully updated.' })
  update(@Param('id') id: string, @Body() updateLocationDto: UpdateLocationDto) {
    return this.locationService.update(id, updateLocationDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a location' })
  @ApiResponse({ status: 200, description: 'Location successfully deleted.' })
  remove(@Param('id') id: string) {
    return this.locationService.remove(id);
  }
}