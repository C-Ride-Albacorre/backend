import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  HttpCode,
  Delete,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { StoreService } from './store.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  OperatingHoursDto,
} from './dto/store.dto';
import Helper from '../../shared/utils/helpers';
import { PrismaService } from '../../shared/services/prisma.service';
import { StoreResponseDto } from '../customer/dto/store-response.dto';
import { GetNearbyStoresQueryDto } from '../customer/dto/near-by-store.dto';

@ApiTags('vendor/stores')
@Controller('vendor/stores')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('logo'))
  async createStore(
    @Request() req,
    @Body() dto: CreateStoreDto,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    return this.storeService.createStore(req.user.id, dto, logo);
  }

  @Get()
  async getMyStores(@Request() req) {
    return this.storeService.getVendorStores(req.user.id);
  }

  @Put(':storeId')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('logo'))
  async updateStore(
    @Request() req,
    @Param('storeId') storeId: string,
    @Body() dto: UpdateStoreDto,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    return this.storeService.updateStore(storeId, req.user.id, dto, logo);
  }

  @Put(':storeId/operating-hours')
  async updateOperatingHours(
    @Request() req,
    @Param('storeId') storeId: string,
    @Body() hours: OperatingHoursDto[],
  ) {
    return this.storeService.updateOperatingHours(storeId, req.user.id, hours);
  }

  /**
   * SIMPLE BULK DELETE - Alternative endpoint for simpler implementation
   */
  @Delete('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Single | bulk delete',
    description: 'Delete multiple stores with a simpler response format',
  })
  @ApiBody({
    schema: {
      properties: {
        storeIds: {
          type: 'array',
          items: { type: 'string' },
          example: ['store-id-1', 'store-id-2'],
        },
      },
    },
  })
  async deleteMultipleStoresSimple(
    @Request() req,
    @Body('storeIds') storeIds: string[],
  ) {
    if (!storeIds || storeIds.length === 0) {
      throw new HttpException('No store IDs provided', HttpStatus.BAD_REQUEST);
    }

    return this.storeService.deleteMultipleStoresSimple(req.user.id, storeIds);
  }

}
