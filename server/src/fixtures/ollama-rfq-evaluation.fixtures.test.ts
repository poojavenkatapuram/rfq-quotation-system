import { describe, expect, it } from "vitest";
import {
  OLLAMA_RFQ_EVALUATION_CASES,
  RFQ_EVALUATION_FIELD_NAMES,
} from "./ollama-rfq-evaluation.fixtures.js";

describe("Ollama RFQ evaluation fixtures", () => {
  it("covers all supported fields across ten realistic synthetic cases", () => {
    const coveredFields = new Set(
      OLLAMA_RFQ_EVALUATION_CASES.flatMap((evaluationCase) =>
        evaluationCase.labels.map((label) => label.fieldName)
      )
    );

    expect(OLLAMA_RFQ_EVALUATION_CASES).toHaveLength(10);
    expect([...coveredFields].sort()).toEqual([...RFQ_EVALUATION_FIELD_NAMES].sort());
    expect(
      OLLAMA_RFQ_EVALUATION_CASES.reduce(
        (total, evaluationCase) => total + evaluationCase.labels.length,
        0
      )
    ).toBe(45);
  });

  it("keeps multi-row, multi-attachment, conflict, ambiguity, and injection cases explicit", () => {
    const casesById = new Map(
      OLLAMA_RFQ_EVALUATION_CASES.map((evaluationCase) => [
        evaluationCase.id,
        evaluationCase,
      ])
    );

    expect(casesById.get("multi-row-excel")?.textSources).toHaveLength(2);
    expect(casesById.get("multiple-attachments")?.textSources).toHaveLength(2);
    expect(casesById.get("cross-document-conflict")?.labels).toHaveLength(2);
    expect(casesById.get("ambiguous-values")?.labels).toEqual([]);
    expect(casesById.get("no-supported-data")?.labels).toEqual([]);
  });
});
