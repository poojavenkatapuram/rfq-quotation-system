import { DocumentProcessingError } from "./rfq-document-extraction.service.js";

const MAX_EMAIL_BODY = 2 * 1024 * 1024;
const MAX_MIME_PARTS = 100;
const MAX_MIME_DEPTH = 5;

export type ParsedRfqEmail = {
  from: string | null;
  subject: string | null;
  date: string | null;
  body: string;
  warnings: string[];
};

function decodeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_match, charset: string, encoding: string, data: string) => {
    try {
      const bytes = encoding.toLowerCase() === "b"
        ? Buffer.from(data, "base64")
        : Buffer.from(data.replace(/_/g, " ").replace(/=([\da-f]{2})/gi, (_hex, hex: string) => String.fromCharCode(parseInt(hex, 16))), "binary");
      return new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch { return "[unsupported encoded header]"; }
  }).replace(/[\r\n\t ]+/g, " ").trim();
}

function decodeQuotedPrintable(value: string): Buffer {
  const normalized = value.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === "=" && /^[\da-f]{2}$/i.test(normalized.slice(i + 1, i + 3))) {
      bytes.push(parseInt(normalized.slice(i + 1, i + 3), 16)); i += 2;
    } else bytes.push(normalized.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|svg|iframe|object|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_m, code: string) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)))
    .replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>();
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let current = "";
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current) { headers.set(current, headers.get(current) + " " + line.trim()); continue; }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    current = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers.set(current, headers.has(current) ? headers.get(current) + ", " + value : value);
  }
  return headers;
}

function headerParam(value: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^;\\s]*))`, "i"))?.slice(1).find(Boolean);
}

function splitEntity(raw: string): { headers: Map<string, string>; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match || match.index === undefined) return { headers: new Map(), body: "" };
  return { headers: parseHeaders(raw.slice(0, match.index)), body: raw.slice(match.index + match[0].length) };
}

function decodePartBody(body: string, encoding: string): Buffer {
  if (/^base64$/i.test(encoding.trim())) return Buffer.from(body.replace(/\s/g, ""), "base64");
  if (/^quoted-printable$/i.test(encoding.trim())) return decodeQuotedPrintable(body);
  return Buffer.from(body, "utf8");
}

type BodyParts = { plain: string[]; html: string[]; skippedAttachments: number; partCount: number };
function collectBodies(raw: string, depth: number, result: BodyParts): void {
  if (depth > MAX_MIME_DEPTH || ++result.partCount > MAX_MIME_PARTS) throw new DocumentProcessingError("Email MIME structure exceeds safe processing limits.");
  const entity = splitEntity(raw);
  const contentType = entity.headers.get("content-type") || "text/plain";
  const disposition = entity.headers.get("content-disposition") || "";
  const filename = headerParam(disposition, "filename") || headerParam(contentType, "name");
  if (/attachment/i.test(disposition) || filename) { result.skippedAttachments++; return; }
  if (/^multipart\//i.test(contentType)) {
    const boundary = headerParam(contentType, "boundary");
    if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) return;
    const chunks: string[] = [];
    let current: string[] | undefined;
    let closed = false;
    for (const line of entity.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
      if (line === `--${boundary}` || line === `--${boundary}--`) {
        if (current?.length) chunks.push(current.join("\n"));
        current = line.endsWith("--") ? undefined : [];
        if (line.endsWith("--")) { closed = true; break; }
      } else if (current) current.push(line);
    }
    if (current?.length) chunks.push(current.join("\n"));
    if (!closed && chunks.length === 0) return;
    for (const chunk of chunks) collectBodies(chunk, depth + 1, result);
    return;
  }
  const contentTypeName = contentType.split(";")[0]!.trim().toLowerCase();
  if (contentTypeName !== "text/plain" && contentTypeName !== "text/html") { result.skippedAttachments++; return; }
  const charset = headerParam(contentType, "charset") || "utf-8";
  const bytes = decodePartBody(entity.body, entity.headers.get("content-transfer-encoding") || "7bit");
  let decoded: string;
  try { decoded = new TextDecoder(charset, { fatal: false }).decode(bytes); }
  catch { decoded = bytes.toString("utf8"); }
  if (contentTypeName === "text/html") result.html.push(htmlToText(decoded)); else result.plain.push(decoded);
}

export function parseRfqEmail(buffer: Buffer): ParsedRfqEmail {
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new DocumentProcessingError("Email is empty or exceeds the 10 MB limit.");
  const raw = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const headerEnd = /\r?\n\r?\n/.exec(raw);
  if (!headerEnd || headerEnd.index > 64 * 1024) throw new DocumentProcessingError("Email headers are malformed or exceed the safe header limit.");
  const top = splitEntity(raw);
  if (!top.headers.size || !top.body) throw new DocumentProcessingError("Email headers or body are malformed.");
  const parsed: BodyParts = { plain: [], html: [], skippedAttachments: 0, partCount: 0 };
  collectBodies(raw, 0, parsed);
  const body = (parsed.plain.filter(Boolean).join("\n\n") || parsed.html.filter(Boolean).join("\n\n")).slice(0, MAX_EMAIL_BODY).trim();
  const fromHeader = top.headers.get("from");
  const emailAddress = fromHeader?.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.slice(0, 320) || null;
  const parsedDate = top.headers.get("date") ? new Date(top.headers.get("date")!) : null;
  const warnings: string[] = [];
  if (parsed.skippedAttachments) warnings.push(`${parsed.skippedAttachments} email attachment(s) were retained with the source email but not extracted. Upload supported PDF/XLSX attachments separately for review.`);
  if (!parsed.plain.length && parsed.html.length) warnings.push("Email contained HTML only; active content was removed and the text was extracted for review.");
  if (body.length >= MAX_EMAIL_BODY) warnings.push("Email body was truncated to the safe processing limit.");
  return { from: emailAddress, subject: top.headers.has("subject") ? decodeHeader(top.headers.get("subject")!).slice(0, 500) : null,
    date: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : null, body, warnings };
}
