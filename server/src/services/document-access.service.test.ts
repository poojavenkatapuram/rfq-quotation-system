import { describe, expect, it } from "vitest";
import { canManageIntakeDocument, canReadDocument } from "./document-access.service.js";
const rfq = { id: "rfq-1", createdById: "creator", assignedToId: "owner" };
describe("document authorization policy", () => {
  it.each([
    ["ADMIN", "admin", true, true],
    ["ESTIMATOR", "uploader", true, true],
    ["ESTIMATOR", "creator", true, false],
    ["ESTIMATOR", "owner", true, false],
    ["ESTIMATOR", "unrelated", false, false],
    ["PLANT_HEAD", "technical", true, false],
    ["SALES_HEAD", "uploader", false, false],
    ["UNKNOWN", "uploader", false, false],
  ])("%s %s: linked read=%s, intake write=%s", (role, userId, read, write) => {
    const user = { role, userId };
    expect(canReadDocument(user, "uploader", rfq)).toBe(read);
    expect(canManageIntakeDocument(user, "uploader")).toBe(write);
  });
  it("keeps unlinked intake documents private to the uploader and Admin", () => {
    for (const [role, userId, allowed] of [["ADMIN", "admin", true], ["ESTIMATOR", "uploader", true], ["ESTIMATOR", "owner", false], ["PLANT_HEAD", "technical", false]] as const) {
      expect(canReadDocument({ role, userId }, "uploader", null)).toBe(allowed);
    }
  });
  it("fails closed without an authenticated user", () => {
    expect(canReadDocument(undefined, "uploader", rfq)).toBe(false);
    expect(canManageIntakeDocument(undefined, "uploader")).toBe(false);
  });
});
