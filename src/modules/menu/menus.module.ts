import { Module } from '@nestjs/common';
import { MenusService } from './menus.service';
// import { MenusController } from './menus.controller';
import { RolesGuard } from '../../common/guards/role.guard';

@Module({
  controllers: [
    /*MenusController*/
  ],
  providers: [MenusService, RolesGuard],
})
export class MenusModule {}
