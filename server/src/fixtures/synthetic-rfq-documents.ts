import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function syntheticPdf(pages: Array<string | Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    for (const page of pages) {
      document.addPage();
      if (typeof page === "string") document.fontSize(16).text(page, 50, 50, { lineGap: 10 });
      else document.image(page, 0, 0, { width: 612, height: 792 });
    }
    document.end();
  });
}

export const syntheticText = (id: string) => [
  `Part Number: ${id}`, `Part Name: Synthetic Test Bracket ${id}`,
  "Material Grade: EN8", "Gross Weight: 1.25 kg", "Annual Volume: 12000",
  `Drawing Number: DWG-${id}`, "Revision: D", "Cycle time min: 4.8",
].join("\n");

// Synthetic fixtures only. Temporary PDFs/images never use application storage or a database.
export async function syntheticRfqDocuments() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeflow-synthetic-"));
  try {
    const scanSource = await syntheticPdf([syntheticText("SCAN-002")]);
    await writeFile(path.join(directory, "source.pdf"), scanSource);
    await promisify(execFile)("pdftoppm", ["-singlefile", "-r", "150", "-png",
      path.join(directory, "source.pdf"), path.join(directory, "scan")], { timeout: 30000 });
    const scanImage = await readFile(path.join(directory, "scan.png"));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Synthetic Parts");
    sheet.addRow(["Part Number", "Part Name", "Material Grade", "Gross Weight Kg", "Annual Volume", "Revision", "Cycle Time Min"]);
    sheet.addRow(["XLSX-003", "Synthetic Pin", "EN8", 0.75, 24000, "C", 4.8]);
    sheet.addRow(["XLSX-004", "Synthetic Spacer", "EN8", 0.5, 12000, "D", 2.5]);
    return {
      textPdf: await syntheticPdf([syntheticText("TEXT-001")]),
      scannedPdf: await syntheticPdf([scanImage]),
      mixedPdf: await syntheticPdf([syntheticText("TEXT-001"), scanImage]),
      xlsx: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
