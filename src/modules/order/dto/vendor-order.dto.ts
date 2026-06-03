import { ApiProperty } from "@nestjs/swagger";

export class VendorOrderProductDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productName: string;

  @ApiProperty({
    nullable: true,
    example:
      "https://cdn.myapp.com/products/burger.jpg",
  })
  image: string | null;
}


export class VendorOrderItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  totalPrice: number;

  @ApiProperty({
    type: VendorOrderProductDto,
    nullable: true,
  })
  product: VendorOrderProductDto | null;
}

export class VendorSummaryDto {
  @ApiProperty()
  itemCount: number;

  @ApiProperty()
  totalQuantity: number;

  @ApiProperty()
  subtotal: number;
}


export class VendorOrderDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  orderCode: string;

  @ApiProperty()
  orderStatus: string;

  @ApiProperty()
  paymentStatus: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  recipientName: string;

  @ApiProperty()
  recipientPhone: string;

  @ApiProperty({
    type: [VendorOrderItemDto],
  })
  items: VendorOrderItemDto[];

  @ApiProperty({
    type: VendorSummaryDto,
  })
  vendorSummary: VendorSummaryDto;
}




