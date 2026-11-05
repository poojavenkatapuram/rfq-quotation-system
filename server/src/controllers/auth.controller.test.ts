import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const {
  mockUserFindUnique,
  mockBcryptCompare,
  mockJwtSign,
} = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockBcryptCompare: vi.fn(),
  mockJwtSign: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    user: {
      findUnique: mockUserFindUnique,
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: mockBcryptCompare,
  },
}));

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: mockJwtSign,
  },
}));

import { getCurrentUser, login } from "./auth.controller.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const sampleUser = {
  id: "user-test-001",
  name: "Test Administrator",
  email: "admin@example.com",
  passwordHash: "hashed-password",
  role: "ADMIN",
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

const createLoginRequest = (body: Record<string, unknown> = {}) =>
  ({ body }) as Request;

const createAuthenticatedRequest = (userId = sampleUser.id) =>
  ({
    user: {
      userId,
      role: "ADMIN",
    },
  }) as AuthenticatedRequest;

describe("Authentication Controller", () => {
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.JWT_SECRET = "test-jwt-secret";

    mockUserFindUnique.mockResolvedValue(sampleUser);
    mockBcryptCompare.mockResolvedValue(true);
    mockJwtSign.mockReturnValue("mock-jwt-token");
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  describe("login", () => {
    it("logs in successfully and returns a token and safe user details", async () => {
      const req = createLoginRequest({
        email: "ADMIN@EXAMPLE.COM",
        password: "test-password",
      });
      const res = createResponse();

      await login(req, res);

      expect(mockUserFindUnique).toHaveBeenCalledWith({
        where: { email: "admin@example.com" },
      });

      expect(mockBcryptCompare).toHaveBeenCalledWith(
        "test-password",
        sampleUser.passwordHash,
      );

      expect(mockJwtSign).toHaveBeenCalledWith(
        {
          userId: sampleUser.id,
          role: sampleUser.role,
        },
        "test-jwt-secret",
        { expiresIn: "8h" },
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Login successful",
        data: {
          token: "mock-jwt-token",
          user: {
            id: sampleUser.id,
            name: sampleUser.name,
            email: sampleUser.email,
            role: sampleUser.role,
          },
        },
      });
    });

    it("rejects invalid request data", async () => {
      const req = createLoginRequest({
        email: "invalid-email",
        password: "",
      });
      const res = createResponse();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockUserFindUnique).not.toHaveBeenCalled();
    });

    it("rejects a user who does not exist", async () => {
      mockUserFindUnique.mockResolvedValue(null);

      const req = createLoginRequest({
        email: "unknown@example.com",
        password: "test-password",
      });
      const res = createResponse();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockBcryptCompare).not.toHaveBeenCalled();
    });

    it("rejects an inactive user", async () => {
      mockUserFindUnique.mockResolvedValue({
        ...sampleUser,
        isActive: false,
      });

      const req = createLoginRequest({
        email: sampleUser.email,
        password: "test-password",
      });
      const res = createResponse();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockBcryptCompare).not.toHaveBeenCalled();
    });

    it("rejects an incorrect password", async () => {
      mockBcryptCompare.mockResolvedValue(false);

      const req = createLoginRequest({
        email: sampleUser.email,
        password: "wrong-password",
      });
      const res = createResponse();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockJwtSign).not.toHaveBeenCalled();
    });

    it("rejects login when JWT_SECRET is missing", async () => {
      delete process.env.JWT_SECRET;

      const req = createLoginRequest({
        email: sampleUser.email,
        password: "test-password",
      });
      const res = createResponse();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(mockJwtSign).not.toHaveBeenCalled();
    });
  });

  describe("getCurrentUser", () => {
    it("returns the current user's safe profile", async () => {
      const safeUser = {
        id: sampleUser.id,
        name: sampleUser.name,
        email: sampleUser.email,
        role: sampleUser.role,
        isActive: true,
      };

      mockUserFindUnique.mockResolvedValue(safeUser);

      const req = createAuthenticatedRequest();
      const res = createResponse();

      await getCurrentUser(req, res);

      expect(mockUserFindUnique).toHaveBeenCalledWith({
        where: { id: sampleUser.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { user: safeUser },
      });
    });

    it("rejects a missing or inactive user", async () => {
      mockUserFindUnique.mockResolvedValue(null);

      const req = createAuthenticatedRequest();
      const res = createResponse();

      await getCurrentUser(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("returns an internal error when the database lookup fails", async () => {
      mockUserFindUnique.mockRejectedValue(new Error("Database error"));

      const req = createAuthenticatedRequest();
      const res = createResponse();

      await getCurrentUser(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
