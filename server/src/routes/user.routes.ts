import { Router } from "express";
import {
  createUser,
  listUsers,
  updateUser,
  updateUserStatus,
} from "../controllers/user.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate, authorize("ADMIN"));

router.get("/", listUsers);
router.post("/", createUser);
router.patch("/:id", updateUser);
router.patch("/:id/status", updateUserStatus);

export default router;
