import { Router } from "express";
import {
  getRoutingByPart,
  saveRouting,
} from "../controllers/routing.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

router.get(
  "/part/:partId",
  getRoutingByPart
);

router.put(
  "/part/:partId",
  authorize("ESTIMATOR", "PLANT_HEAD", "ADMIN"),
  saveRouting
);

export default router;
