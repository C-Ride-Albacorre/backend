import {
  Controller,
  Param,
  Post,
  Body,
  ForbiddenException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { Role, User } from '@prisma/client';
import { GetUser } from 'src/common/decorators/get-user.decorator';

export class VendorActionDto {
  action: 'ACCEPT' | 'DECLINE';
  reason?: string;
}

@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post(':orderId/action')
  async handleAction(
    @Param('orderId') orderId: string,
    @Body() dto: VendorActionDto,
    //@CurrentUser() vendor: User,
    @GetUser() user: any,
  ) {
    if (user.role !== Role.VENDOR) throw new ForbiddenException();
    return this.orderService.handleVendorAction(orderId, user.id, dto);
  }
}
