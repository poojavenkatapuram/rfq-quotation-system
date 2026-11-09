import type { Prisma } from "@prisma/client";

// All routing writers, costing creation and quotation gates use the same
// transaction-scoped lock. Ordered multi-part acquisition avoids deadlocks.
export async function lockRoutingPart(tx: Prisma.TransactionClient, partId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`routing:${partId}`}))`;
}

export class TechnicalReviewConflict extends Error {}

export async function requireApprovedRoutings(
  tx: Prisma.TransactionClient,
  lines: Array<{ partId: string; costing: { routingRevision: number | null } | null }>,
) {
  if (!lines.length) throw new TechnicalReviewConflict("Quotation has no parts to review");
  for (const partId of [...new Set(lines.map(line => line.partId))].sort()) {
    await lockRoutingPart(tx, partId);
  }
  const evidence: Array<{ partId: string; routingRevision: number; reviewId: string }> = [];
  for (const line of lines) {
    const routing = await tx.routing.findUnique({
      where: { partId: line.partId },
      include: { technicalReviews: { where: { status: "APPROVED" } } },
    });
    const review = routing?.technicalReviews.find(item => item.routingRevision === routing.revision);
    if (!routing || !review || line.costing?.routingRevision !== routing.revision) {
      throw new TechnicalReviewConflict(
        "Current routing revision requires Plant Head technical approval and a costing saved from that revision. Save a new draft costing if the routing changed.",
      );
    }
    evidence.push({ partId: line.partId, routingRevision: routing.revision, reviewId: review.id });
  }
  return evidence;
}
