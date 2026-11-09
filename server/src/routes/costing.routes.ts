import { Router } from "express";
import {
  createCosting,
  getCostingsByPart,
} from "../controllers/costing.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

router.post("/", authorize("ESTIMATOR", "ADMIN"), createCosting);
router.get("/part/:partId", getCostingsByPart);

export default router;
