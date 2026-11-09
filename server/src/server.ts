import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import prisma from "./lib/prisma.js";
import { apiErrorHandler } from "./middleware/api-error.middleware.js";
import {
  getClientOrigin,
  getTrustProxyHops,
  validateRuntimeConfiguration,
} from "./config/runtime-config.js";

// Route imports
import authRoutes from "./routes/auth.routes.js";
import customerRoutes from "./routes/customer.routes.js";
import rfqRoutes from "./routes/rfq.routes.js";
import materialRateRoutes from "./routes/material-rate.routes.js";
import machineRateRoutes from "./routes/machine-rate.routes.js";
import costingRoutes from "./routes/costing.routes.js";
import routingRoutes from "./routes/routing.routes.js";
import quotationRoutes from "./routes/quotation.routes.js";
import partRoutes from "./routes/part.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import userRoutes from "./routes/user.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import historyRoutes from "./routes/history.routes.js";
import documentIntakeRoutes from "./routes/document-intake.routes.js";

const app = express();
const PORT = Number(process.env.PORT) || 5000;
validateRuntimeConfiguration();
app.set("trust proxy", getTrustProxyHops());
const allowedOrigin = getClientOrigin();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

// Request parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/api/health", (_req, res) => {
  return res.status(200).json({
    success: true,
    message: "RFQ Quotation API is running",
  });
});

// Database health check
app.get("/api/health/database", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json({
      success: true,
      message: "Database connection successful",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return res.status(503).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/rfqs", rfqRoutes);
app.use("/api/parts", partRoutes);
app.use("/api/material-rates", materialRateRoutes);
app.use("/api/machine-rates", machineRateRoutes);
app.use("/api/routings", routingRoutes);
app.use("/api/costings", costingRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/users", userRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/document-intake", documentIntakeRoutes);

// Handle unknown API routes
app.use((_req, res) => {
  return res.status(404).json({
    success: false,
    message: "API endpoint not found",
  });
});

app.use(apiErrorHandler);

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down server...");

  server.close(async () => {
    await prisma.$disconnect();
    console.log("Database disconnected");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
