import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteStoredDocument,
  retrieveDocument,
  storeDocument,
} from "./document-storage.service.js";

const r2Environment = {
  RFQ_DOCUMENT_STORAGE_PROVIDER: "r2",
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_BUCKET_NAME: "forgeflow-private-docs",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
};

afterEach(() => vi.unstubAllGlobals());

describe("private R2 document storage", () => {
  it("stores documents at server-generated private object keys with signed requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const content = Buffer.from("synthetic private RFQ file");

    const reference = await storeDocument(
      "2f96a724-a008-4f64-92bb-46e2a5acb215.pdf",
      "application/pdf",
      content,
      r2Environment
    );

    expect(reference).toBe("r2://rfq-documents/2f96a724-a008-4f64-92bb-46e2a5acb215.pdf");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain("https://" + r2Environment.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com/forgeflow-private-docs/rfq-documents/");
    expect(request.method).toBe("PUT");
    expect(request.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key\//);
    expect(request.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.from(request.body)).toEqual(content);
  });

  it("retrieves object bytes using the stored opaque reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from("synthetic bytes"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const content = await retrieveDocument(
      "r2://rfq-documents/2f96a724-a008-4f64-92bb-46e2a5acb215.xlsx",
      r2Environment
    );

    expect(content.toString()).toBe("synthetic bytes");
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("deletes only valid generated document keys and treats already-missing keys idempotently", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteStoredDocument(
      "r2://rfq-documents/2f96a724-a008-4f64-92bb-46e2a5acb215.eml",
      r2Environment
    )).resolves.toBeUndefined();
    await expect(retrieveDocument("r2://rfq-documents/../private.pdf", r2Environment)).rejects.toThrow("Invalid private document object key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("does not expose provider response bodies when storage requests fail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("sensitive provider diagnostics", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(storeDocument(
      "2f96a724-a008-4f64-92bb-46e2a5acb215.pdf",
      "application/pdf",
      Buffer.from("synthetic"),
      r2Environment
    )).rejects.toThrow("Private object storage upload failed (403)");
    await expect(storeDocument(
      "2f96a724-a008-4f64-92bb-46e2a5acb215.pdf",
      "application/pdf",
      Buffer.from("synthetic"),
      { ...r2Environment, R2_BUCKET_NAME: "../public" }
    )).rejects.toThrow("R2_BUCKET_NAME");
  });
});
