import "dotenv/config";
import assert from "node:assert/strict";
import { syntheticRfqDocuments } from "../src/fixtures/synthetic-rfq-documents.js";
import { extractDocumentContent } from "../src/services/rfq-document-extraction.service.js";
import { extractSupplementaryRfqSuggestions, getOllamaRfqModel, OLLAMA_RFQ_GENERATE_URL } from "../src/services/ollama-rfq-extraction.service.js";

async function main() {
  const fixtures = await syntheticRfqDocuments();
  const reports = [];
  let successfulAiDocuments = 0;
  for (const [name, buffer] of Object.entries(fixtures)) {
    const only = process.argv.find((argument) => argument.startsWith("--only="))?.slice(7);
    if (only && only !== name) continue;
    const extraction = await extractDocumentContent(buffer, name === "xlsx" ? "XLSX" : "PDF");
    assert(extraction.candidates.length > 0, `${name}: no deterministic candidates`);
    if (name === "mixedPdf") {
      assert(extraction.candidates.some((field) => field.sourceReference.includes("OCR page 2")));
      assert(extraction.candidates.some((field) => field.sourceReference.includes("selectable text page 1")));
    }
    const start = Date.now();
    const ai = await extractSupplementaryRfqSuggestions(extraction.textSources, extraction.candidates, { includeDiagnostics: true });
    if (!ai.failureReason && ai.suggestions.length > 0) successfulAiDocuments++;
    reports.push({ document: name, deterministicFields: extraction.candidates.length,
      sourceReferences: [...new Set(extraction.candidates.map((field) => field.sourceReference))],
      warnings: extraction.warnings ?? [], aiRespondedWithValidJson: !ai.failureReason,
      failureReason: ai.failureReason ?? null, elapsedMs: Date.now() - start,
      inferenceMetrics: ai.inferenceMetrics ?? null,
      rawSuggestions: ai.diagnostics?.rawSuggestionCount ?? 0,
      ...(process.argv.includes("--diagnostics") && { syntheticModelOutput: ai.diagnostics?.rawSuggestions }),
      validatedSuggestions: ai.suggestions.map(({ fieldName, extractedValue, sourceReference }) => ({ fieldName, extractedValue, sourceReference })),
    });
    console.log(JSON.stringify(reports.at(-1)));
  }
  console.log(JSON.stringify({ syntheticOnly: true, databaseUsed: false, mockedAi: false,
    model: getOllamaRfqModel(), endpoint: OLLAMA_RFQ_GENERATE_URL,
    configuredLocalAiEnabled: process.env.LOCAL_AI_ENABLED ?? "default: disabled in production, enabled otherwise",
    successfulAiDocuments, totalDocuments: reports.length }));
  // A real integration check requires one validated model suggestion. Documents
  // with no missing, evidence-backed fields may correctly produce no AI output.
  if (reports.length === 0 || successfulAiDocuments === 0) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Synthetic test failed"); process.exitCode = 1; });
