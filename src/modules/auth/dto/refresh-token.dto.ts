// src/auth/dto/refresh-token.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsJWT()
  refreshToken: string;
}

// export class RefreshTokenDto {
//   @ApiProperty({
//     description: 'Refresh token to obtain new access token',
//     example:
//       'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
//     minLength: 100,
//     maxLength: 500,
//   })
//   @IsNotEmpty()
//   @IsString()
//   @IsJWT()
//   @Length(100, 500)
//   refreshToken: string;

//   @ApiPropertyOptional({
//     description: 'Device identifier for tracking refresh token usage',
//     example: 'iphone-12-pro-max-abc123',
//   })
//   @IsOptional()
//   @IsString()
//   @Length(5, 100)
//   deviceId?: string;

//   @ApiPropertyOptional({
//     description: 'IP address for security tracking',
//     example: '192.168.1.1',
//   })
//   @IsOptional()
//   @IsString()
//   @Matches(/^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/, {
//     message: 'Invalid IP address format',
//   })
//   ipAddress?: string;

//   @ApiPropertyOptional({
//     description: 'User agent string for browser/device identification',
//     example:
//       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
//   })
//   @IsOptional()
//   @IsString()
//   @Length(10, 500)
//   userAgent?: string;

//   @ApiPropertyOptional({
//     description: 'Previous access token (for enhanced security validation)',
//     example:
//       'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
//   })
//   @IsOptional()
//   @IsString()
//   @IsJWT()
//   previousAccessToken?: string;

//   // Transformation to sanitize inputs
//   //   @Transform(({ value }) => value?.trim())
//   //   refreshToken: string;

//   //   @Transform(({ value }) => value?.trim())
//   //   deviceId?: string;
// }
