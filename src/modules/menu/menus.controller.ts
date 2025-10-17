import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { MenusService } from './menus.service';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { ListQueryDto } from './dto/list-query.dto';

@ApiTags('Menu')
@Controller('menu')
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new menu item' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        location: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  create(@Body() dto: CreateMenuDto, @UploadedFile() file: Express.Multer.File) {
    return this.menusService.create(dto, file);
  }

  @Get()
  @ApiOperation({ summary: 'List all menu items (with filters)' })
  findAll(@Query() query: ListQueryDto) {
    return this.menusService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single menu item by ID' })
  findOne(@Param('id') id: string) {
    return this.menusService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a menu item' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMenuDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.menusService.update(id, dto, file);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a menu item' })
  remove(@Param('id') id: string) {
    return this.menusService.remove(id);
  }
}
