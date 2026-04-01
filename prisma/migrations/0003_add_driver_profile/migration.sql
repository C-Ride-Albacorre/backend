-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'BICYCLE', 'OTHER');

-- CreateTable
CREATE TABLE "DriverProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT DEFAULT 'NG',
    "postalCode" TEXT,
    "vehicleType" "VehicleType" NOT NULL DEFAULT 'CAR',
    "vehicleMake" TEXT NOT NULL,
    "vehicleModel" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "driverLicenseUrl" TEXT,
    "driverLicensePublicId" TEXT,
    "vehicleInsuranceUrl" TEXT,
    "vehicleInsurancePublicId" TEXT,
    "vehicleRegistrationUrl" TEXT,
    "vehicleRegistrationPublicId" TEXT,
    "isDriverLicenseVerified" BOOLEAN NOT NULL DEFAULT false,
    "isVehicleInsuranceVerified" BOOLEAN NOT NULL DEFAULT false,
    "isVehicleRegistrationVerified" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION DEFAULT 0,
    "totalDeliveries" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "currentLocation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_licensePlate_key" ON "DriverProfile"("licensePlate");

-- CreateIndex
CREATE INDEX "DriverProfile_userId_idx" ON "DriverProfile"("userId");

-- CreateIndex
CREATE INDEX "DriverProfile_isAvailable_idx" ON "DriverProfile"("isAvailable");

-- CreateIndex
CREATE INDEX "DriverProfile_vehicleType_idx" ON "DriverProfile"("vehicleType");

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

