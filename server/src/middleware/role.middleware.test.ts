
import { describe, expect, it, vi } from "vitest";
import type { Response, NextFunction } from "express";
import {
  authorize,
} from "./role.middleware.js";
import type {
  AuthenticatedRequest,
} from "./auth.middleware.js";

describe("Role authorization middleware", () => {
  const createResponse = () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    return res as unknown as Response;
  };

  it("allows a user with an authorized role", () => {
    const req = {
      user: { userId: "user-1", role: "ADMIN" },
    } as AuthenticatedRequest;

    const res = createResponse();
    const next = vi.fn() as NextFunction;

    authorize("ADMIN")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a user without authentication", () => {
    const req = {} as AuthenticatedRequest;

    const res = createResponse();
    const next = vi.fn() as NextFunction;

    authorize("ADMIN")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a user with an unauthorized role", () => {
    const req = {
      user: { userId: "user-2", role: "ESTIMATOR" },
    } as AuthenticatedRequest;

    const res = createResponse();
    const next = vi.fn() as NextFunction;

    authorize("ADMIN")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
