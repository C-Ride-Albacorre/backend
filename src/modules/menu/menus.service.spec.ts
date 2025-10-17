
import { Test, TestingModule } from '@nestjs/testing';
import { MenusService } from './menus.service';
import { PrismaService } from '../../shared/services/prisma.service';
import { CloudinaryService } from '../../shared/services/cloudinary.service';

class MockPrismaService {}
class MockCloudinaryService {}

describe('MenusService', () => {
  let service: MenusService;

  beforeEach(async () => {

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenusService,
        { provide: PrismaService, useClass: MockPrismaService },
        { provide: CloudinaryService, useClass: MockCloudinaryService },
      ],
    }).compile();

    service = module.get<MenusService>(MenusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
