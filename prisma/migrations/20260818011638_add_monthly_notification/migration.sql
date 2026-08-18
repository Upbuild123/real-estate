-- CreateTable
CREATE TABLE "MonthlyNotification" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyNotification_month_key" ON "MonthlyNotification"("month");
