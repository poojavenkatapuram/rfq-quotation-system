-- CreateTable
CREATE TABLE "HistoricalQuote" (
    "id" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "rfqNumber" TEXT,
    "customerName" TEXT NOT NULL,
    "quoteDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "status" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(14,2),
    "gstPercentage" DECIMAL(8,4),
    "gstAmount" DECIMAL(14,2),
    "grandTotal" DECIMAL(14,2),
    "notes" TEXT,
    "sourceFile" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalQuotePart" (
    "id" TEXT NOT NULL,
    "historicalQuoteId" TEXT NOT NULL,
    "partNumber" TEXT,
    "partName" TEXT NOT NULL,
    "materialGrade" TEXT,
    "quantity" INTEGER,
    "unitPrice" DECIMAL(14,2),
    "totalPrice" DECIMAL(14,2),
    "costingSnapshot" JSONB,

    CONSTRAINT "HistoricalQuotePart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricalQuote_customerName_idx" ON "HistoricalQuote"("customerName");

-- CreateIndex
CREATE INDEX "HistoricalQuote_rfqNumber_idx" ON "HistoricalQuote"("rfqNumber");

-- CreateIndex
CREATE INDEX "HistoricalQuote_quoteDate_idx" ON "HistoricalQuote"("quoteDate");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalQuote_quotationNumber_customerName_key" ON "HistoricalQuote"("quotationNumber", "customerName");

-- CreateIndex
CREATE INDEX "HistoricalQuotePart_partNumber_idx" ON "HistoricalQuotePart"("partNumber");

-- CreateIndex
CREATE INDEX "HistoricalQuotePart_partName_idx" ON "HistoricalQuotePart"("partName");

-- CreateIndex
CREATE INDEX "HistoricalQuotePart_materialGrade_idx" ON "HistoricalQuotePart"("materialGrade");

-- AddForeignKey
ALTER TABLE "HistoricalQuotePart" ADD CONSTRAINT "HistoricalQuotePart_historicalQuoteId_fkey" FOREIGN KEY ("historicalQuoteId") REFERENCES "HistoricalQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
