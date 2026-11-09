import { Prisma } from "@prisma/client";
import { lockRoutingPart } from "../services/routing-review.service.js";
import { Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { rankHistoricalRoutings } from "../services/routing-recommendation.service.js";

const operationSchema = z.object({
  sequence: z.number().int().positive(),
  operationName: z.string().trim().min(2).max(100),
  machineRateId: z.string().min(1),
  cycleTimeMin: z.number().positive(),
  setupTimeMin: z.number().min(0).optional(),
});

const routingSchema = z.object({
  expectedRevision: z.number().int().min(0),
  recommendationSource: z.object({
    sourcePartId: z.string().min(1),
    sourceRoutingRevision: z.number().int().positive(),
  }).nullable().optional(),
  name: z.string().trim().min(2).max(100).optional(),
  operations: z.array(operationSchema)
    .min(1)
    .max(30)
    .refine(
      (operations) =>
        new Set(operations.map((operation) => operation.sequence)).size ===
        operations.length,
      "Operation sequence numbers must be unique"
    ),
});

const isEffectiveRate = (
  rate: {
    isActive: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
  date: Date
): boolean =>
  rate.isActive &&
  rate.effectiveFrom <= date &&
  (rate.effectiveTo === null || date < rate.effectiveTo);


// GET /api/routings/recommendations/:partId
export const getHistoricalRoutingRecommendations = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> => {
  try {
    const partId = req.params.partId;

    if (typeof partId !== "string" || !partId.trim()) {
      return res.status(400).json({ success: false, message: "Invalid part ID" });
    }

    const target = await prisma.part.findUnique({
      where: { id: partId },
      select: {
        id: true,
        rfqId: true,
        createdAt: true,
        name: true,
        materialGrade: true,
        grossWeightKg: true,
      },
    });

    if (!target) {
      return res.status(404).json({ success: false, message: "Part not found" });
    }

    const candidates = await prisma.part.findMany({
      where: {
        id: { not: partId },
        routing: { isNot: null },
        rfqId: { not: target.rfqId },
        createdAt: { lt: target.createdAt },
      },
      select: {
        id: true,
        name: true,
        partNumber: true,
        materialGrade: true,
        grossWeightKg: true,
        rfq: { select: { rfqNumber: true } },
        routing: {
          select: {
            revision: true,
            operations: {
              orderBy: { sequence: "asc" },
              select: {
                sequence: true,
                operationName: true,
                cycleTimeMin: true,
                setupTimeMin: true,
                machineRateId: true,
                machineRate: {
                  select: {
                    id: true,
                    machineCode: true,
                    machineName: true,
                    ratePerHour: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const recommendations = rankHistoricalRoutings(target, candidates);

    return res.status(200).json({
      success: true,
      message: "Historical routing recommendations generated",
      data: {
        targetPart: target,
        recommendationMethod: "Historical similarity ranking; not an AI prediction",
        recommendations,
      },
    });
  } catch (error) {
    console.error("Historical routing recommendation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate routing recommendations",
    });
  }
};

// GET /api/routings/part/:partId
export const getRoutingByPart = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const partId = req.params.partId;

    if (typeof partId !== "string" || !partId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid part ID",
      });
    }

    const routing = await prisma.routing.findUnique({
      where: { partId },
      include: {
        technicalReviews: { orderBy: { routingRevision: "desc" }, include: { submittedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } } },
        part: {
          select: {
            id: true,
            name: true,
            partNumber: true,
            materialGrade: true,
            grossWeightKg: true,
            rfq: {
              select: {
                id: true,
                rfqNumber: true,
              },
            },
          },
        },
        operations: {
          include: {
            machineRate: true,
          },
          orderBy: {
            sequence: "asc",
          },
        },
      },
    });

    if (!routing) {
      return res.status(404).json({
        success: false,
        message: "Routing not found for this part",
      });
    }

    const saved = await prisma.auditLog.findFirst({
      where: { entityType: "Routing", entityId: routing.id, action: "ROUTING_SAVED", details: { path: ["revision"], equals: routing.revision } },
      orderBy: { createdAt: "desc" },
    });
    const details = saved?.details as { recommendationSource?: Prisma.JsonValue } | null;
    return res.status(200).json({
      success: true,
      data: { ...routing, recommendationProvenance: details?.recommendationSource ?? null },
    });
  } catch (error) {
    console.error("Get routing error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve routing",
    });
  }
};

// PUT /api/routings/part/:partId
export const saveRouting = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const actorId = req.user?.userId;

    if (!actorId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!["ESTIMATOR", "PLANT_HEAD", "ADMIN"].includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: "You do not have permission to save routings" });
    }

    const partId = req.params.partId;

    if (typeof partId !== "string" || !partId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid part ID",
      });
    }

    const parsed = routingSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid routing data",
        errors: parsed.error.flatten(),
      });
    }

    const { name, operations, expectedRevision, recommendationSource } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const lockedPartIds = [...new Set([partId, ...(recommendationSource ? [recommendationSource.sourcePartId] : [])])].sort();
      for (const lockedPartId of lockedPartIds) await lockRoutingPart(tx, lockedPartId);
      const existing = await tx.routing.findUnique({ where: { partId } });
      if ((existing?.revision ?? 0) !== expectedRevision) throw new Error("ROUTING_REVISION_CONFLICT");
      const part = await tx.part.findUnique({
        where: { id: partId },
        select: {
          id: true,
          rfqId: true,
          createdAt: true,
          name: true,
          materialGrade: true,
          grossWeightKg: true,
        },
      });

      if (!part) {
        throw new Error("PART_NOT_FOUND");
      }

      const machineRateIds = [
        ...new Set(operations.map((operation) => operation.machineRateId)),
      ];

      const machineRates = await tx.machineRate.findMany({
        where: {
          id: { in: machineRateIds },
        },
      });

      if (machineRates.length !== machineRateIds.length) {
        throw new Error("MACHINE_RATE_NOT_FOUND");
      }

      const now = new Date();

      const invalidRate = machineRates.some(
        (rate) => !isEffectiveRate(rate, now)
      );

      if (invalidRate) {
        throw new Error("MACHINE_RATE_NOT_EFFECTIVE");
      }

      let provenance: Prisma.InputJsonValue | null = null;
      if (recommendationSource === undefined && existing) {
        const previousSave = await tx.auditLog.findFirst({
          where: { entityType: "Routing", entityId: existing.id, action: "ROUTING_SAVED", details: { path: ["revision"], equals: existing.revision } },
          orderBy: { createdAt: "desc" },
        });
        const previous = previousSave?.details as { recommendationSource?: Prisma.InputJsonValue } | null;
        provenance = previous?.recommendationSource ?? null;
      }
      if (recommendationSource) {
        const source = await tx.part.findUnique({
          where: { id: recommendationSource.sourcePartId },
          include: { rfq: { select: { rfqNumber: true } }, routing: { include: { operations: { orderBy: { sequence: "asc" }, include: { machineRate: true } } } } },
        });
        if (!source?.routing || source.id === partId || source.rfqId === part.rfqId || source.createdAt >= part.createdAt || source.routing.revision !== recommendationSource.sourceRoutingRevision || !source.routing.operations.length) {
          throw new Error("RECOMMENDATION_SOURCE_CHANGED");
        }
        const ranked = rankHistoricalRoutings(part, [source])[0];
        if (!ranked) throw new Error("RECOMMENDATION_SOURCE_CHANGED");
        provenance = JSON.parse(JSON.stringify({ method: "Historical similarity ranking; not an AI prediction", ...ranked }));
      }

      const routing = await tx.routing.upsert({
        where: { partId },
        create: {
          partId,
          name,
          operations: {
            create: operations.map((operation) => ({
              sequence: operation.sequence,
              operationName: operation.operationName,
              machineRateId: operation.machineRateId,
              cycleTimeMin: operation.cycleTimeMin,
              setupTimeMin: operation.setupTimeMin,
            })),
          },
        },
        update: {
          revision: { increment: 1 },
          name,
          operations: {
            deleteMany: {},
            create: operations.map((operation) => ({
              sequence: operation.sequence,
              operationName: operation.operationName,
              machineRateId: operation.machineRateId,
              cycleTimeMin: operation.cycleTimeMin,
              setupTimeMin: operation.setupTimeMin,
            })),
          },
        },
        include: {
          operations: {
            include: {
              machineRate: true,
            },
            orderBy: {
              sequence: "asc",
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "ROUTING_SAVED",
          entityType: "Routing",
          entityId: routing.id,
          details: {
            partId,
            partName: part.name,
            revision: routing.revision,
            previousRevision: existing?.revision ?? null,
            name: name ?? null,
            recommendationSource: provenance,
            operationCount: operations.length,
            operations: operations.map((operation) => ({
              sequence: operation.sequence,
              operationName: operation.operationName,
              machineRateId: operation.machineRateId,
              cycleTimeMin: operation.cycleTimeMin,
              setupTimeMin: operation.setupTimeMin ?? 0,
            })),
          },
        },
      });

      return routing;
    });

    return res.status(200).json({
      success: true,
      message: "Routing saved successfully",
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (["ROUTING_REVISION_CONFLICT", "RECOMMENDATION_SOURCE_CHANGED"].includes(error.message)) {
        return res.status(409).json({ success: false, message: "Routing or recommendation source changed; refresh before saving" });
      }
      if (error.message === "PART_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Part not found",
        });
      }

      if (error.message === "MACHINE_RATE_NOT_FOUND") {
        return res.status(400).json({
          success: false,
          message: "One or more machine rates do not exist",
        });
      }

      if (error.message === "MACHINE_RATE_NOT_EFFECTIVE") {
        return res.status(400).json({
          success: false,
          message: "All selected machine rates must be currently effective",
        });
      }
    }

    console.error("Save routing error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save routing",
    });
  }
};
