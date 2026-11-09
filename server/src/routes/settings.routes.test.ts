import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { userLookup, read, save } = vi.hoisted(() => ({
  userLookup: vi.fn(),
  read: vi.fn((_req: unknown, res: express.Response) => res.status(200).json({ success: true })),
  save: vi.fn((_req: unknown, res: express.Response) => res.status(200).json({ success: true })),
}));
vi.mock("../lib/prisma.js", () => ({ default: { user: { findUnique: userLookup } } }));
vi.mock("../controllers/settings.controller.js", () => ({ readCompanySettings: read, updateCompanySettings: save }));
import routes from "./settings.routes.js";
const app = express(); app.use(express.json(), routes);
const secret = "settings-test-secret-only";
const token = (role = "ADMIN") => jwt.sign({ userId: "actor", role }, secret);
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("JWT_SECRET", secret); userLookup.mockResolvedValue({ id: "actor", role: "ADMIN", isActive: true }); });
afterEach(() => vi.unstubAllEnvs());

describe("company settings API authorization", () => {
  it("allows an active Admin to read and update", async () => {
    expect((await request(app).get("/company").auth(token(), { type: "bearer" })).status).toBe(200);
    expect((await request(app).put("/company").auth(token(), { type: "bearer" }).send({})).status).toBe(200);
    expect(read).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
  });
  it.each(["ESTIMATOR", "SALES_HEAD", "PLANT_HEAD"])("denies %s even when the token claims ADMIN", async role => {
    userLookup.mockResolvedValue({ id: "actor", role, isActive: true });
    expect((await request(app).get("/company").auth(token(), { type: "bearer" })).status).toBe(403);
    expect((await request(app).put("/company").auth(token(), { type: "bearer" }).send({})).status).toBe(403);
    expect(read).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("denies unauthenticated access", async () => {
    expect((await request(app).get("/company")).status).toBe(401);
    expect((await request(app).put("/company").send({})).status).toBe(401);
    expect(read).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("denies inactive Admin accounts", async () => {
    userLookup.mockResolvedValue({ id: "actor", role: "ADMIN", isActive: false });
    expect((await request(app).get("/company").auth(token(), { type: "bearer" })).status).toBe(401);
    expect((await request(app).put("/company").auth(token(), { type: "bearer" }).send({})).status).toBe(401);
  });
  it("denies invalid tokens", async () => {
    expect((await request(app).put("/company").auth("invalid", { type: "bearer" }).send({})).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
});
