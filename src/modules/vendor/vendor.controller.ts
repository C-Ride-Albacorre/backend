
import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { RolesGuard } from '../../common/guards/role.guard';
import { UserRole } from '../../shared/enums';

import {
  StatementHistoryItemDto,
  VendorEarningsFilterDto,
  VendorStatementDto,
} from './dto/vendor-earnings.dto';
import { VendorService } from './vendor.service';

@ApiTags('Vendor Earnings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR)
@Controller('vendor/earnings')
export class VendorController {
  constructor(private readonly service: VendorService) {}

  @Get('statement')
  @ApiOperation({
    summary: 'VEN-024/025/026 — Weekly payout statement',
    description:
      'Returns daily breakdown + per-order rows for the selected period. ' +
      'Defaults to the current week if no period is provided by the caller.',
  })
  @ApiOkResponse({ type: VendorStatementDto })
  async getStatement(
    @Req() req: any,
    @Query() filter: VendorEarningsFilterDto,
  ) {
    return this.service.getStatement(req.user.id, filter);
  }

  @Get('orders/:orderId')
  @ApiOperation({
    summary: 'VEN-023 — Per-order earning breakdown',
  })
  async getOrderEarnings(
    @Req() req: any,
    @Param('orderId') orderId: string,
  ) {
    return this.service.getOrderEarnings(req.user.id, orderId);
  }

  @Get('statements')
  @ApiOperation({
    summary: 'VEN-027 — Historical weekly payout statements',
  })
  @ApiOkResponse({ type: [StatementHistoryItemDto] })
  async getHistory(
    @Req() req: any,
    @Query() filter: VendorEarningsFilterDto,
  ) {
    return this.service.getStatementHistory(req.user.id, filter);
  }
}