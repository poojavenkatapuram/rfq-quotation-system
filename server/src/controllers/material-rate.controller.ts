
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const materialRateSchema = z.object({
  materialCode: z.string().trim().min(2).max(40),
  materialName: z.string().trim().min(2).max(150),
  grade: z.string().trim().min(1).max(80),
  ratePerKg: z.number().positive().max(9999999999),
  currency: z.string().trim().length(3).default("INR"),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullable().optional(),
}).refine(
  (data) =>
    !data.effectiveTo ||
    data.effectiveTo > data.effectiveFrom,
  {
    message: "Effective-to date must be after effective-from date",
    path: ["effectiveTo"],
  }
);

const getId = (req: Request): string | null => {
  const id = req.params.id;
  return typeof id === "string" ? id : null;
};

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

// GET /api/material-rates
export const getMaterialRates = async (
  req: Request,
  res: Response
) => {
  try {
    const querySchema = z.object({
      materialCode: z.string().optional(),
      grade: z.string().optional(),
      isActive: z.enum(["true", "false"]).optional(),
    });

    const validation = querySchema.safeParse(req.query);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid filter parameters",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { materialCode, grade, isActive } = validation.data;

    const where: Prisma.MaterialRateWhereInput = {
      ...(materialCode
        ? { materialCode: { contains: materialCode, mode: "insensitive" } }
        : {}),
      ...(grade
        ? { grade: { contains: grade, mode: "insensitive" } }
        : {}),
      ...(isActive !== undefined
        ? { isActive: isActive === "true" }
        : {}),
    };

    const rates = await prisma.materialRate.findMany({
      where,
      orderBy: [
        { materialCode: "asc" },
        { effectiveFrom: "desc" },
      ],
    });

    return res.status(200).json({
      success: true,
      count: rates.length,
      data: rates,
    });
  } catch (error) {
    console.error("Get material rates error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve material rates",
    });
  }
};

// GET /api/material-rates/:id
export const getMaterialRateById = async (
  req: Request,
  res: Response
) => {
  try {
    const id = getId(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid material rate ID",
      });
    }

    const rate = await prisma.materialRate.findUnique({
      where: { id },
    });

    if (!rate) {
      return res.status(404).json({
        success: false,
        message: "Material rate not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rate,
    });
  } catch (error) {
    console.error("Get material rate error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve material rate",
    });
  }
};

// POST /api/material-rates
export const createMaterialRate = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const validation = materialRateSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid material rate details",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const data = validation.data;
    const actorId = req.user?.userId;

    if (!actorId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const createdRate = await prisma.$transaction(async (tx) => {
      const existingRates = await tx.materialRate.findMany({
        where: { materialCode: data.materialCode },
        orderBy: { effectiveFrom: "asc" },
      });

      for (const existing of existingRates) {
        const existingEnd =
          existing.effectiveTo?.getTime() ?? Infinity;

        const newEnd =
          data.effectiveTo?.getTime() ?? Infinity;

        const overlaps =
          existing.effectiveFrom.getTime() < newEnd &&
          existingEnd > data.effectiveFrom.getTime();

        if (!overlaps) continue;

        const canClosePreviousRate =
          existing.effectiveTo === null &&
          existing.effectiveFrom.getTime() <
            data.effectiveFrom.getTime() &&
          existing.isActive &&
          !data.effectiveTo;

        if (canClosePreviousRate) {
          await tx.materialRate.update({
            where: { id: existing.id },
            data: {
              effectiveTo: data.effectiveFrom,
            },
          });

          continue;
        }

        throw new Error("MATERIAL_RATE_PERIOD_OVERLAP");
      }

      const rate = await tx.materialRate.create({
        data: {
          materialCode: data.materialCode,
          materialName: data.materialName,
          grade: data.grade,
          ratePerKg: data.ratePerKg,
          currency: data.currency.toUpperCase(),
          effectiveFrom: data.effectiveFrom,
          effectiveTo: data.effectiveTo ?? null,
          isActive: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "MATERIAL_RATE_CREATED",
          entityType: "MaterialRate",
          entityId: rate.id,
          details: {
            materialCode: rate.materialCode,
            grade: rate.grade,
            ratePerKg: rate.ratePerKg.toString(),
            effectiveFrom: rate.effectiveFrom.toISOString(),
            effectiveTo: rate.effectiveTo?.toISOString() ?? null,
          },
        },
      });

      return rate;
    });

    return res.status(201).json({
      success: true,
      message: "Material rate created successfully",
      data: createdRate,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "MATERIAL_RATE_PERIOD_OVERLAP"
    ) {
      return res.status(409).json({
        success: false,
        message: "Material rate effective period overlaps an existing rate",
      });
    }

    if (isUniqueConstraintError(error)) {
      return res.status(409).json({
        success: false,
        message: "A rate already exists for this material code and effective date",
      });
    }

    console.error("Create material rate error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create material rate",
    });
  }
};

// PATCH /api/material-rates/:id/deactivate
export const deactivateMaterialRate = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const id = getId(req);
    const actorId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid material rate ID",
      });
    }

    if (!actorId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.materialRate.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error("MATERIAL_RATE_NOT_FOUND");
      }

      if (!existing.isActive) {
        throw new Error("MATERIAL_RATE_ALREADY_INACTIVE");
      }

      const now = new Date();

      if (existing.effectiveFrom >= now) {
        throw new Error("MATERIAL_RATE_NOT_YET_EFFECTIVE");
      }

      const updated = await tx.materialRate.update({
        where: { id },
        data: {
          isActive: false,
          effectiveTo:
            existing.effectiveTo && existing.effectiveTo < now
              ? existing.effectiveTo
              : now,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "MATERIAL_RATE_DEACTIVATED",
          entityType: "MaterialRate",
          entityId: id,
          details: {
            materialCode: existing.materialCode,
            previousRate: existing.ratePerKg.toString(),
          },
        },
      });

      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "Material rate deactivated successfully",
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      const errors: Record<string, { status: number; message: string }> = {
        MATERIAL_RATE_NOT_FOUND: {
          status: 404,
          message: "Material rate not found",
        },
        MATERIAL_RATE_ALREADY_INACTIVE: {
          status: 409,
          message: "Material rate is already inactive",
        },
        MATERIAL_RATE_NOT_YET_EFFECTIVE: {
          status: 409,
          message: "A future-effective material rate cannot be deactivated yet",
        },
      };

      const knownError = errors[error.message];

      if (knownError) {
        return res.status(knownError.status).json({
          success: false,
          message: knownError.message,
        });
      }
    }

    console.error("Deactivate material rate error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to deactivate material rate",
    });
  }
};
