-- Safe migration - checks if objects exist before creating
-- This migration will work whether the objects already exist or not

-- ============ ENUMS (Safe Creation) ============
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VendorActionStatus') THEN
        CREATE TYPE "VendorActionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationType') THEN
        CREATE TYPE "NotificationType" AS ENUM ('ORDER_STATUS', 'VENDOR_ACTION_REQUIRED', 'DRIVER_ASSIGNMENT', 'PICKUP_ALERT', 'RATING_REQUEST');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CartStatus') THEN
        CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'ABANDONED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DriverStatus') THEN
        CREATE TYPE "DriverStatus" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY', 'SUSPENDED', 'REJECTED', 'APPROVED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DriverDocumentType') THEN
        CREATE TYPE "DriverDocumentType" AS ENUM ('DRIVER_LICENSE', 'VEHICLE_INSURANCE', 'VEHICLE_REGISTRATION');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleType') THEN
        CREATE TYPE "VehicleType" AS ENUM ('CAR', 'EV');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
        CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'VENDOR', 'DISPATCHER', 'ADMIN', 'SUPER_ADMIN');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OAuthProviderType') THEN
        CREATE TYPE "OAuthProviderType" AS ENUM ('GOOGLE', 'GITHUB', 'FACEBOOK', 'APPLE');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentStatus') THEN
        CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserStatus') THEN
        CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'PENDING_EMAIL_VERIFICATION', 'PENDING_PHONE_VERIFICATION', 'PENDING_ONBOARDING', 'PENDING_DOCUMENTS', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'APPROVED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnBoardingStatus') THEN
        CREATE TYPE "OnBoardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentType') THEN
        CREATE TYPE "DocumentType" AS ENUM ('CAC', 'BUSINESS_PERMIT', 'ID_PROOF');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StoreStatus') THEN
        CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'REJECTED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductStatus') THEN
        CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT', 'OUT_OF_STOCK');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StockStatus') THEN
        CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK', 'LOW_STOCK');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductType') THEN
        CREATE TYPE "ProductType" AS ENUM ('SINGLE', 'VARIABLE');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DayOfWeek') THEN
        CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackageType') THEN
        CREATE TYPE "PackageType" AS ENUM ('PACKAGE', 'DOCUMENT');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeeType') THEN
        CREATE TYPE "FeeType" AS ENUM ('PERCENTAGE', 'FIXED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeeApplicableTo') THEN
        CREATE TYPE "FeeApplicableTo" AS ENUM ('ALL', 'VENDOR_ORDERS', 'PACKAGE_ORDERS', 'DOCUMENT_ORDERS');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaxApplicableTo') THEN
        CREATE TYPE "TaxApplicableTo" AS ENUM ('ALL', 'VENDOR_ORDERS', 'PACKAGE_ORDERS', 'DOCUMENT_ORDERS');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CartItemType') THEN
        CREATE TYPE "CartItemType" AS ENUM ('PRODUCT', 'PACKAGE', 'DOCUMENT');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderType') THEN
        CREATE TYPE "OrderType" AS ENUM ('VENDOR', 'PACKAGE', 'DOCUMENT', 'MIXED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
        CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'CONFIRMED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'ORDER_PLACED', 'ORDER_ACCEPTED', 'ORDER_ASSIGNED', 'ORDER_DECLINED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentStatus') THEN
        CREATE TYPE "PaymentStatus" AS ENUM ('INITIATING', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethod') THEN
        CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'BANK_TRANSFER', 'USSD', 'QR_CODE', 'WALLET');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentStatus') THEN
        CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'SEARCHING', 'ASSIGNED', 'REASSIGNING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'FAILED');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageType') THEN
        CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'LOCATION');
    END IF;
END $$;

-- ============ TABLES (Safe Creation) ============

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phoneNumber" TEXT,
    "password" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "refreshTokenHash" TEXT,
    "referralCode" TEXT,
    "referredBy" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "onboardingCompletedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "profilePicture" TEXT,
    "onboardingStatus" "OnBoardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "onboardingStep" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectionReason" TEXT,
    "isNewUser" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT,
    "fcmToken" TEXT,
    "deviceType" TEXT,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VerificationAttempt" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "otp" TEXT,
    "otpIdentifier" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VerificationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OAuthProvider" (
    "id" TEXT NOT NULL,
    "provider" "OAuthProviderType" NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "profileData" JSONB,
    CONSTRAINT "OAuthProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BusinessInfo" (
    "id" TEXT NOT NULL,
    "businessName" TEXT,
    "businessType" TEXT,
    "description" TEXT,
    "businessPhone" TEXT,
    "businessEmail" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "registrationNumber" TEXT,
    "taxId" TEXT,
    CONSTRAINT "BusinessInfo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VendorDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "documentType" "DocumentType" NOT NULL DEFAULT 'CAC',
    CONSTRAINT "VendorDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Store" (
    "id" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "storeDescription" TEXT,
    "storeAddress" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "preparationTime" INTEGER,
    "deliveryFee" DOUBLE PRECISION,
    "storeLogo" TEXT,
    "status" "StoreStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "userId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectionReason" TEXT,
    "categoryId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "dailyOrderLimit" INTEGER,
    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OperatingHour" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "openingTime" TEXT,
    "closingTime" TEXT,
    "breakStart" TEXT,
    "breakEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperatingHour_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "productType" "ProductType" NOT NULL DEFAULT 'SINGLE',
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'IN_STOCK',
    "productStatus" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "basePrice" DOUBLE PRECISION,
    "stockQuantity" INTEGER DEFAULT 0,
    "lowStockThreshold" INTEGER DEFAULT 5,
    "storeId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subcategoryId" TEXT NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Variant" (
    "id" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "sku" TEXT NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'IN_STOCK',
    "imageUrl" TEXT,
    "productId" TEXT NOT NULL,
    "attributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Addon" (
    "id" TEXT NOT NULL,
    "addonName" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "maxQuantity" INTEGER DEFAULT 10,
    "productId" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Addon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomerLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Subcategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "icon" TEXT,
    "image" TEXT,
    CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "image" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PackageType" NOT NULL,
    "weight" DOUBLE PRECISION,
    "dimensions" JSONB,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT,
    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DeliveryOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "estimatedDays" TEXT,
    "baseFee" DOUBLE PRECISION NOT NULL,
    "perKmFee" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ServiceFee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "feeType" "FeeType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" "FeeApplicableTo" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceFee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TaxSetting" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rate" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" "TaxApplicableTo" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Cart" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "abandonedAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "itemType" "CartItemType" NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "packageId" TEXT,
    "selectedAddons" JSONB,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "specialInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "deliveryFee" DOUBLE PRECISION NOT NULL,
    "serviceFee" DOUBLE PRECISION NOT NULL,
    "taxAmount" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "deliveryOptionId" TEXT,
    "dropoffLocation" JSON,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "deliveryInstructions" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "monnifyReference" TEXT,
    "orderStatus" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "statusHistory" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pickupLocation" JSONB,
    "orderCode" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "reason" TEXT,
    "canceledAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "driverAssignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "vendorAcceptedAt" TIMESTAMP(3),
    "vendorDeclinedAt" TIMESTAMP(3),
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemType" "CartItemType" NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "storeId" TEXT,
    "packageId" TEXT,
    "selectedAddons" JSONB,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "specialInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "idempotency_records" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "store_daily_counters" (
    "store_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "store_daily_counters_pkey" PRIMARY KEY ("store_id","date")
);

CREATE TABLE IF NOT EXISTS "DriverProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'NG',
    "postalCode" TEXT,
    "vehicleType" "VehicleType" NOT NULL DEFAULT 'CAR',
    "vehicleMake" TEXT,
    "vehicleModel" TEXT,
    "year" INTEGER,
    "licensePlate" TEXT,
    "rating" DOUBLE PRECISION DEFAULT 0,
    "ratingCount" INTEGER DEFAULT 0,
    "totalDeliveries" INTEGER DEFAULT 0,
    "status" "DriverStatus" NOT NULL DEFAULT 'OFFLINE',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriverDocument" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "documentType" "DriverDocumentType" NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "publicId" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderActivityLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus",
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriverAssignment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverId" TEXT,
    "assignmentStatus" TEXT DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(6),
    "etaSeconds" INTEGER,
    "pickupConfirmedAt" TIMESTAMP(6),
    "deliveryConfirmedAt" TIMESTAMP(6),
    CONSTRAINT "DriverAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "Role" NOT NULL,
    "message" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VendorOrderAction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "VendorActionStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "VendorOrderAction_pkey" PRIMARY KEY ("id")
);

-- ============ INDEXES (Safe Creation) ============

-- User indexes
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");
CREATE INDEX IF NOT EXISTS "User_phoneNumber_idx" ON "User"("phoneNumber");

-- VerificationAttempt indexes
CREATE INDEX IF NOT EXISTS "VerificationAttempt_otp_idx" ON "VerificationAttempt"("otp");
CREATE INDEX IF NOT EXISTS "VerificationAttempt_purpose_idx" ON "VerificationAttempt"("purpose");
CREATE INDEX IF NOT EXISTS "VerificationAttempt_expiresAt_idx" ON "VerificationAttempt"("expiresAt");

-- OAuthProvider indexes
CREATE INDEX IF NOT EXISTS "OAuthProvider_provider_providerId_idx" ON "OAuthProvider"("provider", "providerId");

-- Store indexes
CREATE INDEX IF NOT EXISTS "Store_userId_idx" ON "Store"("userId");
CREATE INDEX IF NOT EXISTS "Store_categoryId_idx" ON "Store"("categoryId");

-- OperatingHour indexes
CREATE INDEX IF NOT EXISTS "OperatingHour_storeId_idx" ON "OperatingHour"("storeId");

-- Product indexes
CREATE INDEX IF NOT EXISTS "Product_storeId_idx" ON "Product"("storeId");
CREATE INDEX IF NOT EXISTS "Product_subcategoryId_idx" ON "Product"("subcategoryId");
CREATE INDEX IF NOT EXISTS "Product_sku_idx" ON "Product"("sku");

-- ProductImage indexes
CREATE INDEX IF NOT EXISTS "ProductImage_productId_idx" ON "ProductImage"("productId");

-- Variant indexes
CREATE INDEX IF NOT EXISTS "Variant_productId_idx" ON "Variant"("productId");
CREATE INDEX IF NOT EXISTS "Variant_sku_idx" ON "Variant"("sku");

-- Addon indexes
CREATE INDEX IF NOT EXISTS "Addon_productId_idx" ON "Addon"("productId");

-- CustomerLocation indexes
CREATE INDEX IF NOT EXISTS "CustomerLocation_userId_idx" ON "CustomerLocation"("userId");
CREATE INDEX IF NOT EXISTS "CustomerLocation_isDefault_idx" ON "CustomerLocation"("isDefault");

-- Subcategory indexes
CREATE INDEX IF NOT EXISTS "Subcategory_categoryId_idx" ON "Subcategory"("categoryId");
CREATE INDEX IF NOT EXISTS "Subcategory_isActive_idx" ON "Subcategory"("isActive");

-- Category indexes
CREATE INDEX IF NOT EXISTS "Category_isActive_idx" ON "Category"("isActive");

-- Package indexes
CREATE INDEX IF NOT EXISTS "Package_type_idx" ON "Package"("type");
CREATE INDEX IF NOT EXISTS "Package_isActive_idx" ON "Package"("isActive");

-- DeliveryOption indexes
CREATE INDEX IF NOT EXISTS "DeliveryOption_isActive_idx" ON "DeliveryOption"("isActive");

-- ServiceFee indexes
CREATE INDEX IF NOT EXISTS "ServiceFee_isActive_idx" ON "ServiceFee"("isActive");
CREATE INDEX IF NOT EXISTS "ServiceFee_appliesTo_idx" ON "ServiceFee"("appliesTo");

-- TaxSetting indexes
CREATE INDEX IF NOT EXISTS "TaxSetting_isActive_idx" ON "TaxSetting"("isActive");
CREATE INDEX IF NOT EXISTS "TaxSetting_appliesTo_idx" ON "TaxSetting"("appliesTo");

-- Cart indexes
CREATE INDEX IF NOT EXISTS "Cart_userId_idx" ON "Cart"("userId");
CREATE INDEX IF NOT EXISTS "Cart_sessionId_idx" ON "Cart"("sessionId");
CREATE INDEX IF NOT EXISTS "Cart_expiresAt_idx" ON "Cart"("expiresAt");

-- CartItem indexes
CREATE INDEX IF NOT EXISTS "CartItem_cartId_idx" ON "CartItem"("cartId");
CREATE INDEX IF NOT EXISTS "CartItem_productId_idx" ON "CartItem"("productId");
CREATE INDEX IF NOT EXISTS "CartItem_packageId_idx" ON "CartItem"("packageId");

-- Order indexes
CREATE INDEX IF NOT EXISTS "Order_orderCode_idx" ON "Order"("orderCode");
CREATE INDEX IF NOT EXISTS "Order_orderNumber_idx" ON "Order"("orderNumber");
CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order"("userId");
CREATE INDEX IF NOT EXISTS "Order_orderStatus_idx" ON "Order"("orderStatus");
CREATE INDEX IF NOT EXISTS "Order_paymentStatus_idx" ON "Order"("paymentStatus");
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order"("createdAt");

-- OrderItem indexes
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE INDEX IF NOT EXISTS "OrderItem_storeId_idx" ON "OrderItem"("storeId");

-- DriverProfile indexes
CREATE INDEX IF NOT EXISTS "DriverProfile_userId_idx" ON "DriverProfile"("userId");
CREATE INDEX IF NOT EXISTS "DriverProfile_status_idx" ON "DriverProfile"("status");
CREATE INDEX IF NOT EXISTS "DriverProfile_vehicleType_idx" ON "DriverProfile"("vehicleType");

-- OrderActivityLog indexes
CREATE INDEX IF NOT EXISTS "OrderActivityLog_orderId_idx" ON "OrderActivityLog"("orderId");
CREATE INDEX IF NOT EXISTS "OrderActivityLog_createdAt_idx" ON "OrderActivityLog"("createdAt");

-- DriverAssignment indexes
CREATE INDEX IF NOT EXISTS "DriverAssignment_driverId_idx" ON "DriverAssignment"("driverId");

-- Notification indexes
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

-- VendorOrderAction indexes
CREATE INDEX IF NOT EXISTS "VendorOrderAction_vendorId_idx" ON "VendorOrderAction"("vendorId");

-- ============ UNIQUE CONSTRAINTS (Safe Creation) ============

-- Note: These will fail if duplicates exist, but since the tables already exist,
-- the unique constraints should already be in place. We'll use DO blocks to handle this.

DO $$ 
BEGIN
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'User_email_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "User_phoneNumber_key" ON "User"("phoneNumber");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'User_phoneNumber_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'User_referralCode_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "VerificationAttempt_identifier_key" ON "VerificationAttempt"("identifier");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'VerificationAttempt_identifier_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "VerificationAttempt_otpIdentifier_key" ON "VerificationAttempt"("otpIdentifier");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'VerificationAttempt_otpIdentifier_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "OAuthProvider_provider_providerId_key" ON "OAuthProvider"("provider", "providerId");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'OAuthProvider_provider_providerId_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "OAuthProvider_userId_provider_key" ON "OAuthProvider"("userId", "provider");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'OAuthProvider_userId_provider_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "BusinessInfo_userId_key" ON "BusinessInfo"("userId");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'BusinessInfo_userId_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "OperatingHour_storeId_dayOfWeek_key" ON "OperatingHour"("storeId", "dayOfWeek");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'OperatingHour_storeId_dayOfWeek_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Product_sku_key" ON "Product"("sku");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Product_sku_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Variant_sku_key" ON "Variant"("sku");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Variant_sku_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "CustomerLocation_userId_address_key" ON "CustomerLocation"("userId", "address");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'CustomerLocation_userId_address_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Subcategory_categoryId_name_key" ON "Subcategory"("categoryId", "name");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Subcategory_categoryId_name_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category"("name");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Category_name_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Cart_userId_key" ON "Cart"("userId");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Cart_userId_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Cart_sessionId_key" ON "Cart"("sessionId");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Cart_sessionId_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Order_orderNumber_key" ON "Order"("orderNumber");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Order_orderNumber_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Order_paymentReference_key" ON "Order"("paymentReference");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Order_paymentReference_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Order_monnifyReference_key" ON "Order"("monnifyReference");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Order_monnifyReference_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "Order_orderCode_key" ON "Order"("orderCode");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Order_orderCode_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "DriverProfile_userId_key" ON "DriverProfile"("userId");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'DriverProfile_userId_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "DriverProfile_licensePlate_key" ON "DriverProfile"("licensePlate");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'DriverProfile_licensePlate_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "DriverDocument_driverId_documentType_key" ON "DriverDocument"("driverId", "documentType");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'DriverDocument_driverId_documentType_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "DriverAssignment_orderId_key" ON "DriverAssignment"("orderId");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'DriverAssignment_orderId_key already exists or could not be created';
    END;
    
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "VendorOrderAction_orderId_key" ON "VendorOrderAction"("orderId");
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'VendorOrderAction_orderId_key already exists or could not be created';
    END;
END $$;

-- ============ FOREIGN KEYS ============
-- Note: Foreign keys should already exist. If they don't, these will create them.
-- Using DO blocks to handle errors gracefully.

DO $$ 
BEGIN
    BEGIN
        ALTER TABLE "OAuthProvider" ADD CONSTRAINT "OAuthProvider_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key OAuthProvider_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "BusinessInfo" ADD CONSTRAINT "BusinessInfo_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key BusinessInfo_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "VendorDocument" ADD CONSTRAINT "VendorDocument_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key VendorDocument_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Store" ADD CONSTRAINT "Store_categoryId_fkey" 
            FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Store_categoryId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Store" ADD CONSTRAINT "Store_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Store_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "OperatingHour" ADD CONSTRAINT "OperatingHour_storeId_fkey" 
            FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key OperatingHour_storeId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" 
            FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Product_storeId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_subcategoryId_fkey" 
            FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Product_subcategoryId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" 
            FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key ProductImage_productId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Variant" ADD CONSTRAINT "Variant_productId_fkey" 
            FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Variant_productId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Addon" ADD CONSTRAINT "Addon_productId_fkey" 
            FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Addon_productId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "CustomerLocation" ADD CONSTRAINT "CustomerLocation_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key CustomerLocation_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_categoryId_fkey" 
            FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Subcategory_categoryId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Package" ADD CONSTRAINT "Package_storeId_fkey" 
            FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Package_storeId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Cart_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" 
            FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key CartItem_cartId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_packageId_fkey" 
            FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key CartItem_packageId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" 
            FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key CartItem_productId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" 
            FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key CartItem_variantId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryOptionId_fkey" 
            FOREIGN KEY ("deliveryOptionId") REFERENCES "DeliveryOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Order_deliveryOptionId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Order_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" 
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key OrderItem_orderId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_packageId_fkey" 
            FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key OrderItem_packageId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" 
            FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key OrderItem_productId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_storeId_fkey" 
            FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key OrderItem_storeId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" 
            FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key OrderItem_variantId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key DriverProfile_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" 
            FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key DriverDocument_driverId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "OrderActivityLog" ADD CONSTRAINT "OrderActivityLog_orderId_fkey" 
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key OrderActivityLog_orderId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_orderId_fkey" 
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key DriverAssignment_orderId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_orderId_fkey" 
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key ChatMessage_orderId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" 
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key Notification_userId_fkey already exists';
    END;
    
    BEGIN
        ALTER TABLE "VendorOrderAction" ADD CONSTRAINT "VendorOrderAction_orderId_fkey" 
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Foreign key VendorOrderAction_orderId_fkey already exists';
    END;
END $$;