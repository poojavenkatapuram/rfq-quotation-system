import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { companyConfiguration, type ApprovedQuotationSnapshot } from "./quotation-snapshot.service.js";

type CompanyDetails = ApprovedQuotationSnapshot["company"];
type SettingsClient = Pick<Prisma.TransactionClient, "companyProfile">;

export type CompanySettings = {
  company: CompanyDetails;
  version: number;
  source: "database" | "environment" | "unconfigured";
  updatedAt: string | null;
};

const optionalText = z.union([z.string(), z.null()]).optional()
  .transform(value => value?.trim() || null);
const noControls = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

export const saveCompanySettingsSchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  name: z.string().trim().min(2).max(200).refine(noControls, "Company name must be a single line"),
  address: z.string().trim().min(5).max(2000)
    .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Invalid address characters"),
  email: optionalText.pipe(z.string().max(254).email().nullable()),
  phone: optionalText.pipe(z.string().max(32).refine(value =>
    /^\+?[0-9][0-9 ()-]+$/.test(value) &&
    value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15,
    "Enter a phone number with 7–15 digits, without an extension",
  ).nullable()),
  gstNumber: optionalText.transform(value => value?.toUpperCase() ?? null)
    .pipe(z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN format").nullable()),
});

function storedSettings(profile: {
  name: string; address: string; email: string | null; phone: string | null;
  gstNumber: string | null; version: number; updatedAt: Date;
}): CompanySettings {
  return {
    company: { name: profile.name, address: profile.address, email: profile.email, phone: profile.phone, gstNumber: profile.gstNumber },
    version: profile.version,
    source: "database",
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export async function getCompanySettings(client: SettingsClient = prisma): Promise<CompanySettings> {
  const profile = await client.companyProfile.findUnique({ where: { id: 1 } });
  if (profile) return storedSettings(profile);
  const company = companyConfiguration();
  return { company, version: 0, source: Object.values(company).some(Boolean) ? "environment" : "unconfigured", updatedAt: null };
}

export class CompanySettingsConflict extends Error {
  constructor() { super("Company details changed in another session. Reload the saved details before saving again."); }
}

export function isCompanySettingsConflict(error: unknown): boolean {
  return error instanceof CompanySettingsConflict ||
    (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code));
}

// Compare-and-swap protects both initial creation and updates. Audit failure
// rejects the entire caller-owned transaction; this service never touches quotations.
export async function saveCompanySettings(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: z.infer<typeof saveCompanySettingsSchema>,
): Promise<CompanySettings> {
  const before = await getCompanySettings(tx);
  if (before.version !== input.expectedVersion) throw new CompanySettingsConflict();
  const { expectedVersion, ...company } = input;
  let saved;
  if (expectedVersion === 0) {
    saved = await tx.companyProfile.create({ data: { id: 1, ...company } });
  } else {
    const transition = await tx.companyProfile.updateMany({
      where: { id: 1, version: expectedVersion },
      data: { ...company, version: { increment: 1 } },
    });
    if (transition.count !== 1) throw new CompanySettingsConflict();
    saved = await tx.companyProfile.findUniqueOrThrow({ where: { id: 1 } });
  }
  const result = storedSettings(saved);
  await tx.auditLog.create({ data: {
    actorId, action: "COMPANY_SETTINGS_SAVED", entityType: "CompanyProfile", entityId: "1",
    details: { previousVersion: before.version, version: result.version, previousSource: before.source, before: before.company, after: result.company },
  } });
  return result;
}
