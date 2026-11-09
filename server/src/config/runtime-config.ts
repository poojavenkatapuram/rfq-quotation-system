import path from "node:path";

type Environment = NodeJS.ProcessEnv;

const developmentDefaultClientOrigin = "http://localhost:5173";

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
  if (environment.NODE_ENV !== "production") return;

  const problems: string[] = [];
  const databaseUrl = environment.DATABASE_URL?.trim();
  const jwtSecret = environment.JWT_SECRET?.trim();
  const storageDirectory = environment.RFQ_DOCUMENT_STORAGE_DIR?.trim();
  const clientUrl = configuredClientUrl(environment);
  const localAiEnabled = environment.LOCAL_AI_ENABLED?.trim().toLowerCase();
  const proxyHops = getTrustProxyHops(environment);

  if (!isPostgresDatabaseUrl(databaseUrl)) {
    problems.push("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    problems.push("JWT_SECRET must be at least 32 characters");
  }
  if (!storageDirectory || !path.isAbsolute(storageDirectory)) {
    problems.push("RFQ_DOCUMENT_STORAGE_DIR must be an absolute path");
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

  if (problems.length > 0) {
    throw new Error(`Invalid production configuration: ${problems.join("; ")}`);
  }
}
