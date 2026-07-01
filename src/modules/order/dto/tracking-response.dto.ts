import { AssignmentStatus, OrderStatus } from "@prisma/client";

// dto/tracking-response.dto.ts
export class TrackingDataResponseDto {
  order: {
    id: string;
    number: string;
    status: OrderStatus;
    statusHistory: any[];
    totalAmount: number;
    orderType: string;
    createdAt: Date;
    pickupLocation: any;
    dropoffLocation: any;
  };
  store: {
    id: string;
    name: string;
    logo: string;
    address: string;
    lat: number;
    lng: number;
  };
  driver?: {
    id: string;
    fullName: string;
    photo: string;
    rating: number;
    totalTrips: number;
    vehicleMake: string;
    vehicleModel: string;
    vehiclePlate: string;
    phone: string;
    status: string;
  };
  tracking: {
    leg: 'to-vendor' | 'to-customer' | null;
    etaSeconds: number | null;
    polyline: string | null;
    driverLocation: {
      lat: number;
      lng: number;
      heading: number;
      timestamp: number;
    } | null;
    destination: { lat: number; lng: number } | null;
  };
  assignment: {
    status: AssignmentStatus;
    assignedAt: Date | null;
  } | null;
}