// src/vendors/dto/upload-document.dto.ts
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '../../../shared/enums';

export class UploadDocumentDto {
  @ApiProperty({
    enum: DocumentType,
    example: DocumentType.CAC,
  })
  @IsNotEmpty()
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiProperty({
    description: 'Optional description of the document',
    example: 'Business registration certificate issued 2023',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;
}
