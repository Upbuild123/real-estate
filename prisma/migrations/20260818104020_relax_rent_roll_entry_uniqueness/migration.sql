-- DropIndex
DROP INDEX "RentRollEntry_propertyId_month_roomNumber_key";

-- CreateIndex
CREATE INDEX "RentRollEntry_propertyId_month_roomNumber_idx" ON "RentRollEntry"("propertyId", "month", "roomNumber");
