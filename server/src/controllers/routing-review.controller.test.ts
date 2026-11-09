import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const { tx, transaction } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn().mockResolvedValue(1),
    routing: { findUnique: vi.fn() },
    routingTechnicalReview: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
  },
  transaction: vi.fn(),
}));
vi.mock("../lib/prisma.js", () => ({ default: { $transaction: transaction } }));
import { decideRoutingReview, submitRoutingReview } from "./routing-review.controller.js";

const operations = [{ sequence: 1, operationName: "Turning", machineRateId: "rate", cycleTimeMin: 4, setupTimeMin: 60, machineRate: { ratePerHour: 850 } }];
const routing = { id: "routing", partId: "part", revision: 2, operations };
const pending = { id: "review", routingId: "routing", routingRevision: 2, status: "PENDING", submittedSnapshot: { routing }, submittedById: "estimator" };
const request = (role = "ESTIMATOR", body: object = { expectedRevision: 2 }) => ({ params: { partId: "part" }, user: { userId: role.toLowerCase(), role }, body }) as unknown as AuthenticatedRequest;
function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}
const resType = (res: ReturnType<typeof response>) => res as unknown as Response;

beforeEach(() => {
  vi.resetAllMocks();
  tx.$executeRaw.mockResolvedValue(1);
  tx.routing.findUnique.mockResolvedValue(structuredClone(routing));
  tx.routingTechnicalReview.findUnique.mockResolvedValue(null);
  tx.routingTechnicalReview.create.mockImplementation(async ({ data }) => ({ id: "review", ...data }));
  tx.routingTechnicalReview.updateMany.mockResolvedValue({ count: 1 });
  tx.auditLog.findFirst.mockResolvedValue({ details: { recommendationSource: { sourcePartId: "historical", sourceRoutingRevision: 3 }, revision: 2 } });
  tx.auditLog.create.mockResolvedValue({});
  transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
});

describe("technical review submission", () => {
  it("records an immutable copy of saved operations, rates, and recommendation provenance", async () => {
    const res = response();
    await submitRoutingReview(request(), resType(res));
    expect(res.status).toHaveBeenCalledWith(201);
    const data = tx.routingTechnicalReview.create.mock.calls[0][0].data;
    expect(data.submittedSnapshot.routing.operations).toEqual(operations);
    expect(data.submittedSnapshot.saveProvenance.recommendationSource.sourcePartId).toBe("historical");
    expect(data.submittedSnapshot.routing).not.toBe(routing);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "ROUTING_REVIEW_SUBMITTED" }) }));
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.routing.findUnique.mock.invocationCallOrder[0]);
  });
  it.each(["SALES_HEAD", "PLANT_HEAD"])("denies %s submission", async role => {
    const res = response();
    await submitRoutingReview(request(role), resType(res));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("denies unauthenticated requests", async () => {
    const req = request(); delete req.user;
    const res = response();
    await submitRoutingReview(req, resType(res));
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it.each([{}, { expectedRevision: 0 }, { expectedRevision: "2" }])("requires an explicit valid revision %j", async body => {
    const res = response();
    await submitRoutingReview(request("ESTIMATOR", body), resType(res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("rejects a stale revision", async () => {
    const res = response();
    await submitRoutingReview(request("ESTIMATOR", { expectedRevision: 1 }), resType(res));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.routingTechnicalReview.create).not.toHaveBeenCalled();
  });
  it("returns 404 for missing routing", async () => {
    tx.routing.findUnique.mockResolvedValue(null);
    const res = response();
    await submitRoutingReview(request(), resType(res));
    expect(res.status).toHaveBeenCalledWith(404);
  });
  it.each(["PENDING", "APPROVED", "REJECTED"])("does not overwrite an existing %s review", async status => {
    tx.routingTechnicalReview.findUnique.mockResolvedValue({ ...pending, status });
    const res = response();
    await submitRoutingReview(request(), resType(res));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.routingTechnicalReview.create).not.toHaveBeenCalled();
  });
});

describe("Plant Head decisions", () => {
  const decision = (status = "APPROVED", comments?: string) => request("PLANT_HEAD", { expectedRevision: 2, status, comments });
  beforeEach(() => tx.routingTechnicalReview.findUnique.mockResolvedValue(pending));
  it.each(["ESTIMATOR", "SALES_HEAD", "ADMIN"])("denies %s technical approval", async role => {
    const res = response();
    await decideRoutingReview(request(role, { expectedRevision: 2, status: "APPROVED" }), resType(res));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "   "])("requires nonblank comments for changes (%j)", async comments => {
    const res = response();
    await decideRoutingReview(decision("REJECTED", comments), resType(res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(["APPROVED", "REJECTED"])("allows a Plant Head to record %s without touching submitted evidence", async status => {
    const res = response();
    await decideRoutingReview(decision(status, "Verify fixture setup"), resType(res));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.routingTechnicalReview.updateMany).toHaveBeenCalledWith({
      where: { id: "review", status: "PENDING", routingRevision: 2 },
      data: { status, comments: "Verify fixture setup", reviewedById: "plant_head", reviewedAt: expect.any(Date) },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: `ROUTING_REVIEW_${status}` }) }));
  });
  it("rejects a decision when the routing was edited after submission", async () => {
    tx.routing.findUnique.mockResolvedValue({ ...routing, revision: 3 });
    const res = response();
    await decideRoutingReview(decision(), resType(res));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.routingTechnicalReview.updateMany).not.toHaveBeenCalled();
  });
  it("records no audit when a competing decision won the conditional transition", async () => {
    tx.routingTechnicalReview.updateMany.mockResolvedValue({ count: 0 });
    const res = response();
    await decideRoutingReview(decision(), resType(res));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("rolls back the decision if transactional audit logging fails", async () => {
    let committed = "PENDING";
    tx.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      committed = "APPROVED"; // reached only on a successful transaction
      return result;
    });
    const res = response();
    await decideRoutingReview(decision(), resType(res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(committed).toBe("PENDING");
  });
});

describe("competing review transitions", () => {
  // Serializes callbacks like the PostgreSQL transaction-scoped part lock.
  function serialize() {
    let queue = Promise.resolve();
    transaction.mockImplementation((callback: (value: typeof tx) => Promise<unknown>) => {
      const result = queue.then(() => callback(tx));
      queue = result.then(() => undefined, () => undefined);
      return result;
    });
  }
  it("allows exactly one competing submission to create evidence and an audit", async () => {
    serialize();
    let current: object | null = null;
    tx.routingTechnicalReview.findUnique.mockImplementation(async () => current);
    tx.routingTechnicalReview.create.mockImplementation(async ({ data }) => { current = { id: "review", ...data }; return current; });
    const first = response(), second = response();
    await Promise.all([submitRoutingReview(request(), resType(first)), submitRoutingReview(request(), resType(second))]);
    expect([first.status.mock.calls[0][0], second.status.mock.calls[0][0]].sort()).toEqual([201, 409]);
    expect(tx.routingTechnicalReview.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it("prevents concurrent approval and changes requested from producing contradictory decisions", async () => {
    serialize();
    let current = structuredClone(pending);
    tx.routingTechnicalReview.findUnique.mockImplementation(async () => current);
    tx.routingTechnicalReview.updateMany.mockImplementation(async ({ data }) => { current = { ...current, ...data }; return { count: 1 }; });
    const first = response(), second = response();
    await Promise.all([
      decideRoutingReview(request("PLANT_HEAD", { expectedRevision: 2, status: "APPROVED" }), resType(first)),
      decideRoutingReview(request("PLANT_HEAD", { expectedRevision: 2, status: "REJECTED", comments: "Recheck cycle time" }), resType(second)),
    ]);
    expect([first.status.mock.calls[0][0], second.status.mock.calls[0][0]].sort()).toEqual([200, 409]);
    expect(tx.routingTechnicalReview.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
