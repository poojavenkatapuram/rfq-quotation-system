import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedSyntheticManufacturing } from "./synthetic-demo-seed.service.js";

function database(name = "forgeflow_synthetic_demo_test") {
  const records = new Map<string, any>();
  const upsert = vi.fn(async ({ where, create }: any) => {
    if (!records.has(where.id)) records.set(where.id, structuredClone(create));
    return records.get(where.id);
  });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ name, schema: "public" }]),
    user: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN" }) },
    customer: { upsert }, materialRate: { upsert }, machineRate: { upsert },
    rFQ: { findUnique: vi.fn(async ({ where }: any) => records.get(where.id)), create: vi.fn(async ({ data }: any) => { records.set(data.id, structuredClone(data)); return data; }) },
    auditLog: { create: vi.fn() },
  };
  const prisma = { $transaction: async (callback: any) => callback(tx) } as unknown as PrismaClient;
  return { prisma, tx, records, upsert };
}
describe("optional synthetic manufacturing seed", () => {
  it("refuses the existing development database before any seed write", async () => {
    const db = database("rfq_quotation_db");
    await expect(seedSyntheticManufacturing(db.prisma, "actor")).rejects.toThrow("isolated");
    expect(db.upsert).not.toHaveBeenCalled(); expect(db.tx.rFQ.create).not.toHaveBeenCalled();
  });
  it("requires an existing authorized author", async () => {
    const db = database(); db.tx.user.findUnique.mockResolvedValue({ role: "SALES_HEAD" });
    await expect(seedSyntheticManufacturing(db.prisma, "actor")).rejects.toThrow("Admin or Estimator");
    expect(db.upsert).not.toHaveBeenCalled();
  });
  it("is additive and idempotent and creates only draft manufacturing examples", async () => {
    const db = database();
    expect((await seedSyntheticManufacturing(db.prisma, "actor")).createdRFQs).toBe(2);
    const original = structuredClone([...db.records]);
    expect((await seedSyntheticManufacturing(db.prisma, "actor")).createdRFQs).toBe(0);
    expect([...db.records]).toEqual(original);
    expect(db.tx.rFQ.create).toHaveBeenCalledTimes(2); expect(db.tx.auditLog.create).toHaveBeenCalledTimes(2);
    for (const [args] of db.upsert.mock.calls) expect(args.update).toEqual({});
    const parts = db.tx.rFQ.create.mock.calls.flatMap(([args]) => args.data.parts.create);
    expect(parts).toHaveLength(6);
    for (const part of parts) {
      expect(part.name).toContain("SYNTHETIC DEMO"); expect(part.routing.create.operations.create).toHaveLength(2);
      expect(part.routing.create.technicalReviews).toBeUndefined(); expect(part.costings).toBeUndefined(); expect(part.drawingNumber).toBeUndefined();
    }
  });
});
