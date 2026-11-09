import ExcelJS from "exceljs";

export const SYNTHETIC_HISTORY_SEED = 20261109;
export const SYNTHETIC_HISTORY_VERSION = "SYNDEMO-V1";
export const SYNTHETIC_HISTORY_ROWS = 1400;
export const SYNTHETIC_HISTORY_QUOTES = 700;
export const SYNTHETIC_HISTORY_HEADERS = [
  "Quotation Number", "Customer Name", "RFQ Number", "Quote Date", "Valid Until", "Status",
  "Part Number", "Part Name", "Material Grade", "Quantity", "Unit Price", "Total Price",
  "Subtotal", "GST Percentage", "GST Amount", "Grand Total", "Notes",
];
export const SYNTHETIC_PART_FAMILIES = [
  { code: "SHAFT", name: "Transmission shaft", material: "20MnCr5", basePaise: 42500, grossWeightKg: 1.8 },
  { code: "SPINDLE", name: "Wheel spindle", material: "EN8", basePaise: 23500, grossWeightKg: 1.1 },
  { code: "BUSH", name: "Machined steel bushing", material: "C45", basePaise: 9800, grossWeightKg: 0.35 },
  { code: "BRACKET", name: "Forged mounting bracket", material: "EN8", basePaise: 31200, grossWeightKg: 1.4 },
  { code: "HUB", name: "Wheel hub blank with machining", material: "C45", basePaise: 68500, grossWeightKg: 2.7 },
  { code: "FLANGE", name: "Drive flange", material: "20MnCr5", basePaise: 37800, grossWeightKg: 1.6 },
] as const;

// Illustrative prices and volumes, not a replacement for application costing.
export function syntheticHistoryRows(): Array<Array<string | number | Date>> {
  let state = SYNTHETIC_HISTORY_SEED >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const volumes = [3000, 6000, 12000, 24000, 60000, 120000];
  const rows: Array<Array<string | number | Date>> = [];
  for (let q = 0; q < SYNTHETIC_HISTORY_QUOTES; q++) {
    const quoteNumber = `SYNDEMO-V1-Q-${String(q + 1).padStart(4, "0")}`;
    const customer = `SYNTHETIC DEMO Customer ${String(q % 10 + 1).padStart(2, "0")}`;
    const date = new Date(Date.UTC(2022, 0, 1) + Math.floor(random() * 1430) * 86400000);
    const validUntil = new Date(date.getTime() + 30 * 86400000);
    const parts = [0, 1].map(line => {
      const index = q * 2 + line;
      const family = SYNTHETIC_PART_FAMILIES[index % SYNTHETIC_PART_FAMILIES.length]!;
      const quantity = volumes[Math.floor(random() * volumes.length)]!;
      const unitPaise = Math.round(family.basePaise * (0.8 + random() * 0.45) * (quantity >= 60000 ? 0.92 : 1));
      return { index, family, quantity, unitPaise, totalPaise: unitPaise * quantity };
    });
    const subtotalPaise = parts.reduce((sum, part) => sum + part.totalPaise, 0);
    const gstPaise = Math.round(subtotalPaise * 18 / 100);
    const sourceIds = parts.map(p => `SYNDEMO-V1-ROW-${String(p.index + 1).padStart(4, "0")}`);
    for (const part of parts) rows.push([
      quoteNumber, customer, `SYNDEMO-V1-RFQ-${String(q + 1).padStart(4, "0")}`, date, validUntil, "SYNTHETIC_DEMO",
      `SYNDEMO-V1-${part.family.code}-${String(part.index + 1).padStart(4, "0")}`,
      `SYNTHETIC DEMO ${part.family.name}`, part.family.material, part.quantity, part.unitPaise / 100, part.totalPaise / 100,
      subtotalPaise / 100, 18, gstPaise / 100, (subtotalPaise + gstPaise) / 100,
      `SYNTHETIC DEMO DATA; INR; seed=${SYNTHETIC_HISTORY_SEED}; sources=${sourceIds.join(",")}; illustrative, not client transactions`,
    ]);
  }
  return rows;
}

// ExcelJS timestamps ZIP entries at write time. Normalize only timestamps in its
// generated ZIP headers, so identical fixture content has identical XLSX bytes.
function normalizeZipTimestamps(input: Buffer): Buffer {
  const buffer = Buffer.from(input);
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Generated workbook has no ZIP directory");
  let cursor = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid generated ZIP entry");
    const local = buffer.readUInt32LE(cursor + 42);
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("Invalid generated ZIP local entry");
    buffer.writeUInt16LE(0, cursor + 12); buffer.writeUInt16LE(dosDate, cursor + 14);
    buffer.writeUInt16LE(0, local + 10); buffer.writeUInt16LE(dosDate, local + 12);
    cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  return buffer;
}

export async function syntheticHistoryWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ForgeFlow SYNTHETIC DEMO DATA";
  workbook.title = "SYNTHETIC DEMO DATA — 1400 manufacturing quotation source rows";
  workbook.subject = "Illustrative INR import demonstration; not supplied company history";
  workbook.created = new Date("2026-01-01T00:00:00Z"); workbook.modified = workbook.created;
  const sheet = workbook.addWorksheet("SYNTHETIC DEMO DATA");
  sheet.addRow(SYNTHETIC_HISTORY_HEADERS); sheet.addRows(syntheticHistoryRows());
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "Q1401" };
  sheet.getRow(1).font = { bold: true };
  for (const column of [4, 5]) sheet.getColumn(column).numFmt = "yyyy-mm-dd";
  for (const column of [11, 12, 13, 15, 16]) sheet.getColumn(column).numFmt = '"INR "#,##0.00';
  const readme = workbook.addWorksheet("README - SYNTHETIC");
  for (const text of [
    "SYNTHETIC DEMO DATA — NOT CLIENT-PROVIDED HISTORY",
    "Exactly 1400 source part rows, grouped into 700 quotations, two parts each.",
    "Fictional customer identifiers; no confidential drawings or real transactions.",
    "Currency INR. GST 18% is an illustrative assumption, not tax guidance.",
    `Dataset ${SYNTHETIC_HISTORY_VERSION}; fixed seed ${SYNTHETIC_HISTORY_SEED}; dates 2022–2025.`,
    "Importer reads only the first sheet. Row 1 is the header; source rows are 2–1401.",
    "Quotation totals repeat on both lines. Do not sum repeated quotation totals.",
    "Row identities appear in Notes and persist as originalRows in imported part provenance.",
    "Prices are illustrative commercial examples, not generated by live costing formulas.",
    "Never import into the existing development database without separate approval.",
  ]) readme.addRow([text]);
  readme.getColumn(1).width = 110;
  return normalizeZipTimestamps(Buffer.from(await workbook.xlsx.writeBuffer()));
}
