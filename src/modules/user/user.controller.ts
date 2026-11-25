import {
  Body,
  Controller,
  Delete,
  Patch,
  UploadedFile,
  UploadedFiles,
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
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { CreateBusinessProfileDto } from './dto/create-business-profile.dto';
import { ApiResponseDto } from '../../common/dto/api-response.dto';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto';
import { UpdateEmailDto } from './dto/update-email.dto.';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateBusinessProfileDto } from './dto/update-busines-profile';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  
@Patch('business-profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiOperation({
  summary: 'Create or update vendor business profile and upload documents',
})
@ApiConsumes('multipart/form-data')
@UseInterceptors(
  FilesInterceptor('files', 10),
)
@ApiBody({
  description: 'Business information and vendor document uploads',
  type: UpdateBusinessProfileDto,
})
async updateBusinessProfile(
  @GetUser() user: any,
  @Body() dto: UpdateBusinessProfileDto,
  @UploadedFiles() files: Express.Multer.File[],
  @Body('documentTypes') documentTypes?: string[],
) {
  return this.userService.updateBusinessProfile(
    user.id,
    dto,
    files ?? [],
    documentTypes ?? [],
  );
}



  @Patch('profile')
  @ApiOperation({ summary: 'Edit logged-in user profile' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: ApiResponseDto<UserResponseDto>,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ApiErrorResponseDto,
  })
  async updateProfile(
    @GetUser() user: any,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(user.id, dto);
  }


  @Patch('update-email')
  @ApiOperation({ summary: 'Update logged-in dispatcher email' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Email updated successfully',
  })
  async updateEmail(
    @GetUser() user: any,
    @Body() dto: UpdateEmailDto,
  ) {
    return this.userService.updateEmail(user.id, dto.email);
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

  @Delete('delete')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete user account' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: { type: 'string', example: 'No longer need the account' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'User account deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteUser(@GetUser() user: any, @Body('reason') reason: string) {
    return this.userService.deleteUser(user.id, reason);
  }




}
