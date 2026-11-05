import { Router } from "express";
import { assignMaterialRateToPart } from "../controllers/part.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

router.patch(
  "/:partId/material-rate",
  authorize("ESTIMATOR", "PLANT_HEAD", "ADMIN"),
  assignMaterialRateToPart
);

export default router;
