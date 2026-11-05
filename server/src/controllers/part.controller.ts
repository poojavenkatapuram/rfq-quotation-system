import { Request, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const assignMaterialRateSchema = z.object({
  materialRateId: z.string().trim().min(1),
});

// PATCH /api/parts/:partId/material-rate
export const assignMaterialRateToPart = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const partId =
      typeof req.params.partId === "string"
        ? req.params.partId
        : null;

    const actorId = req.user?.userId;

    if (!partId) {
      return res.status(400).json({
        success: false,
        message: "Invalid part ID",
      });
    }

    if (!actorId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const validation = assignMaterialRateSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid material rate assignment",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { materialRateId } = validation.data;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const part = await tx.part.findUnique({
        where: { id: partId },
        include: {
          materialRate: true,
        },
      });

      if (!part) {
        throw new Error("PART_NOT_FOUND");
      }

      const materialRate = await tx.materialRate.findUnique({
        where: { id: materialRateId },
      });

      if (!materialRate) {
        throw new Error("MATERIAL_RATE_NOT_FOUND");
      }

      if (
        !materialRate.isActive ||
        materialRate.effectiveFrom > now ||
        (materialRate.effectiveTo !== null &&
          materialRate.effectiveTo <= now)
      ) {
        throw new Error("MATERIAL_RATE_NOT_EFFECTIVE");
      }

      const partGrade = part.materialGrade?.trim().toLowerCase();
      const rateGrade = materialRate.grade.trim().toLowerCase();

      if (!partGrade || partGrade !== rateGrade) {
        throw new Error("MATERIAL_GRADE_MISMATCH");
      }

      const previousMaterialRateId = part.materialRateId;

      const updatedPart = await tx.part.update({
        where: { id: partId },
        data: {
          materialRateId,
        },
        include: {
          materialRate: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "PART_MATERIAL_RATE_ASSIGNED",
          entityType: "Part",
          entityId: partId,
          details: {
            previousMaterialRateId,
            materialRateId,
            materialCode: materialRate.materialCode,
            grade: materialRate.grade,
            ratePerKg: materialRate.ratePerKg.toString(),
          },
        },
      });

      return updatedPart;
    });

    return res.status(200).json({
      success: true,
      message: "Material rate assigned successfully",
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      const errors: Record<string, { status: number; message: string }> = {
        PART_NOT_FOUND: {
          status: 404,
          message: "Part not found",
        },
        MATERIAL_RATE_NOT_FOUND: {
          status: 404,
          message: "Material rate not found",
        },
        MATERIAL_RATE_NOT_EFFECTIVE: {
          status: 409,
          message: "Selected material rate is not currently effective",
        },
        MATERIAL_GRADE_MISMATCH: {
          status: 400,
          message: "Material rate grade does not match the part material grade",
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

    console.error("Assign material rate error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to assign material rate",
    });
  }
};
