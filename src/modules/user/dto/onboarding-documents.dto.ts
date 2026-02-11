// src/vendors/dto/onboarding-documents.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class OnboardingDocumentsDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    description:
      'Required documents: CAC, Business Permit, and ID Proof',
  })
  files: Express.Multer.File[];
}
