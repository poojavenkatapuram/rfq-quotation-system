-- DropForeignKey
ALTER TABLE "ExtractionJob" DROP CONSTRAINT "ExtractionJob_rfqId_fkey";

-- AlterTable
ALTER TABLE "ExtractionJob" ALTER COLUMN "rfqId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ExtractionJob" ADD CONSTRAINT "ExtractionJob_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE SET NULL ON UPDATE CASCADE;
