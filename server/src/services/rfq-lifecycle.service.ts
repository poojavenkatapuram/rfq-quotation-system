import { RFQStatus, type Prisma, type RFQ } from "@prisma/client";

export class RFQLifecycleError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

// If an action also needs routing locks, acquire those first (in part-ID
// order), then this RFQ lock. Manual RFQ edits only acquire the RFQ lock.
export async function lockRFQ(tx: Prisma.TransactionClient, rfqId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rfq:${rfqId}`}))`;
}

export async function getLockedRFQ(tx: Prisma.TransactionClient, rfqId: string) {
  await lockRFQ(tx, rfqId);
  const rfq = await tx.rFQ.findUnique({ where: { id: rfqId } });
  if (!rfq) throw new RFQLifecycleError("RFQ not found", 404);
  return rfq;
}

export function assertRFQOpen(rfq: Pick<RFQ, "status">) {
  if (rfq.status === "WON" || rfq.status === "LOST") {
    throw new RFQLifecycleError("The RFQ is closed. Quotation and costing actions cannot change its commercial outcome.");
  }
}

// A strictly increasing token also protects two writes within one millisecond.
export function nextRFQUpdatedAt(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

export async function syncRFQLifecycle(
  tx: Prisma.TransactionClient,
  rfq: Pick<RFQ, "id" | "status" | "updatedAt">,
  actorId: string,
) {
  assertRFQOpen(rfq);
  const quotations = await tx.quotation.findMany({ where: { rfqId: rfq.id }, select: { status: true } });
  // Sending is sticky, including explicitly recorded legacy sent RFQs.
  // A rejection must not clear another quotation's pending approval.
  const status = rfq.status === RFQStatus.QUOTATION_SENT || quotations.some(quote => quote.status === "SENT")
    ? RFQStatus.QUOTATION_SENT
    : quotations.some(quote => quote.status === "PENDING_APPROVAL")
      ? RFQStatus.PENDING_APPROVAL
      : RFQStatus.ESTIMATING;
  const updatedAt = nextRFQUpdatedAt(rfq.updatedAt);
  const transition = await tx.rFQ.updateMany({
    where: { id: rfq.id, status: rfq.status, updatedAt: rfq.updatedAt },
    data: { status, updatedAt },
  });
  if (transition.count !== 1) throw new RFQLifecycleError("The RFQ changed during this action. Refresh and try again.");
  if (status !== rfq.status) {
    await tx.auditLog.create({ data: {
      actorId, action: "RFQ_STATUS_SYNCHRONIZED", entityType: "RFQ", entityId: rfq.id,
      details: { previousStatus: rfq.status, newStatus: status },
    } });
  }
  return { status, updatedAt };
}
