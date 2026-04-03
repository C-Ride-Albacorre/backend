import { VehicleType } from '@prisma/client';

export class DriverOnboardingDto {
  // Step 1
  fullName: string;
  phoneNumber: string;
  email: string;
  address: string;
  city: string;
  state: string;

  // Step 2
  vehicleType: VehicleType;
  vehicleMake: string;
  vehicleModel: string;
  year: number;
  licensePlate: string;
}
