export const SYNTHETIC_DATABASE_NAME = "forgeflow_synthetic_demo_test";

// No .env fallback: demo writers require a separately supplied URL and explicit
// approval flag. Reject alternate schemas and URL-level connection overrides.
export function requireSyntheticDatabaseTarget(value: string | undefined, approval: string | undefined) {
  if (approval !== "yes") throw new Error("Explicit isolated database approval is required (SYNTHETIC_DEMO_DB_APPROVED=yes)");
  if (!value) throw new Error("SYNTHETIC_DEMO_DATABASE_URL is required; DATABASE_URL is never used as a fallback");
  const url = new URL(value);
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      (url.port && url.port !== "5432") || url.pathname !== `/${SYNTHETIC_DATABASE_NAME}` ||
      [...url.searchParams.keys()].some(key => key !== "schema") || url.searchParams.getAll("schema").length > 1 ||
      (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public") || url.hash) {
    throw new Error(`Only local localhost:5432/${SYNTHETIC_DATABASE_NAME}, schema public, is permitted`);
  }
  return { url: value, host: url.hostname, port: 5432, database: SYNTHETIC_DATABASE_NAME, schema: "public" };
}
