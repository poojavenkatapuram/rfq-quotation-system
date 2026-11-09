import { describe, expect, it, vi } from "vitest";
import { createLoginRateLimiter } from "./login-rate-limit.middleware.js";

function createResponse() {
  const response = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe("login rate limiter", () => {
  it("allows bounded login attempts then returns a generic retry response", () => {
    let now = 1_000;
    const limiter = createLoginRateLimiter({
      maxAttempts: 2,
      windowMs: 60_000,
      now: () => now,
    });
    const request = { ip: "203.0.113.10", socket: {} } as any;
    const response = createResponse();
    const next = vi.fn();

    limiter(request, response as any, next);
    limiter(request, response as any, next);
    limiter(request, response as any, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "60");
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: "Too many login attempts. Please try again later.",
    });

    now += 60_000;
    limiter(request, response as any, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("keeps client windows isolated", () => {
    const limiter = createLoginRateLimiter({ maxAttempts: 1 });
    const firstResponse = createResponse();
    const secondResponse = createResponse();
    const next = vi.fn();

    limiter({ ip: "203.0.113.1", socket: {} } as any, firstResponse as any, next);
    limiter({ ip: "203.0.113.2", socket: {} } as any, secondResponse as any, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(firstResponse.status).not.toHaveBeenCalled();
    expect(secondResponse.status).not.toHaveBeenCalled();
  });
});
