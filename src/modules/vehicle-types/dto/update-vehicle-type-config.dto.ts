import { PartialType } from '@nestjs/swagger';
import { CreateVehicleTypeConfigDto } from './create-vehicle-type-config.dto';

export class UpdateVehicleTypeConfigDto extends PartialType(CreateVehicleTypeConfigDto) {}