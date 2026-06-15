
import { Controller, Get, Post, Body, Param, UseGuards, Request, Patch } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get('orders/:orderId/messages')
  @ApiOperation({ summary: 'Get chat history for an order' })
  async getMessages(@Param('orderId') orderId: string, @Request() req) {
    return this.chatService.getMessages(orderId, req.user.id, req.user.role);
  }

  @Post('orders/:orderId/messages')
  @ApiOperation({ summary: 'Send a message (REST fallback)' })
  async sendMessage(@Param('orderId') orderId: string, @Body() dto: SendMessageDto, @Request() req) {
    return this.chatService.saveMessage({
      orderId,
      senderId: req.user.id,
      senderRole: req.user.role,
      message: dto.message,
      type: dto.type,
    });
  }

  @Patch('messages/:messageId/read')
  @ApiOperation({ summary: 'Mark a message as read' })
  async markRead(@Param('messageId') messageId: string, @Request() req) {
    await this.chatService.markMessageAsRead(messageId, req.user.id);
    return { success: true };
  }
}