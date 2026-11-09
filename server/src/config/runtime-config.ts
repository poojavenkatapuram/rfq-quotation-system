import path from "node:path";
import { validateR2StorageConfiguration } from "../services/document-storage.service.js";

type Environment = NodeJS.ProcessEnv;

const developmentDefaultClientOrigin = "http://localhost:5173";

export const DEFAULT_OLLAMA_RFQ_NUM_GPU = 0;
export const DEFAULT_OLLAMA_RFQ_NUM_THREAD = 4;
export const DEFAULT_OLLAMA_RFQ_TIMEOUT_MS = 180_000;
export const DEFAULT_OLLAMA_RFQ_KEEP_ALIVE = "2m";
export const DEFAULT_OLLAMA_RFQ_BASE_URL = "http://127.0.0.1:11434";
const MIN_OLLAMA_RFQ_TIMEOUT_MS = 90_000;
const MAX_OLLAMA_RFQ_TIMEOUT_MS = 600_000;
const MAX_OLLAMA_RFQ_NUM_GPU = 128;
const MAX_OLLAMA_RFQ_NUM_THREAD = 64;
const MAX_OLLAMA_RFQ_KEEP_ALIVE_MS = 10 * 60 * 1000;

export interface OllamaRfqRuntimeSettings {
  baseUrl: string;
  numGpu: number;
  numThread: number;
  timeoutMs: number;
  keepAlive: string;
}

export function getOllamaRfqBaseUrl(environment: Environment = process.env): string {
  const rawBaseUrl = environment.OLLAMA_RFQ_BASE_URL?.trim() || DEFAULT_OLLAMA_RFQ_BASE_URL;
  let url: URL;

  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error("OLLAMA_RFQ_BASE_URL must be a valid HTTP(S) URL");
  }

  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error("OLLAMA_RFQ_BASE_URL must use HTTPS remotely, or HTTP on loopback, without URL credentials or query values");
  }

  return url.href.replace(/\/+$/, "");
}

function parseKeepAliveMilliseconds(value: string): number | undefined {
  if (value === "0") return 0;
  const match = value.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] as "ms" | "s" | "m" | "h"];
  const duration = amount * multiplier;
  return Number.isSafeInteger(duration) ? duration : undefined;
}

export function getOllamaRfqRuntimeSettings(
  environment: Environment = process.env
): OllamaRfqRuntimeSettings {
  const baseUrl = getOllamaRfqBaseUrl(environment);
  const rawNumGpu = environment.OLLAMA_RFQ_NUM_GPU?.trim() ?? String(DEFAULT_OLLAMA_RFQ_NUM_GPU);
  if (!/^\d+$/.test(rawNumGpu) || Number(rawNumGpu) > MAX_OLLAMA_RFQ_NUM_GPU) {
    throw new Error("OLLAMA_RFQ_NUM_GPU must be an integer from 0 to 128 (0 selects CPU-only inference)");
  }

  const rawNumThread = environment.OLLAMA_RFQ_NUM_THREAD?.trim() ?? String(DEFAULT_OLLAMA_RFQ_NUM_THREAD);
  if (!/^\d+$/.test(rawNumThread) || Number(rawNumThread) < 1 || Number(rawNumThread) > MAX_OLLAMA_RFQ_NUM_THREAD) {
    throw new Error("OLLAMA_RFQ_NUM_THREAD must be an integer from 1 to 64");
  }

  const rawTimeout = environment.OLLAMA_RFQ_TIMEOUT_MS?.trim() ?? String(DEFAULT_OLLAMA_RFQ_TIMEOUT_MS);
  const timeoutMs = Number(rawTimeout);
  if (!/^\d+$/.test(rawTimeout) || !Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_OLLAMA_RFQ_TIMEOUT_MS || timeoutMs > MAX_OLLAMA_RFQ_TIMEOUT_MS) {
    throw new Error("OLLAMA_RFQ_TIMEOUT_MS must be an integer from 90000 to 600000");
  }

  const keepAlive = environment.OLLAMA_RFQ_KEEP_ALIVE?.trim() || DEFAULT_OLLAMA_RFQ_KEEP_ALIVE;
  const keepAliveMs = parseKeepAliveMilliseconds(keepAlive);
  if (keepAliveMs === undefined || keepAliveMs > MAX_OLLAMA_RFQ_KEEP_ALIVE_MS) {
    throw new Error("OLLAMA_RFQ_KEEP_ALIVE must be 0 or a duration up to 10m, such as 2m");
  }

  return { baseUrl, numGpu: Number(rawNumGpu), numThread: Number(rawNumThread), timeoutMs, keepAlive };
}

function configuredClientUrl(environment: Environment): URL | undefined {
  const value = environment.CLIENT_URL?.trim();
  if (!value) return undefined;

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isPostgresDatabaseUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "postgresql:" || url.protocol === "postgres:";
  } catch {
    return false;
  }
}

export function getClientOrigin(environment: Environment = process.env): string {
  return configuredClientUrl(environment)?.origin ?? developmentDefaultClientOrigin;
}

export function getTrustProxyHops(environment: Environment = process.env): number {
  const value = environment.TRUST_PROXY_HOPS?.trim();
  if (!value || !/^\d+$/.test(value)) return 0;

  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : 0;
}

export function validateRuntimeConfiguration(
  environment: Environment = process.env
): void {
  // Validate optional AI tuning values in every environment so a typo cannot
  // silently change the runtime options when AI is enabled.
  getOllamaRfqRuntimeSettings(environment);
  if (environment.NODE_ENV !== "production") return;

  const problems: string[] = [];
  const databaseUrl = environment.DATABASE_URL?.trim();
  const jwtSecret = environment.JWT_SECRET?.trim();
  const storageDirectory = environment.RFQ_DOCUMENT_STORAGE_DIR?.trim();
  const storageProvider = environment.RFQ_DOCUMENT_STORAGE_PROVIDER?.trim().toLowerCase() || "local";
  const clientUrl = configuredClientUrl(environment);
  const localAiEnabled = environment.LOCAL_AI_ENABLED?.trim().toLowerCase();
  const ollamaBaseUrl = getOllamaRfqBaseUrl(environment);
  const ollamaApiKey = environment.OLLAMA_API_KEY?.trim();
  const proxyHops = getTrustProxyHops(environment);

  if (!isPostgresDatabaseUrl(databaseUrl)) {
    problems.push("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    problems.push("JWT_SECRET must be at least 32 characters");
  }
  if (storageProvider !== "local" && storageProvider !== "r2") {
    problems.push("RFQ_DOCUMENT_STORAGE_PROVIDER must be local or r2");
  } else if (storageProvider === "local" && (!storageDirectory || !path.isAbsolute(storageDirectory))) {
    problems.push("RFQ_DOCUMENT_STORAGE_DIR must be an absolute path when local document storage is selected");
  } else if (storageProvider === "r2") {
    problems.push(...validateR2StorageConfiguration(environment));
  }
  if (!clientUrl || clientUrl.protocol !== "https:") {
    problems.push("CLIENT_URL must be a valid HTTPS origin");
  }
  if (proxyHops < 1) {
    problems.push("TRUST_PROXY_HOPS must be an integer from 1 to 5");
  }
  if (
    localAiEnabled !== undefined &&
    localAiEnabled !== "true" &&
    localAiEnabled !== "false"
  ) {
    problems.push("LOCAL_AI_ENABLED must be true or false when configured");
  }
  if (
    localAiEnabled === "true" &&
    !["http://localhost:11434", "http://127.0.0.1:11434", "http://[::1]:11434"].includes(ollamaBaseUrl) &&
    !ollamaApiKey
  ) {
    problems.push("OLLAMA_API_KEY is required when local AI is enabled with a remote Ollama endpoint");
  }

  if (problems.length > 0) {
    throw new Error(`Invalid production configuration: ${problems.join("; ")}`);
  }
}
