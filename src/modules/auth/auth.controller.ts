import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto';
import { ApiResponseDto } from '../../common/dto/api-response.dto';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { UserService } from '../user/user.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('signup')
  @ApiOperation({ summary: 'Register a new user' })
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
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
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
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('profile')
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
}
