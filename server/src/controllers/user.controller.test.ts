import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

const {
  mockUserFindMany,
  mockUserFindUnique,
  mockUserCount,
  mockUserCreate,
  mockUserUpdate,
  mockAuditLogCreate,
  mockTransaction,
  mockHash,
} = vi.hoisted(() => ({
  mockUserFindMany: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserCount: vi.fn(),
  mockUserCreate: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockHash: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    user: {
      findMany: mockUserFindMany,
      findUnique: mockUserFindUnique,
      count: mockUserCount,
      create: mockUserCreate,
      update: mockUserUpdate,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: mockHash,
  },
}));

import {
  listUsers,
  createUser,
  updateUser,
  updateUserStatus,
} from "./user.controller.js";

const adminId = "admin-test-001";
const targetId = "user-test-001";

const admin = {
  id: adminId,
  name: "Administrator",
  email: "admin@example.com",
  role: "ADMIN",
  isActive: true,
};

const targetUser = {
  id: targetId,
  name: "Test Estimator",
  email: "estimator@example.com",
  role: "ESTIMATOR",
  isActive: true,
};

const createResponse = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;

  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  (res.json as ReturnType<typeof vi.fn>).mockReturnValue(res);

  return res;
};

const createRequest = (
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  query: Record<string, unknown> = {},
) => ({
  body,
  params,
  query,
  user: {
    userId: adminId,
    role: "ADMIN",
  },
});

const transactionClient = {
  user: {
    findMany: mockUserFindMany,
    findUnique: mockUserFindUnique,
    count: mockUserCount,
    create: mockUserCreate,
    update: mockUserUpdate,
  },
  auditLog: {
    create: mockAuditLogCreate,
  },
};

describe("User Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockTransaction.mockImplementation(async (callbackOrQueries: unknown) => {
      if (typeof callbackOrQueries === "function") {
        return callbackOrQueries(transactionClient);
      }

      return Promise.all(callbackOrQueries as Promise<unknown>[]);
    });

    mockUserFindMany.mockResolvedValue([targetUser]);
    mockUserFindUnique.mockResolvedValue(targetUser);
    mockUserCount.mockResolvedValue(2);
    mockUserCreate.mockResolvedValue(targetUser);
    mockUserUpdate.mockResolvedValue(targetUser);
    mockAuditLogCreate.mockResolvedValue({});
    mockHash.mockResolvedValue("secure-hashed-password");
  });

  describe("listUsers", () => {
    it("returns paginated users without exposing password hashes", async () => {
      const req = createRequest({}, {}, { page: "1", limit: "10" });
      const res = createResponse();

      await listUsers(
        req as unknown as Parameters<typeof listUsers>[0],
        res,
      );

      const query = mockUserFindMany.mock.calls[0][0];

      expect(query).toEqual(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
      expect(query.select).not.toHaveProperty("passwordHash");

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("rejects an invalid role filter", async () => {
      const req = createRequest({}, {}, { role: "SUPERUSER" });
      const res = createResponse();

      await listUsers(
        req as unknown as Parameters<typeof listUsers>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockUserFindMany).not.toHaveBeenCalled();
    });
  });

  describe("createUser", () => {
    const validBody = {
      name: "New Estimator",
      email: "new@example.com",
      password: "secure-password-123",
      role: "ESTIMATOR",
    };

    it("creates a user with a hashed password and audit log", async () => {
      mockUserFindUnique.mockResolvedValue(null);

      const req = createRequest(validBody);
      const res = createResponse();

      await createUser(
        req as unknown as Parameters<typeof createUser>[0],
        res,
      );

      expect(mockHash).toHaveBeenCalledWith(validBody.password, 12);

      expect(mockUserCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: validBody.email,
            passwordHash: "secure-hashed-password",
          }),
        }),
      );

      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: adminId,
            action: "USER_CREATED",
            entityType: "User",
          }),
        }),
      );

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("rejects duplicate email addresses", async () => {
      mockUserFindUnique.mockResolvedValue({ id: targetId });

      const req = createRequest(validBody);
      const res = createResponse();

      await createUser(
        req as unknown as Parameters<typeof createUser>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockUserCreate).not.toHaveBeenCalled();
    });

    it("rejects passwords shorter than 12 characters", async () => {
      const req = createRequest({
        ...validBody,
        password: "short",
      });
      const res = createResponse();

      await createUser(
        req as unknown as Parameters<typeof createUser>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockHash).not.toHaveBeenCalled();
    });
  });

  describe("updateUser", () => {
    it("updates a user's role and records an audit log", async () => {
      mockUserFindUnique.mockResolvedValue(targetUser);

      const req = createRequest(
        { role: "PLANT_HEAD" },
        { id: targetId },
      );
      const res = createResponse();

      await updateUser(
        req as unknown as Parameters<typeof updateUser>[0],
        res,
      );

      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: targetId },
          data: { role: "PLANT_HEAD" },
        }),
      );

      expect(mockAuditLogCreate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("prevents administrators from changing their own role", async () => {
      const req = createRequest(
        { role: "ESTIMATOR" },
        { id: adminId },
      );
      const res = createResponse();

      await updateUser(
        req as unknown as Parameters<typeof updateUser>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("prevents demoting the last active administrator", async () => {
      mockUserFindUnique.mockResolvedValue({
        ...admin,
      });
      mockUserCount.mockResolvedValue(1);

      const req = createRequest(
        { role: "ESTIMATOR" },
        { id: targetId },
      );
      const res = createResponse();

      await updateUser(
        req as unknown as Parameters<typeof updateUser>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });
  });

  describe("updateUserStatus", () => {
    it("prevents an administrator from deactivating themselves", async () => {
      const req = createRequest(
        { isActive: false },
        { id: adminId },
      );
      const res = createResponse();

      await updateUserStatus(
        req as unknown as Parameters<typeof updateUserStatus>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("prevents deactivating the last active administrator", async () => {
      mockUserFindUnique.mockResolvedValue(admin);
      mockUserCount.mockResolvedValue(1);

      const req = createRequest(
        { isActive: false },
        { id: targetId },
      );
      const res = createResponse();

      await updateUserStatus(
        req as unknown as Parameters<typeof updateUserStatus>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("deactivates a user and records an audit log", async () => {
      mockUserFindUnique.mockResolvedValue(targetUser);

      const req = createRequest(
        { isActive: false },
        { id: targetId },
      );
      const res = createResponse();

      await updateUserStatus(
        req as unknown as Parameters<typeof updateUserStatus>[0],
        res,
      );

      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: targetId },
          data: { isActive: false },
        }),
      );

      expect(mockAuditLogCreate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
