-- Fix schema drift: enforce one DriverAssignment per order.
CREATE UNIQUE INDEX IF NOT EXISTS "DriverAssignment_orderId_key"
  ON "DriverAssignment" ("orderId");