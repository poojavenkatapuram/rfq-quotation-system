import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const handlers = vi.hoisted(() => ({
  getExtractionJob: vi.fn((_req: any, res: any) => res.sendStatus(200)),
  retryExtractionJob: vi.fn((_req: any, res: any) => res.sendStatus(200)),
  reviewExtractedFields: vi.fn((_req: any, res: any) => res.sendStatus(200)),
  uploadAndExtractDocument: vi.fn(async (_req: any, res: any) => { res.sendStatus(201); }),
  uploadAndExtractDocuments: vi.fn(async (_req: any, res: any) => { res.sendStatus(201); }),
}));
vi.mock("../controllers/document-intake.controller.js", () => handlers);
vi.mock("../middleware/auth.middleware.js", () => ({ authenticate: (req: any, res: any, next: () => void) => {
  const role = req.header("x-test-role");
  if (!role) return res.sendStatus(401);
  req.user = { userId: "user-1", role }; next();
} }));
import routes from "./document-intake.routes.js";
const app = express(); app.use(routes);
beforeEach(() => vi.clearAllMocks());
describe("document route role boundaries", () => {
  it("requires authentication for document reads", async () => {
    expect((await request(app).get("/job-1")).status).toBe(401);
    expect(handlers.getExtractionJob).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "ESTIMATOR", "PLANT_HEAD"])("allows %s reads through to document-level authorization", async role => {
    expect((await request(app).get("/job-1").set("x-test-role", role)).status).toBe(200);
    expect(handlers.getExtractionJob).toHaveBeenCalledOnce();
  });
  it.each(["SALES_HEAD", "UNKNOWN"])("denies %s document reads", async role => {
    expect((await request(app).get("/job-1").set("x-test-role", role)).status).toBe(403);
    expect(handlers.getExtractionJob).not.toHaveBeenCalled();
  });
  it.each(["PLANT_HEAD", "SALES_HEAD"])("does not grant %s intake mutations", async role => {
    expect((await request(app).post("/upload").set("x-test-role", role)).status).toBe(403);
    expect((await request(app).post("/uploads").set("x-test-role", role)).status).toBe(403);
    expect((await request(app).post("/job-1/retry").set("x-test-role", role)).status).toBe(403);
    expect((await request(app).patch("/job-1/review").set("x-test-role", role)).status).toBe(403);
    expect(handlers.reviewExtractedFields).not.toHaveBeenCalled(); expect(handlers.retryExtractionJob).not.toHaveBeenCalled();
    expect(handlers.uploadAndExtractDocument).not.toHaveBeenCalled(); expect(handlers.uploadAndExtractDocuments).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "ESTIMATOR"])("preserves %s intake mutation routes", async role => {
    expect((await request(app).post("/job-1/retry").set("x-test-role", role)).status).toBe(200);
    expect((await request(app).patch("/job-1/review").set("x-test-role", role)).status).toBe(200);
  });
});
