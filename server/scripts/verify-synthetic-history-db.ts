// Opt-in persistence demonstration. Never loads .env or creates/migrates a DB.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { requireSyntheticDatabaseTarget } from "../src/services/synthetic-demo-safety.service.js";

function response() {
  let code = 200; let body: any;
  const res = { status(value: number) { code = value; return res; }, json(value: unknown) { body = value; return res; } };
  return { res, result() { assert.equal(code, 200); return body; } };
}
async function main() {
  const target = requireSyntheticDatabaseTarget(process.env.SYNTHETIC_DEMO_DATABASE_URL, process.env.SYNTHETIC_DEMO_DB_APPROVED);
  console.log({ host: target.host, port: target.port, database: target.database, schema: target.schema });
  // The existing controllers share this singleton. Set the isolated URL before
  // importing them; the user's existing DATABASE_URL is never contacted.
  process.env.DATABASE_URL = target.url;
  const prisma = require("../src/lib/prisma.js").default as import("@prisma/client").PrismaClient;
  try {
    const [identity] = await prisma.$queryRaw<Array<{ name: string; schema: string }>>`SELECT current_database() AS name, current_schema() AS schema`;
    assert.equal(identity?.name, target.database); assert.equal(identity?.schema, "public");
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    const directory = path.resolve(__dirname, "../prisma/migrations");
    const expected = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory());
    for (const entry of expected) {
      const sql = await readFile(`${directory}/${entry.name}/migration.sql`);
      const applied = migrations.filter(m => m.migration_name === entry.name && m.finished_at && !m.rolled_back_at);
      assert.equal(applied.length, 1, `Apply reviewed migrations to the isolated DB first: ${entry.name}`);
      assert.equal(applied[0]!.checksum, createHash("sha256").update(sql).digest("hex"));
    }
    assert.equal(migrations.filter(m => !m.finished_at && !m.rolled_back_at).length, 0);
    assert.equal(await prisma.quotation.count(), 0, "Refusing a database containing live quotations");
    assert.equal(await prisma.companyProfile.count(), 0, "Refusing a database containing company settings");
    assert.equal(await prisma.historicalQuote.count({ where: { NOT: { quotationNumber: { startsWith: "SYNDEMO-V1-Q-" } } } }), 0, "Unrelated history exists");
    const before = await prisma.historicalQuote.count();
    assert.ok(before === 0 || before === 700, "Unexpected partial dataset; inspect manually, never reset it");
    const actorId = "SYNDEMO-V1-IMPORT-ACTOR";
    await prisma.user.upsert({ where: { id: actorId }, update: {}, create: {
      id: actorId, name: "SYNTHETIC DEMO import verifier (disabled)", email: "synthetic-import-verifier@example.invalid",
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12), role: "ADMIN", isActive: false,
    } });
    const { importHistoricalQuotes } = await import("../src/controllers/history-import.controller.js");
    const { getImportedQuoteHistory } = await import("../src/controllers/history.controller.js");
    const buffer = await readFile(path.resolve(__dirname, "../../demo-data/SYNTHETIC-DEMO-history-1400.xlsx"));
    const importWorkbook = async (input: Buffer) => {
      const out = response();
      await importHistoricalQuotes({ user: { userId: actorId, role: "ADMIN" }, file: { buffer: input, originalname: "SYNTHETIC-DEMO-history-1400.xlsx" } } as any, out.res as any);
      return out.result();
    };
    const first = await importWorkbook(buffer);
    assert.deepEqual(first.summary, { totalValidQuotations: 700, imported: before ? 0 : 700, skipped: before ? 700 : 0, invalidRows: 0 });
    const records = () => prisma.historicalQuote.findMany({ orderBy: { quotationNumber: "asc" }, include: { parts: { orderBy: { partNumber: "asc" } } } });
    const stored = await records();
    assert.equal(stored.length, 700); assert.equal(await prisma.historicalQuotePart.count(), 1400);
    for (const [index, record] of stored.entries()) {
      assert.equal(record.currency, "INR"); assert.ok(record.notes?.includes("SYNTHETIC DEMO DATA"));
      assert.equal(record.parts.length, 2); assert.ok(record.quoteDate && record.validUntil && record.validUntil > record.quoteDate);
      const sum = record.parts.reduce((value, part) => value + Number(part.totalPrice), 0);
      assert.equal(Number(record.subtotal), Number(sum.toFixed(2)));
      assert.equal(Number(record.gstAmount), Number((sum * 0.18).toFixed(2)));
      assert.equal(Number(record.grandTotal), Number((sum + Number(record.gstAmount)).toFixed(2)));
      for (const part of record.parts) {
        assert.equal(Number(part.totalPrice), Number((Number(part.unitPrice) * part.quantity!).toFixed(2)));
        assert.deepEqual((part.costingSnapshot as any).originalRows, [index * 2 + 2, index * 2 + 3]);
      }
    }
    const second = await importWorkbook(buffer);
    assert.deepEqual(second.summary, { totalValidQuotations: 700, imported: 0, skipped: 700, invalidRows: 0 });
    assert.deepEqual(await records(), stored, "Re-import must not change any existing history");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    workbook.worksheets[0]!.getCell("J2").value = 0;
    const invalid = await importWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    assert.equal(invalid.summary.invalidRows, 1); assert.equal(invalid.summary.imported, 0); assert.equal(invalid.errors[0].row, 2);
    assert.deepEqual(await records(), stored);
    const search = async (query: Record<string, string>) => {
      const out = response(); await getImportedQuoteHistory({ query } as any, out.res as any); return out.result();
    };
    const all = await search({ limit: "100" }); assert.equal(all.pagination.total, 700); assert.equal(all.data.length, 100);
    const page2 = await search({ limit: "100", page: "2" });
    assert.equal(page2.data.length, 100); assert.ok(page2.data.every((row: any) => !all.data.some((first: any) => row.id === first.id)));
    for (const term of ["SYNDEMO-V1-Q-0001", "SYNDEMO-V1-RFQ-0001", "SYNDEMO-V1-SHAFT-0001"]) assert.equal((await search({ search: term })).pagination.total, 1);
    assert.equal((await search({ search: "synthetic demo customer 01" })).pagination.total, 70);
    assert.ok((await search({ search: "20MnCr5" })).pagination.total > 0);
    assert.ok((await search({ search: "synthetic demo wheel spindle" })).pagination.total > 0);
    assert.equal((await search({ search: "DOES-NOT-EXIST" })).pagination.total, 0);
    const auditCount = await prisma.auditLog.count({ where: { action: "HISTORICAL_QUOTATION_IMPORTED" } });
    assert.equal(auditCount, 700);
    let manufacturingSeed = "SKIPPED (separate approval not provided)";
    if (process.env.SYNTHETIC_DEMO_SEED_APPROVED === "yes") {
      const { seedSyntheticManufacturing } = await import("../src/services/synthetic-demo-seed.service.js");
      const firstSeed = await seedSyntheticManufacturing(prisma, actorId);
      const seededRFQs = await prisma.rFQ.findMany({ orderBy: { id: "asc" }, include: { parts: { orderBy: { id: "asc" }, include: { routing: { include: { operations: { orderBy: { sequence: "asc" } } } } } } } });
      const secondSeed = await seedSyntheticManufacturing(prisma, actorId);
      assert.equal(secondSeed.createdRFQs, 0);
      assert.equal(await prisma.customer.count(), 2); assert.equal(await prisma.part.count(), 6);
      assert.equal(await prisma.materialRate.count(), 3); assert.equal(await prisma.machineRate.count(), 3); assert.equal(await prisma.routing.count(), 6);
      assert.deepEqual(await prisma.rFQ.findMany({ orderBy: { id: "asc" }, include: { parts: { orderBy: { id: "asc" }, include: { routing: { include: { operations: { orderBy: { sequence: "asc" } } } } } } } }), seededRFQs);
      manufacturingSeed = JSON.stringify({ firstSeed, secondRunCreatedRFQs: secondSeed.createdRFQs });
    }
    assert.equal(await prisma.quotation.count(), 0); assert.equal(await prisma.costing.count(), 0);
    assert.equal(await prisma.routingTechnicalReview.count(), 0); assert.equal(await prisma.companyProfile.count(), 0);
    console.log(JSON.stringify({ label: "SYNTHETIC DEMO DATA", database: target.database, firstImport: first.summary, reimport: second.summary, invalidRowsReported: invalid.summary.invalidRows, persistedSourceParts: 1400, historicalSearch: "PASS", manufacturingSeed, liveQuotations: 0 }, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Isolated demo verification failed"); process.exitCode = 1; });
