import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const customerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  code: z.string().trim().min(2).max(30).regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "Customer code may contain only letters, numbers, hyphens, and underscores"
  ),
  email: z.string().trim().email().or(z.literal("")).optional(),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(500).optional(),
  gstNumber: z.string().trim().max(20).optional(),
});

const customerListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});

const getCustomerId = (req: Request): string | null => {
  const id = req.params.id;
  return typeof id === "string" && id.trim() ? id : null;
};

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const nullable = (value: string | undefined): string | null | undefined =>
  value === undefined ? undefined : value || null;

const customerData = (
  input: Partial<z.infer<typeof customerSchema>>
) => ({
  ...(input.name !== undefined && { name: input.name }),
  ...(input.code !== undefined && { code: input.code }),
  ...(input.email !== undefined && { email: nullable(input.email) }),
  ...(input.phone !== undefined && { phone: nullable(input.phone) }),
  ...(input.address !== undefined && { address: nullable(input.address) }),
  ...(input.gstNumber !== undefined && { gstNumber: nullable(input.gstNumber) }),
});

const customerSnapshot = (customer: {
  name: string;
  code: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  gstNumber: string | null;
}) => ({
  name: customer.name,
  code: customer.code,
  email: customer.email,
  phone: customer.phone,
  address: customer.address,
  gstNumber: customer.gstNumber,
});

const getChangedFields = (
  previous: ReturnType<typeof customerSnapshot>,
  next: ReturnType<typeof customerSnapshot>
) => Object.fromEntries(
  Object.keys(previous).flatMap((field) => {
    const key = field as keyof typeof previous;
    return previous[key] === next[key]
      ? []
      : [[key, { previous: previous[key], updated: next[key] }]];
  })
);

const duplicateMessage = (customer: { code: string }, code: string) =>
  customer.code.toLowerCase() === code.toLowerCase()
    ? "Customer code already exists"
    : "Customer name already exists";

export const createCustomer = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const validation = customerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer details",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const data = {
      name: validation.data.name,
      code: validation.data.code,
      email: nullable(validation.data.email) ?? null,
      phone: nullable(validation.data.phone) ?? null,
      address: nullable(validation.data.address) ?? null,
      gstNumber: nullable(validation.data.gstNumber) ?? null,
    };
    const duplicate = await prisma.customer.findFirst({
      where: {
        OR: [
          { code: { equals: validation.data.code, mode: "insensitive" } },
          { name: { equals: validation.data.name, mode: "insensitive" } },
        ],
      },
      select: { id: true, code: true },
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: duplicateMessage(duplicate, validation.data.code),
      });
    }

    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({ data });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "CUSTOMER_CREATED",
          entityType: "Customer",
          entityId: created.id,
          details: {
            customer: customerSnapshot(created),
          },
        },
      });

      return created;
    });

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: customer,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({
        success: false,
        message: "Customer code already exists",
      });
    }

    console.error("Create customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create customer",
    });
  }
};

export const getCustomers = async (req: Request, res: Response) => {
  try {
    const validation = customerListQuerySchema.safeParse(req.query);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer search",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const search = validation.data.search;
    const customers = await prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ name: "asc" }, { code: "asc" }],
    });

    return res.status(200).json({
      success: true,
      count: customers.length,
      data: customers,
    });
  } catch (error) {
    console.error("Get customers error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve customers",
    });
  }
};

export const getCustomerById = async (req: Request, res: Response) => {
  try {
    const customerId = getCustomerId(req);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID",
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        _count: {
          select: {
            rfqs: true,
            quotations: true,
          },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error("Get customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve customer",
    });
  }
};

export const updateCustomer = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const customerId = getCustomerId(req);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID",
      });
    }

    const validation = customerSchema.partial().safeParse(req.body);

    if (!validation.success || Object.keys(validation.data ?? {}).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide valid customer details to update",
        errors: validation.success
          ? undefined
          : validation.error.flatten().fieldErrors,
      });
    }

    const existingCustomer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!existingCustomer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const data = customerData(validation.data);
    const nextSnapshot = customerSnapshot({ ...existingCustomer, ...data });
    const changes = getChangedFields(customerSnapshot(existingCustomer), nextSnapshot);

    if (Object.keys(changes).length === 0) {
      return res.status(200).json({
        success: true,
        message: "No customer changes detected",
        data: existingCustomer,
      });
    }

    const duplicateConditions: Prisma.CustomerWhereInput[] = [];
    if (data.code !== undefined) {
      duplicateConditions.push({
        code: { equals: data.code, mode: "insensitive" },
      });
    }
    if (data.name !== undefined) {
      duplicateConditions.push({
        name: { equals: data.name, mode: "insensitive" },
      });
    }

    if (duplicateConditions.length > 0) {
      const duplicate = await prisma.customer.findFirst({
        where: {
          id: { not: customerId },
          OR: duplicateConditions,
        },
        select: { id: true, code: true },
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: duplicateMessage(duplicate, data.code ?? existingCustomer.code),
        });
      }
    }

    const updatedCustomer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id: customerId },
        data,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "CUSTOMER_UPDATED",
          entityType: "Customer",
          entityId: updated.id,
          details: { changes },
        },
      });

      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      data: updatedCustomer,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({
        success: false,
        message: "Customer code already exists",
      });
    }

    console.error("Update customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update customer",
    });
  }
};
