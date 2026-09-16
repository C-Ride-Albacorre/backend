import { Test, TestingModule } from '@nestjs/testing';
import { GlobalSettingsController } from './global-settings.controller';
import { GlobalSettingsService } from './global-settings.service';

describe('GlobalSettingsController', () => {
  let controller: GlobalSettingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GlobalSettingsController],
      providers: [GlobalSettingsService],
    }).compile();

    controller = module.get<GlobalSettingsController>(GlobalSettingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
