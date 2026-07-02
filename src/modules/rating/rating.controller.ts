import {
  Body,
  Controller,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RatingService } from './rating.service';
import { SubmitRatingDto } from './dto/submit-rating.dto';
import { JwtAuthGuard } from '../../common/guards/auth.guard';

@ApiTags('Ratings')
@Controller('ratings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()

export class RatingController {
  constructor(private readonly ratingService: RatingService) {}

  @Patch(':ratingId/submit')
  @ApiOperation({
    summary: 'Submit a driver rating',
    description:
      'Allows a customer or vendor to submit a rating for a completed delivery.',
  })
  @ApiParam({
    name: 'ratingId',
    description: 'Rating request ID',
    example: 'clxk3r8gb0000x9abc123456',
  })
  @ApiResponse({
    status: 200,
    description: 'Rating submitted successfully.',
    schema: {
      example: {
        success: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid rating, rating already submitted, or rating has expired.',
  })
  @ApiResponse({
    status: 403,
    description: 'You are not authorized to submit this rating.',
  })
  @ApiResponse({
    status: 404,
    description: 'Rating request not found.',
  })
  async submitRating(
    @Param('ratingId') ratingId: string,
    @Body() dto: SubmitRatingDto,
    @Req() req: any,
  ) {
    return this.ratingService.submitRating(
      ratingId,
      req.user.id,
      dto.ratingValue,
      dto.comment,
    );
  }
}