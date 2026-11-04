import { Router } from "express";
import {
  createCosting,
  getCostingsByPart,
} from "../controllers/costing.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate);

router.post("/", createCosting);
router.get("/part/:partId", getCostingsByPart);

export default router;
