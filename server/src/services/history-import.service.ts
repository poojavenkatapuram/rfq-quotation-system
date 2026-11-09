import { gstPercentageSchema } from "./gst-validation.service.js";
import ExcelJS from "exceljs";
import { z } from "zod";
import { assertSafeXlsxArchive } from "./xlsx-archive-validation.service.js";

const headerAliases: Record<string, string[]> = {
  quotationNumber: ["quotation number", "quotation no", "quote number", "quote no"],
  customerName: ["customer name", "customer", "client"],
  rfqNumber: ["rfq number", "rfq no"],
  quoteDate: ["quote date", "quotation date", "date"],
  validUntil: ["valid until", "validity date"],
  status: ["status"],
  partNumber: ["part number", "part no", "item code"],
  partName: ["part name", "part description", "description", "item name"],
  materialGrade: ["material grade", "material", "grade"],
  quantity: ["quantity", "qty", "annual volume"],
  unitPrice: ["unit price", "price per unit", "rate"],
  totalPrice: ["total price", "line total", "amount"],
  subtotal: ["subtotal", "sub total"],
  gstPercentage: ["gst percentage", "gst %", "tax percentage"],
  gstAmount: ["gst amount", "tax amount"],
  grandTotal: ["grand total", "quotation total", "total amount"],
  notes: ["notes", "remarks", "comments"],
};

const rowSchema = z.object({
  quotationNumber: z.string().trim().min(1).max(100),
  customerName: z.string().trim().min(1).max(200),
  rfqNumber: z.string().trim().max(100).optional(),
  quoteDate: z.string().optional(),
  validUntil: z.string().optional(),
  status: z.string().trim().max(30).optional(),
  partNumber: z.string().trim().max(100).optional(),
  partName: z.string().trim().min(1).max(300),
  materialGrade: z.string().trim().max(100).optional(),
  quantity: z.number().int().positive().optional(),
  unitPrice: z.number().nonnegative().optional(),
  totalPrice: z.number().nonnegative().optional(),
  subtotal: z.number().nonnegative().optional(),
  gstPercentage: gstPercentageSchema.optional(),
  gstAmount: z.number().nonnegative().optional(),
  grandTotal: z.number().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
});

export interface ParsedHistoricalQuotePart {
  partNumber?: string;
  partName: string;
  materialGrade?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
}

export interface ParsedHistoricalQuote {
  quotationNumber: string;
  customerName: string;
  rfqNumber?: string;
  quoteDate?: Date;
  validUntil?: Date;
  status?: string;
  subtotal?: number;
  gstPercentage?: number;
  gstAmount?: number;
  grandTotal?: number;
  notes?: string;
  parts: ParsedHistoricalQuotePart[];
  sourceRows: number[];
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ParsedImportResult {
  records: ParsedHistoricalQuote[];
  errors: ImportRowError[];
}

const normalizeHeader = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
  }

  return String(value).trim();
};

const optionalNumber = (value: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, "").replace(/[₹$]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const optionalDate = (value: string): Date | undefined => {
  if (!value) return undefined;

  const numericValue = Number(value);

  if (Number.isFinite(numericValue) && numericValue >= 20000 && numericValue <= 80000) {
    const parsed = new Date(Date.UTC(1899, 11, 30) + numericValue * 86400000);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export async function parseHistoricalQuotes(
  buffer: Buffer
): Promise<ParsedImportResult> {
  assertSafeXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error("The workbook does not contain a worksheet");
  }

  if (worksheet.rowCount < 2) {
    throw new Error("The worksheet must contain a header and at least one data row");
  }

  const headerRow = worksheet.getRow(1);
  const columns = new Map<string, number>();

  headerRow.eachCell((cell, columnNumber) => {
    const header = normalizeHeader(cell.value);
    for (const [field, aliases] of Object.entries(headerAliases)) {
      if (aliases.includes(header)) columns.set(field, columnNumber);
    }
  });

  const requiredHeaders = ["quotationNumber", "customerName", "partName"];
  const missingHeaders = requiredHeaders.filter((field) => !columns.has(field));

  if (missingHeaders.length > 0) {
    throw new Error(
      `Missing required columns: ${missingHeaders.join(", ")}`
    );
  }

  const records = new Map<string, ParsedHistoricalQuote>();
  const errors: ImportRowError[] = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    const raw: Record<string, string | number | undefined> = {};

    for (const [field, columnNumber] of columns.entries()) {
      const value = cellText(row.getCell(columnNumber).value);
      raw[field] = value;
    }

    const hasContent = Object.values(raw).some(
      (value) => value !== undefined && String(value).trim() !== ""
    );

    if (!hasContent) continue;

    const parsed = rowSchema.safeParse({
      quotationNumber: raw.quotationNumber,
      customerName: raw.customerName,
      rfqNumber: raw.rfqNumber || undefined,
      quoteDate: raw.quoteDate || undefined,
      validUntil: raw.validUntil || undefined,
      status: raw.status || undefined,
      partNumber: raw.partNumber || undefined,
      partName: raw.partName,
      materialGrade: raw.materialGrade || undefined,
      quantity: optionalNumber(String(raw.quantity ?? "")),
      unitPrice: optionalNumber(String(raw.unitPrice ?? "")),
      totalPrice: optionalNumber(String(raw.totalPrice ?? "")),
      subtotal: optionalNumber(String(raw.subtotal ?? "")),
      gstPercentage: optionalNumber(String(raw.gstPercentage ?? "")),
      gstAmount: optionalNumber(String(raw.gstAmount ?? "")),
      grandTotal: optionalNumber(String(raw.grandTotal ?? "")),
      notes: raw.notes || undefined,
    });

    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        message: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
      continue;
    }

    const data = parsed.data;
    const quoteDate = optionalDate(data.quoteDate ?? "");
    const validUntil = optionalDate(data.validUntil ?? "");

    if (data.quoteDate && !quoteDate) {
      errors.push({ row: rowNumber, message: "Invalid quote date" });
      continue;
    }

    if (data.validUntil && !validUntil) {
      errors.push({ row: rowNumber, message: "Invalid validity date" });
      continue;
    }

    const key = `${data.quotationNumber.trim().toLowerCase()}::${data.customerName.trim().toLowerCase()}`;

    let record = records.get(key);

    if (!record) {
      record = {
        quotationNumber: data.quotationNumber.trim(),
        customerName: data.customerName.trim(),
        rfqNumber: data.rfqNumber || undefined,
        quoteDate,
        validUntil,
        status: data.status || undefined,
        subtotal: data.subtotal,
        gstPercentage: data.gstPercentage,
        gstAmount: data.gstAmount,
        grandTotal: data.grandTotal,
        notes: data.notes || undefined,
        parts: [],
        sourceRows: [],
      };

      records.set(key, record);
    } else {
      const headerValues = [
        record.rfqNumber === (data.rfqNumber || undefined),
        record.subtotal === data.subtotal,
        record.gstPercentage === data.gstPercentage,
        record.gstAmount === data.gstAmount,
        record.grandTotal === data.grandTotal,
      ];

      if (headerValues.some((matches) => !matches)) {
        errors.push({
          row: rowNumber,
          message: "Quotation-level values differ between rows for this quotation",
        });
        continue;
      }
    }

    record.parts.push({
      partNumber: data.partNumber || undefined,
      partName: data.partName,
      materialGrade: data.materialGrade || undefined,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      totalPrice: data.totalPrice,
    });

    record.sourceRows.push(rowNumber);
  }

  return {
    records: Array.from(records.values()),
    errors,
  };
}
