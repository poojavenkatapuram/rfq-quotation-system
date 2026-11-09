import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

const mocks = vi.hoisted(() => ({
  customerFindMany: vi.fn(),
  customerFindUnique: vi.fn(),
  customerFindFirst: vi.fn(),
  customerCreate: vi.fn(),
  customerUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    customer: {
      findMany: mocks.customerFindMany,
      findUnique: mocks.customerFindUnique,
      findFirst: mocks.customerFindFirst,
      create: mocks.customerCreate,
      update: mocks.customerUpdate,
    },
    auditLog: {
      create: mocks.auditLogCreate,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  createCustomer,
  getCustomers,
  updateCustomer,
} from "./customer.controller.js";

const userId = "user-1";
const customerId = "customer-1";
const existingCustomer = {
  id: customerId,
  name: "Acme Components",
  code: "ACME-01",
  email: "purchasing@acme.example",
  phone: "+91-9999999999",
  address: "Pune",
  gstNumber: "27ABCDE1234F1Z5",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const createResponse = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;

  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  (res.json as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
};

const createRequest = (
  body: Record<string, unknown> = {},
  options: {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    authenticated?: boolean;
  } = {}
) => ({
  body,
  params: options.params ?? {},
  query: options.query ?? {},
  user: options.authenticated === false ? undefined : { userId, role: "ADMIN" },
});

const transactionClient = {
  customer: {
    create: mocks.customerCreate,
    update: mocks.customerUpdate,
  },
  auditLog: {
    create: mocks.auditLogCreate,
  },
};

describe("customer controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customerFindMany.mockResolvedValue([existingCustomer]);
    mocks.customerFindUnique.mockResolvedValue(existingCustomer);
    mocks.customerFindFirst.mockResolvedValue(null);
    mocks.customerCreate.mockResolvedValue(existingCustomer);
    mocks.customerUpdate.mockResolvedValue(existingCustomer);
    mocks.auditLogCreate.mockResolvedValue({ id: "audit-1" });
    mocks.transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        return callback(transactionClient);
      }

      return Promise.all(callback as Promise<unknown>[]);
    });
  });

  it("lists customers using a case-insensitive name or code search", async () => {
    const res = createResponse();

    await getCustomers(
      createRequest({}, { query: { search: "acme" } }) as never,
      res
    );

    expect(mocks.customerFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: "acme", mode: "insensitive" } },
          { code: { contains: "acme", mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects an invalid customer search", async () => {
    const res = createResponse();

    await getCustomers(
      createRequest({}, { query: { search: ["acme"] as unknown as string } }) as never,
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.customerFindMany).not.toHaveBeenCalled();
  });

  it("creates a customer and records the actor and initial values", async () => {
    const res = createResponse();
    const request = createRequest({
      name: "Acme Components",
      code: "ACME-01",
      email: "purchasing@acme.example",
      phone: "+91-9999999999",
      address: "Pune",
      gstNumber: "27ABCDE1234F1Z5",
    });

    await createCustomer(request as never, res);

    expect(mocks.customerCreate).toHaveBeenCalledWith({
      data: {
        name: "Acme Components",
        code: "ACME-01",
        email: "purchasing@acme.example",
        phone: "+91-9999999999",
        address: "Pune",
        gstNumber: "27ABCDE1234F1Z5",
      },
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({
      data: {
        actorId: userId,
        action: "CUSTOMER_CREATED",
        entityType: "Customer",
        entityId: customerId,
        details: {
          customer: {
            name: existingCustomer.name,
            code: existingCustomer.code,
            email: existingCustomer.email,
            phone: existingCustomer.phone,
            address: existingCustomer.address,
            gstNumber: existingCustomer.gstNumber,
          },
        },
      },
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects invalid customer details before querying or writing", async () => {
    const res = createResponse();

    await createCustomer(createRequest({ name: "A", code: "bad code" }) as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.customerFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("prevents duplicate customer names and codes", async () => {
    mocks.customerFindFirst.mockResolvedValue({ id: "customer-2", code: "ACME-01" });
    const res = createResponse();

    await createCustomer(
      createRequest({ name: "Acme Components", code: "ACME-01" }) as never,
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires an authenticated actor to create a customer", async () => {
    const res = createResponse();

    await createCustomer(
      createRequest(
        { name: "Acme Components", code: "ACME-01" },
        { authenticated: false }
      ) as never,
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.customerFindFirst).not.toHaveBeenCalled();
  });

  it("updates only customer fields and audits the changed values", async () => {
    const updatedCustomer = { ...existingCustomer, phone: "+91-8888888888" };
    mocks.customerUpdate.mockResolvedValue(updatedCustomer);
    const res = createResponse();

    await updateCustomer(
      createRequest(
        { phone: "+91-8888888888" },
        { params: { id: customerId } }
      ) as never,
      res
    );

    expect(mocks.customerUpdate).toHaveBeenCalledWith({
      where: { id: customerId },
      data: { phone: "+91-8888888888" },
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: userId,
        action: "CUSTOMER_UPDATED",
        entityType: "Customer",
        entityId: customerId,
        details: {
          changes: {
            phone: {
              previous: "+91-9999999999",
              updated: "+91-8888888888",
            },
          },
        },
      }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects an update that would duplicate another customer", async () => {
    mocks.customerFindFirst.mockResolvedValue({ id: "customer-2", code: "OTHER-01" });
    const res = createResponse();

    await updateCustomer(
      createRequest(
        { name: "Other Customer" },
        { params: { id: customerId } }
      ) as never,
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
