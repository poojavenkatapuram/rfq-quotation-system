import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

type User = AuthenticatedRequest["user"];
type LinkedRFQ = { id: string; createdById: string; assignedToId: string | null };

// Raw documents, extraction values and evidence share the same read boundary.
// Accepted RFQ/quotation business fields are not raw extraction records.
export function canReadDocument(user: User, uploadedById: string, rfq?: LinkedRFQ | null): boolean {
  if (!user?.userId) return false;
  if (user.role === "ADMIN") return true;
  if (user.role === "PLANT_HEAD") return Boolean(rfq);
  if (user.role !== "ESTIMATOR") return false;
  return user.userId === uploadedById || Boolean(rfq && (
    rfq.createdById === user.userId || rfq.assignedToId === user.userId
  ));
}

// Broader read access for technical review never grants intake write access.
export function canManageIntakeDocument(user: User, uploadedById: string): boolean {
  return Boolean(user?.userId && (user.role === "ADMIN" || (
    user.role === "ESTIMATOR" && user.userId === uploadedById
  )));
}
