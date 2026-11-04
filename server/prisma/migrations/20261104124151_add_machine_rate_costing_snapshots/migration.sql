-- AlterTable
ALTER TABLE "CostComponent" ADD COLUMN     "cycleTimeMin" DECIMAL(12,4),
ADD COLUMN     "machineRateId" TEXT,
ADD COLUMN     "ratePerHourSnapshot" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "CostComponent_machineRateId_idx" ON "CostComponent"("machineRateId");

-- AddForeignKey
ALTER TABLE "CostComponent" ADD CONSTRAINT "CostComponent_machineRateId_fkey" FOREIGN KEY ("machineRateId") REFERENCES "MachineRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
