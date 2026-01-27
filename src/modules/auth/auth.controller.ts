import { Controller, Post, Body, Get, UseGuards, Put, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
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

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private config: ConfigService,
  ) {}

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


  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed', type: AuthResponseDto })
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


  @Post('login')
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
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
