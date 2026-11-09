import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_DIRECTORY = path.resolve(process.cwd(), "storage", "rfq-documents");
const R2_STORAGE_PREFIX = "r2://rfq-documents/";
const SAFE_OBJECT_KEY = /^rfq-documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|xlsx|eml)$/i;

type Environment = NodeJS.ProcessEnv;

interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function getDocumentStorageDirectory(environment: Environment = process.env): string {
  const configuredDirectory = environment.RFQ_DOCUMENT_STORAGE_DIR?.trim();
  return configuredDirectory ? path.resolve(configuredDirectory) : DEFAULT_STORAGE_DIRECTORY;
}

export function getDocumentStorageProvider(environment: Environment = process.env): "local" | "r2" {
  const provider = environment.RFQ_DOCUMENT_STORAGE_PROVIDER?.trim().toLowerCase() || "local";
  if (provider !== "local" && provider !== "r2") {
    throw new Error("RFQ_DOCUMENT_STORAGE_PROVIDER must be local or r2");
  }
  return provider;
}

function getR2Config(environment: Environment): R2Config {
  const accountId = environment.R2_ACCOUNT_ID?.trim() || "";
  const bucket = environment.R2_BUCKET_NAME?.trim() || "";
  const accessKeyId = environment.R2_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = environment.R2_SECRET_ACCESS_KEY?.trim() || "";
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error("R2_ACCOUNT_ID must be a 32-character Cloudflare account ID");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("R2_BUCKET_NAME must be a valid bucket name");
  if (!accessKeyId || !secretAccessKey) throw new Error("R2 object storage credentials are required");
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildSignedHeaders(
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body: Buffer,
  contentType: string | undefined,
  config: R2Config,
  now = new Date()
): { url: string; headers: Record<string, string> } {
  if (!SAFE_OBJECT_KEY.test(key)) throw new Error("Invalid private document object key");
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodePathSegment(config.bucket)}/${key.split("/").map(encodePathSegment).join("/")}`;
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = date.slice(0, 8);
  const payloadHash = sha256(body);
  const signed: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": date,
  };
  if (contentType) signed["content-type"] = contentType;
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signed[name].trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const headers: Record<string, string> = {
    ...Object.fromEntries(names.filter((name) => name !== "host").map((name) => [name, signed[name]])),
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  return { url: `https://${host}${canonicalUri}`, headers };
}

async function r2Request(
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body: Buffer<ArrayBufferLike> = Buffer.alloc(0),
  contentType?: string,
  environment: Environment = process.env
): Promise<Response> {
  const signed = buildSignedHeaders(method, key, body, contentType, getR2Config(environment));
  const response = await fetch(signed.url, {
    method,
    headers: signed.headers,
    ...(method === "PUT" ? { body: new Uint8Array(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  return response;
}

export async function storeDocument(
  fileName: string,
  contentType: string,
  content: Buffer,
  environment: Environment = process.env
): Promise<string> {
  if (getDocumentStorageProvider(environment) === "local") {
    const directory = getDocumentStorageDirectory(environment);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filePath = path.join(directory, path.basename(fileName));
    await writeFile(filePath, content, { flag: "wx", mode: 0o600 });
    return filePath;
  }

  const key = `rfq-documents/${path.basename(fileName)}`;
  const response = await r2Request("PUT", key, content, contentType, environment);
  if (!response.ok) throw new Error(`Private object storage upload failed (${response.status})`);
  return `${R2_STORAGE_PREFIX}${path.basename(fileName)}`;
}

export async function retrieveDocument(storageReference: string, environment: Environment = process.env): Promise<Buffer> {
  if (!storageReference.startsWith(R2_STORAGE_PREFIX)) return readFile(storageReference);
  const key = `rfq-documents/${storageReference.slice(R2_STORAGE_PREFIX.length)}`;
  const response = await r2Request("GET", key, Buffer.alloc(0), undefined, environment);
  if (!response.ok) throw new Error(`Private object storage download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteStoredDocument(storageReference: string, environment: Environment = process.env): Promise<void> {
  if (!storageReference.startsWith(R2_STORAGE_PREFIX)) {
    await unlink(storageReference);
    return;
  }
  const key = `rfq-documents/${storageReference.slice(R2_STORAGE_PREFIX.length)}`;
  const response = await r2Request("DELETE", key, Buffer.alloc(0), undefined, environment);
  if (!response.ok && response.status !== 404) throw new Error(`Private object storage cleanup failed (${response.status})`);
}

export function validateR2StorageConfiguration(environment: Environment = process.env): string[] {
  try {
    getR2Config(environment);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "R2 object storage configuration is invalid"];
  }
}
