// // dto/get-delivery-options.query.ts
// import { Type } from 'class-transformer';
// import { IsLatitude, IsLongitude, IsNumber } from 'class-validator';

// export class GetDeliveryOptionsQueryDto {
//   @Type(() => Number)
//   @IsNumber()
//   @IsLatitude()
//   latitude: number;

//   @Type(() => Number)
//   @IsNumber()
//   @IsLongitude()
//   longitude: number;
// }

// get-delivery-options-query.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class GetDeliveryOptionsQueryDto {
  @ApiProperty({
    description: 'Full dropoff address to geocode',
    example: '12 Admiralty Way, Lekki Phase 1, Lagos',
    minLength: 5,
    maxLength: 300,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(300)
  address: string;
}