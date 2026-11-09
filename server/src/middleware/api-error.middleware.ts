import type { ErrorRequestHandler } from "express";
import multer from "multer";

const knownUploadMessages = new Set([
  "Only PDF and XLSX documents are accepted",
  "Only .xlsx Excel workbooks are accepted",
]);

export const apiErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Uploaded file exceeds the permitted size"
      : "Invalid file upload";
    res.status(400).json({ success: false, message });
    return;
  }

  if (error instanceof Error && knownUploadMessages.has(error.message)) {
    res.status(400).json({
      success: false,
      message: "Unsupported upload type",
    });
    return;
  }

  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error("Unhandled API error", { name: errorName });
  res.status(500).json({
    success: false,
    message: "An internal server error occurred",
  });
};
