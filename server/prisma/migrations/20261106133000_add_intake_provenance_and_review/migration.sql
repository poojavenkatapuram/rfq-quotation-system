-- CreateEnum
CREATE TYPE "ExtractionFieldReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "contentHash" TEXT;

-- AlterTable
ALTER TABLE "ExtractedField"
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "evidenceText" TEXT,
  ADD COLUMN "extractionMethod" TEXT,
  ADD COLUMN "groupKey" TEXT,
  ADD COLUMN "reviewStatus" "ExtractionFieldReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- Preserve the accepted state of existing extracted fields.
UPDATE "ExtractedField"
SET "reviewStatus" = CASE
  WHEN "isAccepted" THEN 'ACCEPTED'::"ExtractionFieldReviewStatus"
  ELSE 'PENDING'::"ExtractionFieldReviewStatus"
END;

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_contentHash_idx"
  ON "Attachment"("uploadedById", "contentHash");

-- CreateIndex
CREATE INDEX "Attachment_contentHash_idx"
  ON "Attachment"("contentHash");

-- CreateIndex
CREATE INDEX "ExtractedField_extractionJobId_groupKey_idx"
  ON "ExtractedField"("extractionJobId", "groupKey");

-- CreateIndex
CREATE INDEX "ExtractedField_extractionJobId_reviewStatus_idx"
  ON "ExtractedField"("extractionJobId", "reviewStatus");

