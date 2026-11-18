// src/vacancy/vacancy.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { VacancyPaginationDto } from './dto/vacancy-pagination.dto';
import { PostStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';

@Injectable()
export class VacancyService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateVacancyDto) {
    if (!dto.salaryPeriod) {
      throw new BadRequestException('salaryPeriod is required');
    }

    return this.prisma.vacancy.create({
      data: {
        ...dto,
        salaryPeriod: dto.salaryPeriod,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
      },
    });
  }

  async findAll(query: VacancyPaginationDto) {
    const { page = 1, limit = 10, search, status } = query;
    const skip = (page - 1) * limit;

    // 1. Build Search & Filter
    const where: any = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { positionTitle: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    // 2. Fetch Data
    const [total, data] = await this.prisma.$transaction([
      this.prisma.vacancy.count({ where }),
      this.prisma.vacancy.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          // CUSTOM SORT: PUBLISHED -> DRAFT -> CLOSED
          // Prisma doesn't natively support CASE WHEN in orderBy, so we use `raw`
          // or fetch and sort in memory. Since we are paginating, we CANNOT sort in memory.
          // We must use Prisma's raw SQL OR sort by a mapped integer field.
          // Workaround: If we add `sortOrder Int` to DB, but for now, we'll use raw ordering.
        ],
      }),
    ]);

    // Since Prisma doesn't support custom enum sorting natively in findMany,
    // we will use a raw query for the list to ensure accurate pagination,
    // OR we can fetch all, sort in memory, and paginate (bad for large datasets).
    // Here is the raw query approach for perfect accuracy:

    const rawData = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM "vacancies"
      ${status ? Prisma.sql`WHERE status = ${status}::"PostStatus"` : Prisma.empty}
      ${search && status ? Prisma.sql`AND` : search ? Prisma.sql`WHERE` : Prisma.empty}
      ${
        search
          ? Prisma.sql`(
              "positionTitle" ILIKE ${'%' + search + '%'} OR 
              "location" ILIKE ${'%' + search + '%'}
            )`
          : Prisma.empty
      }
      ORDER BY 
        CASE 
          WHEN status = 'PUBLISHED' THEN 1
          WHEN status = 'DRAFT' THEN 2
          WHEN status = 'CLOSED' THEN 3
          ELSE 4
        END ASC,
        "createdAt" DESC
      LIMIT ${limit} OFFSET ${skip}
    `;

    return {
      data: rawData,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const vacancy = await this.prisma.vacancy.findUnique({ where: { id } });
    if (!vacancy) throw new NotFoundException(`Vacancy with ID ${id} not found`);
    return vacancy;
  }

  async update(id: string, dto: UpdateVacancyDto) {
    await this.findOne(id);
    return this.prisma.vacancy.update({
      where: { id },
      data: {
        ...dto,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.vacancy.delete({ where: { id } });
  }

  // ─── STATS (For UI cards) ───
  async getStats() {
    const [totalPositions, published, drafts, closed] = await this.prisma.$transaction([
      this.prisma.vacancy.count(),
      this.prisma.vacancy.count({ where: { status: PostStatus.PUBLISHED } }),
      this.prisma.vacancy.count({ where: { status: PostStatus.DRAFT } }),
      this.prisma.vacancy.count({ where: { status: PostStatus.CLOSED } }),
    ]);

    return { totalPositions, published, drafts, closed };
  }
}