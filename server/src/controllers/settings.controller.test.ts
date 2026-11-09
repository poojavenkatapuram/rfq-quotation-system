import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
const { tx, database } = vi.hoisted(() => {
  const tx = { companyProfile: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() }, auditLog: { create: vi.fn() } };
  return { tx, database: { companyProfile: tx.companyProfile, $transaction: vi.fn() } };
});
vi.mock("../lib/prisma.js", () => ({ default: database }));
import { readCompanySettings, updateCompanySettings } from "./settings.controller.js";
const fields = { name: "ForgeFlow Manufacturing", address: "Industrial Estate, Pune", email: null, phone: null, gstNumber: null };
const profile = { ...fields, id: 1, version: 1, updatedAt: new Date("2026-11-09") };
function request(role = "ADMIN", body: unknown = { ...fields, expectedVersion: 0 }) { return { user: { userId: "admin", role }, body } as AuthenticatedRequest; }
function response() { return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }; }
const asRes = (res: ReturnType<typeof response>) => res as unknown as Response;
beforeEach(() => {
  vi.resetAllMocks();
  tx.companyProfile.findUnique.mockResolvedValue(null); tx.companyProfile.create.mockResolvedValue(profile); tx.auditLog.create.mockResolvedValue({});
  database.$transaction.mockImplementation(async callback => callback(tx));
});

describe("company settings controllers", () => {
  it.each([readCompanySettings, updateCompanySettings])("rejects unauthenticated access", async handler => {
    const req = request(); delete req.user; const res = response();
    await handler(req, asRes(res));
    expect(res.status).toHaveBeenCalledWith(401); expect(tx.companyProfile.findUnique).not.toHaveBeenCalled(); expect(database.$transaction).not.toHaveBeenCalled();
  });
  it.each(["ESTIMATOR", "SALES_HEAD", "PLANT_HEAD"])("denies %s reads and writes", async role => {
    for (const handler of [readCompanySettings, updateCompanySettings]) {
      const res = response(); await handler(request(role), asRes(res)); expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(tx.companyProfile.findUnique).not.toHaveBeenCalled(); expect(database.$transaction).not.toHaveBeenCalled();
  });
  it("reads the persisted profile without a write", async () => {
    tx.companyProfile.findUnique.mockResolvedValue(profile); const res = response();
    await readCompanySettings(request(), asRes(res));
    expect(res.status).toHaveBeenCalledWith(200); expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ source: "database", version: 1, company: fields }) });
    expect(tx.companyProfile.create).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("returns field errors without opening a transaction", async () => {
    const res = response(); await updateCompanySettings(request("ADMIN", { name: "", address: "", expectedVersion: 0 }), asRes(res));
    expect(res.status).toHaveBeenCalledWith(400); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errors: expect.objectContaining({ fieldErrors: expect.objectContaining({ name: expect.any(Array), address: expect.any(Array) }) }) }));
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it("saves profile and audit through the same transaction", async () => {
    const res = response(); await updateCompanySettings(request(), asRes(res));
    expect(res.status).toHaveBeenCalledWith(200); expect(database.$transaction).toHaveBeenCalledTimes(1); expect(tx.companyProfile.create).toHaveBeenCalledTimes(1); expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it("returns 409 when an update uses an outdated version", async () => {
    tx.companyProfile.findUnique.mockResolvedValue(profile); const res = response(); await updateCompanySettings(request(), asRes(res));
    expect(res.status).toHaveBeenCalledWith(409); expect(tx.companyProfile.create).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("returns 409 when another admin wins initial creation", async () => {
    tx.companyProfile.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3" }));
    const res = response(); await updateCompanySettings(request(), asRes(res)); expect(res.status).toHaveBeenCalledWith(409); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("returns 500 if audit storage fails instead of claiming success", async () => {
    tx.auditLog.create.mockRejectedValue(new Error("audit unavailable")); const res = response();
    await updateCompanySettings(request(), asRes(res)); expect(res.status).toHaveBeenCalledWith(500);
  });
});
