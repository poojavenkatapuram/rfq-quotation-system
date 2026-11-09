import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => {
  const handler = () => vi.fn((_req: unknown, res: { status: (code: number) => { json: (data: object) => unknown } }) => res.status(200).json({ success: true }));
  return { saveRouting: handler(), getRoutingByPart: handler(), getHistoricalRoutingRecommendations: handler(), submitRoutingReview: handler(), decideRoutingReview: handler() };
});
vi.mock("../middleware/auth.middleware.js", () => ({
  authenticate: (req: express.Request & { user?: object }, res: express.Response, next: () => void) => {
    const role = req.header("x-test-role");
    if (!role) return res.status(401).json({ success: false });
    req.user = { userId: "actor", role }; next();
  },
}));
vi.mock("../controllers/routing.controller.js", () => ({ saveRouting: mocks.saveRouting, getRoutingByPart: mocks.getRoutingByPart, getHistoricalRoutingRecommendations: mocks.getHistoricalRoutingRecommendations }));
vi.mock("../controllers/routing-review.controller.js", () => ({ submitRoutingReview: mocks.submitRoutingReview, decideRoutingReview: mocks.decideRoutingReview }));
import routes from "./routing.routes.js";
const app = express(); app.use(express.json(), routes);
beforeEach(() => vi.clearAllMocks());
describe("routing authorization", () => {
  it.each(["ESTIMATOR", "PLANT_HEAD", "SALES_HEAD", "ADMIN"])("allows %s to read recommendations and review history", async role => {
    expect((await request(app).get("/recommendations/part").set("x-test-role", role)).status).toBe(200);
    expect((await request(app).get("/part/part").set("x-test-role", role)).status).toBe(200);
  });
  it.each(["ESTIMATOR", "PLANT_HEAD", "ADMIN"])("allows %s draft routing saves", async role => {
    expect((await request(app).put("/part/part").set("x-test-role", role)).status).toBe(200);
  });
  it("denies Sales Head routing edits", async () => {
    expect((await request(app).put("/part/part").set("x-test-role", "SALES_HEAD")).status).toBe(403);
    expect(mocks.saveRouting).not.toHaveBeenCalled();
  });
  it.each(["ESTIMATOR", "ADMIN"])("allows %s to submit review", async role => {
    expect((await request(app).post("/part/part/review").set("x-test-role", role)).status).toBe(200);
  });
  it.each(["PLANT_HEAD", "SALES_HEAD"])("denies %s review submission", async role => {
    expect((await request(app).post("/part/part/review").set("x-test-role", role)).status).toBe(403);
  });
  it.each(["ESTIMATOR", "ADMIN", "SALES_HEAD"])("denies %s technical decisions", async role => {
    expect((await request(app).post("/part/part/review/decision").set("x-test-role", role)).status).toBe(403);
    expect(mocks.decideRoutingReview).not.toHaveBeenCalled();
  });
  it("allows only Plant Head technical decisions", async () => {
    expect((await request(app).post("/part/part/review/decision").set("x-test-role", "PLANT_HEAD")).status).toBe(200);
  });
  it.each(["/part/part", "/recommendations/part"])("denies unauthenticated reads of %s", async path => {
    expect((await request(app).get(path)).status).toBe(401);
  });
  it.each(["/part/part/review", "/part/part/review/decision"])("denies unauthenticated review actions at %s", async path => {
    expect((await request(app).post(path)).status).toBe(401);
  });
});
