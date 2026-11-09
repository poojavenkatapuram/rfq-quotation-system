import { submitRoutingReview, decideRoutingReview } from "../controllers/routing-review.controller.js";
import { Router } from "express";
import {
  getRoutingByPart,
  getHistoricalRoutingRecommendations,
  saveRouting,
} from "../controllers/routing.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

router.get(
  "/recommendations/:partId",
  getHistoricalRoutingRecommendations
);

router.get(
  "/part/:partId",
  getRoutingByPart
);

router.put(
  "/part/:partId",
  authorize("ESTIMATOR", "PLANT_HEAD", "ADMIN"),
  saveRouting
);

router.post("/part/:partId/review", authorize("ESTIMATOR", "ADMIN"), submitRoutingReview);
router.post("/part/:partId/review/decision", authorize("PLANT_HEAD"), decideRoutingReview);

export default router;
