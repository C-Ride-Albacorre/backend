import { Test, TestingModule } from '@nestjs/testing';
import { VehicleTypesService } from './vehicle-types.service';

describe('VehicleTypesService', () => {
  let service: VehicleTypesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VehicleTypesService],
    }).compile();

    service = module.get<VehicleTypesService>(VehicleTypesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
