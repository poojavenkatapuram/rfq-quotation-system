import { Router } from "express";

import {
  createQuotation,
  getQuotations,
  getQuotationById,
  submitQuotation,
  approveQuotation,
  rejectQuotation,
  sendQuotation,
} from "../controllers/quotation.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate);

// Create and retrieve quotations
router.post("/", createQuotation);
router.get("/", getQuotations);
router.get("/:id", getQuotationById);

// Submission and approval workflow
router.post("/:id/submit", submitQuotation);
router.post("/:id/approve", approveQuotation);
router.post("/:id/reject", rejectQuotation);

// Send approved quotation
router.post("/:id/send", sendQuotation);

export default router;
