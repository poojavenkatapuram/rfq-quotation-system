import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { assertSafeXlsxArchive } from "./xlsx-archive-validation.service.js";
import { isNumericRfqField, numericValueFromEvidence } from "./rfq-field-validation.js";

export type SupportedDocumentType = "PDF" | "XLSX" | "EML";

const execFileAsync = promisify(execFile);
const MAX_OCR_PAGES = 10;
const OCR_DPI = 200;
const MAX_PDF_PAGES = 40;

export class DocumentProcessingError extends Error {}

async function extractScannedPdfText(
  buffer: Buffer,
  pages: number[]
): Promise<Array<{ page: number; text: string }>> {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "rfq-drawing-")
  );

  try {
    const pdfPath = path.join(temporaryDirectory, "document.pdf");
    const outputPrefix = path.join(temporaryDirectory, "page");

    await writeFile(pdfPath, buffer);

    const results: Array<{ page: number; text: string }> = [];
    for (const page of pages) {
      await execFileAsync(
        "pdftoppm",
        ["-f", String(page), "-l", String(page), "-singlefile",
          "-r", String(OCR_DPI), "-png", pdfPath, outputPrefix],
        { timeout: 120000, maxBuffer: 2 * 1024 * 1024 }
      );

      const imagePath = outputPrefix + ".png";
      const { stdout } = await execFileAsync(
        "tesseract",
        [imagePath, "stdout", "-l", "eng", "--psm", "11"],
        {
          timeout: 60000,
          maxBuffer: 5 * 1024 * 1024,
        }
      );

      results.push({ page, text: stdout });
    }

    return results;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}


export type ExtractionMethod = "DETERMINISTIC" | "LOCAL_OLLAMA";

export interface ExtractedCandidate {
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceReference: string;
  sourceId: string;
  evidenceText: string;
  extractionMethod: ExtractionMethod;
  groupKey: string;
}

export interface ExtractedTextSource {
  sourceId: string;
  sourceReference: string;
  text: string;
  groupKey: string;
}

export interface DocumentExtractionResult {
  candidates: ExtractedCandidate[];
  textSources: ExtractedTextSource[];
  warnings?: string[];
}

const MAX_AI_SOURCE_CHARACTERS = 4_000;
const MAX_AI_SOURCES = 12;

export function createBoundedTextSources(
  text: string,
  sourceReference: string,
  sourceIdPrefix: string,
  groupKey = sourceIdPrefix,
  maxSources = MAX_AI_SOURCES
): ExtractedTextSource[] {
  const sourceText = text.trim();

  if (!sourceText || maxSources <= 0) return [];

  const sources: ExtractedTextSource[] = [];
  let start = 0;

  while (start < sourceText.length && sources.length < maxSources) {
    let end = Math.min(
      start + MAX_AI_SOURCE_CHARACTERS,
      sourceText.length
    );

    if (end < sourceText.length) {
      const lastBreak = Math.max(
        sourceText.lastIndexOf("\n", end),
        sourceText.lastIndexOf(" ", end)
      );

      if (lastBreak > start) end = lastBreak;
    }

    const chunk = sourceText.slice(start, end).trim();

    if (chunk) {
      sources.push({
        sourceId: `${sourceIdPrefix}-${sources.length + 1}`,
        sourceReference,
        text: chunk,
        groupKey,
      });
    }

    start = end;
  }

  return sources;
}

const FIELD_PATTERNS: Array<{
  fieldName: string;
  pattern: RegExp;
}> = [
  { fieldName: "rfqNumber", pattern: /(?:rfq|enquiry|inquiry)\s*(?:no|number|#)?\s*[:\-]\s*([A-Z0-9/_-]+)/i },
  { fieldName: "customerName", pattern: /(?:customer|buyer|company)\s*(?:name)?\s*[:\-]\s*([^\n\r]+)/i },
  { fieldName: "partNumber", pattern: /(?:part|component)\s*(?:no|number|#)\s*[:\-]\s*([A-Z0-9/_-]+)/i },
  { fieldName: "partName", pattern: /(?:part|component)\s*name\s*[:\-]\s*([^\n\r]+)/i },
  { fieldName: "materialGrade", pattern: /(?:material|material grade|grade)\s*[:\-]\s*([A-Z0-9 ._-]+)/i },
  { fieldName: "drawingNumber", pattern: /(?:drawing|dwg)\s*(?:no|number|#)?\s*[:\-]\s*([A-Z0-9/_-]+)/i },
];

function normalizeCell(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim();
    }

    if ("result" in value) {
      return String(value.result ?? "").trim();
    }

    return "";
  }

  return String(value).trim();
}


export function extractTextCandidates(
  text: string,
  source: string,
  sourceId: string,
  groupKey: string,
  confidence: number
): ExtractedCandidate[] {
  const candidates: ExtractedCandidate[] = [];

  for (const field of FIELD_PATTERNS) {
    for (const match of text.matchAll(new RegExp(field.pattern.source, "gi"))) {
      if (!match[1]) continue;
      const value = match[1].trim();
      if (!value) continue;
      candidates.push({
        fieldName: field.fieldName, extractedValue: value, confidence,
        sourceReference: source, sourceId, evidenceText: match[0].trim(),
        extractionMethod: "DETERMINISTIC", groupKey,
      });
    }
  }

  const titleBlockPatterns: Array<{
    fieldName: string;
    pattern: RegExp;
  }> = [
    { fieldName: "drawingNumber", pattern: /(?:drawing\s*(?:no|number|#)|dwg\.?\s*(?:no|#))\s*[:\-]?\s*([A-Z0-9/_-]+)/i },
    { fieldName: "partNumber", pattern: /(?:part\s*(?:no|number|#)|component\s*(?:no|number))\s*[:\-]?\s*([A-Z0-9/_-]+)/i },
    { fieldName: "partName", pattern: /(?:part\s*name|component\s*name|description)\s*[:\-]?\s*([^\n\r]+)/i },
    { fieldName: "materialGrade", pattern: /(?:material|material\s*grade)\s*[:\-]?\s*([A-Z0-9 ._-]+)/i },
    { fieldName: "revision", pattern: /(?:revision|rev\.?)\s*[:\-]?\s*([A-Z0-9._-]+)/i },
    { fieldName: "drawingScale", pattern: /(?:scale)\s*[:\-]?\s*([0-9:./-]+)/i },
  ];

  for (const field of titleBlockPatterns) {
    const match = text.match(field.pattern);
    if (!match?.[1]) continue;

    const value = match[1].trim();
    if (!value) continue;

    const alreadyFound = candidates.some(
      (candidate) => candidate.fieldName === field.fieldName
    );

    if (!alreadyFound) {
      candidates.push({
        fieldName: field.fieldName,
        extractedValue: value,
        confidence: Math.min(confidence, 0.75),
        sourceReference: `${source}; drawing title-block label match`,
        sourceId,
        evidenceText: match[0].trim(),
        extractionMethod: "DETERMINISTIC",
        groupKey,
      });
    }
  }

  for (const line of text.split(/\r?\n/)) {
    const numericFields = ["grossWeightKg", "netWeightKg", "annualVolume"] as const;
    let matched = false;
    for (const fieldName of numericFields) {
      const value = numericValueFromEvidence(fieldName, line);
      if (!value) continue;
      matched = true;
      candidates.push({ fieldName, extractedValue: value, confidence,
        sourceReference: source, sourceId, evidenceText: line.trim(),
        extractionMethod: "DETERMINISTIC", groupKey });
    }
    if (!matched && /^\s*(?:(?:gross|net)\s*)?(?:weight|wt|mass|quantity|qty|annual\s*(?:volume|quantity|qty))\b/i.test(line)) {
      candidates.push({ fieldName: /weight|wt|mass/i.test(line) ? "weightUnspecified" : "quantityUnspecified",
        extractedValue: line.trim(), confidence: 0.3, sourceReference: source, sourceId,
        evidenceText: line.trim(), extractionMethod: "DETERMINISTIC", groupKey });
    }
  }
  return candidates;
}

async function extractFromPdf(
  buffer: Buffer
): Promise<DocumentExtractionResult> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let pages: Array<{ num: number; text: string }>;

  try {
    const info = await parser.getInfo();
    if (info.total > MAX_PDF_PAGES) throw new DocumentProcessingError("PDF exceeds the 40-page limit. Split the document before uploading.");
    const result = await parser.getText();
    pages = result.pages;
  } finally {
    await parser.destroy();
  }

  // Decide independently per page: a text cover page must not hide later scans.
  // Sparse headers/footers on an otherwise scanned drawing also need OCR.
  const needsOcr = pages.filter((page) => page.text.trim().length < 80 ||
    (page.text.match(/\b(?:part|material|drawing|revision|weight|volume|customer)\b/gi)?.length ?? 0) < 2);
  if (needsOcr.length > MAX_OCR_PAGES) throw new DocumentProcessingError("PDF needs OCR on more than 10 pages. Split the document before uploading.");
  let ocr: Array<{ page: number; text: string }> = [];
  try {
    if (needsOcr.length) ocr = await extractScannedPdfText(buffer, needsOcr.map((page) => page.num));
  } catch {
    throw new DocumentProcessingError("Local PDF OCR failed. Check pdftoppm and Tesseract (English), or upload a clearer text PDF.");
  }
  const candidates: ExtractedCandidate[] = [];
  const textSources: ExtractedTextSource[] = [];
  const warnings: string[] = [];

  for (const page of pages) {
    const scanned = ocr.find((result) => result.page === page.num);
    const text = scanned?.text.trim() || page.text.trim();
    if (!text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "").trim()) {
      throw new DocumentProcessingError(`No readable text on PDF page ${page.num}. Upload a clearer scan or remove the blank page.`);
    }
    const reference = `PDF ${scanned ? "OCR" : "selectable text"} page ${page.num}`;
    if (scanned) warnings.push(`Page ${page.num} used OCR; verify every value against the drawing.`);
    // Separate labelled part blocks; never infer that different pages describe the same part.
    const starts = [...text.matchAll(/(?:^|\n)[ \t]*(?:part|component)\s*(?:no\.?|number|#)\s*[:\-]?/gi)].map((match) => match.index!);
    const identifiers = [...text.matchAll(/\b(?:part|component)\s*(?:no\.?|number|#)\s*[:\-]/gi)];
    if (identifiers.length > 1 && identifiers.length > starts.length) {
      throw new DocumentProcessingError(`PDF page ${page.num} has an ambiguous multi-part layout. Split it into one part per page or supply an XLSX part list.`);
    }
    const boundaries = [...new Set([0, ...starts, text.length])];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const block = text.slice(boundaries[i], boundaries[i + 1]).trim();
      if (!block) continue;
      const prefix = `pdf-page-${page.num}-block-${i + 1}`;
      const groupKey = `part:${prefix}`;
      const sources = createBoundedTextSources(block, reference, prefix, groupKey, MAX_AI_SOURCES - textSources.length);
      textSources.push(...sources);
      const found = extractTextCandidates(block, reference, `${prefix}-1`, groupKey, scanned ? 0.55 : 0.65);
      for (const field of found) {
        field.sourceId = sources.find((source) => source.text.includes(field.evidenceText))?.sourceId ?? `${prefix}-1`;
        candidates.push(field);
      }
    }
  }
  if (textSources.length === MAX_AI_SOURCES) warnings.push("AI source limit reached; review all pages for missing fields.");
  return { candidates, textSources, warnings };
}

const EXCEL_HEADERS: Record<string, string> = {
  rfq: "rfqNumber",
  "rfq number": "rfqNumber",
  "rfq no": "rfqNumber",
  customer: "customerName",
  "customer name": "customerName",
  "part number": "partNumber",
  "part no": "partNumber",
  "part name": "partName",
  component: "partName",
  material: "materialGrade",
  "material grade": "materialGrade",
  grade: "materialGrade",
  weight: "weightUnspecified",
  "gross weight": "grossWeightKg",
  "gross weight kg": "grossWeightKg",
  "annual volume": "annualVolume",
  "annual quantity": "annualVolume",
  quantity: "quantityUnspecified",
  qty: "quantityUnspecified",
  "drawing number": "drawingNumber",
  "drawing no": "drawingNumber",
  "dwg no": "drawingNumber",
  "dwg number": "drawingNumber",
  "part description": "partName",
  description: "partName",
  "gross wt": "grossWeightKg",
  "weight kg": "weightUnspecified",
  "net weight": "netWeightKg",
  "net weight kg": "netWeightKg",
  "annual qty": "annualVolume",
  "yearly quantity": "annualVolume",
};

const AI_ONLY_EXCEL_SOURCE_HEADERS: Record<string, string> = {
  revision: "revision",
  rev: "revision",
  "drawing revision": "revision",
  "cycle time": "cycleTimeMinutes",
  "cycle time min": "cycleTimeMinutes",
  "cycle time minutes": "cycleTimeMinutes",
  "ct min": "cycleTimeMinutes",
};

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractFromExcel(
  buffer: Buffer
): Promise<DocumentExtractionResult> {
  assertSafeXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([buffer]));

  const candidates: ExtractedCandidate[] = [];
  const textSources: ExtractedTextSource[] = [];
  const MAX_HEADER_SCAN_ROWS = 15;
  let sheetIndex = 0;
  let processedRows = 0;

  workbook.eachSheet((worksheet) => {
    sheetIndex += 1;
    if (sheetIndex > 20 || worksheet.rowCount > 5000 || worksheet.columnCount > 100) {
      throw new DocumentProcessingError("Workbook exceeds processing limits (20 sheets, 5000 rows per sheet, 100 columns).");
    }
    let headerRowNumber = 0;
    let bestHeaderCount = 0;
    const columns = new Map<
      number,
      { fieldName?: string; sourceFieldName: string; header: string }
    >();

    const scanLimit = Math.min(worksheet.rowCount, MAX_HEADER_SCAN_ROWS);

    for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const detectedColumns = new Map<
        number,
        { fieldName?: string; sourceFieldName: string; header: string }
      >();

      row.eachCell((cell, columnNumber) => {
        const header = normalizeCell(cell.value);
        const normalizedHeader = normalizeHeader(header);
        const fieldName = EXCEL_HEADERS[normalizedHeader];
        const sourceFieldName = fieldName ?? AI_ONLY_EXCEL_SOURCE_HEADERS[normalizedHeader];

        if (sourceFieldName) {
          detectedColumns.set(columnNumber, {
            fieldName,
            sourceFieldName,
            header: header || fieldName,
          });
        }
      });

      if (detectedColumns.size > bestHeaderCount) {
        bestHeaderCount = detectedColumns.size;
        headerRowNumber = rowNumber;
        columns.clear();
        for (const [columnNumber, column] of detectedColumns) {
          columns.set(columnNumber, column);
        }
      }
    }

    if (bestHeaderCount < 2 || headerRowNumber === 0) return;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      if (++processedRows > 1000) throw new DocumentProcessingError("Workbook exceeds the 1000 data-row limit. Split the part list.");

      const sourceId = "excel-sheet-" + sheetIndex + "-row-" + rowNumber + "-1";
      const groupKey = "part:excel-sheet-" + sheetIndex + "-row-" + rowNumber;
      const sourceReference =
        'Excel sheet "' + worksheet.name + '", row ' + rowNumber;
      const rowText: string[] = [];

      for (const [columnNumber, column] of columns) {
        const cell = row.getCell(columnNumber);
        const value = normalizeCell(cell.value);

        if (!value) continue;

        const evidenceText = column.header + ": " + value;
        rowText.push(evidenceText);
        if (column.fieldName) {
          const safeValue = isNumericRfqField(column.fieldName) ? numericValueFromEvidence(column.fieldName, evidenceText) : value;
          const fieldName = safeValue ? column.fieldName : column.fieldName === "annualVolume" ? "quantityUnspecified" : "weightUnspecified";
          candidates.push({
            fieldName,
            extractedValue: safeValue || evidenceText,
            confidence: safeValue ? 0.9 : 0.3,
            sourceReference:
              'Excel sheet "' + worksheet.name + '", cell ' + cell.address,
            sourceId,
            evidenceText,
            extractionMethod: "DETERMINISTIC",
            groupKey,
          });
        }
      }

      if (rowText.length > 0 && textSources.length < MAX_AI_SOURCES) {
        textSources.push(
          ...createBoundedTextSources(
            rowText.join("\n"),
            sourceReference,
            "excel-sheet-" + sheetIndex + "-row-" + rowNumber,
            groupKey,
            MAX_AI_SOURCES - textSources.length
          )
        );
      }
    });
  });

  const warnings = textSources.length === MAX_AI_SOURCES
    ? ["AI source limit reached; review all worksheet rows for missing fields."] : [];
  return { candidates, textSources, warnings };
}

export async function extractDocumentContent(
  buffer: Buffer,
  documentType: SupportedDocumentType
): Promise<DocumentExtractionResult> {
  if (!buffer.length) {
    throw new Error("Uploaded document is empty");
  }

  if (documentType === "PDF") {
    return extractFromPdf(buffer);
  }

  if (documentType === "XLSX") {
    return extractFromExcel(buffer);
  }

  if (documentType === "EML") {
    const { parseRfqEmail } = await import("./rfq-email-extraction.service.js");
    const email = parseRfqEmail(buffer);
    const sourceId = "email-body-1";
    const groupKey = "email:body";
    const sourceReference = "Email plain-text body";
    const textSources = createBoundedTextSources(email.body, sourceReference, sourceId, groupKey);
    const candidates = extractTextCandidates(email.body, sourceReference, sourceId + "-1", groupKey, 0.65);
    for (const candidate of candidates) candidate.sourceId = sourceId;
    for (const [fieldName, pattern] of [
      ["deliveryRequirements", /(?:delivery requirements?|delivery schedule|lead time|required delivery)\s*[:\-]\s*([^\n\r]+)/i],
      ["commercialTerms", /(?:payment terms?|incoterms?|commercial terms?)\s*[:\-]\s*([^\n\r]+)/i],
    ] as Array<[string, RegExp]>) {
      const match = email.body.match(pattern);
      if (match?.[1]) candidates.push({ fieldName, extractedValue: match[1].trim(), confidence: 0.65,
        sourceReference, sourceId, evidenceText: match[0].trim(), extractionMethod: "DETERMINISTIC", groupKey });
    }
    for (const [fieldName, value, sourceReferenceValue] of [
      ["emailFrom", email.from, "Email From header"],
      ["emailSubject", email.subject, "Email Subject header"],
      ["emailDate", email.date, "Email Date header"],
    ] as Array<[string, string | null, string]>) {
      if (value) candidates.push({ fieldName, extractedValue: value, confidence: 1,
        sourceReference: sourceReferenceValue, sourceId: "email-header-1",
        evidenceText: sourceReferenceValue + ": " + value, extractionMethod: "DETERMINISTIC", groupKey: "email:headers" });
    }
    const warnings = [...email.warnings];
    if (!email.body) warnings.push("No readable email body was found. Enter missing RFQ details manually.");
    return { candidates, textSources, warnings };
  }

  throw new Error("Unsupported document type");
}

export async function extractDocumentCandidates(
  buffer: Buffer,
  documentType: SupportedDocumentType
): Promise<ExtractedCandidate[]> {
  const result = await extractDocumentContent(buffer, documentType);
  return result.candidates;
}
