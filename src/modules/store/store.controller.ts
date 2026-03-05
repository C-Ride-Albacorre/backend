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
  BadRequestException,
  HttpException,
  HttpStatus,
  HttpCode,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiOperation,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { StoreService } from './store.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  OperatingHoursDto,
} from './dto/store.dto';

@ApiTags('vendor/stores')
@Controller('vendor/stores')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  // @Post()
  // @ApiConsumes('multipart/form-data')
  // @UseInterceptors(FileInterceptor('logo'))
  // @ApiBody({ type: CreateStoreWithLogoDto })
  // async createStore(
  //   @Request() req,
  //   @Body() dto: CreateStoreDto,
  //   @UploadedFile() logo?: Express.Multer.File,
  // ) {
  //   if (typeof dto.operatingHours === 'string') {
  //     dto.operatingHours = JSON.parse(dto.operatingHours);
  //   }
  //   return this.storeService.createStore(req.user.id, dto, logo);
  // }

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

  // @Post()
  // @ApiConsumes('multipart/form-data')
  // @ApiBody({
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       storeName: { type: 'string' },
  //       storeCategory: { type: 'string' },
  //       storeDescription: { type: 'string' },
  //       storeAddress: { type: 'string' },
  //       phoneNumber: { type: 'string' },
  //       email: { type: 'string' },
  //       minimumOrder: { type: 'number' },
  //       preparationTime: { type: 'number' },
  //       deliveryFee: { type: 'number' },
  //       operatingHours: {
  //         type: 'string',
  //         description:
  //           'JSON string array of operating hours. Example: [{"dayOfWeek":"MONDAY","isOpen":true,"openingTime":"09:00","closingTime":"18:00"}]',
  //         example:
  //           '[{"dayOfWeek":"MONDAY","isOpen":true,"openingTime":"09:00","closingTime":"18:00"},{"dayOfWeek":"TUESDAY","isOpen":true,"openingTime":"09:00","closingTime":"18:00"}]',
  //       },
  //       logo: { type: 'string', format: 'binary' },
  //     },
  //     required: [
  //       'storeName',
  //       'storeCategory',
  //       'storeAddress',
  //       'phoneNumber',
  //       'email',
  //       'operatingHours',
  //     ],
  //   },
  // })
  // @UseInterceptors(FileInterceptor('logo'))
  // async createStore(
  //   @Request() req,
  //   @UploadedFile() logoFile: Express.Multer.File,
  //   @Body('storeName') storeName: string,
  //   @Body('storeCategory') storeCategory: string,
  //   @Body('storeDescription') storeDescription: string,
  //   @Body('storeAddress') storeAddress: string,
  //   @Body('phoneNumber') phoneNumber: string,
  //   @Body('email') email: string,
  //   @Body('minimumOrder') minimumOrder?: number,
  //   @Body('preparationTime') preparationTime?: number,
  //   @Body('deliveryFee') deliveryFee?: number,
  //   @Body('operatingHours') operatingHoursRaw?: string, // JSON string
  // ) {
  //   let operatingHours;
  //   try {
  //     operatingHours = operatingHoursRaw ? JSON.parse(operatingHoursRaw) : [];
  //   } catch (err) {
  //     throw new BadRequestException('Invalid JSON for operatingHours');
  //   }

  //   const dto: CreateStoreDto = {
  //     storeName,
  //     storeCategory,
  //     storeDescription,
  //     storeAddress,
  //     phoneNumber,
  //     email,
  //     minimumOrder: minimumOrder ? Number(minimumOrder) : undefined,
  //     preparationTime: preparationTime ? Number(preparationTime) : undefined,
  //     deliveryFee: deliveryFee ? Number(deliveryFee) : undefined,
  //     operatingHours,
  //   };

  //   return this.storeService.createStore(req.user.id, dto, logoFile);
  // }

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
    summary: 'Simple bulk delete (no detailed results)',
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
