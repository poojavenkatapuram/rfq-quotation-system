import { Router } from "express";
import multer from "multer";

import {
  getQuotationHistory,
  getCostingHistory,
  getImportedQuoteHistory,
} from "../controllers/history.controller.js";
import { importHistoricalQuotes } from "../controllers/history-import.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const isExcel =
      file.originalname.toLowerCase().endsWith(".xlsx") &&
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    if (!isExcel) {
      callback(new Error("Only .xlsx Excel workbooks are accepted"));
      return;
    }

    callback(null, true);
  },
});

router.use(authenticate);

router.get("/quotations", getQuotationHistory);
router.get("/costings", getCostingHistory);
router.get("/imported", getImportedQuoteHistory);
router.post("/import", upload.single("file"), importHistoricalQuotes);

export default router;
