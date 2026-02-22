// src/auth/dto/password.dto.ts
import {
  IsString,
  IsEmail,
  IsPhoneNumber,
  MinLength,
  Matches,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// export class ForgotPasswordDto {
//   @ApiProperty({
//     description: 'Email address for password reset',
//     example: 'user@example.com',
//     required: false,
//   })
//   @IsOptional()
//   @IsEmail()
//   email?: string;

//   @ApiProperty({
//     description: 'Phone number for password reset',
//     example: '+1234567890',
//     required: false,
//   })
//   @IsOptional()
//   @IsPhoneNumber()
//   phoneNumber?: string;

//   // Ensure at least one identifier is provided
//   // constructor(partial: Partial<ForgotPasswordDto>) {
//   //   Object.assign(this, partial);
//   //   if (!this.email && !this.phoneNumber) {
//   //     throw new Error('Either email or phoneNumber must be provided');
//   //   }
//   // }
// }

export class ForgotPasswordDto {
  @ApiPropertyOptional({
    example: 'user@example.com',
  })
  @ValidateIf((o) => !o.phoneNumber)
  @IsEmail()
  @IsNotEmpty()
  email?: string;

  @ApiPropertyOptional({
    example: '+1234567890',
  })
  @ValidateIf((o) => !o.email)
  // @IsPhoneNumber()
  @IsNotEmpty()
  phoneNumber?: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Reset token received via email/SMS' })
  @IsString()
  token: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewPassword123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
    {
      message:
        'Password must contain at least 1 uppercase, 1 lowercase, 1 number and 1 special character',
    },
  )
  newPassword: string;
}

export class VerifyResetTokenDto {
  @ApiProperty({ description: 'Reset token to verify' })
  @IsString()
  token: string;
}
