import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { ProductService } from './product.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@ApiTags('vendor/products')
@Controller('vendor/stores/:storeId/products')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('images', 10))
  async createProduct(
    @Request() req,
    @Param('storeId') storeId: string,
    @Body() dto: CreateProductDto,
    @UploadedFiles() images: Express.Multer.File[],
  ) {
    return this.productService.createProduct(req.user.id, storeId, dto, images);
  }

  @Get()
  async getStoreProducts(@Request() req, @Param('storeId') storeId: string) {
    return this.productService.getStoreProducts(storeId, req.user.id);
  }

  @Get(':productId')
  async getProduct(@Param('productId') productId: string) {
    return this.productService.getProductWithDetails(productId);
  }

  @Put(':productId')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('newImages', 5))
  async updateProduct(
    @Request() req,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
    @UploadedFiles() newImages?: Express.Multer.File[],
  ) {
    return this.productService.updateProduct(
      productId,
      storeId,
      req.user.id,
      dto,
      newImages,
    );
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  async deleteProduct(
    @Request() req,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
  ) {
    return this.productService.deleteProduct(productId, storeId, req.user.id);
  }
}
