
// call.controller.ts
import { Controller, Post, Get, Body, Param, UseGuards, Request, Req } from '@nestjs/common';
import { CallService } from './call.service';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';


@ApiTags('Call')
@ApiBearerAuth()
@Controller('call')
@UseGuards(JwtAuthGuard)
export class CallController {
  constructor(private callService: CallService) {}

  @Post('initiate')
  @ApiOperation({ summary: 'Initiate a new call' })
  async initiateCall(
    @Request() req,
    @Body('orderId') orderId: string,
  ) {
    const user = req.user; // assume user has id and role
    const result = await this.callService.initiateCall(
      orderId,
      user.id,
      user.role,
    );
    return result;
  }

  @Post(':callId/accept')
  @ApiOperation({ summary: 'Accept an incoming call' })
  async acceptCall(
    @Request() req,
    @Param('callId') callId: string,
  ) {
    const user = req.user;
    const token = await this.callService.acceptCall(callId, user.id);
    return token;
  }

  @Post(':callId/reject')
  @ApiOperation({ summary: 'Reject an incoming call' })
  async rejectCall(
    @Request() req,
    @Param('callId') callId: string,
  ) {
    const user = req.user;
    await this.callService.rejectCall(callId, user.id);
    return { success: true };
  }

  @Post(':callId/end')
  @ApiOperation({ summary: 'End an active call' })
  async endCall(
    // @Req() req: Request,
    @Request() req,
    @Param('callId') callId: string,
  ) {
    const user = req.user;
    await this.callService.endCall(callId, user.id);
    return { success: true };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get call history' })
  async getHistory(
    @Request() req,
    @Body('orderId') orderId?: string,
  ) {
    const user = req.user;
    return this.callService.getCallHistory(user.id, orderId);
  }

  @Get('active/:orderId')
  @ApiOperation({ summary: 'Get active call' })
  async getActiveCall(
    @Param('orderId') orderId: string,
  ) {
    return this.callService.getActiveCall(orderId);
  }
}