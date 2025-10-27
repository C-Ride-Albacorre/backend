import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { ListQueryDto } from './dto/list-query.dto';

@Injectable()
export class MenusService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
  ) {}

  async create(userId: string, dto: CreateMenuDto, file?: Express.Multer.File) {
    let imageUrl: string | undefined;

    if (file) {
      const uploadResult = await this.cloudinary.uploadLogo(file);
      imageUrl = uploadResult.secure_url;
    }

    
    if (!imageUrl && dto.imageUrl) {
      imageUrl = dto.imageUrl;
    }

    const data: any = {
      Name: dto.name,
      description: dto.description,
      imageUrl,
      location: dto.location,
      userId,
    };

    const menu = await (this.prisma as any).menu.create({
      data,
    });

    return menu;
  }

  async findAll(userId: string, query: ListQueryDto) {
    const { skip = 0, take = 20, location, search } = query;

    return (this.prisma as any).menu.findMany({
      skip,
      take,
      where: {
        AND: [
          { userId },
          location ? { location } : {},
          search
            ? {
                OR: [
                  { Name: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllSystemWide(query: ListQueryDto) {
    const { skip = 0, take = 20, location, search } = query;

    return (this.prisma as any).menu.findMany({
      skip,
      take,
      where: {
        AND: [
          location ? { location } : {},
          search
            ? {
                OR: [
                  { Name: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const menu = await (this.prisma as any).menu.findUnique({ where: { id } });
    if (!menu) throw new NotFoundException('Menu item not found');
    if (menu.userId !== userId) throw new ForbiddenException('Not your menu item');
    return menu;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateMenuDto,
    file?: Express.Multer.File,
  ) {
    const existing = await this.findOne(userId, id);
    let imageUrl = existing.imageUrl;

    if (file) {
      const uploadResult = await this.cloudinary.uploadLogo(file);
      imageUrl = uploadResult.secure_url;
    }

   
    if (!file && dto.imageUrl) {
      imageUrl = dto.imageUrl;
    }

    const updateData: any = {
      ...(dto.name ? { Name: dto.name } : {}),
      ...(dto.description ? { description: dto.description } : {}),
      ...(dto.location ? { location: dto.location } : {}),
      imageUrl,
    };

    return (this.prisma as any).menu.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await (this.prisma as any).menu.delete({ where: { id } });
    return { message: 'Menu item deleted successfully' };
  }
}
