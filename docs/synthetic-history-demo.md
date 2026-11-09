# Synthetic historical quotation demo

This demo shows the historical Excel importer. **Every workbook record is synthetic.** It is not client-provided history, actual customer pricing, or evidence of Company A transactions. No authoritative assignment workbook was present in the repository.

## Workbook

- File: `demo-data/SYNTHETIC-DEMO-history-1400.xlsx`
- Manifest: `demo-data/SYNTHETIC-DEMO-history-1400.validation.json`
- Reproducible generator seed: `20261109`; dataset namespace: `SYNDEMO-V1`.
- Exactly 1,400 synthetic source part rows, grouped as 700 quotations with two parts each. The first worksheet has headers on row 1 and data on rows 2–1401; the second worksheet contains disclosures.
- Fictional customers and plausible Indian automotive machining/forging examples (shafts, spindles, bushings, brackets, hubs and flanges). Dates, quantities, materials, prices and GST values are illustrative INR demo values only.
- No quotation is represented as having actually been approved, sent, won, or lost. Prices do not come from or replace the application's costing formulas.

The importer's first worksheet uses these headers: `Quotation Number`, `Customer Name`, `RFQ Number`, `Quote Date`, `Valid Until`, `Status`, `Part Number`, `Part Name`, `Material Grade`, `Quantity`, `Unit Price`, `Total Price`, `Subtotal`, `GST Percentage`, `GST Amount`, `Grand Total`, `Notes`. Quotation/customer/part name are required. Dates support Excel date cells, serial dates, and ISO dates. Quotation totals repeat on each part row and must not be summed once per row.

Rows are grouped case-insensitively by quotation number and customer within a workbook; RFQ number and repeated financial totals must agree. Source worksheet rows are retained as provenance. Exact quotation/customer duplicates already in imported history and live quotation number collisions are skipped. Import reporting allows valid rows to persist when another row is invalid; the import is not an all-or-nothing workbook transaction. Re-import the unchanged workbook to exercise duplicate handling. Do not alter case as a way of identifying a duplicate.

The historical search covers quotation number, RFQ number, customer, part number, part name, and material. Imported rows preserve commercial history, not original routing, weight, machine-rate, or costing calculations.

## Reproduce workbook generation and unit validation

From the project root, with dependencies already installed:

```bash
./server/node_modules/.bin/tsx server/scripts/generate-synthetic-history.ts demo-data
./server/node_modules/.bin/vitest run --root server src/fixtures/synthetic-history.fixtures.test.ts src/controllers/history-import.controller.test.ts src/controllers/synthetic-history-search.controller.test.ts src/services/synthetic-demo-safety.service.test.ts src/services/synthetic-demo-seed.service.test.ts src/services/history-import.service.test.ts src/controllers/history.controller.test.ts --maxWorkers=1
npm run build --prefix server
```

The generator validates through the real importer before writing. It will not replace a differing artifact. Unit tests use mocked persistence and do not prove database writes.

## Previously verified isolated database run

The following is the result of the Phase 6D run, not a command to rerun against an existing database:

- Target: PostgreSQL `localhost:5432`, database `forgeflow_synthetic_demo_test`, schema `public`.
- All 11 repository migrations were applied and migration status was verified.
- Initial workbook import created 700 historical quotation groups from 1,400 synthetic part rows. All source rows were valid; 700 import audit records were written.
- Historical search and pagination returned imported data successfully.
- Re-importing the unchanged workbook inserted zero quotations and skipped all 700 as duplicates.
- Malformed-row verification reported the invalid row as expected; the malformed row was rejected.
- Final counts: 700 historical quotations, 1,400 historical parts, and 700 import audit records. No live quotation, company profile, RFQ, or application part records were created by this verification.
- The optional manufacturing seed was not run.
- The main application database `rfq_quotation_db` was not connected to or modified during the isolated verification.

These results verify the importer against the isolated test database only. Do not point this demo at the main application database. The isolated verification database already contains the imported records; do not re-import into it unless you have reviewed its state and explicitly intend to verify duplicate behavior again. For a fresh reproduction, use a newly created, verified empty isolated database and follow your team's database approval procedure.

## Database safety

Never run `migrate reset`, `db push`, `DROP`, `TRUNCATE`, or destructive cleanup as part of this demo. Do not reuse a database if its identity or contents are unexpected. Never put credentials in tracked files or print complete connection URLs. A separate optional synthetic manufacturing seed exists; it is not required for historical import verification and should only be run against a separately approved isolated database.

## Historical validation record

At the Phase 6D validation point, the targeted importer/search/seed/safety tests reported 50 passed; the full backend suite reported 606 passed and 9 skipped. Those are historical results. Consult the current submission report for later suite results. Workbook SHA-256 recorded at generation: `df07d2fb87a74dbe68a70ff522abb501f7b53d8967e080b38adbbeea9f0f8ae7`.
