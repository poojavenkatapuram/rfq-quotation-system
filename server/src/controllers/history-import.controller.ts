import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import prisma from "../lib/prisma.js";
import { parseHistoricalQuotes } from "../services/history-import.service.js";

type HistoryImportRequest = AuthenticatedRequest & {
  file?: { buffer: Buffer; originalname: string };
};

export const importHistoricalQuotes = async (
  req: HistoryImportRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!["ADMIN", "ESTIMATOR"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only administrators or estimators can import historical quotations",
      });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "Please upload an Excel workbook",
      });
    }

    const parsed = await parseHistoricalQuotes(req.file.buffer);
    const imported: string[] = [];
    const skipped: { quotationNumber: string; reason: string }[] = [];
    const errors = [...parsed.errors];

    for (const record of parsed.records) {
      try {
        const existingLegacy = await prisma.historicalQuote.findUnique({
          where: {
            quotationNumber_customerName: {
              quotationNumber: record.quotationNumber,
              customerName: record.customerName,
            },
          },
          select: { id: true },
        });

        if (existingLegacy) {
          skipped.push({
            quotationNumber: record.quotationNumber,
            reason: "This quotation already exists in imported history",
          });
          continue;
        }

        const existingLive = await prisma.quotation.findUnique({
          where: { quotationNumber: record.quotationNumber },
          select: { id: true },
        });

        if (existingLive) {
          skipped.push({
            quotationNumber: record.quotationNumber,
            reason: "This quotation already exists in live records",
          });
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const created = await tx.historicalQuote.create({
            data: {
              quotationNumber: record.quotationNumber,
              customerName: record.customerName,
              rfqNumber: record.rfqNumber,
              quoteDate: record.quoteDate,
              validUntil: record.validUntil,
              status: record.status,
              subtotal: record.subtotal,
              gstPercentage: record.gstPercentage,
              gstAmount: record.gstAmount,
              grandTotal: record.grandTotal,
              notes: record.notes,
              sourceFile: req.file!.originalname,
              importedById: req.user!.userId,
              parts: {
                create: record.parts.map((part) => ({
                  partNumber: part.partNumber,
                  partName: part.partName,
                  materialGrade: part.materialGrade,
                  quantity: part.quantity,
                  unitPrice: part.unitPrice,
                  totalPrice: part.totalPrice,
                  costingSnapshot: {
                    source: "LEGACY_EXCEL_IMPORT",
                    originalRows: record.sourceRows,
                  },
                })),
              },
            },
          });

          await tx.auditLog.create({
            data: {
              actorId: req.user!.userId,
              action: "HISTORICAL_QUOTATION_IMPORTED",
              entityType: "HISTORICAL_QUOTE",
              entityId: created.id,
              details: {
                quotationNumber: record.quotationNumber,
                customerName: record.customerName,
                sourceFile: req.file!.originalname,
                partCount: record.parts.length,
                sourceRows: record.sourceRows,
              },
            },
          });
        });

        imported.push(record.quotationNumber);
      } catch (error) {
        console.error(
          `Historical quotation import failed for ${record.quotationNumber}:`,
          error
        );

        skipped.push({
          quotationNumber: record.quotationNumber,
          reason: "Database import failed; existing records were not overwritten",
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Historical quotation import processed",
      summary: {
        totalValidQuotations: parsed.records.length,
        imported: imported.length,
        skipped: skipped.length,
        invalidRows: errors.length,
      },
      imported,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("Historical quotation import error:", error);

    return res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to process the Excel workbook",
    });
  }
};
