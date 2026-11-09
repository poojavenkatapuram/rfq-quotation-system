import type { NextFunction, Request, Response } from "express";

type AttemptWindow = {
  attempts: number;
  resetAt: number;
};

export interface LoginRateLimiterOptions {
  windowMs?: number;
  maxAttempts?: number;
  maxTrackedClients?: number;
  now?: () => number;
}

/**
 * Limits attempts by client IP before credentials are evaluated. This is
 * deliberately process-local: it is a safe baseline for one application
 * instance, while a multi-instance deployment must enforce an equivalent
 * limit at its shared edge/proxy.
 */
export function createLoginRateLimiter(
  options: LoginRateLimiterOptions = {}
) {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const maxAttempts = options.maxAttempts ?? 10;
  const maxTrackedClients = options.maxTrackedClients ?? 10_000;
  const getNow = options.now ?? Date.now;
  const attemptsByClient = new Map<string, AttemptWindow>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = getNow();
    const clientKey = req.ip || req.socket.remoteAddress || "unknown";
    const current = attemptsByClient.get(clientKey);

    if (current && current.resetAt <= now) {
      attemptsByClient.delete(clientKey);
    }

    const active = attemptsByClient.get(clientKey);

    if (active && active.attempts >= maxAttempts) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((active.resetAt - now) / 1000)
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        message: "Too many login attempts. Please try again later.",
      });
      return;
    }

    if (!active && attemptsByClient.size >= maxTrackedClients) {
      for (const [key, entry] of attemptsByClient) {
        if (entry.resetAt <= now) attemptsByClient.delete(key);
      }

      if (attemptsByClient.size >= maxTrackedClients) {
        const oldestKey = attemptsByClient.keys().next().value;
        if (oldestKey) attemptsByClient.delete(oldestKey);
      }
    }

    if (active) {
      active.attempts += 1;
    } else {
      attemptsByClient.set(clientKey, {
        attempts: 1,
        resetAt: now + windowMs,
      });
    }

    next();
  };
}

export const loginRateLimiter = createLoginRateLimiter();
