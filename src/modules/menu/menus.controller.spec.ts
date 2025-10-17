
import { Test, TestingModule } from '@nestjs/testing';
import { MenusController } from './menus.controller';
import { MenusService } from './menus.service';


    import { PrismaService } from '../../shared/services/prisma.service';
    import { CloudinaryService } from '../../shared/services/cloudinary.service';

    class MockPrismaService {}
    class MockCloudinaryService {}

describe('MenusController', () => {
  let controller: MenusController;

  beforeEach(async () => {

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MenusController],
      providers: [
        MenusService,
            { provide: PrismaService, useClass: MockPrismaService },
            { provide: CloudinaryService, useClass: MockCloudinaryService },
      ],
    }).compile();

    controller = module.get<MenusController>(MenusController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
