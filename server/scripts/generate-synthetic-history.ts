import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { syntheticHistoryWorkbook, SYNTHETIC_HISTORY_SEED, SYNTHETIC_HISTORY_ROWS, SYNTHETIC_HISTORY_QUOTES } from "../src/fixtures/synthetic-history.fixtures.js";
import { parseHistoricalQuotes } from "../src/services/history-import.service.js";

async function main() {
  const directory = path.resolve(process.argv[2] || path.resolve(__dirname, "../../demo-data"));
  const buffer = await syntheticHistoryWorkbook();
  const parsed = await parseHistoricalQuotes(buffer);
  const rows = parsed.records.flatMap(record => record.sourceRows);
  if (parsed.errors.length || rows.length !== SYNTHETIC_HISTORY_ROWS || parsed.records.length !== SYNTHETIC_HISTORY_QUOTES || new Set(rows).size !== 1400) {
    throw new Error("Synthetic workbook failed importer validation");
  }
  const report = {
    label: "SYNTHETIC DEMO DATA — not client-provided history", seed: SYNTHETIC_HISTORY_SEED,
    sourceRows: rows.length, quotations: parsed.records.length, partsPerQuotation: 2,
    invalidRows: parsed.errors.length, currency: "INR", sha256: createHash("sha256").update(buffer).digest("hex"),
    databaseWrites: false, persistenceVerification: "PENDING EXPLICIT ISOLATED DATABASE APPROVAL",
  };
  await mkdir(directory, { recursive: true });
  // Never overwrite existing files: identical output is an idempotent no-op.
  for (const [name, contents] of [["SYNTHETIC-DEMO-history-1400.xlsx", buffer], ["SYNTHETIC-DEMO-history-1400.validation.json", Buffer.from(JSON.stringify(report, null, 2) + "\n")]] as const) {
    const target = path.join(directory, name);
    try { await writeFile(target, contents, { flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readFile(target)).equals(contents)) throw error;
    }
  }
  console.log(JSON.stringify({ directory, ...report }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
