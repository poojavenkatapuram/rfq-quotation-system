import { Router } from "express";
import {
  getCurrentUser,
  login,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { loginRateLimiter } from "../middleware/login-rate-limit.middleware.js";

const router = Router();

router.post("/login", loginRateLimiter, login);
router.get("/me", authenticate, getCurrentUser);

export default router;
