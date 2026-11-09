import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { syntheticPdf, syntheticRfqDocuments, syntheticText } from "../fixtures/synthetic-rfq-documents.js";
import {
  extractDocumentCandidates,
  extractDocumentContent,
} from "./rfq-document-extraction.service.js";

describe("RFQ document extraction", () => {
  it("extracts plain-text EML headers and reviewed RFQ field provenance", async () => {
    const { extractDocumentContent } = await import("./rfq-document-extraction.service.js");
    const email = ["From: Buyer <buyer@example.in>", "Subject: RFQ: RFQ-EML-42", "Date: Mon, 02 Nov 2026 10:30:00 +0530", "Content-Type: text/plain; charset=utf-8", "", "Please quote", "RFQ No: RFQ-EML-42", "Customer Name: Example Components", "Part Number: SP-42", "Part Name: Drive Spindle", "Annual Volume: 12000", "Delivery Schedule: 8 weeks", "Payment Terms: net 30 days", ""].join("\r\n");
    const result = await extractDocumentContent(Buffer.from(email), "EML");
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldName: "emailFrom", extractedValue: "buyer@example.in", sourceReference: "Email From header", confidence: 1 }),
      expect.objectContaining({ fieldName: "emailSubject", extractedValue: "RFQ: RFQ-EML-42", sourceReference: "Email Subject header" }),
      expect.objectContaining({ fieldName: "rfqNumber", extractedValue: "RFQ-EML-42", sourceReference: "Email plain-text body", sourceId: "email-body-1", evidenceText: "RFQ No: RFQ-EML-42", groupKey: "email:body" }),
      expect.objectContaining({ fieldName: "annualVolume", extractedValue: "12000" }),
      expect.objectContaining({ fieldName: "deliveryRequirements", extractedValue: "8 weeks", evidenceText: "Delivery Schedule: 8 weeks" }),
      expect.objectContaining({ fieldName: "commercialTerms", extractedValue: "net 30 days" }),
    ]));
    expect(result.textSources[0]).toMatchObject({ sourceId: "email-body-1-1", sourceReference: "Email plain-text body" });
  });

  it("extracts HTML-only EML as inert text, removing active content", async () => {
    const { parseRfqEmail } = await import("./rfq-email-extraction.service.js");
    const email = "From: buyer@example.in\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><script>RFQ No: EVIL</script><p>RFQ No: RFQ-HTML-7</p><p>Part Name: Spindle &amp; Hub</p></html>";
    const result = parseRfqEmail(Buffer.from(email));
    expect(result.body).toContain("RFQ No: RFQ-HTML-7");
    expect(result.body).toContain("Spindle & Hub");
    expect(result.body).not.toContain("EVIL");
    expect(result.warnings).toContain("Email contained HTML only; active content was removed and the text was extracted for review.");
  });

  it("prefers plain text in multipart email and skips all attachments", async () => {
    const { parseRfqEmail } = await import("./rfq-email-extraction.service.js");
    const email = ["From: Buyer <buyer@example.in>", 'Content-Type: multipart/mixed; boundary="outer"', "", "--outer", "Content-Type: multipart/alternative; boundary=inner", "", "--inner", "Content-Type: text/plain; charset=utf-8", "", "Part Name: Plain version", "--inner", "Content-Type: text/html", "", "<p>Part Name: HTML version</p>", "--inner--", "--outer", 'Content-Type: application/pdf; name="drawing.pdf"', 'Content-Disposition: attachment; filename="drawing.pdf"', "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQ=", "--outer--", ""].join("\r\n");
    const result = parseRfqEmail(Buffer.from(email));
    expect(result.body).toContain("Plain version");
    expect(result.body).not.toContain("HTML version");
    expect(result.warnings.join(" ")).toContain("1 email attachment(s) were retained");
  });

  it("rejects malformed EML and oversized EML input", async () => {
    const { parseRfqEmail } = await import("./rfq-email-extraction.service.js");
    expect(() => parseRfqEmail(Buffer.from("not an email"))).toThrow("Email headers are malformed");
    expect(() => parseRfqEmail(Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow("Email is empty or exceeds the 10 MB limit");
  });

  async function createExcelBuffer(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("RFQ Parts");

    sheet.addRow([
      "RFQ Number",
      "Customer Name",
      "Part Number",
      "Part Name",
      "Material Grade",
      "Gross Weight Kg",
      "Annual Volume",
      "Drawing Number",
    ]);

    sheet.addRow([
      "RFQ-TEST-001",
      "Demo Customer",
      "PART-001",
      "Rear Wheel Spindle",
      "EN8",
      0.61,
      180000,
      "DWG-001",
    ]);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it("extracts structured fields from Excel", async () => {
    const buffer = await createExcelBuffer();
    const fields = await extractDocumentCandidates(buffer, "XLSX");

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "rfqNumber",
          extractedValue: "RFQ-TEST-001",
        }),
        expect.objectContaining({
          fieldName: "partName",
          extractedValue: "Rear Wheel Spindle",
        }),
        expect.objectContaining({
          fieldName: "materialGrade",
          extractedValue: "EN8",
        }),
      ])
    );
  });

  it("includes source references and confidence", async () => {
    const buffer = await createExcelBuffer();
    const fields = await extractDocumentCandidates(buffer, "XLSX");

    expect(fields.length).toBeGreaterThan(0);

    for (const field of fields) {
      expect(field.sourceReference).toContain("Excel sheet");
      expect(field.confidence).toBeGreaterThan(0);
      expect(field.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("detects headers below title and blank rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Customer RFQ");

    sheet.addRow(["CUSTOMER RFQ REQUIREMENT"]);
    sheet.addRow([]);
    sheet.addRow(["Please quote the following components"]);
    sheet.addRow([
      "RFQ Number",
      "Part Number",
      "Part Name",
      "Material Grade",
      "Annual Volume",
    ]);
    sheet.addRow([
      "RFQ-TEST-002",
      "PART-002",
      "Hydraulic Lift Arm",
      "40Cr4",
      24000,
    ]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fields = await extractDocumentCandidates(buffer, "XLSX");

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "rfqNumber",
          extractedValue: "RFQ-TEST-002",
        }),
        expect.objectContaining({
          fieldName: "partName",
          extractedValue: "Hydraulic Lift Arm",
        }),
        expect.objectContaining({
          fieldName: "materialGrade",
          extractedValue: "40Cr4",
        }),
      ])
    );
  });

  it("normalizes underscores and inconsistent header spacing", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Parts");

    sheet.addRow([
      "Part_Number",
      "Part   Name",
      "Gross_Weight_Kg",
      "Annual_Qty",
    ]);
    sheet.addRow(["PART-003", "Gear Blank", 1.48, 60000]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fields = await extractDocumentCandidates(buffer, "XLSX");

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "partNumber",
          extractedValue: "PART-003",
        }),
        expect.objectContaining({
          fieldName: "partName",
          extractedValue: "Gear Blank",
        }),
        expect.objectContaining({
          fieldName: "grossWeightKg",
          extractedValue: "1.48",
        }),
        expect.objectContaining({
          fieldName: "annualVolume",
          extractedValue: "60000",
        }),
      ])
    );
  });

  it("extracts multiple data rows with exact cell references", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Parts");

    sheet.addRow(["Part Number", "Material"]);
    sheet.addRow(["PART-004", "EN8"]);
    sheet.addRow(["PART-005", "20MnCr5"]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fields = await extractDocumentCandidates(buffer, "XLSX");

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "partNumber",
          extractedValue: "PART-004",
          sourceReference: 'Excel sheet "Parts", cell A2',
          sourceId: "excel-sheet-1-row-2-1",
          groupKey: "part:excel-sheet-1-row-2",
          evidenceText: "Part Number: PART-004",
          extractionMethod: "DETERMINISTIC",
        }),
        expect.objectContaining({
          fieldName: "partNumber",
          extractedValue: "PART-005",
          sourceReference: 'Excel sheet "Parts", cell A3',
          sourceId: "excel-sheet-1-row-3-1",
          groupKey: "part:excel-sheet-1-row-3",
          evidenceText: "Part Number: PART-005",
          extractionMethod: "DETERMINISTIC",
        }),
        expect.objectContaining({
          fieldName: "materialGrade",
          extractedValue: "20MnCr5",
          sourceReference: 'Excel sheet "Parts", cell B3',
        }),
      ])
    );
  });

  it("returns bounded labelled text sources alongside deterministic candidates", async () => {
    const buffer = await createExcelBuffer();
    const result = await extractDocumentContent(buffer, "XLSX");

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "rfqNumber",
          extractedValue: "RFQ-TEST-001",
        }),
      ])
    );
    expect(result.textSources).toEqual([
      expect.objectContaining({
        sourceId: "excel-sheet-1-row-2-1",
        sourceReference: 'Excel sheet "RFQ Parts", row 2',
      }),
    ]);
    expect(result.textSources[0]?.text).toContain(
      "RFQ Number: RFQ-TEST-001"
    );
    expect(result.textSources[0]?.text).toContain(
      "Gross Weight Kg: 0.61"
    );
    expect(
      result.textSources.every((source) => source.text.length <= 4_000)
    ).toBe(true);
  });

  it("includes Excel revision and cycle-time columns in AI text sources without making them deterministic candidates", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("RFQ Parts");

    sheet.addRow(["Part Number", "Revision", "Cycle Time Min"]);
    sheet.addRow(["PART-006", "D", 4.8]);

    const result = await extractDocumentContent(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "XLSX"
    );

    expect(result.candidates).toEqual([
      expect.objectContaining({
        fieldName: "partNumber",
        extractedValue: "PART-006",
      }),
    ]);
    expect(result.textSources).toEqual([
      expect.objectContaining({
        sourceId: "excel-sheet-1-row-2-1",
        text: expect.stringContaining("Revision: D"),
      }),
    ]);
    expect(result.textSources[0]?.text).toContain("Cycle Time Min: 4.8");
    expect(result.candidates.some((candidate) =>
      ["revision", "cycleTimeMinutes"].includes(candidate.fieldName)
    )).toBe(false);
  });

  it("extracts valid XLSX workbooks whose SpreadsheetML elements use a namespace prefix", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Synthetic Parts");
    sheet.addRow(["Part Number", "Part Name", "Material Grade", "Cycle Time Min"]);
    sheet.addRow(["SYN-PREFIX-001", "Synthetic Test Shaft", "EN8", 4.8]);

    const archive = await JSZip.loadAsync(
      Buffer.from(await workbook.xlsx.writeBuffer())
    );
    const spreadsheetNamespace =
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    for (const [name, entry] of Object.entries(archive.files)) {
      if (entry.dir || !name.toLowerCase().endsWith(".xml")) continue;
      const xml = await entry.async("string");
      if (!xml.includes(`xmlns="${spreadsheetNamespace}"`)) continue;
      const prefixed = xml
        .replace(
          `xmlns="${spreadsheetNamespace}"`,
          `xmlns:x="${spreadsheetNamespace}"`
        )
        .replace(/(<\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g, "$1x:$2");
      archive.file(name, prefixed);
    }

    const result = await extractDocumentContent(
      await archive.generateAsync({ type: "nodebuffer" }),
      "XLSX"
    );

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldName: "partNumber", extractedValue: "SYN-PREFIX-001" }),
        expect.objectContaining({ fieldName: "partName", extractedValue: "Synthetic Test Shaft" }),
        expect.objectContaining({ fieldName: "materialGrade", extractedValue: "EN8" }),
      ])
    );
    expect(result.candidates.some((candidate) => candidate.fieldName === "cycleTimeMinutes")).toBe(false);
    expect(result.textSources[0]?.text).toContain("Cycle Time Min: 4.8");
  });

  it("bounds oversized text sources without changing deterministic candidates", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Parts");
    const partName = "X".repeat(4_500);

    sheet.addRow(["Part Name", "Material"]);
    sheet.addRow([partName, "EN8"]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await extractDocumentContent(buffer, "XLSX");

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "partName",
          extractedValue: partName,
        }),
      ])
    );
    expect(result.textSources.length).toBeGreaterThan(1);
    expect(
      result.textSources.every((source) => source.text.length <= 4_000)
    ).toBe(true);
    expect(
      result.textSources.some((source) =>
        source.text.includes("Material: EN8")
      )
    ).toBe(true);
  });

  it("rejects empty documents", async () => {
    await expect(
      extractDocumentCandidates(Buffer.alloc(0), "XLSX")
    ).rejects.toThrow("Uploaded document is empty");
  });

  it("keeps text PDF pages and multiple labelled part blocks separate", async () => {
    const pdf = await syntheticPdf([syntheticText("A-001") + "\n" + syntheticText("B-002"), syntheticText("C-003")]);
    const result = await extractDocumentContent(pdf, "PDF");
    const partNumbers = result.candidates.filter((field) => field.fieldName === "partNumber");
    expect(partNumbers.map((field) => field.extractedValue)).toEqual(["A-001", "B-002", "C-003"]);
    expect(new Set(partNumbers.map((field) => field.groupKey)).size).toBe(3);
    expect(partNumbers[0]?.sourceReference).toContain("page 1");
    expect(partNumbers[2]?.sourceReference).toContain("page 2");
    expect(result.candidates.filter((field) => field.fieldName === "grossWeightKg").map((field) => field.extractedValue)).toEqual(["1.25", "1.25", "1.25"]);
  });

  it("retains conflicting labelled fields for review rather than silently taking the first", async () => {
    const result = await extractDocumentContent(await syntheticPdf([syntheticText("CONFLICT-001") + "\nMaterial Grade: EN19"]), "PDF");
    expect(result.candidates.filter((field) => field.fieldName === "materialGrade").map((field) => field.extractedValue)).toEqual(["EN8", "EN19"]);
  });

  it("rejects ambiguous side-by-side part layouts rather than mixing specifications", async () => {
    const text = "Part Number: A-001   Part Number: B-002\nPart Name: Synthetic part\nMaterial Grade: EN8\nAnnual volume: 12000";
    await expect(extractDocumentContent(await syntheticPdf([text]), "PDF")).rejects.toThrow("ambiguous multi-part layout");
  });

  it("runs real local OCR for scanned pages even alongside selectable text", async () => {
    const documents = await syntheticRfqDocuments();
    const result = await extractDocumentContent(documents.mixedPdf, "PDF");
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldName: "partNumber", extractedValue: "TEXT-001", sourceReference: expect.stringContaining("selectable text page 1") }),
      expect.objectContaining({ fieldName: "partNumber", extractedValue: "SCAN-002", sourceReference: expect.stringContaining("OCR page 2") }),
    ]));
    expect(result.warnings?.join(" ")).toContain("OCR");
  }, 60000);

  it("keeps ambiguous XLSX weights and quantities out of authoritative numeric fields", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Parts");
    sheet.addRow(["Part Number", "Weight", "Quantity", "Gross Weight Kg", "Annual Volume", "Net Weight Kg"]);
    sheet.addRow(["AMB-1", 50, 1200, "500 g", "12.5", 0.4]);
    const result = await extractDocumentContent(Buffer.from(await workbook.xlsx.writeBuffer()), "XLSX");
    expect(result.candidates.some((field) => ["grossWeightKg", "annualVolume"].includes(field.fieldName))).toBe(false);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldName: "weightUnspecified" }), expect.objectContaining({ fieldName: "quantityUnspecified" }),
      expect.objectContaining({ fieldName: "netWeightKg", extractedValue: "0.4" }),
    ]));
  });

  it("rejects unreadable blank scans and excessive pages instead of silent partial success", async () => {
    await expect(extractDocumentContent(await syntheticPdf([""]), "PDF")).rejects.toThrow("No readable text");
    await expect(extractDocumentContent(await syntheticPdf(Array(41).fill(syntheticText("A"))), "PDF")).rejects.toThrow("40-page limit");
    await expect(extractDocumentContent(await syntheticPdf(Array(11).fill("")), "PDF")).rejects.toThrow("10 pages");
  }, 60000);

  it("rejects excessive workbook processing and corrupted PDF input", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Parts");
    sheet.addRow(["Part Number", "Part Name"]);
    for (let i = 0; i < 1001; i++) sheet.addRow(["P-" + i, "Synthetic pin"]);
    await expect(extractDocumentContent(Buffer.from(await workbook.xlsx.writeBuffer()), "XLSX")).rejects.toThrow("1000 data-row");
    await expect(extractDocumentContent(Buffer.from("%PDF-not-a-real-pdf"), "PDF")).rejects.toThrow();
  });
});
