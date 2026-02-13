import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { ListQueryDto } from './dto/list-query.dto';
import { buildQuery } from '../../shared/utils/query.util';

@Injectable()
export class MenusService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
  ) {}

  async createold(
    userId: string,
    dto: CreateMenuDto,
    file?: Express.Multer.File,
  ) {
    let imageUrl: string | null = null;

    // Upload image if provided
    if (file) {
      const { secure_url } = await this.cloudinary.uploadLogo(file);
      imageUrl = secure_url;
    }

    // Build menu data
    const data = {
      name: dto.name,
      description: dto.description,
      category: dto.category,
      type: dto.type,
      imageUrl,
      userId,
    };

    // 4️⃣ Save to database
    const menu = await this.prisma.menu.create({ data });

    return menu;
  }

  async create(userId: string, dto: CreateMenuDto, file?: Express.Multer.File) {
    let fileUrl: string | null = null;

    if (file) {
      const { rawUrl } = await this.cloudinary.uploadFilebk(file);
      fileUrl = rawUrl;
    }

    const data = {
      name: dto.name,
      description: dto.description,
      category: dto.category,
      type: dto.type,
      imageUrl: fileUrl,
      userId,
    };

    return this.prisma.menu.create({ data });
  }

  async findUserMenu(userId: string, query: ListQueryDto) {
    const { skip = 0, take = 20, search, category, type } = query;

    const prismaQuery = buildQuery({
      skip,
      take,
      search,
      searchFields: ['name', 'description'],
      filters: { userId, category, type },
    });

    const [data, total] = await Promise.all([
      this.prisma.menu.findMany(prismaQuery),
      this.prisma.menu.count({ where: prismaQuery.where }),
    ]);

    const page = Math.floor(skip / take) + 1;
    const totalPages = Math.ceil(total / take);

    return {
      data,
      meta: {
        total,
        page,
        totalPages,
        skip,
        take,
      },
    };
  }

  async findAllMenus(query: ListQueryDto) {
    const { skip = 0, take = 20, search, category, type } = query;

    const prismaQuery = buildQuery({
      skip,
      take,
      search,
      searchFields: ['name', 'description'],
      filters: { category, type },
    });

    const [data, total] = await Promise.all([
      this.prisma.menu.findMany(prismaQuery),
      this.prisma.menu.count({ where: prismaQuery.where }),
    ]);

    const page = Math.floor(skip / take) + 1;
    const totalPages = Math.ceil(total / take);

    return {
      data,
      meta: {
        total,
        page,
        totalPages,
        skip,
        take,
      },
    };
  }

  async findOne(id: string) {
    const menu = await this.prisma.menu.findUnique({ where: { id } });
    if (!menu) throw new NotFoundException('Menu item not found');
    // if (menu.userId !== userId)
    //   throw new ForbiddenException('Not your menu item');
    return menu;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateMenuDto,
    file?: Express.Multer.File,
  ) {
    // 1️⃣ Verify the menu belongs to the user
    const existingMenu = await this.findOne(id);
    if (!existingMenu) {
      throw new NotFoundException('Menu item not found');
    }

    let imageUrl = existingMenu.imageUrl;

    // 2️⃣ If a new file is uploaded, replace image
    if (file) {
      const { secure_url } = await this.cloudinary.uploadLogo(file);
      imageUrl = secure_url;
    }

    // 3️⃣ Build update payload dynamically
    const updateData = {
      ...(dto.name && { name: dto.name }),
      ...(dto.description && { description: dto.description }),
      ...(dto.category && { category: dto.category }),
      ...(dto.type && { type: dto.type }),
      imageUrl,
    };

    // 4️⃣ Update record
    return await this.prisma.menu.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(id);
    await this.prisma.menu.delete({ where: { id } });
    return { message: 'Menu item deleted successfully' };
  }
}
