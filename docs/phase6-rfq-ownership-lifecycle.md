# Phase 6 F1/F2: RFQ ownership and lifecycle

No schema changes, migrations, or existing-record backfill are needed.

- Admins and Estimators can select an active Estimator owner, including clearing an owner, in the RFQ register or during manual RFQ creation. Intake-created RFQs can be assigned afterward in the register.
- `GET /api/rfqs/assignees` returns active Estimator IDs and names to Admins and Estimators only. User administration permissions remain unchanged.
- `PATCH /api/rfqs/:id` requires `expectedUpdatedAt`, the ISO timestamp returned on the RFQ. A stale timestamp returns HTTP 409; refresh before retrying. Sales Heads can only record commercial outcomes, and Plant Heads cannot update RFQs.
- Manual Received → Estimating remains available. Pending approval and Quotation sent can only be produced by quotation workflow actions. Lost requires a reason; Won requires Quotation sent. Closed RFQs cannot be reopened.
- Saving a new costing or draft quotation advances an open Received RFQ to Estimating. Submission, approval, rejection, and sending synchronize the parent RFQ in the same transaction. A pending quotation keeps the parent Pending approval unless a quotation has already been sent. Approval alone does not mean sent.
- Quotation sent remains sticky while further quotations are prepared. Won/Lost blocks subsequent costing and quotation workflow writes. Historical approved snapshots and financial calculations are unchanged.
- RFQ edits and workflow writes use transaction-scoped RFQ advisory locks, conditional status/timestamp updates, and transactional audit logging. When routing locks are needed, acquire them before the RFQ lock.

## Browser checks using new test records

1. As Admin or Estimator, open RFQ Register, create an RFQ with an owner, refresh, then reassign or clear the owner. Verify persistence. Sales Head and Plant Head must not see owner edit controls.
2. Open the same RFQ in two tabs. Save an owner/status change in one tab; attempt another from the stale tab. Expect a conflict message and no overwrite; refresh and retry.
3. Verify the status selector offers no manual Pending approval or Quotation sent option. Direct PATCH requests for either status must return 403 even with a current timestamp.
4. Save a draft costing for a Received RFQ: expect Estimating. Complete the existing technical-review workflow and create/submit a quotation. Above the existing threshold, expect Pending approval; automatic approval below the threshold leaves Estimating.
5. As the assigned Sales Head, approve or reject a pending quotation. Approval/rejection returns the RFQ to Estimating if no other quotation is pending. With another pending quotation, expect Pending approval to remain.
6. Send a technically valid approved quotation: expect Quotation sent. Prepare another quotation: the parent must remain Quotation sent. Record Won or Lost (with reason); later costing/submission/approval/send attempts must fail without reopening the parent.
7. Re-download an existing approved PDF and verify its snapshot/company/pricing remain unchanged. These changes intentionally do not repair existing inconsistent statuses automatically.

Automated concurrency coverage uses transaction/compare-and-set mocks; a real simultaneous browser/database contention check remains part of manual validation. Database integration suites are opt-in and are not required to run against populated submission data.
