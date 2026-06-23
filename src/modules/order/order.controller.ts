import {
  Controller,
  Param,
  Post,
  Body,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { OrderStatus, Role } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { RolesGuard } from '../../common/guards/role.guard';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { UserRole } from '../../shared/enums';
import { VendorActionDto } from './dto/vendor-action.dto';
import { VendorOrderDto } from './dto/vendor-order.dto';

// export class VendorActionDto {
//   action: 'ACCEPT' | 'DECLINE';
//   reason?: string;
// }

@ApiTags('Vendor Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR)
@Controller('vendor/orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @ApiOperation({
    summary: 'List vendor orders',
    description: 'Retrieve all PAID and CONFIRMED orders belonging to the authenticated vendor.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    example: 'ORDER_ASSIGNED',
    description: 'Filter orders by status',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 10,
    description: 'Number of records per page',
  })
  @ApiResponse({
    status: 200,
    description: 'Orders retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - User is not a vendor',
  })
  async listOrders(
    @GetUser() user: any,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
        //console.log('Vendor ID:', user);

    // if (user.role !== Role.VENDOR) {
    //   throw new ForbiddenException();
    // }


    return this.orderService.getVendorOrders(user.id, {
      status,
      page,
      limit,
    });
  }


  @Get(":id")
  @ApiOperation({
    summary: "Get single vendor order",
  })
  @ApiParam({
    name: "id",
    example: "1f24e2fa-4f69-4f44-a4d3-6c5ca4ecf315",
  })
  @ApiOkResponse({
    type: VendorOrderDto,
  })
  getOrder(
    @GetUser() user: any,
    @Param("id") orderId: string,
  ) {
    return this.orderService.getVendorOrderById(
      user.sub,
      orderId,
    );
  }


  @Post(':orderId/action')
  @ApiOperation({
    summary: 'Handle vendor order action',
    description:
      'Allows a vendor to accept, reject, or perform an action on an order.',
  })
  @ApiParam({
    name: 'orderId',
    type: String,
    description: 'Order ID',
    example: 'clx123abc456',
  })
  @ApiBody({
    type: VendorActionDto,
    description: 'Vendor action payload',
  })
  @ApiResponse({
    status: 200,
    description: 'Vendor action processed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request payload',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - User is not a vendor',
  })
  @ApiResponse({
    status: 404,
    description: 'Order not found',
  })
  async handleAction(
    @Param('orderId') orderId: string,
    @Body() dto: VendorActionDto,
    //@CurrentUser() vendor: User,
    @GetUser() user: any,
  ) {
    if (user.role !== Role.VENDOR) {
      throw new ForbiddenException();
    }

    return this.orderService.handleVendorAction(orderId, user.id, dto);
  }
}
