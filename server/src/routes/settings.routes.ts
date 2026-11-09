import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { readCompanySettings, updateCompanySettings } from "../controllers/settings.controller.js";

const router = Router();
router.use(authenticate, authorize("ADMIN"));
router.get("/company", readCompanySettings);
router.put("/company", updateCompanySettings);
export default router;
