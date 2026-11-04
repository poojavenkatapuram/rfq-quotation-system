import { Router } from "express";
import {
  getMachineRates,
  getMachineRateById,
  createMachineRate,
  deactivateMachineRate,
} from "../controllers/machine-rate.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

router.get("/", getMachineRates);
router.get("/:id", getMachineRateById);

router.post(
  "/",
  authorize("PLANT_HEAD", "ADMIN"),
  createMachineRate
);

router.patch(
  "/:id/deactivate",
  authorize("PLANT_HEAD", "ADMIN"),
  deactivateMachineRate
);

export default router;