import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  getExtractionJob,
  retryExtractionJob,
  reviewExtractedFields,
  uploadAndExtractDocument,
  uploadAndExtractDocuments,
} from "../controllers/document-intake.controller.js";


const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req, file, callback) => {
    const extension = file.originalname.toLowerCase();

    const isPdf =
      extension.endsWith(".pdf") &&
      file.mimetype === "application/pdf";

    const isExcel =
      extension.endsWith(".xlsx") &&
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const isEmail = extension.endsWith(".eml") &&
      ["message/rfc822", "application/octet-stream", "text/plain"].includes(file.mimetype);

    if (!isPdf && !isExcel && !isEmail) {
      callback(new Error("Only PDF, XLSX, and EML documents are accepted"));
      return;
    }

    callback(null, true);
  },
});

router.use(authenticate);
// Read-only technical access for Plant Heads; all intake mutations stay restricted.
router.get("/:id", authorize("ADMIN", "ESTIMATOR", "PLANT_HEAD"), getExtractionJob);
router.use(authorize("ADMIN", "ESTIMATOR"));

router.post(
  "/upload",
  upload.single("file"),
  (req, res, next) => {
    void uploadAndExtractDocument(req as any, res).catch(next);
  }
);
router.post(
  "/uploads",
  upload.array("files", 10),
  (req, res, next) => {
    void uploadAndExtractDocuments(req as any, res).catch(next);
  }
);
router.post("/:id/retry", retryExtractionJob);
router.patch("/:id/review", reviewExtractedFields);

export default router;
