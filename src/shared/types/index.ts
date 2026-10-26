import { Role } from "@prisma/client";

export type NearbyDriver = {
  userId: string;
  lat: number;
  lng: number;
};


export type BatchOrder = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  totalAmount: number;
  deliveryFee: number;
  pickupLocation: any;
  dropoffLocation: any;
  createdAt: Date;
  storeId: string;
  storeName: string;
  storeLogo: string;
  storeLat: number;
  storeLng: number;
  distanceMeters: number;
  orderType: string;
  rn: number;
  items: any[];
};

export type TransitionContext = {
  actorId?: string;
  actorRole?: Role;
  reason?: string;
  metadata?: any;
  respondedAt?: Date;
};