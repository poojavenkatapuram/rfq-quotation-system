import { describe, expect, it } from "vitest";
import {
  getClientOrigin,
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
});
