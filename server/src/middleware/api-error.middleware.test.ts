import { describe, expect, it, vi } from "vitest";
import multer from "multer";
import { apiErrorHandler } from "./api-error.middleware.js";

function createResponse(headersSent = false) {
  const response = {
    headersSent,
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe("API error handler", () => {
  it("returns a safe JSON response for oversized uploads", () => {
    const response = createResponse();
    const next = vi.fn();

    apiErrorHandler(
      new multer.MulterError("LIMIT_FILE_SIZE"),
      {} as any,
      response as any,
      next
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: "Uploaded file exceeds the permitted size",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not expose an unexpected error message", () => {
    const response = createResponse();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      apiErrorHandler(
        new Error("database password must not be disclosed"),
        {} as any,
        response as any,
        vi.fn()
      );

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        success: false,
        message: "An internal server error occurred",
      });
      expect(consoleError).toHaveBeenCalledWith("Unhandled API error", {
        name: "Error",
      });
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
        "database password"
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("delegates errors after headers have been sent", () => {
    const response = createResponse(true);
    const next = vi.fn();
    const error = new Error("stream write failed");

    apiErrorHandler(error, {} as any, response as any, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
