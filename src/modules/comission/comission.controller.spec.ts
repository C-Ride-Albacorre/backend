import { Test, TestingModule } from '@nestjs/testing';
import { CommissionController } from './comission.controller';
import { CommissionService } from './comission.service';

describe('CommissionController', () => {
  let controller: CommissionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommissionController],
      providers: [CommissionService],
    }).compile();

    controller = module.get<CommissionController>(CommissionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
