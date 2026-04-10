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
  BadRequestException,
  Param,
  Logger,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerLoginDto, LoginDto } from './dto/login.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto';
import { ApiResponseDto } from '../../common/dto/api-response.dto';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { UserService } from '../user/user.service';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto';
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
import { Roles } from '../../common/decorators/role.decorator';
import { RolesGuard } from '../../common/guards/role.guard';
import { UserRole } from '../../shared/enums';
import { AuthResponse } from './interface/auth-response.interface';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { OAuthUser } from '../../common/decorators/oauth-user.decorator';
import { ResetPasswordWithOtpDto } from './dto/reset-password-with-otp.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { AddPhoneDto } from './dto/add-phone-number.dto';
import { CreateAdminDto } from '../admin/dto/create-admin.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private config: ConfigService,
  ) {}

  @Post('create-admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new admin (Super Admin only)' })
  @ApiResponse({ status: 201, description: 'Admin created successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires Super Admin role',
  })
  async createAdmin(@GetUser() user: any, @Body() dto: CreateAdminDto) {
    return this.authService.createAdmin(user.id, dto);
  }

  @Post('/admin/login')
  @HttpCode(HttpStatus.OK)
  // @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Admin login' })
  @ApiBody({
    description: 'Log in as ADMIN',
    required: true,
    schema: {
      example: { email: 'user@example.com', password: 'password' },
    },
  })
  async loginAdminAndSuperAdmin(
    @Body() dto: { email: string; password: string },
  ) {
    return this.authService.login(dto);
  }

  // @Post('/admin/verify')
  // @ApiOperation({ summary: 'Verify Admin login OTP' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Verification successful',
  //   type: AuthResponseDto,
  // })
  // @ApiResponse({ status: 401, description: 'Invalid OTP' })
  // async verifyAdminLogin(@Body() dto: VerifyOtpDto) {
  //   return this.authService.verifyRegistration(dto);
  // }
  @Post('/admin/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Verification successful',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid OTP' })
  async verifyAdminLogin(@Req() req, @Body() dto: VerifyOtpDto) {
    return this.authService.verifyRegistration(req.user.id, dto);
  }

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

  // @Post('/customer/verify')
  // @ApiOperation({ summary: 'Verify registration OTP' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Verification successful',
  //   type: AuthResponseDto,
  // })
  // @ApiResponse({ status: 401, description: 'Invalid OTP' })
  // async verifyRegistration(@Body() verifyOtpDto: VerifyOtpDto) {
  //   return this.authService.verifyRegistration(verifyOtpDto);
  // }
  @Post('/customer/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify registration OTP' })
  @ApiResponse({
    status: 200,
    description: 'Verification successful',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid OTP' })
  async verifyRegistration(@Req() req, @Body() dto: VerifyOtpDto) {
    return this.authService.verifyRegistration(req.user.id, dto);
  }

  @Post('/customer/login')
  @ApiOperation({ summary: 'Login with email and password | phone number' })
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
  //@UsePipes(new ValidationPipe({ transform: true }))
  async loginCustomer(@Body() dto: CustomerLoginDto) {
    return this.authService.loginCustomer(dto);
  }

  @Post('/resend-otp')
  @ApiOperation({
    summary: 'Resend verification OTP  email | phone number',
  })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async resendCustomerOtp(@Body() body: ResendOtpDto) {
    return this.authService.resendCustomerOtp(body.identifier);
  }

  // VENDOR
  // @Post('/vendor/register')
  // @ApiOperation({ summary: 'Register a new vendor' })
  // @ApiResponse({ status: 201, description: 'Vendor registered successfully' })
  // @ApiResponse({ status: 409, description: 'Vendor already exists' })
  // async registerVendor(@Body() dto: CreateVendorDto) {
  //   return this.authService.registerVendor(dto);
  // }

  @Post('/vendor/register')
  @ApiOperation({ summary: 'Register a new Vendor' })
  @ApiResponse({ status: 201, description: 'Vendor registered successfully' })
  @ApiResponse({ status: 409, description: 'Vendor already exists' })
  async registerVendor(@Body() dto: CreateUserDto) {
    return this.authService.registerUser(dto, UserRole.VENDOR);
  }

  // @Post('/vendor/verify/email')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Verify vendor email' })
  // @ApiResponse({ status: 200, description: 'Email verified successfully' })
  // @ApiResponse({ status: 401, description: 'Invalid verification code' })
  // async verifyVendorEmail(@Body() dto: VerifyEmailDto) {
  //   return this.authService.verifyVendorEmail(dto);
  // }

  // @Post('/user/verify/email')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Verify user email' })
  // @ApiResponse({ status: 200, description: 'Email verified successfully' })
  // @ApiResponse({ status: 401, description: 'Invalid verification code' })
  // async verifyUserEmail(@Body() dto: VerifyEmailDto) {
  //   return this.authService.verifyUserEmail(dto);
  // }

  @Post('/user/verify/email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify user email' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async verifyUserEmail(@Req() req, @Body() dto: VerifyEmailDto) {
    return this.authService.verifyUserEmail(req.user.id, dto);
  }

  // @Post('/vendor/verify/phone')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Verify vendor phone' })
  // @ApiResponse({ status: 200, description: 'Phone verified successfully' })
  // @ApiResponse({ status: 401, description: 'Invalid verification code' })
  // async verifyVendorPhone(@Body() dto: VerifyPhoneDto) {
  //   return this.authService.verifyVendorPhone(dto);
  // }
  @Post('/user/add/phone')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.VENDOR)
  @ApiOperation({ summary: 'Add phone number for authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'OTP sent to phone number successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'Phone number already in use or already verified',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async addPhoneNumber(@Req() req, @Body() dto: AddPhoneDto) {
    return this.authService.addPhoneNumber(req.user.id, dto);
  }

  @Post('/user/verify/phone')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify user phone' })
  @ApiResponse({ status: 200, description: 'Phone verified successfully' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async verifyUserPhone(@Req() req, @Body() dto: VerifyPhoneDto) {
    return this.authService.verifyUserPhone(req.user.id, dto);
  }

  // @Post('/user/verify/phone')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Verify user phone' })
  // @ApiResponse({ status: 200, description: 'Phone verified successfully' })
  // @ApiResponse({ status: 401, description: 'Invalid verification code' })
  // async verifyUserPhone(@Body() dto: VerifyPhoneDto) {
  //   return this.authService.verifyUserPhone(dto);
  // }

  // @Post('/vendor/login')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Vendor login' })
  // @ApiResponse({ status: 200, description: 'Login successful' })
  // @ApiResponse({ status: 401, description: 'Invalid credentials' })
  // async loginVendor(@Body() loginDto: LoginDto) {
  //   return this.authService.loginVendor(loginDto);
  // }

  @Post('/vendor/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async loginUser(@Body() loginDto: LoginDto) {
    return this.authService.loginUser(loginDto, UserRole.VENDOR);
  }

  @Post('/vendor/onboarding/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.VENDOR)
  @ApiOperation({
    summary: 'Submit final onboarding (Step 5 - Upload Documents)',
    description:
      'Uploads required business documents and submits onboarding for admin review.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('documents', 10))
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        documentsMetadata: {
          type: 'string',
          description:
            'JSON string array describing each uploaded document. Example: [{"documentType":"CAC","description":"CAC certificate"}]',
          example:
            '[{"documentType":"CAC","description":"CAC certificate"},{"documentType":"ID_PROOF","description":"Passport"}]',
        },
        documents: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Business document files',
        },
      },
      required: ['documentsMetadata', 'documents'],
    },
  })
  async submitVendorOnboarding(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('documentsMetadata') documentsMetadataRaw: string, // raw JSON string
    @Req() req: Request,
  ) {
    const vendorId = (req.user as any).id;

    let documentsMetadata: VendorDocumentMetadataDto[];

    try {
      documentsMetadata = JSON.parse(documentsMetadataRaw);
    } catch (error) {
      throw new BadRequestException('Invalid documentsMetadata JSON format');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one document must be uploaded');
    }

    return this.authService.submitVendorOnboarding(
      vendorId,
      files,
      documentsMetadata,
    );
  }

  /**
   * ================================
   * SAVE STEP (1–4)
   * ================================
   */

  @Post('/vendor/onboarding/:step')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.VENDOR)
  @ApiOperation({
    summary: 'Save vendor onboarding step (1–4)',
    description:
      'Saves onboarding progress for the specified step. Steps must be completed sequentially.',
  })
  @ApiParam({
    name: 'step',
    type: Number,
    example: 1,
    description: 'Onboarding step number (1–4)',
  })
  @ApiResponse({
    status: 200,
    description: 'Step saved successfully',
  })
  @ApiBody({
    description: `
STEP 1 – Business Information
--------------------------------
{
  "businessName": "Acme Inc.",
  "businessType": "Restaurant",
  "registrationNumber": "RC1234567",
  "taxId": "12345678-0001",
  "description": "Best restaurant in town"
}

STEP 2 – Contact Details
--------------------------------
{
  "businessPhone": "+1234567890",
  "businessEmail": "business@acme.com"
}

STEP 3 – Business Address
--------------------------------
{
  "address": "123 Main St",
  "city": "Lagos",
  "state": "Lagos"
}

STEP 4 – Bank Details
--------------------------------
{
  "bankName": "First Bank",
  "accountName": "Acme Inc.",
  "accountNumber": "0123456789"
}
`,
    schema: {
      type: 'object',
      properties: {
        businessName: { type: 'string' },
        businessType: { type: 'string' },
        registrationNumber: { type: 'string' },
        taxId: { type: 'string' },
        description: { type: 'string' },

        businessPhone: { type: 'string' },
        businessEmail: { type: 'string' },

        address: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },

        bankName: { type: 'string' },
        accountName: { type: 'string' },
        accountNumber: { type: 'string' },
      },
    },
  })
  async saveVendorOnboardingStep(
    @Param('step', ParseIntPipe) step: number,
    @Body() dto: Partial<CompleteOnboardingDto>,
    @Req() req: Request,
  ) {
    const vendorId = (req.user as any).id;

    if (step < 1 || step > 4) {
      throw new BadRequestException('Step must be between 1 and 4');
    }

    return this.authService.saveVendorOnboardingStep(vendorId, step, dto);
  }

  /**
   * ================================
   * GET CURRENT ONBOARDING STATE
   * ================================
   */
  @Get('/vendor/onboarding/state')
  @ApiOperation({
    summary: 'Get current vendor onboarding state',
    description:
      'Returns onboardingStatus, onboardingStep, and account status for redirect logic.',
  })
  @ApiResponse({
    status: 200,
    description: 'Onboarding state retrieved successfully',
  })
  async getOnboardingState(@Req() req: Request) {
    const vendorId = (req.user as any).id;

    return this.authService.getVendorOnboardingState(vendorId);
  }

  //DRIVER
  @Post('/driver/register')
  @ApiOperation({ summary: 'Register a new Driver' })
  @ApiResponse({ status: 201, description: 'Driver registered successfully' })
  @ApiResponse({ status: 409, description: 'Driver already exists' })
  async registerDriver(@Body() dto: CreateUserDto) {
    return this.authService.registerUser(dto, UserRole.DISPATCHER);
  }

  @Post('/driver/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Driver login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async loginDriver(@Body() loginDto: LoginDto) {
    return this.authService.loginUser(loginDto, UserRole.DISPATCHER);
  }
  //   async registerDriver(dto: CreateDriverDto) {
  //     return this.userRegistrationService.registerUser(
  //       {
  //         email: dto.email,
  //         phoneNumber: dto.phoneNumber,
  //         password: dto.password,
  //         firstName: dto.firstName,
  //         lastName: dto.lastName,
  //       },
  //       this.registrationOptions,
  //     );
  //   }

  //   async verifyDriverEmail(dto: VerifyEmailDto): Promise<VerificationResult> {
  //     const result = await this.userRegistrationService.verifyEmail(
  //       dto.email,
  //       dto.otp,
  //       {
  //         role: UserRole.DRIVER,
  //         verificationPurpose: 'driver_email_verification',
  //         nextStatusAfterVerification: UserStatus.ACTIVE,
  //       },
  //     );

  //     // If both verified, create driver profile
  //     if (result.requiresOnboarding) {
  //       const user = await this.userService.findByEmail(dto.email);
  //       if (user) {
  //         await this.createDriverProfile(user.id);
  //       }
  //     }

  //     return result;
  //   }

  //   async verifyDriverPhone(dto: VerifyPhoneDto): Promise<VerificationResult> {
  //     const result = await this.userRegistrationService.verifyPhone(
  //       dto.phoneNumber,
  //       dto.otp,
  //       {
  //         role: UserRole.DRIVER,
  //         verificationPurpose: 'driver_phone_verification',
  //         nextStatusAfterVerification: UserStatus.ACTIVE,
  //       },
  //     );

  //     // If both verified, create driver profile
  //     if (result.requiresOnboarding) {
  //       const user = await this.userService.findByPhone(dto.phoneNumber);
  //       if (user) {
  //         await this.createDriverProfile(user.id);
  //       }
  //     }

  //     return result;
  //   }

  //   async loginDriver(loginDto: LoginDto) {
  //     const identifier = loginDto.email || loginDto.phoneNumber;
  //     const user = await this.userRegistrationService.loginUser(
  //       identifier,
  //       loginDto.password,
  //       UserRole.DRIVER,
  //     );

  //     return user;
  //   }

  //   private async createDriverProfile(userId: string) {
  //     // Create driver profile logic
  //     // This could include license verification, background check, etc.
  //   }

  //   @Post('refresh')
  //   @ApiOperation({ summary: 'Refresh access token' })
  //   @ApiResponse({
  //     status: 200,
  //     description: 'Token refreshed',
  //     type: AuthResponseDto,
  //   })
  //   @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  //   async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto) {
  //     return this.authService.refreshTokens(refreshTokenDto);
  //   }

  //   //DRIVER
  // // Driver endpoints
  //   @Post('/driver/register')
  //   @ApiOperation({ summary: 'Register a new driver' })
  //   @ApiResponse({ status: 201, description: 'Driver registered successfully' })
  //   async registerDriver(@Body() dto: CreateDriverDto) {
  //     return this.authService.registerDriver(dto);
  //   }

  //   @Post('/driver/verify/email')
  //   @HttpCode(HttpStatus.OK)
  //   @ApiOperation({ summary: 'Verify driver email' })
  //   async verifyDriverEmail(@Body() dto: VerifyEmailDto) {
  //     return this.authService.verifyDriverEmail(dto);
  //   }

  //   @Post('/driver/verify/phone')
  //   @HttpCode(HttpStatus.OK)
  //   @ApiOperation({ summary: 'Verify driver phone' })
  //   async verifyDriverPhone(@Body() dto: VerifyPhoneDto) {
  //     return this.authService.verifyDriverPhone(dto);
  //   }

  //   @Post('/driver/login')
  //   @HttpCode(HttpStatus.OK)
  //   @ApiOperation({ summary: 'Driver login' })
  //   async loginDriver(@Body() loginDto: LoginDto) {
  //     return this.authService.loginDriver(loginDto);
  //   }
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
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Sends password reset instructions via email or SMS if the account exists and is eligible.',
  })
  @ApiBody({
    type: ForgotPasswordDto,
  })
  @ApiOkResponse({
    description: 'Password reset flow processed',
    schema: {
      oneOf: [
        {
          example: {
            success: true,
            message:
              'If an account exists with this email/phone, you will receive reset instructions.',
          },
        },
        {
          example: {
            success: true,
            message: 'Password reset instructions sent successfully.',
            identifier: 'user@example.com',
            method: 'email',
          },
        },
        {
          example: {
            success: false,
            message:
              'Please verify your account first before resetting password.',
          },
        },
        {
          example: {
            success: false,
            message:
              'Failed to send reset instructions. Please try again later.',
          },
        },
      ],
    },
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

  @Post('reset-password/otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset password using OTP' })
  @ApiBody({ type: ResetPasswordWithOtpDto })
  @ApiResponse({
    status: 200,
    description: 'Password has been reset successfully',
    schema: {
      example: {
        success: true,
        message: 'Password has been reset successfully.',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired OTP, or user not found/inactive',
  })
  async resetPasswordWithOtp(@Body() dto: ResetPasswordWithOtpDto) {
    return this.authService.resetPasswordWithOtp({
      identifier: dto.phoneNumber, // Map to identifier expected by the service
      otp: dto.otp,
      newPassword: dto.newPassword,
    });
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
  @UseGuards(GoogleAuthGuard) // Passport Google strategy
  @ApiOperation({ summary: 'Login with Google OAuth' })
  @ApiQuery({
    name: 'role',
    required: true,
    description: 'Role of the user (e.g., VENDOR or CUSTOMER)',
    example: 'VENDOR',
  })
  async googleLogin() {
    this.logger.log('Google OAuth login initiated');
    return; // Passport will handle the redirect automatically
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback handler' })
  async googleCallback(
    @OAuthUser() googleUser: OAuthUser,
    @Res() res: Response,
  ) {
    this.logger.debug(`OAuth callback - Role: ${googleUser.requestedRole}`);

    // Handle user creation or retrieval
    const authResponse = await this.authService.handleOAuthCallback(
      googleUser,
      OAuthProviderType.GOOGLE,
      googleUser.requestedRole as UserRole,
    );

    // Redirect to frontend with tokens in URL
    const frontendUrl = this.getFrontendUrl();
    const redirectUrl = new URL(`${frontendUrl}/google/callback`);
    redirectUrl.searchParams.append('success', 'true');
    redirectUrl.searchParams.append('accessToken', authResponse.accessToken);
    if (authResponse.refreshToken) {
      redirectUrl.searchParams.append(
        'refreshToken',
        authResponse.refreshToken,
      );
    }
    redirectUrl.searchParams.append('userId', authResponse.user.id);

    return res.redirect(redirectUrl.toString());
  }

  // Google OAuth routes (frontend flow)
  // Initiates Google OAuth redirect
  // @Get('google')
  // @UseGuards(GoogleAuthGuard) /* passport google */ // register passport route in module
  // @ApiOperation({ summary: 'Login with Google OAuth' })
  // @ApiOperation({ summary: 'Login with Google OAuth' })
  // @ApiQuery({
  //   name: 'role',
  //   required: true,
  //   description: 'Role of the user (e.g., VENDOR or CUSTOMER)',
  //   example: 'VENDOR',
  // })
  // async googleLogin() {
  //   this.logger.log('Google OAuth login initiated');
  //   return; // return { msg: 'Redirect to Google' }; // passport will redirect
  // }

  // @Get('google/callback')
  // // @Get('/api/auth/google/callback')
  // @UseGuards(GoogleAuthGuard)
  // @ApiOperation({ summary: 'Google OAuth callback handler' })
  // async googleCallback(
  //   @OAuthUser() googleUser: OAuthUser,
  //   @Res() res: Response, // ❗ remove passthrough
  //   // @Res({ passthrough: true }) res: Response,
  // ) {
  //   this.logger.debug(`OAuth callback - Role: ${googleUser.requestedRole}`);

  //   const authResponse = await this.authService.handleOAuthCallback(
  //     googleUser,
  //     OAuthProviderType.GOOGLE,
  //     googleUser.requestedRole as UserRole, // Cast if needed
  //   );

  //   this.setAuthCookies(res, authResponse);

  //   // Redirect to frontend
  //   const frontendUrl = this.getFrontendUrl();
  //   return res.redirect(`${frontendUrl}/google/callback?success=true`);
  // }

  /**
   * Handles Google OAuth callback
   */
  //@Get('google/callback/without/param')
  @UseGuards(GoogleAuthGuard)
  // @ApiOperation({ summary: 'Google OAuth callback handler' })
  async googleCallbackWithoutParam(
    @Req() req: Request,
    @Res() res: Response,
    @Query('role') role?: UserRole,
  ) {
    this.logger.log('Google OAuth callback received');

    try {
      const googleUser = req.user as any;

      this.logger.debug(
        `Google user data: ${JSON.stringify({
          email: googleUser?.email,
          id: googleUser?.id,
          name: googleUser?.name,
          role,
        })}`,
      );

      if (!googleUser) {
        this.logger.error('No user data from Google');
        return res.redirect(
          `${this.getFrontendUrl()}/login?error=no_user_data`,
        );
      }

      if (role && !Object.values(UserRole).includes(role)) {
        return res.redirect(
          `${this.getFrontendUrl()}/login?error=invalid_role`,
        );
      }

      // Process OAuth callback
      const authResponse = await this.authService.handleOAuthCallback(
        googleUser,
        OAuthProviderType.GOOGLE,
        role,
      );

      const frontendUrl = this.getFrontendUrl();

      // Redirect with tokens (you might want to use a more secure method)
      const redirectUrl = new URL('/oauth-redirect', frontendUrl);
      redirectUrl.searchParams.append('accessToken', authResponse.accessToken);
      redirectUrl.searchParams.append(
        'refreshToken',
        authResponse.refreshToken,
      );

      // Optionally encode user data (be careful with size)
      const userData = Buffer.from(JSON.stringify(authResponse.user)).toString(
        'base64',
      );
      redirectUrl.searchParams.append('user', userData);

      this.logger.log(
        `Redirecting user to: ${redirectUrl.origin}${redirectUrl.pathname}`,
      );

      return res.redirect(redirectUrl.toString());
    } catch (error) {
      this.logger.error(
        `Google OAuth callback error: ${error.message}`,
        error.stack,
      );

      const frontendUrl = this.getFrontendUrl();
      return res.redirect(
        `${frontendUrl}/login?error=oauth_failed&message=${encodeURIComponent(error.message)}`,
      );
    }
  }

  /**
   * Get frontend URL with fallback
   */
  private getFrontendUrl(): string {
    const frontendUrl = this.config.get('FRONTEND_URL');
    if (!frontendUrl) {
      this.logger.error('FRONTEND_URL not configured');
      throw new Error('FRONTEND_URL not configured');
    }
    return frontendUrl;
  }

  private setAuthCookies(res: Response, authResponse: AuthResponse) {
    res.cookie('accessToken', authResponse.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 15 * 60 * 1000, // 15 min
    });

    res.cookie('refreshToken', authResponse.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }
}
