import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  attachmentFindFirst: vi.fn(),
  attachmentCreate: vi.fn(),
  extractionJobCreate: vi.fn(),
  extractionJobFindUnique: vi.fn(),
  extractionJobUpdate: vi.fn(),
  extractionJobUpdateMany: vi.fn(),
  extractedFieldCreateMany: vi.fn(),
  extractedFieldFindMany: vi.fn(),
  extractedFieldUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  extractDocumentContent: vi.fn(),
  extractSupplementaryRfqSuggestions: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    $transaction: mocks.transaction,
    attachment: {
      findFirst: mocks.attachmentFindFirst,
    },
    extractionJob: {
      findUnique: mocks.extractionJobFindUnique,
    },
  },
}));

vi.mock("../services/rfq-document-extraction.service.js", () => ({
  extractDocumentContent: mocks.extractDocumentContent,
  DocumentProcessingError: class extends Error {},
}));

vi.mock("../services/ollama-rfq-extraction.service.js", () => ({
  extractSupplementaryRfqSuggestions:
    mocks.extractSupplementaryRfqSuggestions,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  unlink: mocks.unlink,
}));

import {
  getDocumentStorageDirectory,
  getExtractionJob,
  retryExtractionJob,
  reviewExtractedFields,
  uploadAndExtractDocument,
  uploadAndExtractDocuments,
} from "./document-intake.controller.js";

const deterministicCandidates = [
  {
    fieldName: "rfqNumber",
    extractedValue: "RFQ-LOCAL-001",
    confidence: 0.9,
    sourceReference: "PDF selectable text",
    sourceId: "pdf-selectable-text-1",
    evidenceText: "RFQ No: RFQ-LOCAL-001",
    extractionMethod: "DETERMINISTIC",
    groupKey: "document:pdf-selectable-text",
  },
  {
    fieldName: "partName",
    extractedValue: "Rear Wheel Spindle",
    confidence: 0.8,
    sourceReference: "PDF selectable text",
    sourceId: "pdf-selectable-text-1",
    evidenceText: "Part Name: Rear Wheel Spindle",
    extractionMethod: "DETERMINISTIC",
    groupKey: "document:pdf-selectable-text",
  },
];

const textSources = [
  {
    sourceId: "pdf-selectable-text-1",
    sourceReference: "PDF selectable text",
    text: "Material Grade: EN8",
    groupKey: "document:pdf-selectable-text",
  },
];

function createResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };

  response.status.mockReturnValue(response);

  return response;
}

function createRequest() {
  const buffer = Buffer.from("%PDF-1.4 customer RFQ");

  return {
    user: {
      userId: "user-1",
      role: "ESTIMATOR",
    },
    file: {
      originalname: "customer-rfq.pdf",
      mimetype: "application/pdf",
      size: buffer.length,
      buffer,
    },
  };
}

function configureTransactions() {
  const tx = {
    attachment: {
      create: mocks.attachmentCreate,
    },
    extractionJob: {
      create: mocks.extractionJobCreate,
      findUnique: mocks.extractionJobFindUnique,
      update: mocks.extractionJobUpdate,
      updateMany: mocks.extractionJobUpdateMany,
    },
    extractedField: {
      createMany: mocks.extractedFieldCreateMany,
      findMany: mocks.extractedFieldFindMany,
      update: mocks.extractedFieldUpdate,
    },
    auditLog: {
      create: mocks.auditLogCreate,
    },
  };

  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  mocks.attachmentCreate.mockResolvedValue({
    id: "attachment-1",
    fileName: "customer-rfq.pdf",
    mimeType: "application/pdf",
    fileSize: 24,
  });
  mocks.extractionJobCreate.mockResolvedValue({ id: "job-1" });
  mocks.extractionJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.extractionJobUpdate.mockResolvedValue({
    id: "job-1",
    status: "COMPLETED",
    fields: [],
    attachment: {
      id: "attachment-1",
      fileName: "customer-rfq.pdf",
      mimeType: "application/pdf",
      fileSize: 24,
      createdAt: new Date(),
    },
  });
}

describe("document intake local AI integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureTransactions();
    mocks.attachmentFindFirst.mockResolvedValue(null);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.extractDocumentContent.mockResolvedValue({
      candidates: deterministicCandidates,
      textSources,
    });
  });

  it("saves validated AI suggestions only after deterministic candidates", async () => {
    mocks.extractSupplementaryRfqSuggestions.mockResolvedValue({
      inferenceMetrics: {
        modelLoadDurationMs: 64_350,
        promptEvaluationDurationMs: 1_234.57,
        generationDurationMs: 2_345.68,
        promptTokenCount: 840,
        generatedTokenCount: 176,
      },
      suggestions: [
        {
          fieldName: "materialGrade",
          extractedValue: "EN8",
          evidenceText: "Material Grade: EN8",
          sourceId: "pdf-selectable-text-1",
          sourceReference: "PDF selectable text",
          groupKey: "document:pdf-selectable-text",
          confidence: 0.88,
          requiresHumanReview: true,
        },
      ],
    });
    const req = createRequest();
    const res = createResponse();

    await uploadAndExtractDocument(req as any, res as any);

    expect(mocks.extractSupplementaryRfqSuggestions).toHaveBeenCalledWith(
      textSources,
      deterministicCandidates
    );
    expect(mocks.extractedFieldCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fieldName: "rfqNumber",
          extractedValue: "RFQ-LOCAL-001",
          sourceReference: "PDF selectable text",
        }),
        expect.objectContaining({
          fieldName: "partName",
          extractedValue: "Rear Wheel Spindle",
          sourceReference: "PDF selectable text",
        }),
        expect.objectContaining({
          fieldName: "materialGrade",
          extractedValue: "EN8",
          confidence: 0.88,
          sourceReference: "PDF selectable text",
          sourceId: "pdf-selectable-text-1",
          evidenceText: "Material Grade: EN8",
          extractionMethod: "LOCAL_OLLAMA",
          groupKey: "document:pdf-selectable-text",
          reviewStatus: "PENDING",
        }),
      ],
    });
    expect(mocks.extractionJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "LOCAL_OLLAMA",
        }),
      })
    );
    expect(mocks.auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DOCUMENT_EXTRACTION_COMPLETED",
          details: expect.objectContaining({
            aiInferenceMetrics: {
              modelLoadDurationMs: 64_350,
              promptEvaluationDurationMs: 1_234.57,
              generationDurationMs: 2_345.68,
              promptTokenCount: 840,
              generatedTokenCount: 176,
            },
          }),
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("completes deterministic intake when local Ollama is unavailable", async () => {
    mocks.extractSupplementaryRfqSuggestions.mockResolvedValue({
      suggestions: [],
      failureReason: "UNAVAILABLE",
    });
    const req = createRequest();
    const res = createResponse();

    await uploadAndExtractDocument(req as any, res as any);

    expect(mocks.extractedFieldCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ fieldName: "rfqNumber" }),
        expect.objectContaining({ fieldName: "partName" }),
      ]),
    });
    expect(
      mocks.extractedFieldCreateMany.mock.calls[0]?.[0].data
    ).toHaveLength(deterministicCandidates.length);
    expect(mocks.extractionJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "LOCAL",
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("falls back to deterministic candidates if the AI service throws", async () => {
    mocks.extractSupplementaryRfqSuggestions.mockRejectedValue(
      new Error("local AI unavailable")
    );
    const req = createRequest();
    const res = createResponse();

    await uploadAndExtractDocument(req as any, res as any);

    expect(
      mocks.extractedFieldCreateMany.mock.calls[0]?.[0].data
    ).toEqual(
      deterministicCandidates.map((candidate) =>
        expect.objectContaining({
          fieldName: candidate.fieldName,
          extractedValue: candidate.extractedValue,
        })
      )
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.status).not.toHaveBeenCalledWith(422);
  });

  it("stores and returns a stable extraction failure message instead of parser details", async () => {
    const parserError = new Error("parser failed reading /tmp/private-customer-drawing.pdf");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.extractDocumentContent.mockRejectedValue(parserError);
    const req = createRequest();
    const res = createResponse();

    try {
      await uploadAndExtractDocument(req as any, res as any);

      expect(mocks.extractionJobUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            errorMessage: "Unable to extract document content",
          }),
        })
      );
      expect(mocks.auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: { error: "Unable to extract document content" },
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(422);
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
        "/tmp/private-customer-drawing.pdf"
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("uses deterministic extraction only when local AI is not explicitly enabled in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalLocalAiEnabled = process.env.LOCAL_AI_ENABLED;
    process.env.NODE_ENV = "production";
    delete process.env.LOCAL_AI_ENABLED;

    try {
      const req = createRequest();
      const res = createResponse();

      await uploadAndExtractDocument(req as any, res as any);

      expect(mocks.extractSupplementaryRfqSuggestions).not.toHaveBeenCalled();
      expect(mocks.extractedFieldCreateMany).toHaveBeenCalledWith({
        data: deterministicCandidates.map((candidate) =>
          expect.objectContaining({
            fieldName: candidate.fieldName,
            extractedValue: candidate.extractedValue,
            extractionMethod: "DETERMINISTIC",
          })
        ),
      });
      expect(mocks.extractionJobUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider: "LOCAL" }),
        })
      );
      expect(mocks.auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: expect.objectContaining({ aiFailureReason: "DISABLED" }),
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }

      if (originalLocalAiEnabled === undefined) {
        delete process.env.LOCAL_AI_ENABLED;
      } else {
        process.env.LOCAL_AI_ENABLED = originalLocalAiEnabled;
      }
    }
  });

  it("uses a configured persistent document storage directory", () => {
    const previousDirectory = process.env.RFQ_DOCUMENT_STORAGE_DIR;
    process.env.RFQ_DOCUMENT_STORAGE_DIR = "/var/lib/rfq/documents";

    try {
      expect(getDocumentStorageDirectory()).toBe("/var/lib/rfq/documents");
    } finally {
      if (previousDirectory === undefined) {
        delete process.env.RFQ_DOCUMENT_STORAGE_DIR;
      } else {
        process.env.RFQ_DOCUMENT_STORAGE_DIR = previousDirectory;
      }
    }
  });
});

describe("document intake review and ownership safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureTransactions();
    mocks.attachmentFindFirst.mockResolvedValue(null);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.extractDocumentContent.mockResolvedValue({
      candidates: deterministicCandidates,
      textSources,
    });
    mocks.extractSupplementaryRfqSuggestions.mockResolvedValue({
      suggestions: [],
    });
  });

  it("processes multiple documents and reports a duplicate without blocking reuse", async () => {
    const first = createRequest().file!;
    const second = {
      ...first,
      originalname: "repeat-rfq.pdf",
    };
    mocks.attachmentFindFirst
      .mockResolvedValueOnce({ id: "existing-attachment" })
      .mockResolvedValueOnce(null);
    mocks.attachmentCreate
      .mockResolvedValueOnce({
        id: "attachment-1",
        fileName: first.originalname,
        mimeType: first.mimetype,
        fileSize: first.size,
      })
      .mockResolvedValueOnce({
        id: "attachment-2",
        fileName: second.originalname,
        mimeType: second.mimetype,
        fileSize: second.size,
      });
    mocks.extractionJobCreate
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-2" });
    mocks.extractionJobUpdate
      .mockResolvedValueOnce({
        id: "job-1",
        status: "COMPLETED",
        fields: [],
        attachment: { id: "attachment-1", fileName: first.originalname },
      })
      .mockResolvedValueOnce({
        id: "job-2",
        status: "COMPLETED",
        fields: [],
        attachment: { id: "attachment-2", fileName: second.originalname },
      });

    const req = {
      user: { userId: "user-1", role: "ESTIMATOR" },
      files: [first, second],
    };
    const res = createResponse();

    await uploadAndExtractDocuments(req as any, res as any);

    expect(mocks.attachmentCreate).toHaveBeenCalledTimes(2);
    expect(mocks.attachmentFindFirst).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        results: expect.arrayContaining([
          expect.objectContaining({
            duplicateOfAttachmentId: "existing-attachment",
          }),
        ]),
      })
    );
  });

  it("creates private storage and writes uploads with owner-only file permissions", async () => {
    const req = createRequest();
    const res = createResponse();

    await uploadAndExtractDocument(req as any, res as any);

    expect(mocks.mkdir).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true, mode: 0o700 }
    );
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      req.file!.buffer,
      { flag: "wx", mode: 0o600 }
    );
  });

  it("rejects malformed documents before storing an attachment", async () => {
    const req = createRequest();
    req.file = {
      ...req.file!,
      buffer: Buffer.from("not a PDF"),
      size: 9,
    };
    const res = createResponse();

    await uploadAndExtractDocument(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rejects malformed XLSX archives before storing an attachment", async () => {
    const req = createRequest();
    req.file = {
      ...req.file!,
      originalname: "invalid.xlsx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      size: 4,
    };
    const res = createResponse();

    await uploadAndExtractDocument(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ["ADMIN", "admin", true], ["ESTIMATOR", "uploader", true],
    ["ESTIMATOR", "creator", true], ["ESTIMATOR", "owner", true],
    ["ESTIMATOR", "unrelated", false], ["PLANT_HEAD", "technical", true],
    ["SALES_HEAD", "uploader", false], ["UNKNOWN", "uploader", false],
  ])("linked extraction access matches RFQ policy for %s %s", async (role, userId, allowed) => {
    mocks.extractionJobFindUnique.mockResolvedValue({ id: "job-1", rfqId: "rfq-1",
      rfq: { id: "rfq-1", createdById: "creator", assignedToId: "owner" },
      attachment: { uploadedById: "uploader", fileName: "SECRET-drawing.pdf" },
      fields: [{ extractedValue: "SECRET-value", evidenceText: "SECRET-evidence", sourceReference: "SECRET-provenance" }],
    });
    const res = createResponse();
    await getExtractionJob({ user: { role, userId }, params: { id: "job-1" } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(allowed ? 200 : 403);
    expect(JSON.stringify(res.json.mock.calls).includes("SECRET")).toBe(allowed);
    if (allowed) expect(res.json.mock.calls[0][0].extractionJob.rfq).toBeUndefined();
    expect(mocks.extractionJobFindUnique.mock.calls[0][0].include.attachment.select.storagePath).toBeUndefined();
  });
  it("denies Plant Head access to unlinked intake documents", async () => {
    mocks.extractionJobFindUnique.mockResolvedValue({ id: "job-1", rfq: null, attachment: { uploadedById: "uploader" }, fields: [{ evidenceText: "SECRET" }] });
    const res = createResponse();
    await getExtractionJob({ user: { role: "PLANT_HEAD", userId: "technical" }, params: { id: "job-1" } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403); expect(JSON.stringify(res.json.mock.calls)).not.toContain("SECRET");
  });

  it("does not expose another estimator's extraction job", async () => {
    mocks.extractionJobFindUnique.mockResolvedValue({
      id: "job-other",
      attachment: {
        id: "attachment-other",
        uploadedById: "another-estimator",
        fileName: "private.pdf",
        storagePath: "/private/path.pdf",
      },
      fields: [],
    });
    const req = {
      user: { userId: "user-1", role: "ESTIMATOR" },
      params: { id: "job-other" },
    };
    const res = createResponse();

    await getExtractionJob(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "You do not have access to this extraction job",
      })
    );
  });

  it("persists accept, edit, and reject decisions with an audit event", async () => {
    const job = {
      id: "job-1",
      status: "COMPLETED",
      attachment: { uploadedById: "user-1" },
    };
    mocks.extractionJobFindUnique
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({
        ...job,
        attachment: { id: "attachment-1", fileName: "customer-rfq.pdf" },
        fields: [],
      });
    mocks.extractedFieldFindMany.mockResolvedValue([
      {
        id: "field-accept",
        fieldName: "partName",
        extractedValue: "Spindle",
        acceptedValue: "Spindle",
        reviewStatus: "PENDING",
      },
      {
        id: "field-reject",
        fieldName: "revision",
        extractedValue: "A",
        acceptedValue: null,
        reviewStatus: "PENDING",
      },
    ]);

    const req = {
      user: { userId: "user-1", role: "ESTIMATOR" },
      params: { id: "job-1" },
      body: {
        fields: [
          {
            id: "field-accept",
            decision: "ACCEPTED",
            acceptedValue: "Rear Wheel Spindle - revised",
          },
          { id: "field-reject", decision: "REJECTED" },
        ],
      },
    };
    const res = createResponse();

    await reviewExtractedFields(req as any, res as any);

    expect(mocks.extractedFieldUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "field-accept" },
        data: expect.objectContaining({
          acceptedValue: "Rear Wheel Spindle - revised",
          isAccepted: true,
          reviewStatus: "ACCEPTED",
        }),
      })
    );
    expect(mocks.extractedFieldUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "field-reject" },
        data: expect.objectContaining({
          acceptedValue: null,
          isAccepted: false,
          reviewStatus: "REJECTED",
        }),
      })
    );
    expect(mocks.auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DOCUMENT_FIELDS_REVIEWED",
          details: expect.objectContaining({ reviewedCount: 2 }),
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("blocks review of a document owned by another estimator", async () => {
    mocks.extractionJobFindUnique.mockResolvedValue({
      id: "job-other",
      status: "COMPLETED",
      attachment: { uploadedById: "another-estimator" },
    });
    const req = {
      user: { userId: "user-1", role: "ESTIMATOR" },
      params: { id: "job-other" },
      body: {
        fields: [{
          id: "field-1",
          decision: "ACCEPTED",
          acceptedValue: "Value",
        }],
      },
    };
    const res = createResponse();

    await reviewExtractedFields(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocks.extractedFieldFindMany).not.toHaveBeenCalled();
    expect(mocks.extractedFieldUpdate).not.toHaveBeenCalled();
  });

  it("denies upload to non-intake roles", async () => {
    const req = {
      ...createRequest(),
      user: { userId: "sales-1", role: "SALES_HEAD" },
    };
    const res = createResponse();

    await uploadAndExtractDocument(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
  });

  it("retries a failed extraction owned by the estimator", async () => {
    mocks.extractionJobFindUnique.mockResolvedValue({
      id: "job-failed",
      status: "FAILED",
      attachment: {
        id: "attachment-1",
        uploadedById: "user-1",
        storagePath: "/private/rfq.pdf",
        mimeType: "application/pdf",
      },
    });
    mocks.readFile.mockResolvedValue(Buffer.from("%PDF-1.4 retry"));
    mocks.extractionJobUpdate.mockResolvedValue({
      id: "job-failed",
      status: "COMPLETED",
      fields: [],
      attachment: {
        id: "attachment-1",
        fileName: "customer-rfq.pdf",
        mimeType: "application/pdf",
        fileSize: 24,
        createdAt: new Date(),
      },
    });
    const req = {
      user: { userId: "user-1", role: "ESTIMATOR" },
      params: { id: "job-failed" },
    };
    const res = createResponse();

    await retryExtractionJob(req as any, res as any);

    expect(mocks.readFile).toHaveBeenCalledWith("/private/rfq.pdf");
    expect(mocks.extractionJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-failed", status: "FAILED", rfqId: null },
        data: expect.objectContaining({
          status: "PROCESSING",
          errorMessage: null,
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("reuses a duplicate's saved fields without filesystem writes or AI reprocessing", async () => {
    const existing = { id: "job-saved", status: "COMPLETED", fields: [{ id: "saved-field", reviewStatus: "ACCEPTED", acceptedValue: "EN8" }] };
    mocks.attachmentFindFirst.mockResolvedValue({ id: "attachment-saved", extractionJobs: [existing] });
    const req = createRequest();
    const res = createResponse();
    await uploadAndExtractDocument(req as unknown as Parameters<typeof uploadAndExtractDocument>[0], res as unknown as Parameters<typeof uploadAndExtractDocument>[1]);
    expect(mocks.attachmentFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ uploadedById: "user-1", rfqId: null }) }));
    expect(mocks.extractDocumentContent).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ extractionJob: existing }));
  });

  it("returns a duplicate failed job for its safe retry action without replacing its audit or reviews", async () => {
    const existing = {
      id: "job-failed",
      status: "FAILED",
      errorMessage: "Unable to extract document content",
      fields: [{ id: "review-1", reviewStatus: "REJECTED", acceptedValue: null, isAccepted: false }],
      attachment: { id: "attachment-failed", fileName: "synthetic.xlsx" },
    };
    mocks.attachmentFindFirst.mockResolvedValue({
      id: "attachment-failed",
      extractionJobs: [existing],
    });
    const res = createResponse();

    await uploadAndExtractDocument(
      createRequest() as unknown as Parameters<typeof uploadAndExtractDocument>[0],
      res as unknown as Parameters<typeof uploadAndExtractDocument>[1]
    );

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      extractionJob: existing,
      duplicateOfAttachmentId: "attachment-failed",
    }));
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
    expect(mocks.extractionJobCreate).not.toHaveBeenCalled();
    expect(mocks.extractDocumentContent).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("returns failed jobs as retryable cards and retains their stored upload", async () => {
    mocks.extractDocumentContent.mockRejectedValue(new Error("private parser details"));
    mocks.extractionJobUpdate.mockResolvedValue({ id: "failed-1", status: "FAILED", fields: [], attachment: { fileName: "test.pdf" } });
    const res = createResponse();
    await uploadAndExtractDocument(createRequest() as unknown as Parameters<typeof uploadAndExtractDocument>[0], res as unknown as Parameters<typeof uploadAndExtractDocument>[1]);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ extractionJob: expect.objectContaining({ status: "FAILED" }) }));
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous duplicate upload requests", async () => {
    const first = createResponse(); const second = createResponse();
    await Promise.all([first, second].map((res) => uploadAndExtractDocument(createRequest() as unknown as Parameters<typeof uploadAndExtractDocument>[0], res as unknown as Parameters<typeof uploadAndExtractDocument>[1])));
    expect(mocks.attachmentCreate).toHaveBeenCalledTimes(1);
    expect(mocks.extractDocumentContent).toHaveBeenCalledTimes(1);
    expect(first.json.mock.calls[0]?.[0].extractionJob).toEqual(second.json.mock.calls[0]?.[0].extractionJob);
  });

  it("blocks a competing retry before extraction and audit creation", async () => {
    mocks.extractionJobFindUnique.mockResolvedValue({ id: "job-1", status: "FAILED", attachment: { uploadedById: "user-1", storagePath: "/private/rfq.pdf", mimeType: "application/pdf" } });
    mocks.extractionJobUpdateMany.mockResolvedValue({ count: 0 });
    const res = createResponse();
    await retryExtractionJob({ user: { userId: "user-1", role: "ESTIMATOR" }, params: { id: "job-1" } } as unknown as Parameters<typeof retryExtractionJob>[0], res as unknown as Parameters<typeof retryExtractionJob>[1]);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.extractDocumentContent).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("validates numeric reviews before updating any field in the batch", async () => {
    mocks.extractionJobFindUnique.mockResolvedValue({ id: "job-1", status: "COMPLETED", attachment: { uploadedById: "user-1" } });
    mocks.extractedFieldFindMany.mockResolvedValue([{ id: "name", fieldName: "partName" }, { id: "volume", fieldName: "annualVolume" }]);
    const res = createResponse();
    await reviewExtractedFields({ user: { userId: "user-1", role: "ESTIMATOR" }, params: { id: "job-1" }, body: { fields: [
      { id: "name", decision: "ACCEPTED", acceptedValue: "Test part" }, { id: "volume", decision: "ACCEPTED", acceptedValue: "12.5" },
    ] } } as unknown as Parameters<typeof reviewExtractedFields>[0], res as unknown as Parameters<typeof reviewExtractedFields>[1]);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.extractedFieldUpdate).not.toHaveBeenCalled();
  });

  it("keeps reviews already linked to an RFQ read-only", async () => {
    mocks.extractionJobFindUnique.mockResolvedValue({ id: "job-1", rfqId: "rfq-existing", status: "COMPLETED", attachment: { uploadedById: "user-1" } });
    const res = createResponse();
    await reviewExtractedFields({ user: { userId: "user-1", role: "ESTIMATOR" }, params: { id: "job-1" }, body: { fields: [{ id: "field-1", decision: "REJECTED" }] } } as unknown as Parameters<typeof reviewExtractedFields>[0], res as unknown as Parameters<typeof reviewExtractedFields>[1]);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.extractedFieldUpdate).not.toHaveBeenCalled();
  });

  it.each(["oversize", "legacy-xls"])("rejects %s input before processing", async (kind) => {
    const req = createRequest();
    if (kind === "oversize") req.file.size = 10 * 1024 * 1024 + 1;
    else { req.file.originalname = "parts.xls"; req.file.mimetype = "application/vnd.ms-excel"; }
    const res = createResponse();
    await uploadAndExtractDocument(req as unknown as Parameters<typeof uploadAndExtractDocument>[0], res as unknown as Parameters<typeof uploadAndExtractDocument>[1]);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
  });

  it("accepts an authenticated .eml through the existing private extraction pipeline", async () => {
    const req = createRequest();
    req.file.originalname = "customer-rfq.eml";
    req.file.mimetype = "message/rfc822";
    req.file.buffer = Buffer.from("From: buyer@example.in\r\nSubject: RFQ\r\n\r\nRFQ No: RFQ-1");
    req.file.size = req.file.buffer.length;
    const res = createResponse();
    await uploadAndExtractDocument(req as any, res as any);
    expect(mocks.extractDocumentContent).toHaveBeenCalledWith(req.file.buffer, "EML");
    expect(mocks.attachmentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fileName: "customer-rfq.eml", mimeType: "message/rfc822" }) }));
    expect(mocks.extractedFieldCreateMany).toHaveBeenCalled();
    expect(mocks.extractedFieldCreateMany.mock.calls[0]?.[0].data).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewStatus: "PENDING", isAccepted: false, extractionMethod: "DETERMINISTIC" }),
    ]));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects malformed EML before persisting or extracting it", async () => {
    const req = createRequest();
    req.file.originalname = "malformed.eml";
    req.file.mimetype = "message/rfc822";
    req.file.buffer = Buffer.from("not an email");
    req.file.size = req.file.buffer.length;
    const res = createResponse();
    await uploadAndExtractDocument(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
    expect(mocks.extractDocumentContent).not.toHaveBeenCalled();
  });

  it("denies Plant Head email upload before persistence", async () => {
    const req = createRequest();
    req.user.role = "PLANT_HEAD";
    req.file.originalname = "customer-rfq.eml";
    req.file.mimetype = "message/rfc822";
    req.file.buffer = Buffer.from("From: buyer@example.in\r\n\r\nRFQ No: RFQ-1");
    req.file.size = req.file.buffer.length;
    const res = createResponse();
    await uploadAndExtractDocument(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
    expect(mocks.extractDocumentContent).not.toHaveBeenCalled();
  });

});
