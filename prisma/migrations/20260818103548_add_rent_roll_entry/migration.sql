-- CreateTable
CREATE TABLE "RentRollEntry" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "lessee" TEXT NOT NULL,
    "monthlyCharge" INTEGER NOT NULL,
    "leaseStart" TEXT,
    "leaseEnd" TEXT,
    "extractionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentRollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentRollEntry_propertyId_month_roomNumber_key" ON "RentRollEntry"("propertyId", "month", "roomNumber");

-- AddForeignKey
ALTER TABLE "RentRollEntry" ADD CONSTRAINT "RentRollEntry_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentRollEntry" ADD CONSTRAINT "RentRollEntry_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
