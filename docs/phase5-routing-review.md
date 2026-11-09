# Phase 5: routing recommendations and technical review

Routing technical review is independent of Sales Head commercial approval.

- Estimator/Admin: save draft routings and costings; submit saved routing revisions for technical review.
- Plant Head: edit draft routing; approve or request changes on the current submitted revision. Requesting changes requires comments. Admin has no technical decision override.
- Sales Head: existing commercial approval and internal send permissions remain unchanged.

Every routing save requires `expectedRevision` (0 for a new routing). Existing routing edits increment the revision, including a save with identical operations. Saving after a rejected review creates a fresh draft revision; it does not overwrite the rejected review. Old pending reviews remain visible as historical records and cannot be decided after a new revision is saved.

The Costing workspace shows revision/status, review actions, submitted operations/rates, source evidence, and review history. Unsaved edits must be saved before review or costing. Draft costing does not require approval. New costings record their routing revision; if that revision is already approved they also record its review ID.

Both quotation submission and internal sending require Plant Head approval of every current routing revision and costings from those same revisions. This check also applies to quotations below or exactly at ₹25 lakh. The existing commercial threshold remains unchanged: values above ₹25 lakh require assigned Sales Head approval; values at or below it use the existing automatic commercial approval behavior.

Legacy costings have a null routing revision and are not silently backfilled. Existing routings start at revision 1 without assumed technical approval. Create a new draft costing and obtain technical review before submitting new quotations using those routings. If an already commercially approved quotation becomes stale, its snapshot remains immutable: create a fresh quotation from the current costing instead of rewriting the old approved quotation.

Routing save, review submission/decision, draft costing creation, and quotation submission/send use the same PostgreSQL transaction-scoped advisory lock per part. Multi-part quotation gates lock parts in sorted order. Review decisions also use a conditional PENDING transition. State changes and audit writes share a transaction. Submission/send audits record the technical review IDs and revisions that passed the gate. A database trigger protects submitted snapshot evidence and completed decisions; a check constraint requires rejection comments.

Recommendations use actual saved operations from older parts in other RFQs. They exclude weak/unrelated matches and invalid timing data, break ties by source part ID, and retain the five best eligible matches. Matching is deterministic (material 45%, name 35%, weight 20%), not an AI prediction or confidence probability. A source may be an unreviewed draft: every adopted routing needs its own technical review. Imported quote records without routing operation evidence are not turned into fabricated routing recommendations.

When a recommendation is used, the server validates its source revision and recomputes matching factors. The source operations, RFQ, part and revision are persisted in the routing save audit and copied into immutable review evidence. Subsequent manual edits preserve that source evidence unless the caller explicitly clears it with `recommendationSource: null`. Historical machine rates are references; currently effective rates must be selected before saving.

Costing calculations, INR rounding, saved component amounts/rate snapshots, and approved quotation snapshot/PDF formats are unchanged. Sending remains an internal status transition; the application does not send external email.

## Validation

Use the installed dependencies; no install or reset is required:

```sh
cd server
npm run build
npm test -- --maxWorkers=2
PHASE5_DB_TESTS=1 npm test -- --maxWorkers=2
```

The opt-in database tests only accept the local `rfq_quotation_db` public schema. Fixtures are created inside transactions that roll back; no existing records are modified or deleted. They cover immutable evidence/decisions, mandatory rejection comments, audit rollback, routing revision gates, and advisory locks across database connections.

```sh
cd client
npm run lint
npm run build
../server/node_modules/.bin/tsx --test tests/*.test.ts
```

Then run `git diff --check` from the repository root. Real HTTP route tests and local database checks may require execution outside the sandbox. No Phase 6 work is included.
