import {
  Body,
  Controller,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserService } from './user.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateBusinessProfileDto } from './dto/create-business-profile.dto';
import { ApiResponseDto } from 'src/common/dto/api-response.dto';
import { ApiErrorResponseDto } from 'src/common/dto/api-error-response.dto';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Patch('business-profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create or update business profile (authenticated)',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiBody({
    description: 'Business profile data with optional logo upload',
    type: CreateBusinessProfileDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Business profile created or updated successfully',
    type: ApiResponseDto<CreateBusinessProfileDto>,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ApiErrorResponseDto,
  })
  async createOrUpdateProfile(
    @GetUser() user: any,
    @Body() dto: CreateBusinessProfileDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.userService.createOrUpdateProfile(user.id, dto, file);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid password' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async changePassword(
    @GetUser() user: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    const { currentPassword, newPassword } = changePasswordDto;
    return this.userService.changePassword(
      user.id,
      currentPassword,
      newPassword,
    );
  }
}
