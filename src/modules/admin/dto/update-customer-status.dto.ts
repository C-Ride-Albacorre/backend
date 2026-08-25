// import { IsEnum } from 'class-validator';
// import { UserStatus } from '@prisma/client';
// import { ApiProperty } from '@nestjs/swagger';

// export class UpdateCustomerStatusDto {
//   @ApiProperty({ enum: UserStatus, required: true })
//   @IsEnum(UserStatus)
//   status: UserStatus;
// }

import { IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCustomerStatusDto {
  @ApiProperty({
    enum: [UserStatus.ACTIVE, UserStatus.SUSPENDED],
    required: true,
  })
  @IsEnum([UserStatus.ACTIVE, UserStatus.SUSPENDED])
  status: UserStatus;
}
