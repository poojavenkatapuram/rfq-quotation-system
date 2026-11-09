import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  createCosting: vi.fn((_req: any, res: any) => {
    res.status(201).json({ success: true });
  }),
  getCostingsByPart: vi.fn((_req: any, res: any) => {
    res.status(200).json({ success: true });
  }),
}));

vi.mock("../middleware/auth.middleware.js", () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = {
      userId: "user-1",
      role: req.header("x-test-role") || "ESTIMATOR",
    };
    next();
  },
}));

vi.mock("../controllers/costing.controller.js", () => ({
  createCosting: mocks.createCosting,
  getCostingsByPart: mocks.getCostingsByPart,
}));

import costingRoutes from "./costing.routes.js";

const app = express();
app.use(costingRoutes);

describe("costing routes", () => {
  it.each(["ESTIMATOR", "ADMIN"])(
    "allows %s to create a costing",
    async (role) => {
      mocks.createCosting.mockClear();

      const response = await request(app)
        .post("/")
        .set("x-test-role", role);

      expect(response.status).toBe(201);
      expect(mocks.createCosting).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["SALES_HEAD", "PLANT_HEAD"])(
    "denies %s from creating a costing",
    async (role) => {
      mocks.createCosting.mockClear();

      const response = await request(app)
        .post("/")
        .set("x-test-role", role);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        success: false,
        message: "You do not have permission to access this resource",
      });
      expect(mocks.createCosting).not.toHaveBeenCalled();
    }
  );
});
