import {
  OLLAMA_RFQ_EVALUATION_CASES,
  type RfqEvaluationLabel,
} from "../src/fixtures/ollama-rfq-evaluation.fixtures.js";
import {
  extractSupplementaryRfqSuggestions,
  getOllamaRfqModel,
  type OllamaValidationDiagnostics,
} from "../src/services/ollama-rfq-extraction.service.js";

type CaseResult = {
  id: string;
  elapsedMs: number;
  failureReason?: string;
  expectedCount: number;
  acceptedCount: number;
  correctCount: number;
  acceptedSuggestions: Array<{
    sourceId: string;
    fieldName: RfqEvaluationLabel["fieldName"];
    extractedValue: string;
    evidenceText: string;
  }>;
  incorrectSuggestions: Array<{
    sourceId: string;
    fieldName: RfqEvaluationLabel["fieldName"];
    extractedValue: string;
    evidenceText: string;
  }>;
  diagnostics?: OllamaValidationDiagnostics;
};

type FieldMetric = {
  expectedCount: number;
  acceptedCount: number;
  correctCount: number;
  precisionPercent: number;
  recallPercent: number;
  exactMatchAccuracyPercent: number;
};

const keyFor = (value: Pick<RfqEvaluationLabel, "sourceId" | "fieldName">) =>
  value.sourceId + ":" + value.fieldName;

const percentage = (numerator: number, denominator: number) =>
  denominator === 0 ? 100 : Number(((numerator / denominator) * 100).toFixed(2));

async function main(): Promise<void> {
const results: CaseResult[] = [];

for (const evaluationCase of OLLAMA_RFQ_EVALUATION_CASES) {
  const supplementaryLabels = evaluationCase.labels.filter((label) =>
    !evaluationCase.deterministicCandidates.some(
      (candidate) => keyFor(candidate) === keyFor(label),
    ),
  );
  const expectedByKey = new Map(
    supplementaryLabels.map((label) => [keyFor(label), label.value]),
  );
  const startedAt = Date.now();
  const result = await extractSupplementaryRfqSuggestions(
    evaluationCase.textSources,
    evaluationCase.deterministicCandidates,
    { includeDiagnostics: true },
  );
  const correct = result.suggestions.filter(
    (suggestion) =>
      expectedByKey.get(keyFor(suggestion)) === suggestion.extractedValue,
  );
  const incorrect = result.suggestions
    .filter(
      (suggestion) =>
        expectedByKey.get(keyFor(suggestion)) !== suggestion.extractedValue,
    )
    .map((suggestion) => ({
      sourceId: suggestion.sourceId,
      fieldName: suggestion.fieldName,
      extractedValue: suggestion.extractedValue,
      evidenceText: suggestion.evidenceText,
    }));

  results.push({
    id: evaluationCase.id,
    elapsedMs: Date.now() - startedAt,
    failureReason: result.failureReason,
    expectedCount: supplementaryLabels.length,
    acceptedCount: result.suggestions.length,
    correctCount: correct.length,
    acceptedSuggestions: result.suggestions.map((suggestion) => ({
      sourceId: suggestion.sourceId,
      fieldName: suggestion.fieldName,
      extractedValue: suggestion.extractedValue,
      evidenceText: suggestion.evidenceText,
    })),
    incorrectSuggestions: incorrect,
    diagnostics: result.diagnostics,
  });
}

const expectedCount = results.reduce((total, result) => total + result.expectedCount, 0);
const datasetLabelledFieldCount = OLLAMA_RFQ_EVALUATION_CASES.reduce(
  (total, evaluationCase) => total + evaluationCase.labels.length,
  0,
);
const acceptedCount = results.reduce((total, result) => total + result.acceptedCount, 0);
const correctCount = results.reduce((total, result) => total + result.correctCount, 0);
const rawSuggestionCount = results.reduce(
  (total, result) => total + (result.diagnostics?.rawSuggestionCount ?? 0),
  0,
);
const rejectedSuggestionCount = results.reduce(
  (total, result) => total + (result.diagnostics?.rejectedSuggestionCount ?? 0),
  0,
);
const evidenceGroundedCount = results.reduce(
  (total, result) => total + (result.diagnostics?.strictlyValidatedSuggestionCount ?? 0),
  0,
);
const suppressedCount = results.reduce(
  (total, result) => total + (result.diagnostics?.suppressedDeterministicSuggestionCount ?? 0),
  0,
);
const failureCount = results.filter((result) => result.failureReason).length;
const timeoutCount = results.filter(
  (result) => result.failureReason === "TIMEOUT"
).length;
const elapsedTimes = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
const meanLatencyMs = Math.round(
  results.reduce((total, result) => total + result.elapsedMs, 0) / results.length
);
const percentileLatencyMs = (percentile: number) => {
  if (elapsedTimes.length === 0) return 0;
  const index = Math.min(
    elapsedTimes.length - 1,
    Math.ceil((percentile / 100) * elapsedTimes.length) - 1
  );
  return elapsedTimes[index];
};
const fieldNames = new Set<string>();
const perFieldCounts = new Map<
  string,
  Pick<FieldMetric, "expectedCount" | "acceptedCount" | "correctCount">
>();

for (const evaluationCase of OLLAMA_RFQ_EVALUATION_CASES) {
  for (const label of evaluationCase.labels) fieldNames.add(label.fieldName);
}
for (const result of results) {
  const evaluationCase = OLLAMA_RFQ_EVALUATION_CASES.find(
    (candidate) => candidate.id === result.id
  )!;
  const expectedLabels = evaluationCase.labels.filter(
    (label) =>
      !evaluationCase.deterministicCandidates.some(
        (candidate) => keyFor(candidate) === keyFor(label)
      )
  );
  const expectedByKey = new Map(
    expectedLabels.map((label) => [keyFor(label), label.value])
  );
  for (const label of expectedLabels) {
    const count = perFieldCounts.get(label.fieldName) ?? {
      expectedCount: 0,
      acceptedCount: 0,
      correctCount: 0,
    };
    count.expectedCount += 1;
    perFieldCounts.set(label.fieldName, count);
  }

  for (const suggestion of result.acceptedSuggestions) {
    fieldNames.add(suggestion.fieldName);
    const expectedValue = expectedByKey.get(keyFor(suggestion));
    const count = perFieldCounts.get(suggestion.fieldName) ?? {
      expectedCount: 0,
      acceptedCount: 0,
      correctCount: 0,
    };
    count.acceptedCount += 1;
    if (expectedValue === suggestion.extractedValue) {
      count.correctCount += 1;
    }
    perFieldCounts.set(suggestion.fieldName, count);
  }
}

const perFieldMetrics = Object.fromEntries(
  [...fieldNames].sort().map((fieldName) => {
    const count = perFieldCounts.get(fieldName) ?? {
      expectedCount: 0,
      acceptedCount: 0,
      correctCount: 0,
    };
    const metric: FieldMetric = {
      ...count,
      precisionPercent: percentage(count.correctCount, count.acceptedCount),
      recallPercent: percentage(count.correctCount, count.expectedCount),
      exactMatchAccuracyPercent: percentage(count.correctCount, count.expectedCount),
    };
    return [fieldName, metric];
  })
);

console.log(JSON.stringify({
  model: getOllamaRfqModel(),
  endpoint: "http://127.0.0.1:11434/api/generate",
  caseCount: results.length,
  datasetLabelledFieldCount,
  supplementaryTargetFieldCount: expectedCount,
  metrics: {
    precisionPercent: percentage(correctCount, acceptedCount),
    recallPercent: percentage(correctCount, expectedCount),
    fieldExactMatchAccuracyPercent: percentage(correctCount, expectedCount),
    invalidSuggestionRatePercent: percentage(rejectedSuggestionCount, rawSuggestionCount),
    evidenceGroundingAccuracyPercent: percentage(evidenceGroundedCount, acceptedCount + suppressedCount),
    rawSuggestionCount,
    acceptedSuggestionCount: acceptedCount,
    correctSuggestionCount: correctCount,
    suppressedDeterministicSuggestionCount: suppressedCount,
    failureRatePercent: percentage(failureCount, results.length),
    timeoutRatePercent: percentage(timeoutCount, results.length),
    meanLatencyMs,
    p95LatencyMs: percentileLatencyMs(95),
  },
  perFieldMetrics,
  cases: results,
}, null, 2));
}

void main().catch((error) => {
  console.error("Ollama RFQ evaluation failed:", error);
  process.exitCode = 1;
});
