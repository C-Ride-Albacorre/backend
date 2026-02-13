import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Put,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  BadRequestException,
  Param,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { LoginDto } from './dto/login.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto';
import { ApiResponseDto } from '../../common/dto/api-response.dto';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { UserService } from '../user/user.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleAuthGuard } from '../../common/guards/google-auth.guard';
import { ConfigService } from '@nestjs/config';
import { OAuthProviderType } from '@prisma/client';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyOtpDto } from '../verification/dto/verify-otp.dto';
import {
  CompleteOnboardingDto,
  CreateVendorDto,
  VendorDocumentMetadataDto,
  VerifyEmailDto,
  VerifyPhoneDto,
} from './dto/create-vendor.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadDocumentDto } from '../user/dto/upload-document.dto';
// import { CurrentUser } from '../../common/guards/current-user.decorator';
import { Roles } from '../../common/decorators/role.decorator';
import { RolesGuard } from '../../common/guards/role.guard';
import { UserRole } from 'src/shared/enums';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private config: ConfigService,
  ) { }

  //CUSTOMER
  @Post('/customer/signup')
  @ApiOperation({ summary: 'Sign up a new customer' })
  @ApiBody({
    type: CreateCustomerDto,
    description: 'Sign up a new customer',
    required: true,
    schema: {
      example: { email: 'user@example.com', password: 'password' },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'User successfully registered',
    type: ApiResponseDto<AuthResponseDto>,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation or bad request error',
    type: ApiErrorResponseDto,
  })
  async registerCustomer(@Body() dto: CreateCustomerDto) {
    return this.authService.registerCustomer(dto);
  }

  @Post('/customer/verify')
  @ApiOperation({ summary: 'Verify registration OTP' })
  @ApiResponse({
    status: 200,
    description: 'Verification successful',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid OTP' })
  async verifyRegistration(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyRegistration(verifyOtpDto);
  }

  @Post('/customer/login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'User logged in successfully',
    type: ApiResponseDto<AuthResponseDto>,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Account deactivated' })
  //  @UsePipes(new ValidationPipe({ transform: true }))
  async loginCustomer(@Body() dto: LoginDto) {
    return this.authService.loginCustomer(dto);
  }

  @Post('/customer/resend-otp')
  @ApiOperation({ summary: 'Resend verification OTP' })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async resendCustomerOtp(@Body() body: { identifier: string }) {
    return this.authService.resendCustomerOtp(body.identifier);
  }

  // VENDOR
  @Post('/vendor/register')
  @ApiOperation({ summary: 'Register a new vendor' })
  @ApiResponse({ status: 201, description: 'Vendor registered successfully' })
  @ApiResponse({ status: 409, description: 'Vendor already exists' })
  async registerVendor(@Body() dto: CreateVendorDto) {
    return this.authService.registerVendor(dto);
  }

  @Post('/vendor/verify/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify vendor email' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async verifyVendorEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyVendorEmail(dto);
  }

  @Post('verify/phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify vendor phone' })
  @ApiResponse({ status: 200, description: 'Phone verified successfully' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async verifyVendorPhone(@Body() dto: VerifyPhoneDto) {
    return this.authService.verifyVendorPhone(dto);
  }

  @Post('/vendor/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vendor login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async loginVendor(@Body() loginDto: LoginDto) {
    return this.authService.loginVendor(loginDto);
  }

  /**
   * Complete full onboarding with document files
   * Users can select files from their computer
   */

  @Post('/vendor/onboarding/:vendorId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('documents', 10)) // 'documents' is the field name for files
  @ApiOperation({ summary: 'Complete vendor onboarding with document files' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        businessName: { type: 'string', example: 'Acme Inc.' },
        businessType: { type: 'string', example: 'Restaurant' },
        description: { type: 'string', example: 'Best restaurant in town' },
        businessPhone: { type: 'string', example: '+1234567890' },
        businessEmail: { type: 'string', example: 'business@acme.com' },
        address: { type: 'string', example: '123 Main St' },
        city: { type: 'string', example: 'Lagos' },
        state: { type: 'string', example: 'Lagos' },
        bankName: { type: 'string', example: 'First Bank' },
        accountName: { type: 'string', example: 'Acme Inc.' },
        accountNumber: { type: 'string', example: '0123456789' },
        documentsMetadata: {
          type: 'string',
          description: 'JSON string containing document metadata',
          example:
            '[{"documentType":"BUSINESS_REGISTRATION","description":"CAC certificate"},{"documentType":"TAX_CERTIFICATE","description":"Tax ID"}]',
        },
        documents: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Document files to upload (select from computer)',
        },
      },
    },
  })
  async completeOnboarding(
    @Param('vendorId') vendorId: string,
    @Body() dto: CompleteOnboardingDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    // Parse the documentsMetadata JSON string
    let documentsMetadata: VendorDocumentMetadataDto[] = [];
    try {
      documentsMetadata = JSON.parse(dto.documentsMetadata);
    } catch (error) {
      throw new BadRequestException('Invalid documentsMetadata JSON format');
    }

    // Validate that we have files
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'At least one document file must be uploaded',
      );
    }

    // Validate that number of files matches metadata
    // if (files.length !== documentsMetadata.length) {
    //   throw new BadRequestException(
    //     `Number of files (${files.length}) must match number of document metadata entries (${documentsMetadata.length})`,
    //   );
    // }

    return this.authService.completeVendorOnboarding(
      vendorId,
      dto,
      files,
      documentsMetadata,
    );
  }
  /**
   * Upload a single document file (for progressive onboarding)
   */
  @Post('onboarding/upload-document')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('documents')) // Still use FilesInterceptor for single file
  @ApiOperation({ summary: 'Upload a document file' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        documentType: {
          type: 'string',
          enum: ['BUSINESS_REGISTRATION', 'TAX_CERTIFICATE', 'IDENTIFICATION'],
        },
        description: { type: 'string' },
        documents: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Document file to upload (select from computer)',
        },
      },
    },
  })
  async uploadDocument(
    @Req() req,
    // @Body('documentType') documentType: string,
    // @Body('description') description: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No file uploaded');
    }

    return this.authService.uploadSingleDocument(
      req.user.id,
      dto,
      files[0], // Take the first file
    );
  }

  // @Post('/vendor/onboarding')
  // @UseGuards(JwtAuthGuard)
  // @HttpCode(HttpStatus.OK)
  // @ApiBearerAuth()
  // @ApiOperation({ summary: 'Complete business onboarding' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Onboarding completed successfully',
  // })
  // @ApiResponse({ status: 400, description: 'Email or phone not verified' })
  // async completeOnboarding(@Req() req, @Body() dto: CompleteOnboardingDto) {
  //   return this.authService.completeVendorOnboarding(req.user.id, dto);
  // }

  // @Post('resend-otp')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Resend verification OTP' })
  // @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  // async resendOtp(
  //   @Body('identifier') identifier: string,
  //   @Body('purpose') purpose: string,
  // ) {
  //   return this.authService.resendVerificationOtp(identifier, purpose as any);
  // }

  ///

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshTokenDto);
  }

  @Post('logout')
  //  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async logout(@Req() request): Promise<{ message: string }> {
    const userId = request.user.id;
    await this.authService.logout(userId);
    return { message: 'Logged out successfully' };
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({
    status: 200,
    description: 'Password reset email sent if user exists',
    type: ApiResponseDto<AuthResponseDto>,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation or bad request error',
    type: ApiErrorResponseDto,
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Put('reset-password')
  @ApiOperation({ summary: 'Reset password using reset token' })
  @ApiResponse({
    status: 200,
    description: 'Password successfully reset',
    type: ApiResponseDto<AuthResponseDto>,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation or bad request error',
    type: ApiErrorResponseDto,
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get logged-in user profile' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get logged-in user profile' })
  @ApiResponse({
    status: 200,
    description: 'Returns authenticated user info',
    type: ApiResponseDto<UserResponseDto>,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ApiErrorResponseDto,
  })
  async profile(@GetUser() user: any) {
    return this.userService.profile(user.id);
  }

  // Google OAuth routes (frontend flow)
  // Initiates Google OAuth redirect
  @Get('google')
  @ApiOperation({ summary: 'Login with Google OAuth' })
  @UseGuards(GoogleAuthGuard) /* passport google */ // register passport route in module
  // The route setup for redirect will be handled by passport middleware; in Nest you can do redirect flow in separate controller wired to passport
  async googleLogin() {
    return { msg: 'Redirect to Google' }; // passport will redirect
  }

  /**
   * Handles Google OAuth callback
   */
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback (JWT returned or redirect)' })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const googleUser = req.user as any;
    const jwtPayload = await this.authService.handleOAuthCallback(
      googleUser,
      OAuthProviderType.GOOGLE,
    );

    const frontendUrl = this.config.get('FRONTEND_URL');
    if (!frontendUrl) throw new Error('FRONTEND_URL not configured');

    const redirectUrl = `${frontendUrl}/redirect?token=${jwtPayload.accessToken}`;
    return res.redirect(redirectUrl);
  }
}