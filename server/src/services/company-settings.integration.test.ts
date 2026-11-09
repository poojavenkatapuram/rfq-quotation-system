import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanySettingsConflict, getCompanySettings, saveCompanySettings, saveCompanySettingsSchema } from "./company-settings.service.js";

// Explicit opt-in; fixtures exist only inside rolled-back transactions.
// Refuse to run if an actual company profile has already been configured.
const db = new PrismaClient({ errorFormat: "minimal" });
const rollback = new Error("ROLLBACK_COMPANY_SETTINGS_FIXTURE");
const fields = { name: "Rollback-only Company", address: "Registered office, Pune", email: "quotes@example.com", phone: "+91 9876543210", gstNumber: "27ABCDE1234F1Z5" };

describe.skipIf(process.env.COMPANY_SETTINGS_DB_TESTS !== "1")("local company settings persistence (rollback only)", () => {
  beforeAll(async () => {
    const u = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || (u.port || "5432") !== "5432" || u.pathname !== "/rfq_quotation_db" || (u.searchParams.get("schema") || "public") !== "public") throw new Error("Company settings integration tests require the authorized local database");
    if (await db.companyProfile.count()) throw new Error("Company profile already exists; refusing to touch it");
  });
  afterAll(async () => db.$disconnect());

  it("stores a profile, reads it afresh, uses optimistic versions, and audits every save", async () => {
    await expect(db.$transaction(async tx => {
      const actor = await tx.user.create({ data: { name: "Rollback test administrator", email: `${randomUUID()}@company-test.invalid`, passwordHash: "not-a-login", role: "ADMIN" } });
      const first = await saveCompanySettings(tx, actor.id, saveCompanySettingsSchema.parse({ ...fields, expectedVersion: 0 }));
      expect(first).toEqual(expect.objectContaining({ version: 1, source: "database", company: fields }));
      expect(await getCompanySettings(tx)).toEqual(first);
      expect(await tx.companyProfile.count()).toBe(1);
      const changed = { ...fields, name: "Updated rollback-only Company", email: null };
      const second = await saveCompanySettings(tx, actor.id, { ...changed, expectedVersion: 1 });
      expect(second).toEqual(expect.objectContaining({ version: 2, company: changed }));
      expect(await getCompanySettings(tx)).toEqual(second);
      await expect(saveCompanySettings(tx, actor.id, { ...fields, expectedVersion: 1 })).rejects.toBeInstanceOf(CompanySettingsConflict);
      const audits = await tx.auditLog.findMany({ where: { actorId: actor.id, action: "COMPANY_SETTINGS_SAVED" }, orderBy: { createdAt: "asc" } });
      expect(audits).toHaveLength(2);
      expect(audits[1].details).toEqual(expect.objectContaining({ previousVersion: 1, version: 2, before: fields, after: changed }));
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await db.companyProfile.count()).toBe(0);
  });

  it("rolls back the profile when audit logging fails", async () => {
    await expect(db.$transaction(tx => saveCompanySettings(tx, `nonexistent-${randomUUID()}`, { ...fields, expectedVersion: 0 }))).rejects.toThrow(/Foreign key constraint/);
    expect(await db.companyProfile.count()).toBe(0);
  });

  it("enforces the reviewed singleton constraint in PostgreSQL", async () => {
    await expect(db.$transaction(async tx => {
      await tx.companyProfile.create({ data: { id: 2, ...fields } });
      throw new Error("Singleton constraint failed to protect the table");
    })).rejects.toThrow(/CompanyProfile_singleton/);
    expect(await db.companyProfile.count()).toBe(0);
  });
});
