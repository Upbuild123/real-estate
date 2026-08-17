/*
  Warnings:

  - Added the required column `lineItemKey` to the `FinancialRecord` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FinancialRecord" ADD COLUMN     "lineItemKey" TEXT NOT NULL;
