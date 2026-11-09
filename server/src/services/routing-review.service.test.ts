import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { lockRoutingPart, requireApprovedRoutings, TechnicalReviewConflict } from "./routing-review.service.js";

function fixture(revision = 2, reviewRevision = 2, status = "APPROVED") {
  return { revision, technicalReviews: status === "APPROVED" ? [{ id: "review", routingRevision: reviewRevision, status }] : [] };
}
function client(routing: ReturnType<typeof fixture> | null = fixture()) {
  return { $executeRaw: vi.fn().mockResolvedValue(1), routing: { findUnique: vi.fn().mockResolvedValue(routing) } };
}
const asTx = (tx: ReturnType<typeof client>) => tx as unknown as Prisma.TransactionClient;

describe("quotation technical review gate", () => {
  it("allows costing drafted before review when its revision is now approved", async () => {
    const tx = client();
    await expect(requireApprovedRoutings(asTx(tx), [{ partId: "part", costing: { routingRevision: 2 } }])).resolves.toEqual([{ partId: "part", routingRevision: 2, reviewId: "review" }]);
  });
  it.each([
    ["no routing", null, 2],
    ["draft routing", fixture(2, 2, "DRAFT"), 2],
    ["pending review", fixture(2, 2, "PENDING"), 2],
    ["changes requested", fixture(2, 2, "REJECTED"), 2],
    ["approval for earlier revision", fixture(3, 2), 3],
    ["costing from earlier revision", fixture(), 1],
    ["legacy costing without recorded revision", fixture(), null],
  ])("blocks %s", async (_label, routing, revision) => {
    await expect(requireApprovedRoutings(asTx(client(routing)), [{ partId: "part", costing: { routingRevision: revision } }])).rejects.toBeInstanceOf(TechnicalReviewConflict);
  });
  it("blocks missing costing and empty quotations", async () => {
    await expect(requireApprovedRoutings(asTx(client()), [{ partId: "part", costing: null }])).rejects.toBeInstanceOf(TechnicalReviewConflict);
    await expect(requireApprovedRoutings(asTx(client()), [])).rejects.toBeInstanceOf(TechnicalReviewConflict);
  });
  it("locks every distinct part in sorted order before reading eligibility", async () => {
    const tx = client();
    await requireApprovedRoutings(asTx(tx), ["z", "a", "z"].map(partId => ({ partId, costing: { routingRevision: 2 } })));
    expect(tx.$executeRaw.mock.calls.map(call => call[1])).toEqual(["routing:a", "routing:z"]);
    expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.routing.findUnique.mock.invocationCallOrder[0]);
  });
  it("binds advisory lock identifiers as SQL parameters", async () => {
    const tx = client();
    await lockRoutingPart(asTx(tx), "part'); DROP TABLE x; --");
    expect(tx.$executeRaw.mock.calls[0][1]).toBe("routing:part'); DROP TABLE x; --");
    expect(tx.$executeRaw.mock.calls[0][0].join("")).toContain("pg_advisory_xact_lock(hashtext())");
  });
});
