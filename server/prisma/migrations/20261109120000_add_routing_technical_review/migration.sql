-- CreateEnum
CREATE TYPE "RoutingReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Routing" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Costing" ADD COLUMN     "routingRevision" INTEGER,
ADD COLUMN     "routingTechnicalReviewId" TEXT;

-- CreateTable
CREATE TABLE "RoutingTechnicalReview" (
    "id" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "routingRevision" INTEGER NOT NULL,
    "status" "RoutingReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "submittedSnapshot" JSONB NOT NULL,
    "comments" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "RoutingTechnicalReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutingTechnicalReview_status_submittedAt_idx" ON "RoutingTechnicalReview"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "RoutingTechnicalReview_submittedById_idx" ON "RoutingTechnicalReview"("submittedById");

-- CreateIndex
CREATE INDEX "RoutingTechnicalReview_reviewedById_idx" ON "RoutingTechnicalReview"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingTechnicalReview_routingId_routingRevision_key" ON "RoutingTechnicalReview"("routingId", "routingRevision");

-- AddForeignKey
ALTER TABLE "Costing" ADD CONSTRAINT "Costing_routingTechnicalReviewId_fkey" FOREIGN KEY ("routingTechnicalReviewId") REFERENCES "RoutingTechnicalReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingTechnicalReview" ADD CONSTRAINT "RoutingTechnicalReview_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "Routing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingTechnicalReview" ADD CONSTRAINT "RoutingTechnicalReview_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingTechnicalReview" ADD CONSTRAINT "RoutingTechnicalReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Submitted evidence and completed decisions must remain immutable.
ALTER TABLE "Routing" ADD CONSTRAINT "Routing_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "RoutingTechnicalReview" ADD CONSTRAINT "RoutingTechnicalReview_decision_valid" CHECK (
  "routingRevision" > 0 AND (
    ("status" = 'PENDING' AND "reviewedById" IS NULL AND "reviewedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL)
  ) AND ("status" <> 'REJECTED' OR (length(btrim("comments")) > 0 AND "comments" IS NOT NULL))
);
CREATE FUNCTION protect_routing_review_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Technical review history cannot be deleted';
  END IF;
  IF OLD."status" <> 'PENDING'
     OR NEW."status" = 'PENDING'
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."routingId" IS DISTINCT FROM OLD."routingId"
     OR NEW."routingRevision" IS DISTINCT FROM OLD."routingRevision"
     OR NEW."submittedById" IS DISTINCT FROM OLD."submittedById"
     OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
     OR NEW."submittedSnapshot" IS DISTINCT FROM OLD."submittedSnapshot" THEN
    RAISE EXCEPTION 'Technical review evidence and completed decisions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER routing_review_evidence_immutable
BEFORE UPDATE OR DELETE ON "RoutingTechnicalReview"
FOR EACH ROW EXECUTE FUNCTION protect_routing_review_evidence();
