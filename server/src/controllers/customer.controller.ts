
import { Request, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";

const customerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  code: z.string().trim().min(2).max(30),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(500).optional(),
  gstNumber: z.string().trim().max(20).optional(),
});

const getCustomerId = (req: Request): string | null => {
  const id = req.params.id;
  return typeof id === "string" ? id : null;
};

// Create customer
export const createCustomer = async (req: Request, res: Response) => {
  try {
    const validation = customerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer details",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const data = validation.data;

    const existingCustomer = await prisma.customer.findUnique({
      where: { code: data.code },
    });

    if (existingCustomer) {
      return res.status(409).json({
        success: false,
        message: "Customer code already exists",
      });
    }

    const customer = await prisma.customer.create({
      data: {
        name: data.name,
        code: data.code,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        gstNumber: data.gstNumber || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: customer,
    });
  } catch (error) {
    console.error("Create customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create customer",
    });
  }
};

// Get all customers
export const getCustomers = async (_req: Request, res: Response) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { createdAt: "desc" },
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

// Get customer by ID
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

// Update customer
export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const customerId = getCustomerId(req);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID",
      });
    }

    const validation = customerSchema.partial().safeParse(req.body);

    if (
      !validation.success ||
      Object.keys(validation.data ?? {}).length === 0
    ) {
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

    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: validation.data,
    });

    return res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      data: updatedCustomer,
    });
  } catch (error) {
    console.error("Update customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update customer",
    });
  }
};
