// src/vendors/dto/create-vendor.dto.ts
import {
  IsEmail,
  IsNotEmpty,
  IsPhoneNumber,
  IsString,
  MinLength,
  Matches,
  IsOptional,
  Length,
  IsUrl,
  IsArray,
  IsEnum,
  IsObject,
  MaxLength,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { DocumentType } from '../../../shared/enums';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+1234567890' })
  @IsNotEmpty()
  //@IsString()
  @IsPhoneNumber(null)
  phoneNumber: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiProperty({ example: 'StrongP@ssw0rd' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  password: string;

  @ApiProperty({ example: 'John' })
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsNotEmpty()
  @IsString()
  lastName: string;
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '+1234567890' })
  @IsNotEmpty()
  @IsPhoneNumber()
  phoneNumber: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;
}
// src/users/dtos/complete-onboarding.dto.ts

export class VendorDocumentDto {
  @ApiProperty({
    description: 'Type of document',
    enum: DocumentType,
    example: DocumentType.CAC,
  })
  @IsEnum(DocumentType, { message: 'Invalid document type' })
  documentType: DocumentType;

  @ApiProperty({
    description: 'URL of the uploaded document',
    example: 'https://res.cloudinary.com/.../document.pdf',
  })
  @IsUrl({}, { message: 'Document URL must be a valid URL' })
  documentUrl: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the document',
    example: {
      originalName: 'cac_certificate.pdf',
      mimeType: 'application/pdf',
      size: 1048576,
      uploadedAt: '2024-01-01T00:00:00Z',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
  description: any;

  // @ApiPropertyOptional({
  //   description: 'Document description or notes',
  //   example: 'Certificate of Incorporation',
  // })
  // @IsOptional()
  // @IsString()
  // @MaxLength(500, { message: 'Description cannot exceed 500 characters' })
  // description?: string;

  // @ApiPropertyOptional({
  //   description: 'Document expiry date if applicable',
  //   example: '2025-12-31',
  // })
  // @IsOptional()
  // @IsString()
  // @Matches(/^\d{4}-\d{2}-\d{2}$/, {
  //   message: 'Expiry date must be in YYYY-MM-DD format',
  // })
  // expiryDate?: string;

  // @ApiPropertyOptional({
  //   description: 'Whether this is the primary document of its type',
  //   example: true,
  // })
  // @IsOptional()
  // @IsBoolean()
  // isPrimary?: boolean;
}

export class BusinessAddressDto {
  // @ApiProperty({
  //   description: 'Street address',
  //   example: '123 Business Avenue',
  // })
  // @IsString()
  // @MinLength(5, { message: 'Address must be at least 5 characters long' })
  // @MaxLength(200, { message: 'Address cannot exceed 200 characters' })
  // street: string;

  @ApiProperty({
    description: 'City',
    example: 'Lagos',
  })
  @IsString()
  @MinLength(2, { message: 'City must be at least 2 characters long' })
  @MaxLength(100, { message: 'City cannot exceed 100 characters' })
  city: string;

  @ApiProperty({
    description: 'State/Province',
    example: 'Lagos State',
  })
  @IsString()
  @MinLength(2, { message: 'State must be at least 2 characters long' })
  @MaxLength(100, { message: 'State cannot exceed 100 characters' })
  state: string;

  @ApiPropertyOptional({
    description: 'Postal/ZIP code',
    example: '100001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Postal code cannot exceed 20 characters' })
  postalCode?: string;

  @ApiProperty({
    description: 'Country',
    example: 'Nigeria',
  })
  @IsString()
  @MinLength(2, { message: 'Country must be at least 2 characters long' })
  @MaxLength(100, { message: 'Country cannot exceed 100 characters' })
  country: string;

  @ApiPropertyOptional({
    description: 'Additional address details',
    example: 'Suite 201, Second Floor',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, {
    message: 'Additional details cannot exceed 200 characters',
  })
  additionalDetails?: string;
}

export class BusinessHoursDto {
  @ApiPropertyOptional({
    description: 'Monday business hours',
    example: '9:00 AM - 6:00 PM',
  })
  @IsOptional()
  @IsString()
  monday?: string;

  @ApiPropertyOptional({
    description: 'Tuesday business hours',
    example: '9:00 AM - 6:00 PM',
  })
  @IsOptional()
  @IsString()
  tuesday?: string;

  @ApiPropertyOptional({
    description: 'Wednesday business hours',
    example: '9:00 AM - 6:00 PM',
  })
  @IsOptional()
  @IsString()
  wednesday?: string;

  @ApiPropertyOptional({
    description: 'Thursday business hours',
    example: '9:00 AM - 6:00 PM',
  })
  @IsOptional()
  @IsString()
  thursday?: string;

  @ApiPropertyOptional({
    description: 'Friday business hours',
    example: '9:00 AM - 6:00 PM',
  })
  @IsOptional()
  @IsString()
  friday?: string;

  @ApiPropertyOptional({
    description: 'Saturday business hours',
    example: '10:00 AM - 4:00 PM',
  })
  @IsOptional()
  @IsString()
  saturday?: string;

  @ApiPropertyOptional({
    description: 'Sunday business hours',
    example: 'Closed',
  })
  @IsOptional()
  @IsString()
  sunday?: string;

  @ApiPropertyOptional({
    description: 'Additional notes about business hours',
    example: 'Closed on public holidays',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Notes cannot exceed 200 characters' })
  notes?: string;
}

export class SocialMediaDto {
  @ApiPropertyOptional({
    description: 'Facebook page URL',
    example: 'https://facebook.com/yourbusiness',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Facebook URL must be a valid URL' })
  facebook?: string;

  @ApiPropertyOptional({
    description: 'Instagram profile URL',
    example: 'https://instagram.com/yourbusiness',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Instagram URL must be a valid URL' })
  instagram?: string;

  @ApiPropertyOptional({
    description: 'Twitter/X profile URL',
    example: 'https://twitter.com/yourbusiness',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Twitter URL must be a valid URL' })
  twitter?: string;

  @ApiPropertyOptional({
    description: 'LinkedIn company page URL',
    example: 'https://linkedin.com/company/yourbusiness',
  })
  @IsOptional()
  @IsUrl({}, { message: 'LinkedIn URL must be a valid URL' })
  linkedin?: string;

  @ApiPropertyOptional({
    description: 'YouTube channel URL',
    example: 'https://youtube.com/@yourbusiness',
  })
  @IsOptional()
  @IsUrl({}, { message: 'YouTube URL must be a valid URL' })
  youtube?: string;
}

export class BankDetailsDto {
  @ApiProperty({
    description: 'Bank name',
    example: 'First Bank of Nigeria',
  })
  @IsString()
  @MinLength(2, { message: 'Bank name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Bank name cannot exceed 100 characters' })
  bankName: string;

  @ApiProperty({
    description: 'Account name',
    example: 'Business Name Ltd',
  })
  @IsString()
  @MinLength(3, { message: 'Account name must be at least 3 characters long' })
  @MaxLength(200, { message: 'Account name cannot exceed 200 characters' })
  accountName: string;

  @ApiProperty({
    description: 'Account number',
    example: '0123456789',
  })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  accountNumber: string;

  // @ApiPropertyOptional({
  //   description: 'Bank sort code',
  //   example: '011',
  // })
  // @IsOptional()
  // @IsString()
  // @Matches(/^\d{3}$/, { message: 'Sort code must be 3 digits' })
  // sortCode?: string;

  // @ApiPropertyOptional({
  //   description: 'Bank routing number',
  //   example: '123456789',
  // })
  // @IsOptional()
  // @IsString()
  // routingNumber?: string;

  // @ApiPropertyOptional({
  //   description: 'SWIFT/BIC code for international transfers',
  //   example: 'FBNINGLA',
  // })
  // @IsOptional()
  // @IsString()
  // @Matches(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, {
  //   message: 'Invalid SWIFT/BIC code format'
  // })
  // swiftCode?: string;

  // @ApiPropertyOptional({
  //   description: 'Bank branch address',
  //   example: '123 Bank Street, Lagos',
  // })
  // @IsOptional()
  // @IsString()
  // @MaxLength(200, { message: 'Branch address cannot exceed 200 characters' })
  // branchAddress?: string;

  // @ApiPropertyOptional({
  //   description: 'Currency for the account',
  //   example: 'NGN',
  // })
  // @IsOptional()
  // @IsString()
  // @Matches(/^[A-Z]{3}$/, { message: 'Currency must be a 3-letter ISO code' })
  // currency?: string;
}

export class CompleteOnboardingDtoFull {
  @ApiProperty({
    description: 'Legal business name',
    example: 'Business Name Ltd',
  })
  @IsString()
  @MinLength(2, { message: 'Business name must be at least 2 characters long' })
  @MaxLength(200, { message: 'Business name cannot exceed 200 characters' })
  businessName: string;

  @ApiProperty({
    description: 'Type of business',
    example: 'Retail',
  })
  @IsString()
  @MinLength(2, { message: 'Business type must be at least 2 characters long' })
  @MaxLength(100, { message: 'Business type cannot exceed 100 characters' })
  businessType: string;

  @ApiPropertyOptional({
    description: 'Detailed business description',
    example: 'We are a leading retailer of...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Description cannot exceed 2000 characters' })
  description?: string;

  @ApiPropertyOptional({
    description: 'Business phone number',
    example: '+2348012345678',
  })
  @IsOptional()
  @IsPhoneNumber(null, { message: 'Invalid phone number format' })
  businessPhone?: string;

  @ApiProperty({
    description: 'Business email address',
    example: 'contact@business.com',
  })
  @IsEmail({}, { message: 'Invalid email address format' })
  @MaxLength(255, { message: 'Email cannot exceed 255 characters' })
  businessEmail: string;

  @ApiPropertyOptional({
    description: 'Logo URL',
    example: 'https://res.cloudinary.com/.../logo.png',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Logo URL must be a valid URL' })
  logoUrl?: string;

  @ApiProperty({
    description: 'Business address',
    type: BusinessAddressDto,
  })
  @ValidateNested()
  @Type(() => BusinessAddressDto)
  address: BusinessAddressDto;

  @ApiPropertyOptional({
    description: 'Business website',
    example: 'https://www.business.com',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Website must be a valid URL' })
  website?: string;

  @ApiPropertyOptional({
    description: 'Business hours',
    type: BusinessHoursDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessHoursDto)
  businessHours?: BusinessHoursDto;

  @ApiPropertyOptional({
    description: 'Social media links',
    type: SocialMediaDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialMediaDto)
  socialMedia?: SocialMediaDto;

  @ApiPropertyOptional({
    description: 'Bank account details for payments',
    type: BankDetailsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails?: BankDetailsDto;

  @ApiProperty({
    description: 'Business registration number',
    example: 'RC123456',
  })
  @IsString()
  @MinLength(3, {
    message: 'Registration number must be at least 3 characters long',
  })
  @MaxLength(50, { message: 'Registration number cannot exceed 50 characters' })
  registrationNumber: string;

  @ApiPropertyOptional({
    description: 'Tax identification number',
    example: 'TIN1234567890',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'TIN cannot exceed 50 characters' })
  taxId?: string;

  @ApiProperty({
    description: 'Year business was established',
    example: 2015,
  })
  @IsOptional()
  yearEstablished?: number;

  @ApiProperty({
    description: 'Number of employees',
    example: 50,
  })
  @IsOptional()
  employeeCount?: number;

  @ApiPropertyOptional({
    description: 'Annual revenue range',
    example: '₦10M - ₦50M',
  })
  @IsOptional()
  @IsString()
  annualRevenue?: string;

  @ApiProperty({
    description: 'Business documents',
    type: [VendorDocumentDto],
    minItems: 1,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendorDocumentDto)
  @MinLength(1, { message: 'At least one document is required' })
  documents: VendorDocumentDto[];

  @ApiPropertyOptional({
    description: 'Additional business metadata',
    example: {
      businessSector: 'Technology',
      businessSubSector: 'E-commerce',
      businessModel: 'B2C',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Whether to accept terms and conditions',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to subscribe to newsletter',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  subscribeToNewsletter?: boolean;
}

// Alternative flat structure if you prefer not to use nested objects
export class CompleteOnboardingDtobk {
  @ApiProperty({ description: 'Business name' })
  @IsString()
  businessName: string;

  @ApiProperty({ description: 'Business type' })
  @IsString()
  businessType: string;

  @ApiPropertyOptional({ description: 'Business description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Business phone' })
  @IsOptional()
  @IsPhoneNumber(null)
  businessPhone?: string;

  @ApiProperty({ description: 'Business email' })
  @IsEmail()
  businessEmail: string;

  // Address fields (flat)
  @ApiProperty({ description: 'Street address' })
  @IsString()
  address: string;

  @ApiProperty({ description: 'City' })
  @IsString()
  city: string;

  @ApiProperty({ description: 'State' })
  @IsString()
  state: string;

  @ApiProperty({
    description: 'Bank name',
    example: 'First Bank of Nigeria',
  })
  @IsString()
  @MinLength(2, { message: 'Bank name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Bank name cannot exceed 100 characters' })
  bankName: string;

  @ApiProperty({
    description: 'Account name',
    example: 'Business Name Ltd',
  })
  @IsString()
  @MinLength(3, { message: 'Account name must be at least 3 characters long' })
  @MaxLength(200, { message: 'Account name cannot exceed 200 characters' })
  accountName: string;

  @ApiProperty({
    description: 'Account number',
    example: '0123456789',
  })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  accountNumber: string;

  @ApiProperty({ description: 'Business documents', type: [VendorDocumentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendorDocumentDto)
  documents: VendorDocumentDto[];
}

export class VendorDocumentMetadataDto {
  @ApiProperty({
    description: 'Type of document',
    enum: DocumentType,
    example: DocumentType.CAC,
  })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiPropertyOptional({
    description: 'Description of the document',
    example: 'CAC certificate of incorporation',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CompleteOnboardingDto {
  @ApiProperty({ description: 'Business name', example: 'Acme Inc.' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  businessName: string;

  @ApiProperty({ description: 'Business type', example: 'Restaurant' })
  @IsString()
  businessType: string;

  @ApiPropertyOptional({ description: 'Business description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Business phone',
    example: '+1234567890',
  })
  @IsOptional()
  @IsPhoneNumber()
  businessPhone?: string;

  @ApiProperty({ description: 'Business email', example: 'business@acme.com' })
  @IsEmail()
  businessEmail: string;

  @ApiProperty({ description: 'Street address', example: '123 Main St' })
  @IsString()
  address: string;

  @ApiProperty({ description: 'City', example: 'Lagos' })
  @IsString()
  city: string;

  @ApiProperty({ description: 'State', example: 'Lagos' })
  @IsString()
  state: string;

  @ApiProperty({ description: 'Bank name', example: 'First Bank' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  bankName: string;

  @ApiProperty({ description: 'Account name', example: 'Acme Inc.' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  accountName: string;

  @ApiProperty({ example: 'RC1234567', required: false })
  @IsNotEmpty()
  @IsString()
  registrationNumber: string;

  @ApiProperty({ example: '12345678-0001', required: false })
  @IsNotEmpty()
  @IsString()
  taxId: string;

  @ApiProperty({ description: 'Account number', example: '0123456789' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  accountNumber: string;

  @ApiProperty({
    description: 'Document metadata (sent as JSON string)',
    type: 'string',
    example:
      '[{"documentType":"BUSINESS_REGISTRATION","description":"CAC certificate"},{"documentType":"TAX_CERTIFICATE","description":"Tax ID"}]',
  })
  @IsString()
  documentsMetadata: string; // This will be parsed from JSON string

  @IsOptional()
  documents?: any;
}
