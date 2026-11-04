/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `Costing` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[partId,version]` on the table `Costing` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Costing_partId_version_idx";

-- AlterTable
ALTER TABLE "Costing" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Costing_idempotencyKey_key" ON "Costing"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Costing_partId_version_key" ON "Costing"("partId", "version");
