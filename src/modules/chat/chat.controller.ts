
import { Controller, Get, Post, Body, Param, UseGuards, Request, Patch, Put, Delete, UploadedFile, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { UploadImageResponseDto } from './dto/upload-image-response.dto';
import { FileInterceptor } from '@nestjs/platform-express';

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


  @Post('orders/:orderId/images')
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: UploadImageResponseDto })
  async uploadImage(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    const { imageUrl, message } = await this.chatService.uploadImage(
      orderId,
      req.user.id,
      req.user.role,
      file,
    );
    return {
      imageUrl,
      orderId,
      message: 'Image uploaded successfully',
    };
  }
  
  // chat.controller.ts
@Delete('messages/:messageId')
@ApiOperation({ summary: 'Delete a message (soft delete)' })
@ApiResponse({ status: 200, description: 'Message deleted' })
async deleteMessage(@Param('messageId') messageId: string, @Request() req) {
  await this.chatService.deleteMessage(messageId, req.user.id, req.user.role);
  return { success: true };
}

@Patch('messages/:messageId')
@ApiOperation({ summary: 'Edit a message' })
@ApiResponse({ status: 200, description: 'Message edited' })
async editMessage(
  @Param('messageId') messageId: string,
  @Body('newMessage') newMessage: string,
  @Request() req,
) {
  const updatedMessage = await this.chatService.editMessage(messageId, req.user.id, newMessage);
  return { success: true, message: updatedMessage };

}

}