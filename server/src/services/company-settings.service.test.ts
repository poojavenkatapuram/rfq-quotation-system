import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CompanySettingsConflict, getCompanySettings, isCompanySettingsConflict, saveCompanySettings, saveCompanySettingsSchema } from "./company-settings.service.js";

const fields = { name: "ForgeFlow Manufacturing", address: "Industrial Estate, Pune, Maharashtra", email: "quotes@example.com", phone: "+91 98765 43210", gstNumber: "27ABCDE1234F1Z5" };
const profile = { id: 1, ...fields, version: 1, createdAt: new Date("2026-11-09"), updatedAt: new Date("2026-11-09") };
function client() {
  return { companyProfile: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(profile), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ ...profile, version: 2 }) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
}
const asTx = (tx: ReturnType<typeof client>) => tx as unknown as Prisma.TransactionClient;
beforeEach(() => { for (const key of ["COMPANY_NAME", "COMPANY_ADDRESS", "COMPANY_EMAIL", "COMPANY_PHONE", "COMPANY_GST_NUMBER"]) vi.stubEnv(key, ""); });
afterEach(() => vi.unstubAllEnvs());

describe("company profile validation", () => {
  it("trims details, normalizes GSTIN and preserves multiline registered addresses", () => {
    expect(saveCompanySettingsSchema.parse({ ...fields, name: "  ForgeFlow Manufacturing  ", address: "  Industrial Estate\nPune  ", gstNumber: fields.gstNumber.toLowerCase(), expectedVersion: 0 })).toEqual({ ...fields, name: fields.name, address: "Industrial Estate\nPune", expectedVersion: 0 });
  });
  it("accepts explicit clearing of optional details", () => {
    expect(saveCompanySettingsSchema.parse({ name: fields.name, address: fields.address, email: " ", phone: null, gstNumber: "", expectedVersion: 1 })).toEqual({ name: fields.name, address: fields.address, email: null, phone: null, gstNumber: null, expectedVersion: 1 });
  });
  it.each([
    { expectedVersion: undefined }, { expectedVersion: -1 }, { expectedVersion: "1" },
    { name: " " }, { name: "Company\nInjected" }, { name: "x".repeat(201) }, { address: "" }, { address: "x".repeat(2001) },
    { email: "not-email" }, { phone: "abc1234567890" }, { phone: "123" }, { phone: "1234567890123456" },
    { gstNumber: "invalid" }, { id: 2 }, { version: 55 }, { logoUrl: "https://untrusted.invalid/logo" },
  ])("rejects invalid details %j", change => {
    expect(saveCompanySettingsSchema.safeParse({ ...fields, expectedVersion: 0, ...change }).success).toBe(false);
  });
});

describe("company profile persistence", () => {
  it("returns unconfigured without inserting anything on a read", async () => {
    const tx = client();
    expect(await getCompanySettings(asTx(tx))).toEqual({ company: { name: null, address: null, email: null, phone: null, gstNumber: null }, version: 0, source: "unconfigured", updatedAt: null });
    expect(tx.companyProfile.create).not.toHaveBeenCalled();
  });
  it("uses environment defaults only while no profile exists", async () => {
    vi.stubEnv("COMPANY_NAME", " Environment Company ");
    const tx = client();
    expect(await getCompanySettings(asTx(tx))).toEqual(expect.objectContaining({ company: expect.objectContaining({ name: "Environment Company" }), version: 0, source: "environment" }));
    tx.companyProfile.findUnique.mockResolvedValue({ ...profile, email: null } as never);
    vi.stubEnv("COMPANY_EMAIL", "old@example.com");
    const result = await getCompanySettings(asTx(tx));
    expect(result.company.name).toBe(fields.name);
    expect(result.company.email).toBeNull();
    expect(result.source).toBe("database");
  });
  it("creates the singleton with actor-attributed before/after audit evidence", async () => {
    const tx = client();
    const saved = await saveCompanySettings(asTx(tx), "admin", { ...fields, expectedVersion: 0 });
    expect(saved.version).toBe(1);
    expect(tx.companyProfile.create).toHaveBeenCalledWith({ data: { id: 1, ...fields } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "admin", action: "COMPANY_SETTINGS_SAVED", entityType: "CompanyProfile", entityId: "1", details: expect.objectContaining({ previousVersion: 0, version: 1, previousSource: "unconfigured", after: fields }) }) });
  });
  it("conditionally updates exactly the expected version and audits previous values", async () => {
    const tx = client(); tx.companyProfile.findUnique.mockResolvedValue(profile as never);
    const saved = await saveCompanySettings(asTx(tx), "admin", { ...fields, expectedVersion: 1 });
    expect(saved.version).toBe(2);
    expect(tx.companyProfile.updateMany).toHaveBeenCalledWith({ where: { id: 1, version: 1 }, data: { ...fields, version: { increment: 1 } } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ previousVersion: 1, version: 2, before: fields }) }) }));
  });
  it("rejects stale versions without any write or audit", async () => {
    const tx = client(); tx.companyProfile.findUnique.mockResolvedValue(profile as never);
    await expect(saveCompanySettings(asTx(tx), "admin", { ...fields, expectedVersion: 0 })).rejects.toBeInstanceOf(CompanySettingsConflict);
    expect(tx.companyProfile.create).not.toHaveBeenCalled(); expect(tx.companyProfile.updateMany).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("rejects the losing conditional update without an audit", async () => {
    const tx = client(); tx.companyProfile.findUnique.mockResolvedValue(profile as never); tx.companyProfile.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveCompanySettings(asTx(tx), "admin", { ...fields, expectedVersion: 1 })).rejects.toBeInstanceOf(CompanySettingsConflict);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("propagates audit failures so the caller rolls back the profile write", async () => {
    const tx = client(); tx.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(saveCompanySettings(asTx(tx), "admin", { ...fields, expectedVersion: 0 })).rejects.toThrow("audit unavailable");
  });
  it("recognizes competing initial creation as a conflict", () => {
    expect(isCompanySettingsConflict(new Prisma.PrismaClientKnownRequestError("unique conflict", { code: "P2002", clientVersion: "6.19.3" }))).toBe(true);
    expect(isCompanySettingsConflict(new Error("storage unavailable"))).toBe(false);
  });
  it("allows only one of two competing updates to publish the same expected version", async () => {
    const tx = client(); tx.companyProfile.findUnique.mockResolvedValue(profile as never);
    let version = 1;
    tx.companyProfile.updateMany.mockImplementation(async ({ where }) => {
      if (where.version !== version) return { count: 0 };
      version += 1; return { count: 1 };
    });
    const outcomes = await Promise.allSettled([
      saveCompanySettings(asTx(tx), "first-admin", { ...fields, expectedVersion: 1 }),
      saveCompanySettings(asTx(tx), "second-admin", { ...fields, expectedVersion: 1 }),
    ]);
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

});
