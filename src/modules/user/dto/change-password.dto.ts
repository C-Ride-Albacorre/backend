import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, Matches, NotEquals } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPass@123',
    description: 'Your current account password',
  })
  @IsString()
  @MinLength(8, {
    message: 'Current password must be at least 8 characters long',
  })
  currentPassword: string;

  @ApiProperty({
    example: 'NewPass@456',
    description:
      'Your new password (must include letters, numbers, and a special character)',
  })
  @IsString()
  @MinLength(10, {
    message: 'New password must be at least 10 characters long',
  })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[\W_]).+$/, {
    message:
      'New password must contain at least one letter, one number, and one special character',
  })
  @NotEquals('currentPassword', {
    message: 'New password must be different from current password',
  })
  newPassword: string;
}
