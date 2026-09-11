import { Controller, Get, Post, Body, Patch, Param, Delete, Query, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { VehicleTypesService } from './vehicle-types.service';
import { CreateVehicleTypeConfigDto } from './dto/create-vehicle-type-config.dto';
import { UpdateVehicleTypeConfigDto } from './dto/update-vehicle-type-config.dto';

@ApiTags('Vehicle Types & Pricing')
@Controller('vehicle-types')
export class VehicleTypesController {
  constructor(private readonly vehicleTypesService: VehicleTypesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new vehicle type configuration' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Configuration successfully created.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input or duplicate configuration.' })
  create(@Body() createDto: CreateVehicleTypeConfigDto) {
    return this.vehicleTypesService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all vehicle type configurations' })
  @ApiQuery({ name: 'location', required: false, type: String })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  findAll(
    @Query('location') location?: string,
    @Query('isActive') isActive?: string,
  ) {
    // Convert string 'true'/'false' to boolean if provided
    const activeFilter = isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    return this.vehicleTypesService.findAll(location, activeFilter);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard statistics for vehicle types' })
  getStats() {
    return this.vehicleTypesService.getDashboardStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific vehicle type configuration by ID' })
  findOne(@Param('id') id: string) {
    return this.vehicleTypesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a vehicle type configuration' })
  update(@Param('id') id: string, @Body() updateDto: UpdateVehicleTypeConfigDto) {
    return this.vehicleTypesService.update(id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a vehicle type configuration' })
  remove(@Param('id') id: string) {
    return this.vehicleTypesService.remove(id);
  }
}