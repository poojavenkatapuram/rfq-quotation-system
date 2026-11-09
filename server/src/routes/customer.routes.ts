
import { Router } from "express";
import {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
} from "../controllers/customer.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate);

router.get("/", getCustomers);
router.post("/", authorize("ADMIN"), createCustomer);
router.get("/:id", getCustomerById);
router.patch("/:id", authorize("ADMIN"), updateCustomer);

export default router;
