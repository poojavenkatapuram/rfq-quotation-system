import type { Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const roles = ["ESTIMATOR", "SALES_HEAD", "PLANT_HEAD", "ADMIN"] as const;

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.enum(roles),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(roles).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});

const statusSchema = z.object({
  isActive: z.boolean(),
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export const listUsers = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || "").trim();
    const role = req.query.role ? String(req.query.role) : undefined;

    if (role && !roles.includes(role as (typeof roles)[number])) {
      return res.status(400).json({
        success: false,
        message: "Invalid user role",
      });
    }

    const where = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(role ? { role: role as (typeof roles)[number] } : {}),
    };

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve users",
    });
  }
};

export const createUser = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const validation = createUserSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid user details",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { name, email, password, role } = validation.data;
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { name, email, passwordHash, role },
        select: userSelect,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "USER_CREATED",
          entityType: "User",
          entityId: createdUser.id,
          details: { name, email, role },
        },
      });

      return createdUser;
    });

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: { user },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    console.error("Create user error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create user",
    });
  }
};

export const updateUser = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const validation = updateUserSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid user update",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const targetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    if (targetId === req.user!.userId && validation.data.role) {
      return res.status(409).json({
        success: false,
        message: "You cannot change your own role",
      });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: targetId },
      });

      if (!existing) return null;

      if (
        existing.isActive &&
        existing.role === "ADMIN" &&
        validation.data.role &&
        validation.data.role !== "ADMIN"
      ) {
        const activeAdminCount = await tx.user.count({
          where: { role: "ADMIN", isActive: true },
        });

        if (activeAdminCount <= 1) {
          throw new Error("LAST_ACTIVE_ADMIN");
        }
      }

      const updated = await tx.user.update({
        where: { id: targetId },
        data: validation.data,
        select: userSelect,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: targetId,
          details: {
            before: { name: existing.name, role: existing.role },
            after: validation.data,
          },
        },
      });

      return updated;
    });

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: { user: updatedUser },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_ACTIVE_ADMIN") {
      return res.status(409).json({
        success: false,
        message: "The last active administrator cannot be demoted",
      });
    }

    console.error("Update user error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update user",
    });
  }
};

export const updateUserStatus = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const validation = statusSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "A valid isActive boolean is required",
      });
    }

    const targetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    if (targetId === req.user!.userId && !validation.data.isActive) {
      return res.status(409).json({
        success: false,
        message: "You cannot deactivate your own account",
      });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: targetId },
      });

      if (!existing) return null;

      if (
        existing.isActive &&
        !validation.data.isActive &&
        existing.role === "ADMIN"
      ) {
        const activeAdminCount = await tx.user.count({
          where: { role: "ADMIN", isActive: true },
        });

        if (activeAdminCount <= 1) {
          throw new Error("LAST_ACTIVE_ADMIN");
        }
      }

      if (existing.isActive === validation.data.isActive) {
        return tx.user.findUnique({
          where: { id: targetId },
          select: userSelect,
        });
      }

      const updated = await tx.user.update({
        where: { id: targetId },
        data: { isActive: validation.data.isActive },
        select: userSelect,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: validation.data.isActive
            ? "USER_ACTIVATED"
            : "USER_DEACTIVATED",
          entityType: "User",
          entityId: targetId,
          details: {
            previousStatus: existing.isActive,
            newStatus: validation.data.isActive,
          },
        },
      });

      return updated;
    });

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: validation.data.isActive
        ? "User activated successfully"
        : "User deactivated successfully",
      data: { user: updatedUser },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_ACTIVE_ADMIN") {
      return res.status(409).json({
        success: false,
        message: "The last active administrator cannot be deactivated",
      });
    }

    console.error("Update user status error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update user status",
    });
  }
};
