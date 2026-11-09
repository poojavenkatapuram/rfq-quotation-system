import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomers: vi.fn((_req: unknown, res: express.Response) => {
    res.status(200).json({ success: true });
  }),
  getCustomerById: vi.fn((_req: unknown, res: express.Response) => {
    res.status(200).json({ success: true });
  }),
  createCustomer: vi.fn((_req: unknown, res: express.Response) => {
    res.status(201).json({ success: true });
  }),
  updateCustomer: vi.fn((_req: unknown, res: express.Response) => {
    res.status(200).json({ success: true });
  }),
}));

vi.mock("../middleware/auth.middleware.js", () => ({
  authenticate: (req: express.Request & { user?: unknown }, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      userId: "user-1",
      role: req.header("x-test-role") || "ESTIMATOR",
    };
    next();
  },
}));

vi.mock("../controllers/customer.controller.js", () => ({
  getCustomers: mocks.getCustomers,
  getCustomerById: mocks.getCustomerById,
  createCustomer: mocks.createCustomer,
  updateCustomer: mocks.updateCustomer,
}));

import customerRoutes from "./customer.routes.js";

const app = express();
app.use(customerRoutes);

describe("customer routes", () => {
  it.each(["ESTIMATOR", "SALES_HEAD", "PLANT_HEAD", "ADMIN"])(
    "allows %s to view customers",
    async (role) => {
      mocks.getCustomers.mockClear();

      const response = await request(app).get("/").set("x-test-role", role);

      expect(response.status).toBe(200);
      expect(mocks.getCustomers).toHaveBeenCalledTimes(1);
    }
  );

  it("allows an administrator to create and update customers", async () => {
    mocks.createCustomer.mockClear();
    mocks.updateCustomer.mockClear();

    const createResponse = await request(app)
      .post("/")
      .set("x-test-role", "ADMIN");
    const updateResponse = await request(app)
      .patch("/customer-1")
      .set("x-test-role", "ADMIN");

    expect(createResponse.status).toBe(201);
    expect(updateResponse.status).toBe(200);
    expect(mocks.createCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.updateCustomer).toHaveBeenCalledTimes(1);
  });

  it.each(["ESTIMATOR", "SALES_HEAD", "PLANT_HEAD"])(
    "denies %s from creating or updating customers",
    async (role) => {
      mocks.createCustomer.mockClear();
      mocks.updateCustomer.mockClear();

      const createResponse = await request(app)
        .post("/")
        .set("x-test-role", role);
      const updateResponse = await request(app)
        .patch("/customer-1")
        .set("x-test-role", role);

      expect(createResponse.status).toBe(403);
      expect(updateResponse.status).toBe(403);
      expect(mocks.createCustomer).not.toHaveBeenCalled();
      expect(mocks.updateCustomer).not.toHaveBeenCalled();
    }
  );
});
