import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { lockRoutingPart, requireApprovedRoutings, TechnicalReviewConflict } from "./routing-review.service.js";

// Opt-in: every fixture is created inside a transaction that is rolled back.
// No existing records are changed and no fixture cleanup/deletion is needed.
const enabled = process.env.PHASE5_DB_TESTS === "1";
const db = new PrismaClient();
const rollback = new Error("ROLLBACK_PHASE5_TEST_FIXTURE");

async function fixture(tx: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const user = await tx.user.create({ data: { name: "Phase 5 rollback fixture", email: `${suffix}@phase5.invalid`, passwordHash: "not-a-login", role: "PLANT_HEAD" } });
  const customer = await tx.customer.create({ data: { name: "Phase 5 rollback fixture", code: suffix } });
  const rfq = await tx.rFQ.create({ data: { rfqNumber: suffix, customerId: customer.id, createdById: user.id } });
  const part = await tx.part.create({ data: { rfqId: rfq.id, name: "Rollback test spindle" } });
  const routing = await tx.routing.create({ data: { partId: part.id, operations: { create: { sequence: 1, operationName: "Turning", cycleTimeMin: 2, setupTimeMin: 10 } } } });
  const review = await tx.routingTechnicalReview.create({ data: { routingId: routing.id, routingRevision: 1, submittedById: user.id, submittedSnapshot: { operationName: "Turning", cycleTimeMin: 2 } } });
  return { user, customer, rfq, part, routing, review };
}

describe.skipIf(!enabled)("local Phase 5 database protections (rollback only)", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/rfq_quotation_db" || (url.searchParams.get("schema") || "public") !== "public") throw new Error("Phase 5 tests require the authorized local rfq_quotation_db database");
    const identity = await db.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0].database).toBe("rfq_quotation_db");
  });
  afterAll(async () => db.$disconnect());

  it("permits draft costing, gates approval, then invalidates approval after an edit without changing history or commercial snapshots", async () => {
    await expect(db.$transaction(async tx => {
      const { user, customer, rfq, part, routing, review } = await fixture(tx);
      const costing = await tx.costing.create({ data: { partId: part.id, createdById: user.id, routingRevision: 1, grossWeightKg: 1, totalCost: 123.45 } });
      const lines = [{ partId: part.id, costing }];
      await expect(requireApprovedRoutings(tx, lines)).rejects.toBeInstanceOf(TechnicalReviewConflict);
      await tx.routingTechnicalReview.update({ where: { id: review.id }, data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date() } });
      await expect(requireApprovedRoutings(tx, lines)).resolves.toEqual([{ partId: part.id, routingRevision: 1, reviewId: review.id }]);
      const snapshot = { marker: "approved commercial snapshot must not change" };
      const quotation = await tx.quotation.create({ data: { quotationNumber: randomUUID(), rfqId: rfq.id, customerId: customer.id, createdById: user.id, status: "APPROVED", subtotal: 123.45, gstAmount: 22.22, grandTotal: 145.67, approvedSnapshot: snapshot } });
      await tx.routing.update({ where: { id: routing.id }, data: { revision: { increment: 1 }, operations: { updateMany: { where: { sequence: 1 }, data: { cycleTimeMin: 3 } } } } });
      await expect(requireApprovedRoutings(tx, lines)).rejects.toBeInstanceOf(TechnicalReviewConflict);
      expect((await tx.routingTechnicalReview.findUniqueOrThrow({ where: { id: review.id } })).submittedSnapshot).toEqual(review.submittedSnapshot);
      expect((await tx.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).approvedSnapshot).toEqual(snapshot);
      expect(Number((await tx.costing.findUniqueOrThrow({ where: { id: costing.id } })).totalCost)).toBe(123.45);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("rejects changes to submitted snapshot evidence at the database level", async () => {
    await expect(db.$transaction(async tx => {
      const { review } = await fixture(tx);
      await tx.routingTechnicalReview.update({ where: { id: review.id }, data: { submittedSnapshot: { tampered: true } } });
      throw new Error("Snapshot protection did not run");
    })).rejects.toThrow(/immutable/);
  });

  it("rejects changing completed review decisions at the database level", async () => {
    await expect(db.$transaction(async tx => {
      const { review, user } = await fixture(tx);
      await tx.routingTechnicalReview.update({ where: { id: review.id }, data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date() } });
      await tx.routingTechnicalReview.update({ where: { id: review.id }, data: { status: "REJECTED", comments: "Late contradictory decision" } });
      throw new Error("Completed decision protection did not run");
    })).rejects.toThrow(/immutable/);
  });

  it("rejects rejection without comments at the database level", async () => {
    await expect(db.$transaction(async tx => {
      const { review, user } = await fixture(tx);
      await tx.routingTechnicalReview.update({ where: { id: review.id }, data: { status: "REJECTED", comments: "  ", reviewedById: user.id, reviewedAt: new Date() } });
      throw new Error("Comment constraint did not run");
    })).rejects.toThrow(/RoutingTechnicalReview_decision_valid/);
  });

  it("rolls back a review decision when its transactional audit insert fails", async () => {
    await expect(db.$transaction(async tx => {
      const { review, user } = await fixture(tx);
      await tx.$executeRawUnsafe("SAVEPOINT phase5_audit_failure");
      try {
        await tx.routingTechnicalReview.update({ where: { id: review.id }, data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: "nonexistent-phase5-actor", action: "ROUTING_REVIEW_APPROVED", entityType: "Routing", entityId: review.routingId } });
        throw new Error("Invalid actor unexpectedly accepted");
      } catch (error) {
        expect(String(error)).toContain("Foreign key constraint");
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT phase5_audit_failure");
      }
      expect((await tx.routingTechnicalReview.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("PENDING");
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("serializes the same part across actual PostgreSQL connections and releases at transaction end", async () => {
    const partId = randomUUID();
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { acquired = resolve; });
    const finished = new Promise<void>(resolve => { release = resolve; });
    const owner = db.$transaction(async tx => { await lockRoutingPart(tx, partId); acquired(); await finished; });
    try {
      await held;
      const available = await db.$transaction(tx => tx.$queryRaw<Array<{ available: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${`routing:${partId}`})) AS available`);
      expect(available[0].available).toBe(false);
    } finally { release(); await owner; }
    const available = await db.$transaction(tx => tx.$queryRaw<Array<{ available: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${`routing:${partId}`})) AS available`);
    expect(available[0].available).toBe(true);
  });
});
