-- AlterTable
ALTER TABLE "Quotation"
  ADD COLUMN "paymentTerms" TEXT,
  ADD COLUMN "deliveryTerms" TEXT,
  ADD COLUMN "commercialTerms" TEXT,
  ADD COLUMN "approvedSnapshot" JSONB,
  ADD COLUMN "approvedAt" TIMESTAMP(3);
