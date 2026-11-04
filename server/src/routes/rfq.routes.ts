import { Router } from "express";
import {
  createRFQ,
  getRFQs,
  getRFQById,
  updateRFQ,
} from "../controllers/rfq.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate);

router.post("/", createRFQ);
router.get("/", getRFQs);
router.get("/:id", getRFQById);
router.patch("/:id", updateRFQ);

export default router;