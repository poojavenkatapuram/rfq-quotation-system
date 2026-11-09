import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import prisma from "../lib/prisma.js";
import { getCompanySettings, isCompanySettingsConflict, saveCompanySettings, saveCompanySettingsSchema } from "../services/company-settings.service.js";

function authorizeAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (!req.user?.userId) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return false;
  }
  if (req.user.role !== "ADMIN") {
    res.status(403).json({ success: false, message: "Only administrators can manage company details" });
    return false;
  }
  return true;
}

export async function readCompanySettings(req: AuthenticatedRequest, res: Response) {
  if (!authorizeAdmin(req, res)) return res;
  try {
    return res.status(200).json({ success: true, data: await getCompanySettings() });
  } catch (error) {
    console.error("Read company settings error:", error);
    return res.status(500).json({ success: false, message: "Unable to load company details" });
  }
}

export async function updateCompanySettings(req: AuthenticatedRequest, res: Response) {
  if (!authorizeAdmin(req, res)) return res;
  const parsed = saveCompanySettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid company details", errors: parsed.error.flatten() });
  try {
    const data = await prisma.$transaction(tx => saveCompanySettings(tx, req.user!.userId, parsed.data));
    return res.status(200).json({ success: true, message: "Company details saved. Existing approved quotations remain unchanged.", data });
  } catch (error) {
    if (isCompanySettingsConflict(error)) return res.status(409).json({
      success: false,
      message: "Company details changed in another session. Reload the saved details before saving again.",
    });
    console.error("Save company settings error:", error);
    return res.status(500).json({ success: false, message: "Unable to save company details. No changes were saved; retry or reload the saved details." });
  }
}
