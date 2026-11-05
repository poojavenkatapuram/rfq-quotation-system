import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import prisma from "../lib/prisma.js";

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
});

const costingInclude = {
  materialRate: true,
  volumes: {
    orderBy: { annualVolume: "asc" as const },
  },
  components: {
    include: {
      machineRate: true,
    },
  },
  createdBy: {
    select: { id: true, name: true },
  },
  part: {
    include: {
      rfq: {
        include: {
          customer: true,
        },
      },
      routing: {
        include: {
          operations: {
            include: {
              machineRate: true,
            },
            orderBy: { sequence: "asc" as const },
          },
        },
      },
    },
  },
} satisfies Prisma.CostingInclude;

export const getQuotationHistory = async (
  req: Request,
  res: Response
) => {
  try {
    const validation = historyQuerySchema.safeParse(req.query);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid history filters",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { page, limit, search, status } = validation.data;

    const where: Prisma.QuotationWhereInput = {
      ...(status && { status: status as Prisma.QuotationWhereInput["status"] }),
      ...(search && {
        OR: [
          {
            quotationNumber: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            rfq: {
              rfqNumber: {
                contains: search,
                mode: "insensitive",
              },
            },
          },
          {
            customer: {
              name: {
                contains: search,
                mode: "insensitive",
              },
            },
          },
          {
            parts: {
              some: {
                part: {
                  OR: [
                    { partNumber: { contains: search, mode: "insensitive" } },
                    { name: { contains: search, mode: "insensitive" } },
                    { materialGrade: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        ],
      }),
    };

    const [records, total] = await prisma.$transaction([
      prisma.quotation.findMany({
        where,
        include: {
          rfq: { select: { rfqNumber: true } },
          customer: true,
          createdBy: {
            select: { id: true, name: true },
          },
          parts: {
            include: {
              part: true,
              costing: {
                include: {
                  materialRate: true,
                  volumes: true,
                  components: {
                    include: {
                      machineRate: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.quotation.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: records,
    });
  } catch (error) {
    console.error("Quotation history error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve quotation history",
    });
  }
};

export const getCostingHistory = async (
  req: Request,
  res: Response
) => {
  try {
    const validation = historyQuerySchema.safeParse(req.query);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid history filters",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { page, limit, search } = validation.data;

    const where: Prisma.CostingWhereInput = {
      ...(search && {
        OR: [
          {
            part: {
              is: {
                partNumber: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
          {
            part: {
              is: {
                name: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
          {
            part: {
              is: {
                materialGrade: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
          {
            part: {
              is: {
                rfq: {
                  rfqNumber: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
            },
          },
          {
            part: {
              is: {
                rfq: {
                  customer: {
                    name: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
          },
        ],
      }),
    };

    const [records, total] = await prisma.$transaction([
      prisma.costing.findMany({
        where,
        include: costingInclude,
        orderBy: [
          { partId: "asc" },
          { version: "desc" },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.costing.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: records,
    });
  } catch (error) {
    console.error("Costing history error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve costing history",
    });
  }
};

export const getImportedQuoteHistory = async (
  req: Request,
  res: Response
) => {
  try {
    const validation = historyQuerySchema.safeParse(req.query);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid history filters",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { page, limit, search } = validation.data;

    const where: Prisma.HistoricalQuoteWhereInput = search
      ? {
          OR: [
            { quotationNumber: { contains: search, mode: "insensitive" } },
            { rfqNumber: { contains: search, mode: "insensitive" } },
            { customerName: { contains: search, mode: "insensitive" } },
            {
              parts: {
                some: {
                  OR: [
                    { partNumber: { contains: search, mode: "insensitive" } },
                    { partName: { contains: search, mode: "insensitive" } },
                    { materialGrade: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : {};

    const [records, total] = await prisma.$transaction([
      prisma.historicalQuote.findMany({
        where,
        include: { parts: true },
        orderBy: [{ quoteDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.historicalQuote.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: records,
    });
  } catch (error) {
    console.error("Imported quote history error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve imported quote history",
    });
  }
};
