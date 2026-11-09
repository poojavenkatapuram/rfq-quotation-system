import { describe, expect, it } from "vitest";
import { requireSyntheticDatabaseTarget } from "./synthetic-demo-safety.service.js";
const url = "postgresql://demo:placeholder@localhost:5432/forgeflow_synthetic_demo_test?schema=public";
describe("synthetic database safety boundary", () => {
  it("accepts only the named explicitly approved local target", () => {
    expect(requireSyntheticDatabaseTarget(url, "yes")).toMatchObject({ database: "forgeflow_synthetic_demo_test", host: "localhost", schema: "public" });
  });
  it.each([undefined, "", "no"])("requires explicit approval, got %s", approval => {
    expect(() => requireSyntheticDatabaseTarget(url, approval)).toThrow("approval");
  });
  it.each([undefined, url.replace("forgeflow_synthetic_demo_test", "rfq_quotation_db"), url.replace("localhost", "remote.example.invalid"), url.replace("5432", "5433"), url.replace("public", "private"), url + "&schema=private", url + "&host=remote", url + "&options=unsafe", url.replace("postgresql", "https")])("rejects an unsafe target", target => {
    expect(() => requireSyntheticDatabaseTarget(target, "yes")).toThrow();
  });
});
