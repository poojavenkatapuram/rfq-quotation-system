-- AlterEnum
ALTER TYPE "CostComponentType" ADD VALUE 'SETUP';

-- AlterTable
ALTER TABLE "CostComponent" ADD COLUMN     "setupTimeMinSnapshot" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "Costing" ADD COLUMN     "materialRatePerKgSnapshot" DECIMAL(12,2);
