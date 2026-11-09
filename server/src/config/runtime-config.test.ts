import { describe, expect, it } from "vitest";
import {
  getClientOrigin,
  getOllamaRfqBaseUrl,
  getOllamaRfqRuntimeSettings,
  getTrustProxyHops,
  validateRuntimeConfiguration,
} from "./runtime-config.js";

const productionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://rfq_app:password@db.example.internal:5432/rfq",
  JWT_SECRET: "a-32-character-minimum-jwt-secret-value",
  RFQ_DOCUMENT_STORAGE_DIR: "/var/lib/rfq-quotation/documents",
  CLIENT_URL: "https://quotes.example.com",
  TRUST_PROXY_HOPS: "1",
  LOCAL_AI_ENABLED: "false",
};

describe("runtime configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(() => validateRuntimeConfiguration(productionEnvironment)).not.toThrow();
  });

  it("fails closed when production secrets, storage, or origin are missing", () => {
    expect(() =>
      validateRuntimeConfiguration({
        NODE_ENV: "production",
        DATABASE_URL: "",
        JWT_SECRET: "short",
        RFQ_DOCUMENT_STORAGE_DIR: "relative/documents",
        CLIENT_URL: "http://quotes.example.com",
      })
    ).toThrow("Invalid production configuration");
  });

  it("rejects a malformed production database connection URL", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...productionEnvironment,
        DATABASE_URL: "not-a-database-url",
      })
    ).toThrow("DATABASE_URL must be a valid PostgreSQL connection URL");
  });

  it("rejects an invalid local AI feature flag in production", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...productionEnvironment,
        LOCAL_AI_ENABLED: "enabled",
      })
    ).toThrow("LOCAL_AI_ENABLED must be true or false");
  });

  it("uses a URL origin for CORS and has a safe development fallback", () => {
    expect(
      getClientOrigin({ CLIENT_URL: "https://quotes.example.com/app" })
    ).toBe("https://quotes.example.com");
    expect(getClientOrigin({ CLIENT_URL: "not a URL" })).toBe(
      "http://localhost:5173"
    );
    expect(getTrustProxyHops({ TRUST_PROXY_HOPS: "2" })).toBe(2);
    expect(getTrustProxyHops({ TRUST_PROXY_HOPS: "not-a-number" })).toBe(0);
  });

  it("uses conservative CPU-only Ollama defaults and accepts validated overrides", () => {
    expect(getOllamaRfqRuntimeSettings({})).toEqual({
      baseUrl: "http://127.0.0.1:11434",
      numGpu: 0,
      numThread: 4,
      timeoutMs: 180_000,
      keepAlive: "2m",
    });
    expect(getOllamaRfqRuntimeSettings({
      OLLAMA_RFQ_BASE_URL: "https://ollama.com/",
      OLLAMA_RFQ_NUM_GPU: "0",
      OLLAMA_RFQ_NUM_THREAD: "4",
      OLLAMA_RFQ_TIMEOUT_MS: "240000",
      OLLAMA_RFQ_KEEP_ALIVE: "5m",
    })).toEqual({ baseUrl: "https://ollama.com", numGpu: 0, numThread: 4, timeoutMs: 240_000, keepAlive: "5m" });
  });

  it("allows HTTPS hosted Ollama endpoints and local loopback HTTP only", () => {
    expect(getOllamaRfqBaseUrl({ OLLAMA_RFQ_BASE_URL: "https://ollama.com/" })).toBe("https://ollama.com");
    expect(getOllamaRfqBaseUrl({ OLLAMA_RFQ_BASE_URL: "http://127.0.0.1:11434/" })).toBe("http://127.0.0.1:11434");
    for (const value of [
      "http://ollama.example.com",
      "https://user:pass@ollama.example.com",
      "https://ollama.example.com?token=hidden",
      "not-a-url",
    ]) {
      expect(() => getOllamaRfqBaseUrl({ OLLAMA_RFQ_BASE_URL: value })).toThrow("OLLAMA_RFQ_BASE_URL");
    }
  });

  it("requires server-side API credentials for enabled remote Ollama in production", () => {
    expect(() => validateRuntimeConfiguration({
      ...productionEnvironment,
      LOCAL_AI_ENABLED: "true",
      OLLAMA_RFQ_BASE_URL: "https://ollama.com",
    })).toThrow("OLLAMA_API_KEY is required");
    expect(() => validateRuntimeConfiguration({
      ...productionEnvironment,
      LOCAL_AI_ENABLED: "true",
      OLLAMA_RFQ_BASE_URL: "https://ollama.com",
      OLLAMA_API_KEY: "server-side-test-key",
    })).not.toThrow();
  });

  it.each([
    ["OLLAMA_RFQ_NUM_GPU", "-1"],
    ["OLLAMA_RFQ_NUM_GPU", "1.5"],
    ["OLLAMA_RFQ_NUM_GPU", "129"],
    ["OLLAMA_RFQ_NUM_THREAD", "0"],
    ["OLLAMA_RFQ_NUM_THREAD", "65"],
    ["OLLAMA_RFQ_NUM_THREAD", "2.5"],
    ["OLLAMA_RFQ_TIMEOUT_MS", "89999"],
    ["OLLAMA_RFQ_TIMEOUT_MS", "600001"],
    ["OLLAMA_RFQ_TIMEOUT_MS", "1m"],
    ["OLLAMA_RFQ_KEEP_ALIVE", "forever"],
    ["OLLAMA_RFQ_KEEP_ALIVE", "11m"],
  ])("rejects invalid %s configuration", (name, value) => {
    expect(() => getOllamaRfqRuntimeSettings({ [name]: value })).toThrow(name);
    expect(() => validateRuntimeConfiguration({ [name]: value })).toThrow(name);
  });
});
