
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { calculateCosting } from "../services/costing.service.js";

const createCostingSchema = z.object({
  partId: z.string().min(1),
  scrapPercentage: z.number().min(0).max(100).default(0),
  overheadAmount: z.number().min(0).default(0),
  packingAmount: z.number().min(0).default(0),
  freightAmount: z.number().min(0).default(0),
  profitMargin: z.number().min(0).max(99.99).default(0),
  annualVolumes: z.array(
    z.number().int().positive()
  ).min(1).max(5),
  assumptions: z.string().trim().max(2000).optional(),
});

const idempotencyKeySchema = z.string().uuid();

const isEffectiveRate = (
  rate: {
    isActive: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
  date: Date
): boolean => {
  return (
    rate.isActive &&
    rate.effectiveFrom <= date &&
    (rate.effectiveTo === null || date < rate.effectiveTo)
  );
};

const isUniqueConstraintError = (
  error: unknown
): boolean => {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
};

export const createCosting = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  let idempotencyKey: string | undefined;

  try {
    const parsed = createCostingSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid costing input",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const parsedKey = idempotencyKeySchema.safeParse(
      req.get("Idempotency-Key")
    );

    if (!parsedKey.success) {
      res.status(400).json({
        message: "A valid UUID Idempotency-Key header is required",
      });
      return;
    }

    idempotencyKey = parsedKey.data;

    if (!req.user?.userId) {
      res.status(401).json({
        message: "Unauthorized",
      });
      return;
    }

    const userId = req.user.userId;

    const {
      partId,
      scrapPercentage,
      overheadAmount,
      packingAmount,
      freightAmount,
      profitMargin,
      annualVolumes,
      assumptions,
    } = parsed.data;

    const uniqueVolumes = [...new Set(annualVolumes)];

    // Return the original result if this request was already processed.
    const existingCosting = await prisma.costing.findUnique({
      where: { idempotencyKey },
      include: {
        components: true,
        volumes: true,
      },
    });

    if (existingCosting) {
      res.status(200).json({
        message: "This costing request was already processed",
        replayed: true,
        data: {
          costing: existingCosting,
          calculation: null,
        },
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const part = await tx.part.findUnique({
        where: { id: partId },
        include: {
          materialRate: true,
          routing: {
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
          },
        },
      });

      if (!part) {
        return { error: "PART_NOT_FOUND" as const };
      }

      if (!part.grossWeightKg || Number(part.grossWeightKg) <= 0) {
        return { error: "INVALID_PART_WEIGHT" as const };
      }

      if (!part.materialRate) {
        return { error: "MATERIAL_RATE_MISSING" as const };
      }

      const now = new Date();

      if (!isEffectiveRate(part.materialRate, now)) {
        return { error: "MATERIAL_RATE_NOT_EFFECTIVE" as const };
      }

      const operations = part.routing?.operations ?? [];

      if (operations.length === 0) {
        return { error: "ROUTING_MISSING" as const };
      }

      let totalCycleTimeMin = 0;
      let totalMachiningCost = 0;
      let totalSetupCost = 0;

      const machineComponents: {
        name: string;
        amount: number;
        description: string;
        machineRateId: string;
        cycleTimeMin: number;
        ratePerHourSnapshot: number;
        setupTimeMin: number;
        setupCost: number;
      }[] = [];

      for (const operation of operations) {
        if (!operation.machineRate) {
          return { error: "MACHINE_RATE_MISSING" as const };
        }

        if (!isEffectiveRate(operation.machineRate, now)) {
          return { error: "MACHINE_RATE_NOT_EFFECTIVE" as const };
        }

        const cycleTimeMin = Number(operation.cycleTimeMin);

        const machineRatePerHour = Number(
          operation.machineRate.ratePerHour
        );

        const operationCost =
          (cycleTimeMin / 60) * machineRatePerHour;

        const setupTimeMin = Number(operation.setupTimeMin ?? 0);
        const operationSetupCost =
          (setupTimeMin / 60) * machineRatePerHour;

        totalCycleTimeMin += cycleTimeMin;
        totalMachiningCost += operationCost;
        totalSetupCost += operationSetupCost;

        machineComponents.push({
          name: operation.operationName,
          amount: operationCost,
          description:
            `Machine: ${operation.machineRate.machineCode}; ` +
            `Rate: ${machineRatePerHour} ${operation.machineRate.currency}/hour; ` +
            `Cycle time: ${cycleTimeMin} minutes; ` +
            `Machine rate ID: ${operation.machineRate.id}`,
          machineRateId: operation.machineRate.id,
          cycleTimeMin,
          ratePerHourSnapshot: machineRatePerHour,
          setupTimeMin,
          setupCost: operationSetupCost,
        });
      }

      const effectiveMachineRate =
        (totalMachiningCost / totalCycleTimeMin) * 60;

      const costing = calculateCosting({
        grossWeightKg: Number(part.grossWeightKg),
        materialRatePerKg: Number(part.materialRate.ratePerKg),
        cycleTimeMin: totalCycleTimeMin,
        machineRatePerHour: effectiveMachineRate,
        setupCost: totalSetupCost,
        annualVolumes: uniqueVolumes,
        scrapPercentage,
        overheadAmount,
        packingAmount,
        freightAmount,
        profitMargin,
      });

      const latestCosting = await tx.costing.findFirst({
        where: { partId },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const version = (latestCosting?.version ?? 0) + 1;

      const components = [
        {
          type: "MATERIAL" as const,
          name: "Raw material",
          amount: costing.materialCost,
          description:
            `Weight: ${part.grossWeightKg} kg; ` +
            `Rate: ${part.materialRate.ratePerKg} ${part.materialRate.currency}/kg; ` +
            `Material rate ID: ${part.materialRate.id}`,
        },
        ...machineComponents.map((component) => ({
          type: "MACHINING" as const,
          name: component.name,
          amount: component.amount,
          description: component.description,
          machineRateId: component.machineRateId,
          cycleTimeMin: component.cycleTimeMin,
          ratePerHourSnapshot: component.ratePerHourSnapshot,
        })),
        ...machineComponents
          .filter((component) => component.setupTimeMin > 0)
          .map((component) => ({
            type: "SETUP" as const,
            name: `${component.name} setup`,
            amount: component.setupCost,
            description:
              `Setup time: ${component.setupTimeMin} minutes; ` +
              `Rate: ${component.ratePerHourSnapshot}/hour; ` +
              `Machine rate ID: ${component.machineRateId}`,
            machineRateId: component.machineRateId,
            setupTimeMinSnapshot: component.setupTimeMin,
            ratePerHourSnapshot: component.ratePerHourSnapshot,
          })),
        {
          type: "SCRAP" as const,
          name: "Material scrap",
          amount: costing.scrapCost,
          description: `Scrap percentage: ${scrapPercentage}%`,
        },
        {
          type: "OVERHEAD" as const,
          name: "Overhead",
          amount: costing.overheadAmount,
          description: "Configured overhead amount per part",
        },
        {
          type: "PACKING" as const,
          name: "Packing",
          amount: costing.packingAmount,
          description: "Configured packing amount per part",
        },
        {
          type: "FREIGHT" as const,
          name: "Freight",
          amount: costing.freightAmount,
          description: "Configured freight amount per part",
        },
      ];

      const savedCosting = await tx.costing.create({
        data: {
          partId,
          materialRateId: part.materialRate.id,
          materialRatePerKgSnapshot: Number(part.materialRate.ratePerKg),
          createdById: userId,
          idempotencyKey,
          version,
          grossWeightKg: part.grossWeightKg,
          scrapPercentage,
          overheadAmount,
          packingAmount,
          freightAmount,
          profitMargin,
          totalCost: costing.totalCost,
          assumptions,
          components: {
            create: components,
          },
          volumes: {
            create: costing.volumeResults.map((volume) => ({
              annualVolume: volume.annualVolume,
              unitPrice: volume.unitSellingPrice,
              totalCost: volume.annualValue,
            })),
          },
        },
        include: {
          components: true,
          volumes: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "COSTING_CREATED",
          entityType: "Costing",
          entityId: savedCosting.id,
          details: {
            partId,
            version,
            totalCost: costing.totalCost,
            setupCost: costing.setupCost,
            volumeResults: costing.volumeResults.map((volume) => ({
              annualVolume: volume.annualVolume,
              unitSellingPrice: volume.unitSellingPrice,
              annualValue: volume.annualValue,
            })),
          },
        },
      });

      return {
        costing: savedCosting,
        calculation: costing,
      };
    });

    if ("error" in result && result.error) {
      const errors: Record<
        string,
        { status: number; message: string }
      > = {
        PART_NOT_FOUND: {
          status: 404,
          message: "Part not found",
        },
        INVALID_PART_WEIGHT: {
          status: 400,
          message: "Part must have a valid gross weight",
        },
        MATERIAL_RATE_MISSING: {
          status: 400,
          message: "No material rate is linked to this part",
        },
        MATERIAL_RATE_NOT_EFFECTIVE: {
          status: 400,
          message: "The linked material rate is not currently effective",
        },
        ROUTING_MISSING: {
          status: 400,
          message: "No routing operations are configured for this part",
        },
        MACHINE_RATE_MISSING: {
          status: 400,
          message: "A routing operation has no linked machine rate",
        },
        MACHINE_RATE_NOT_EFFECTIVE: {
          status: 400,
          message: "A linked machine rate is not currently effective",
        },
      };

      const error = errors[result.error];

      res.status(error.status).json({
        message: error.message,
      });
      return;
    }

    res.status(201).json({
      message: "Costing created successfully",
      replayed: false,
      data: result,
    });
  } catch (error) {
    // A concurrent request may have inserted the same idempotency key.
    if (isUniqueConstraintError(error) && idempotencyKey) {
      const existingCosting = await prisma.costing.findUnique({
        where: { idempotencyKey },
        include: {
          components: true,
          volumes: true,
        },
      });

      if (existingCosting) {
        res.status(200).json({
          message: "This costing request was already processed",
          replayed: true,
          data: {
            costing: existingCosting,
            calculation: null,
          },
        });
        return;
      }

      // A different request may have created the same part version.
      res.status(409).json({
        message: "A costing version conflict occurred. Please retry with a new Idempotency-Key.",
      });
      return;
    }

    console.error("Create costing error:", error);

    res.status(500).json({
      message: "Failed to create costing",
    });
  }
};

export const getCostingsByPart = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const partIdParam = req.params.partId;

    const partId = Array.isArray(partIdParam)
      ? partIdParam[0]
      : partIdParam;

    if (!partId) {
      res.status(400).json({
        message: "Part ID is required",
      });
      return;
    }

    const part = await prisma.part.findUnique({
      where: { id: partId },
      select: { id: true },
    });

    if (!part) {
      res.status(404).json({
        message: "Part not found",
      });
      return;
    }

    const costings = await prisma.costing.findMany({
      where: { partId },
      include: {
        materialRate: true,
        components: true,
        volumes: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { version: "desc" },
    });

    res.status(200).json({
      count: costings.length,
      data: costings,
    });
  } catch (error) {
    console.error("Get costings error:", error);

    res.status(500).json({
      message: "Failed to retrieve costings",
    });
  }
};
