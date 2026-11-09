import { canReadDocument, canManageIntakeDocument } from "../services/document-access.service.js";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import prisma from "../lib/prisma.js";
import {
  extractDocumentContent,
  DocumentProcessingError,
} from "../services/rfq-document-extraction.service.js";
import { extractSupplementaryRfqSuggestions } from "../services/ollama-rfq-extraction.service.js";
import { ExtractionFieldReviewStatus, ExtractionStatus } from "@prisma/client";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertSafeXlsxArchive } from "../services/xlsx-archive-validation.service.js";
import type { SupportedDocumentType } from "../services/rfq-document-extraction.service.js";
import { isNumericRfqField, normalizeReviewedNumber } from "../services/rfq-field-validation.js";

type UploadRequest = AuthenticatedRequest & {
  file?: Express.Multer.File;
  files?: Express.Multer.File[];
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const EXTRACTION_FAILURE_MESSAGE = "Unable to extract document content";

const DEFAULT_STORAGE_DIRECTORY = path.resolve(
  process.cwd(),
  "storage",
  "rfq-documents"
);

export function getDocumentStorageDirectory(): string {
  const configuredDirectory = process.env.RFQ_DOCUMENT_STORAGE_DIR?.trim();

  return configuredDirectory
    ? path.resolve(configuredDirectory)
    : DEFAULT_STORAGE_DIRECTORY;
}

function isLocalAiEnabled(): boolean {
  const configuredValue = process.env.LOCAL_AI_ENABLED?.trim().toLowerCase();

  if (configuredValue === "true") return true;
  if (configuredValue === "false") return false;

  // Local AI is an optional enhancement. Production must opt in explicitly;
  // deterministic extraction remains available in every environment.
  return process.env.NODE_ENV !== "production";
}

function validateDocument(file: Express.Multer.File): {
  valid: boolean;
  documentType?: SupportedDocumentType;
  message?: string;
} {
  const extension = path.extname(file.originalname).toLowerCase();

  if (file.size > MAX_FILE_SIZE || file.buffer?.length > MAX_FILE_SIZE) {
    return { valid: false, message: "File exceeds the 10 MB limit" };
  }

  if (!file.buffer?.length) {
    return { valid: false, message: "Uploaded file is empty" };
  }

  if (
    extension === ".pdf" &&
    file.mimetype === "application/pdf" &&
    file.buffer.subarray(0, 5).toString() === "%PDF-"
  ) {
    return { valid: true, documentType: "PDF" };
  }

  if (
    extension === ".xlsx" &&
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
    file.buffer.length >= 4 &&
    file.buffer[0] === 0x50 &&
    file.buffer[1] === 0x4b
  ) {
    try {
      assertSafeXlsxArchive(file.buffer);
      return { valid: true, documentType: "XLSX" };
    } catch {
      return {
        valid: false,
        message: "The Excel workbook is invalid or exceeds processing safety limits",
      };
    }
  }

  if (extension === ".eml" && ["message/rfc822", "application/octet-stream", "text/plain"].includes(file.mimetype)) {
    const preview = file.buffer.toString("utf8", 0, Math.min(file.buffer.length, 8192));
    if (/^(?:[A-Za-z0-9-]+):[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*\r?\n/m.test(preview)) {
      return { valid: true, documentType: "EML" };
    }
    return { valid: false, message: "The email file has no valid RFC 822 headers" };
  }

  return {
    valid: false,
    message: "Only valid PDF, XLSX, and EML documents are accepted",
  };
}

const publicAttachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  createdAt: true,
  uploadedById: true,
} as const;

function isIntakeUser(req: AuthenticatedRequest): boolean {
  return Boolean(
    req.user?.userId &&
      ["ADMIN", "ESTIMATOR"].includes(req.user.role)
  );
}


function duplicateHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function runDocumentExtraction(input: {
  jobId: string;
  buffer: Buffer;
  documentType: SupportedDocumentType;
  actorId: string;
}) {
  try {
    const extractionResult = await extractDocumentContent(
      input.buffer,
      input.documentType
    );
    const deterministicCandidates = extractionResult.candidates;
    const deterministicSourceFields = new Set(
      deterministicCandidates.map(
        (candidate) => candidate.sourceId + ":" + candidate.fieldName
      )
    );
    let supplementaryCandidates: typeof deterministicCandidates = [];
    let aiFailureReason: string | undefined;

    if (isLocalAiEnabled() && extractionResult.textSources.length > 0) {
      try {
        const aiResult = await extractSupplementaryRfqSuggestions(
          extractionResult.textSources,
          deterministicCandidates
        );
        aiFailureReason = aiResult.failureReason;

        supplementaryCandidates = aiResult.suggestions
          .filter((suggestion) => {
            const key = suggestion.sourceId + ":" + suggestion.fieldName;
            return !deterministicSourceFields.has(key);
          })
          .map((suggestion) => ({
            fieldName: suggestion.fieldName,
            extractedValue: suggestion.extractedValue,
            confidence: suggestion.confidence,
            sourceReference: suggestion.sourceReference,
            sourceId: suggestion.sourceId,
            evidenceText: suggestion.evidenceText,
            extractionMethod: "LOCAL_OLLAMA" as const,
            groupKey: suggestion.groupKey || ("document:" + suggestion.sourceId),
          }));
      } catch {
        aiFailureReason = "UNAVAILABLE";
      }
    } else {
      aiFailureReason = "DISABLED";
    }

    const candidates = [
      ...deterministicCandidates,
      ...supplementaryCandidates,
    ];
    const provider =
      supplementaryCandidates.length > 0 ? "LOCAL_OLLAMA" : "LOCAL";
    const warnings = [...(extractionResult.warnings || [])];
    if (aiFailureReason) warnings.push(`Local AI: ${aiFailureReason}. Only deterministic suggestions are available; enter missing fields manually.`);

    const job = await prisma.$transaction(async (tx) => {
      if (candidates.length > 0) {
        await tx.extractedField.createMany({
          data: candidates.map((candidate) => ({
            extractionJobId: input.jobId,
            fieldName: candidate.fieldName,
            extractedValue: candidate.extractedValue,
            confidence: candidate.confidence,
            sourceReference: candidate.sourceReference,
            sourceId: candidate.sourceId,
            evidenceText: candidate.evidenceText,
            extractionMethod: candidate.extractionMethod,
            groupKey: candidate.groupKey,
            reviewStatus: ExtractionFieldReviewStatus.PENDING,
            isAccepted: false,
          })),
        });
      }

      const completed = await tx.extractionJob.update({
        where: { id: input.jobId },
        data: {
          status: ExtractionStatus.COMPLETED,
          completedAt: new Date(),
          provider,
          errorMessage: warnings.join(" ") || null,
        },
        include: {
          fields: { orderBy: { createdAt: "asc" } },
          attachment: { select: publicAttachmentSelect },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "DOCUMENT_EXTRACTION_COMPLETED",
          entityType: "EXTRACTION_JOB",
          entityId: completed.id,
          details: {
            extractedFieldCount: candidates.length,
            deterministicFieldCount: deterministicCandidates.length,
            aiSuggestionCount: supplementaryCandidates.length,
            aiFailureReason,
            warnings,
            extractionMethod: provider,
          },
        },
      });

      return completed;
    });

    return { job };
  } catch (error) {
    console.error("Document extraction failed", { name: errorName(error) });
    const failureMessage = error instanceof DocumentProcessingError ? error.message : EXTRACTION_FAILURE_MESSAGE;

    const job = await prisma.$transaction(async (tx) => {
      const failed = await tx.extractionJob.update({
        where: { id: input.jobId },
        data: {
          status: ExtractionStatus.FAILED,
          errorMessage: failureMessage,
          completedAt: new Date(),
        },
        include: { fields: { orderBy: { createdAt: "asc" } }, attachment: { select: publicAttachmentSelect } },
      });

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "DOCUMENT_EXTRACTION_FAILED",
          entityType: "EXTRACTION_JOB",
          entityId: input.jobId,
          details: { error: EXTRACTION_FAILURE_MESSAGE },
        },
      });
      return failed;
    });

    return { error: "EXTRACTION_FAILED" as const, job };
  }
}

async function processDocumentUploadOnce(
  file: Express.Multer.File,
  actorId: string
) {
  const validation = validateDocument(file);

  if (!validation.valid || !validation.documentType) {
    return {
      statusCode: 400,
      message: validation.message || "Invalid document",
    };
  }

  let storedFilePath: string | undefined;
  let persisted = false;

  try {
    const contentHash = duplicateHash(file.buffer);
    const existingAttachment = await prisma.attachment.findFirst({
      where: { uploadedById: actorId, contentHash, rfqId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, extractionJobs: {
        where: { rfqId: null }, orderBy: { createdAt: "desc" }, take: 1,
        include: { fields: { orderBy: { createdAt: "asc" } }, attachment: { select: publicAttachmentSelect } },
      } },
    });
    const reusable = existingAttachment?.extractionJobs?.[0];
    if (reusable) {
      return { statusCode: reusable.status === ExtractionStatus.COMPLETED ? 201 : reusable.status === ExtractionStatus.FAILED ? 422 : 409,
        message: "This document is already uploaded. Its existing extraction and reviews have been retained.",
        extractionJob: reusable, duplicateOfAttachmentId: existingAttachment!.id };
    }
    const safeFileName =
      randomUUID() + "." + validation.documentType.toLowerCase();

    const storageDirectory = getDocumentStorageDirectory();
    await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
    storedFilePath = path.join(storageDirectory, safeFileName);
    await writeFile(storedFilePath, file.buffer, {
      flag: "wx",
      mode: 0o600,
    });

    const attachmentAndJob = await prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          uploadedById: actorId,
          fileName: path.basename(file.originalname.replace(/\\/g, "/")).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255),
          storagePath: storedFilePath!,
          mimeType: file.mimetype,
          fileSize: file.size,
          contentHash,
        },
      });

      const job = await tx.extractionJob.create({
        data: {
          attachmentId: attachment.id,
          status: ExtractionStatus.PROCESSING,
          provider: "LOCAL",
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "DOCUMENT_UPLOADED",
          entityType: "ATTACHMENT",
          entityId: attachment.id,
          details: {
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            mimeType: attachment.mimeType,
            contentHash,
            duplicateOfAttachmentId: existingAttachment?.id,
            extractionJobId: job.id,
            extractionMethod: "LOCAL",
          },
        },
      });

      return { attachment, job };
    });
    persisted = true;

    const extraction = await runDocumentExtraction({
      jobId: attachmentAndJob.job.id,
      buffer: file.buffer,
      documentType: validation.documentType,
      actorId,
    });

    if ("error" in extraction) {
      return {
        statusCode: 422,
        message: "Document was uploaded but extraction failed",
        extractionJobId: attachmentAndJob.job.id,
        extractionJob: extraction.job,
      };
    }

    return {
      statusCode: 201,
      message: "Document uploaded and processed successfully",
      extractionJob: extraction.job,
      duplicateOfAttachmentId: existingAttachment?.id,
    };
  } catch (error) {
    if (storedFilePath && !persisted) {
      await unlink(storedFilePath).catch(() => undefined);
    }

    console.error("Document upload error", { name: errorName(error) });
    return {
      statusCode: 500,
      message: "Unable to upload and process document",
    };
  }
}

// Coalesce simultaneous identical uploads in this process; persistent lookup above
// also reuses uploads after navigation/restart, scoped to the uploader and unlinked RFQ.
const activeUploads = new Map<string, Promise<Awaited<ReturnType<typeof processDocumentUploadOnce>>>>();
async function processDocumentUpload(file: Express.Multer.File, actorId: string) {
  const key = actorId + ":" + duplicateHash(file.buffer);
  const active = activeUploads.get(key);
  if (active) return active;
  const pending = processDocumentUploadOnce(file, actorId);
  activeUploads.set(key, pending);
  try { return await pending; } finally { activeUploads.delete(key); }
}

export const uploadAndExtractDocument = async (
  req: UploadRequest,
  res: Response
) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (!isIntakeUser(req)) {
    return res.status(403).json({
      success: false,
      message: "Only administrators and estimators can upload documents",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please upload a PDF, XLSX, or EML document",
    });
  }

  const result = await processDocumentUpload(req.file, req.user.userId);

  return res.status(result.statusCode).json({
    success: result.statusCode === 201,
    message: result.message,
    ...(result.extractionJob && { extractionJob: result.extractionJob }),
    ...(result.extractionJobId && { extractionJobId: result.extractionJobId }),
    ...(result.duplicateOfAttachmentId && {
      duplicateOfAttachmentId: result.duplicateOfAttachmentId,
    }),
  });
};

export const uploadAndExtractDocuments = async (
  req: UploadRequest,
  res: Response
) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (!isIntakeUser(req)) {
    return res.status(403).json({
      success: false,
      message: "Only administrators and estimators can upload documents",
    });
  }

  const files = req.files || [];
  if (files.length > 10) return res.status(400).json({ success: false, message: "Maximum 10 documents per upload" });

  if (files.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Please upload one or more PDF, XLSX, or EML documents",
    });
  }

  const results = [];
  for (const file of files) {
    results.push({ ...await processDocumentUpload(file, req.user.userId), fileName: path.basename(file.originalname.replace(/\\/g, "/")) });
  }

  const allSucceeded = results.every((result) => result.statusCode === 201);

  return res.status(allSucceeded ? 201 : 207).json({
    success: allSucceeded,
    message: allSucceeded
      ? "Documents uploaded and processed successfully"
      : "Some documents could not be processed",
    results: results.map((result) => ({
      statusCode: result.statusCode,
      fileName: result.fileName,
      message: result.message,
      extractionJob: result.extractionJob,
      extractionJobId: result.extractionJobId,
      duplicateOfAttachmentId: result.duplicateOfAttachmentId,
    })),
  });
};

export const retryExtractionJob = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const jobId = typeof req.params.id === "string" ? req.params.id : undefined;
  if (!jobId) {
    return res.status(400).json({
      success: false,
      message: "Extraction job ID is required",
    });
  }

  try {
    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId },
      include: {
        attachment: {
          select: {
            id: true,
            fileName: true,
            uploadedById: true,
            storagePath: true,
            mimeType: true,
          },
        },
      },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Extraction job not found",
      });
    }

    if (!canManageIntakeDocument(req.user, job.attachment.uploadedById)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this extraction job",
      });
    }

    if (job.status !== ExtractionStatus.FAILED) {
      return res.status(409).json({
        success: false,
        message: "Only failed extraction jobs can be retried",
      });
    }
    if (job.rfqId) return res.status(409).json({ success: false, message: "Linked extraction jobs cannot be retried" });

    const extension = path.extname(job.attachment.fileName || "").toLowerCase();
    const documentType: SupportedDocumentType = job.attachment.mimeType === "application/pdf" || extension === ".pdf"
      ? "PDF" : job.attachment.mimeType === "message/rfc822" || extension === ".eml" ? "EML" : "XLSX";
    const buffer = await readFile(job.attachment.storagePath);

    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.extractionJob.updateMany({
        where: { id: jobId, status: ExtractionStatus.FAILED, rfqId: null },
        data: {
          status: ExtractionStatus.PROCESSING,
          errorMessage: null,
          completedAt: null,
        },
      });
      if (claim.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "DOCUMENT_EXTRACTION_RETRIED",
          entityType: "EXTRACTION_JOB",
          entityId: jobId,
        },
      });
      return true;
    });
    if (!claimed) return res.status(409).json({ success: false, message: "This extraction is already being retried or was linked to an RFQ" });

    const extraction = await runDocumentExtraction({
      jobId,
      buffer,
      documentType,
      actorId: req.user.userId,
    });

    if ("error" in extraction) {
      return res.status(422).json({
        success: false,
        message: "Document extraction retry failed",
        extractionJobId: jobId,
        extractionJob: extraction.job,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Document extraction retried successfully",
      extractionJob: extraction.job,
    });
  } catch (error) {
    console.error("Document extraction retry error", { name: errorName(error) });
    return res.status(500).json({
      success: false,
      message: "Unable to retry document extraction",
    });
  }
};

export const getExtractionJob = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const jobId = typeof req.params.id === "string" ? req.params.id : undefined;

  if (!jobId) {
    return res.status(400).json({
      success: false,
      message: "Extraction job ID is required",
    });
  }

  try {
    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId },
      include: {
        attachment: { select: publicAttachmentSelect },
        rfq: { select: { id: true, createdById: true, assignedToId: true } },
        fields: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Extraction job not found",
      });
    }

    if (!canReadDocument(req.user, job.attachment.uploadedById, job.rfq)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this extraction job",
      });
    }

    const { rfq: _authorizationContext, ...publicJob } = job;
    return res.status(200).json({
      success: true,
      extractionJob: publicJob,
    });
  } catch (error) {
    console.error("Extraction job retrieval error", { name: errorName(error) });
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve extraction job",
    });
  }
};

const reviewFieldsSchema = z.object({
  fields: z.array(
    z.object({
      id: z.string().min(1),
      decision: z
        .enum([
          ExtractionFieldReviewStatus.ACCEPTED,
          ExtractionFieldReviewStatus.REJECTED,
        ])
        .optional(),
      acceptedValue: z.string().trim().min(1).max(2000).optional(),
      unavailable: z.boolean().optional(),
    }).superRefine((field, context) => {
      const decision =
        field.decision || ExtractionFieldReviewStatus.ACCEPTED;

      if (
        decision === ExtractionFieldReviewStatus.ACCEPTED &&
        !field.acceptedValue
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["acceptedValue"],
          message: "An accepted value is required when accepting a field",
        });
      }
      if (field.unavailable && decision !== ExtractionFieldReviewStatus.REJECTED) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Unavailable fields must be rejected" });
      }

      if (
        decision === ExtractionFieldReviewStatus.REJECTED &&
        field.acceptedValue
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["acceptedValue"],
          message: "Rejected fields cannot have an accepted value",
        });
      }
    })
  ).min(1).max(100),
});

export const reviewExtractedFields = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const jobId = typeof req.params.id === "string" ? req.params.id : undefined;

  if (!jobId) {
    return res.status(400).json({
      success: false,
      message: "Extraction job ID is required",
    });
  }

  const validation = reviewFieldsSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: "Invalid field review data",
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const fields = validation.data.fields;
  const fieldIds = fields.map((field) => field.id);

  if (new Set(fieldIds).size !== fieldIds.length) {
    return res.status(400).json({
      success: false,
      message: "Duplicate field IDs are not allowed",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.extractionJob.findUnique({
        where: { id: jobId },
        include: {
          attachment: {
            select: { uploadedById: true },
          },
        },
      });

      if (!job) return { error: "NOT_FOUND" as const };

      if (!canManageIntakeDocument(req.user!, job.attachment.uploadedById)) {
        return { error: "FORBIDDEN" as const };
      }

      if (job.status !== ExtractionStatus.COMPLETED) {
        return { error: "NOT_COMPLETED" as const };
      }
      if (job.rfqId) return { error: "LINKED" as const };

      const matchingFields = await tx.extractedField.findMany({
        where: {
          id: { in: fieldIds },
          extractionJobId: jobId,
        },
        select: {
          id: true,
          fieldName: true,
          extractedValue: true,
          acceptedValue: true,
          reviewStatus: true,
        },
      });

      if (matchingFields.length !== fieldIds.length) {
        return { error: "INVALID_FIELDS" as const };
      }

      // Validate the entire batch before writing anything.
      for (const submitted of fields) {
        const original = matchingFields.find((field) => field.id === submitted.id)!;
        if ((submitted.decision || "ACCEPTED") === "ACCEPTED" && isNumericRfqField(original.fieldName)) {
          const value = normalizeReviewedNumber(original.fieldName, submitted.acceptedValue!);
          if (!value) return { error: "INVALID_NUMBER" as const };
          submitted.acceptedValue = value;
        }
      }

      const changes = [];
      for (const submitted of fields) {
        const original = matchingFields.find(
          (field) => field.id === submitted.id
        )!;
        const decision =
          submitted.decision || ExtractionFieldReviewStatus.ACCEPTED;
        const acceptedValue =
          decision === ExtractionFieldReviewStatus.ACCEPTED
            ? submitted.acceptedValue!.trim()
            : null;

        await tx.extractedField.update({
          where: { id: submitted.id },
          data: {
            acceptedValue,
            isAccepted: decision === ExtractionFieldReviewStatus.ACCEPTED,
            reviewStatus: decision,
            reviewedAt: new Date(),
          },
        });

        changes.push({
          fieldId: original.id,
          fieldName: original.fieldName,
          extractedValue: original.extractedValue,
          previousAcceptedValue: original.acceptedValue,
          previousReviewStatus: original.reviewStatus,
          decision,
          unavailable: submitted.unavailable || false,
          acceptedValue,
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "DOCUMENT_FIELDS_REVIEWED",
          entityType: "EXTRACTION_JOB",
          entityId: jobId,
          details: {
            reviewedCount: changes.length,
            changes,
          },
        },
      });

      return {
        job: await tx.extractionJob.findUnique({
          where: { id: jobId },
          include: {
            attachment: { select: publicAttachmentSelect },
            fields: { orderBy: { createdAt: "asc" } },
          },
        }),
      };
    });

    if ("error" in result) {
      if (result.error === "LINKED") return res.status(409).json({ success: false, message: "Reviews linked to an RFQ are read-only" });
      if (result.error === "INVALID_NUMBER") return res.status(400).json({ success: false, message: "Enter a positive number in the displayed unit; annual volume must be a whole number" });
      if (result.error === "NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Extraction job not found",
        });
      }

      if (result.error === "FORBIDDEN") {
        return res.status(403).json({
          success: false,
          message: "You do not have access to this extraction job",
        });
      }

      if (result.error === "NOT_COMPLETED") {
        return res.status(409).json({
          success: false,
          message: "Only completed extraction jobs can be reviewed",
        });
      }

      return res.status(400).json({
        success: false,
        message: "One or more fields do not belong to this extraction job",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Extracted fields reviewed successfully",
      extractionJob: result.job,
    });
  } catch (error) {
    console.error("Extracted field review error", { name: errorName(error) });
    return res.status(500).json({
      success: false,
      message: "Unable to review extracted fields",
    });
  }
};
