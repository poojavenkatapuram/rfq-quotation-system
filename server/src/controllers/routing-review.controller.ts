import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { lockRoutingPart } from "../services/routing-review.service.js";

const submission = z.object({ expectedRevision: z.number().int().positive() });
const decision = submission.extend({
  status: z.enum(["APPROVED", "REJECTED"]),
  comments: z.string().trim().max(2000).optional(),
}).refine(value => value.status !== "REJECTED" || Boolean(value.comments?.length), {
  message: "Comments are required when requesting changes", path: ["comments"],
});

export function reviewError(error: unknown, res: Response) {
  if (error instanceof Error && error.message === "ROUTING_NOT_FOUND") {
    return res.status(404).json({ success: false, message: "Routing not found" });
  }
  if ((error instanceof Error && error.message === "REVIEW_CONFLICT") ||
      (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))) {
    return res.status(409).json({ success: false, message: "Routing or review changed; refresh. After changes are requested, save a new revision before resubmitting." });
  }
  console.error("Routing technical review error:", error);
  return res.status(500).json({ success: false, message: "Unable to update technical review" });
}

export async function submitRoutingReview(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });
  if (!["ESTIMATOR", "ADMIN"].includes(req.user.role)) return res.status(403).json({ success: false, message: "Only estimators or administrators can submit technical reviews" });
  const parsed = submission.safeParse(req.body);
  const partId = req.params.partId;
  if (!parsed.success || typeof partId !== "string" || !partId.trim()) return res.status(400).json({ success: false, message: "A valid part and current routing revision are required" });
  try {
    const review = await prisma.$transaction(async tx => {
      await lockRoutingPart(tx, partId);
      const routing = await tx.routing.findUnique({
        where: { partId },
        include: { part: { select: { name: true, partNumber: true, materialGrade: true, grossWeightKg: true, drawingNumber: true, revision: true } }, operations: { orderBy: { sequence: "asc" }, include: { machineRate: true } } },
      });
      if (!routing) throw new Error("ROUTING_NOT_FOUND");
      if (routing.revision !== parsed.data.expectedRevision || !routing.operations.length) throw new Error("REVIEW_CONFLICT");
      const prior = await tx.routingTechnicalReview.findUnique({ where: { routingId_routingRevision: { routingId: routing.id, routingRevision: routing.revision } } });
      if (prior) throw new Error("REVIEW_CONFLICT");
      const saved = await tx.auditLog.findFirst({
        where: { entityType: "Routing", entityId: routing.id, action: "ROUTING_SAVED", details: { path: ["revision"], equals: routing.revision } },
        orderBy: { createdAt: "desc" },
      });
      const snapshot = JSON.parse(JSON.stringify({ schemaVersion: 1, partId, routing, saveProvenance: saved?.details ?? null }));
      const created = await tx.routingTechnicalReview.create({ data: {
        routingId: routing.id, routingRevision: routing.revision,
        submittedById: req.user!.userId, submittedSnapshot: snapshot,
      } });
      await tx.auditLog.create({ data: { actorId: req.user!.userId, action: "ROUTING_REVIEW_SUBMITTED", entityType: "Routing", entityId: routing.id, details: { reviewId: created.id, partId, revision: routing.revision } } });
      return created;
    });
    return res.status(201).json({ success: true, data: review });
  } catch (error) { return reviewError(error, res); }
}

export async function decideRoutingReview(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });
  if (req.user.role !== "PLANT_HEAD") return res.status(403).json({ success: false, message: "Only Plant Heads can decide technical reviews" });
  const parsed = decision.safeParse(req.body);
  const partId = req.params.partId;
  if (!parsed.success || typeof partId !== "string" || !partId.trim()) return res.status(400).json({ success: false, message: "Invalid review decision; comments are required when requesting changes" });
  try {
    const result = await prisma.$transaction(async tx => {
      await lockRoutingPart(tx, partId);
      const routing = await tx.routing.findUnique({ where: { partId } });
      if (!routing) throw new Error("ROUTING_NOT_FOUND");
      if (routing.revision !== parsed.data.expectedRevision) throw new Error("REVIEW_CONFLICT");
      const review = await tx.routingTechnicalReview.findUnique({ where: { routingId_routingRevision: { routingId: routing.id, routingRevision: routing.revision } } });
      if (!review || review.status !== "PENDING") throw new Error("REVIEW_CONFLICT");
      const transition = await tx.routingTechnicalReview.updateMany({
        where: { id: review.id, status: "PENDING", routingRevision: routing.revision },
        data: { status: parsed.data.status, comments: parsed.data.comments || null, reviewedById: req.user!.userId, reviewedAt: new Date() },
      });
      if (transition.count !== 1) throw new Error("REVIEW_CONFLICT");
      await tx.auditLog.create({ data: { actorId: req.user!.userId, action: `ROUTING_REVIEW_${parsed.data.status}`, entityType: "Routing", entityId: routing.id, details: { reviewId: review.id, partId, revision: routing.revision, comments: parsed.data.comments ?? null } } });
      return tx.routingTechnicalReview.findUnique({ where: { id: review.id } });
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return reviewError(error, res); }
}
