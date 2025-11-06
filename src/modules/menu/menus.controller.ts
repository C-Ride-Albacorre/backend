import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { MenusService } from './menus.service';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { ListQueryDto } from './dto/list-query.dto';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { UserRole } from '../../shared/enums/user-role.enum';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Menu')
@Controller('menu')
export class MenusController {
  constructor(private readonly menusService: MenusService) {}
  
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
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
        description: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  create(
    @GetUser('id') userId: string,
    @Body() dto: CreateMenuDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.menusService.create(userId, dto, file);
  }

  @Get()
  @ApiOperation({ summary: 'List all menu items' })
  //@Roles(UserRole.SuperAdmin)
  findAllMenus(@Query() query: ListQueryDto) {
    return this.menusService.findAllMenus(query);
  }

  @Get('/user')
  @ApiOperation({ summary: 'Get menus for the current user' })
  findUserMenu(@GetUser('id') userId: string, @Query() query: ListQueryDto) {
    return this.menusService.findUserMenu(userId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single menu item by ID',
  })
  findOne(
    //@GetUser('id') userId: string, 
    @Param('id') id: string) {
    return this.menusService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a menu item' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  update(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMenuDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.menusService.update(userId, id, dto, file);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a menu item' })
  remove(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.menusService.remove(userId, id);
  }
}
