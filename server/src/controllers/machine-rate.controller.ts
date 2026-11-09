import { Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const createMachineRateSchema = z.object({
  machineCode: z.string().trim().min(2).max(40)
    .transform((value) => value.toUpperCase()),
  machineName: z.string().trim().min(2).max(100),
  ratePerHour: z.coerce.number().positive(),
  currency: z.string().trim().toUpperCase().refine(
    (value) => value === "INR",
    "Only INR currency is supported"
  ).default("INR"),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().optional(),
});

const querySchema = z.object({
  machineCode: z.string().trim().optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

const parseDate = (value: string): Date | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// GET /api/machine-rates
export const getMachineRates = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const parsed = querySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid query filters",
        errors: parsed.error.flatten(),
      });
    }

    const { machineCode, isActive } = parsed.data;

    const rates = await prisma.machineRate.findMany({
      where: {
        ...(machineCode
          ? {
              machineCode: {
                contains: machineCode.toUpperCase(),
                mode: "insensitive",
              },
            }
          : {}),
        ...(isActive !== undefined
          ? { isActive: isActive === "true" }
          : {}),
      },
      orderBy: [
        { machineCode: "asc" },
        { effectiveFrom: "desc" },
      ],
    });

    return res.status(200).json({
      success: true,
      count: rates.length,
      data: rates,
    });
  } catch (error) {
    console.error("Get machine rates error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve machine rates",
    });
  }
};

// GET /api/machine-rates/:id
export const getMachineRateById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const id = req.params.id as string;

    const rate = await prisma.machineRate.findUnique({
      where: { id },
    });

    if (!rate) {
      return res.status(404).json({
        success: false,
        message: "Machine rate not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rate,
    });
  } catch (error) {
    console.error("Get machine rate error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve machine rate",
    });
  }
};

// POST /api/machine-rates
export const createMachineRate = async (
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

    const parsed = createMachineRateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid machine rate data",
        errors: parsed.error.flatten(),
      });
    }

    const data = parsed.data;
    const effectiveFrom = parseDate(data.effectiveFrom);
    const effectiveTo = data.effectiveTo
      ? parseDate(data.effectiveTo)
      : null;

    if (!effectiveFrom || (data.effectiveTo && !effectiveTo)) {
      return res.status(400).json({
        success: false,
        message: "Invalid effective date",
      });
    }

    if (effectiveTo && effectiveTo <= effectiveFrom) {
      return res.status(400).json({
        success: false,
        message: "Effective end date must be after start date",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingRates = await tx.machineRate.findMany({
        where: { machineCode: data.machineCode },
        orderBy: { effectiveFrom: "asc" },
      });

      for (const existing of existingRates) {
        const existingEnd = existing.effectiveTo;

        const overlaps =
          (!effectiveTo || existing.effectiveFrom < effectiveTo) &&
          (!existingEnd || effectiveFrom < existingEnd);

        if (!overlaps) {
          continue;
        }

        const canClosePreviousRate =
          !effectiveTo &&
          existing.isActive &&
          !existingEnd &&
          existing.effectiveFrom < effectiveFrom;

        if (canClosePreviousRate) {
          await tx.machineRate.update({
            where: { id: existing.id },
            data: { effectiveTo: effectiveFrom },
          });

          continue;
        }

        throw new Error("MACHINE_RATE_PERIOD_OVERLAP");
      }

      const machineRate = await tx.machineRate.create({
        data: {
          machineCode: data.machineCode,
          machineName: data.machineName,
          ratePerHour: data.ratePerHour,
          currency: data.currency,
          effectiveFrom,
          effectiveTo,
          isActive: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "MACHINE_RATE_CREATED",
          entityType: "MachineRate",
          entityId: machineRate.id,
        },
      });

      return machineRate;
    });

    return res.status(201).json({
      success: true,
      message: "Machine rate created successfully",
      data: result,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "MACHINE_RATE_PERIOD_OVERLAP"
    ) {
      return res.status(409).json({
        success: false,
        message: "Machine rate effective period overlaps an existing rate",
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        success: false,
        message: "A machine rate already exists for this effective date",
      });
    }

    console.error("Create machine rate error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create machine rate",
    });
  }
};

// PATCH /api/machine-rates/:id/deactivate
export const deactivateMachineRate = async (
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

    const id = req.params.id as string;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.machineRate.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error("MACHINE_RATE_NOT_FOUND");
      }

      if (!existing.isActive) {
        throw new Error("MACHINE_RATE_ALREADY_INACTIVE");
      }

      const now = new Date();

      if (existing.effectiveFrom > now) {
        throw new Error("MACHINE_RATE_NOT_YET_EFFECTIVE");
      }

      const effectiveTo =
        existing.effectiveTo && existing.effectiveTo < now
          ? existing.effectiveTo
          : now;

      const updated = await tx.machineRate.update({
        where: { id },
        data: {
          isActive: false,
          effectiveTo,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "MACHINE_RATE_DEACTIVATED",
          entityType: "MachineRate",
          entityId: existing.id,
        },
      });

      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "Machine rate deactivated successfully",
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "MACHINE_RATE_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Machine rate not found",
        });
      }

      if (error.message === "MACHINE_RATE_ALREADY_INACTIVE") {
        return res.status(400).json({
          success: false,
          message: "Machine rate is already inactive",
        });
      }

      if (error.message === "MACHINE_RATE_NOT_YET_EFFECTIVE") {
        return res.status(400).json({
          success: false,
          message: "Future machine rates cannot be deactivated yet",
        });
      }
    }

    console.error("Deactivate machine rate error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to deactivate machine rate",
    });
  }
};
