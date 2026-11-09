import { Router } from "express";
import {
  createRFQ,
  getRFQAssignees,
  getRFQs,
  getRFQById,
  updateRFQ,
} from "../controllers/rfq.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

router.post("/", authorize("ESTIMATOR", "ADMIN"), createRFQ);
router.get("/", getRFQs);
router.get("/assignees", authorize("ADMIN", "ESTIMATOR"), getRFQAssignees);
router.get("/:id", getRFQById);
router.patch(
  "/:id",
  authorize("ESTIMATOR", "ADMIN", "SALES_HEAD"),
  updateRFQ
);

export default router;