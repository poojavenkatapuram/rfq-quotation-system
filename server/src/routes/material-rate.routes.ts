import { Router } from "express";
import {
  getMaterialRates,
  getMaterialRateById,
  createMaterialRate,
  deactivateMaterialRate,
} from "../controllers/material-rate.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

router.get("/", getMaterialRates);
router.get("/:id", getMaterialRateById);

router.post(
  "/",
  authorize("PLANT_HEAD", "ADMIN"),
  createMaterialRate
);

router.patch(
  "/:id/deactivate",
  authorize("PLANT_HEAD", "ADMIN"),
  deactivateMaterialRate
);

export default router;
