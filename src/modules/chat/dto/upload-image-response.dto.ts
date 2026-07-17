// src/modules/chat/dto/upload-image-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class UploadImageResponseDto {
  @ApiProperty({ example: 'https://cdn.example.com/chat/order-123/abc123.jpg' })
  url: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;
}