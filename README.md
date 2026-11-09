# ForgeFlow — RFQ-to-Quotation Management

ForgeFlow helps manufacturing teams turn customer requests for quotation (RFQs) into traceable, reviewed quotations. It brings customer and part records, manufacturing routing, deterministic costing, technical and commercial approvals, PDF output, and searchable historical quotes into one workflow.

## Capabilities

- RFQ register with owners, due dates, lifecycle statuses, customer and part details.
- Estimator costing across multiple annual volumes, using material, scrap, routing and machine rates, overhead, packing, freight, and margin inputs.
- Effective-dated material and machine rate masters; costing records retain the rate/costing inputs used at creation.
- PDF, XLSX, and `.eml` RFQ document extraction. Extracted values are suggestions with source evidence/provenance and require human review. Email attachments are uploaded separately; Outlook `.msg` is unsupported.
- Historical routing recommendations from similarity matching against available historical part/routing data. Recommendations show their evidence; they are not LLM-generated routings.
- Draft routing and costing before technical approval. A current-revision Plant Head technical approval is required before a quotation can proceed to commercial approval or customer dispatch.
- Sales Head approval for quotations whose annual value exceeds ₹25 lakh. The backend enforces the threshold and approval workflow.
- Quotation PDF generation with GST, terms, and configured company profile. Company details are captured for future approval snapshots; earlier approved snapshots/documents are not silently rewritten.
- Historical quotation Excel import and search. The supplied 1,400-row workbook is explicitly synthetic demo data.
- Role-protected application functions for Admin, Estimator, Plant Head, and Sales Head.

The application does not send quotations by email or synchronize mailboxes. The `Sent` lifecycle status represents the application's quotation workflow.

## Roles

| Role | Main responsibilities |
| --- | --- |
| Admin | User/role administration, company profile, and administrative functions |
| Estimator | RFQs, document intake review, routing drafts, costing, quotations, and historical import/search |
| Plant Head | Technical routing review: approve or request changes with a comment |
| Sales Head | Commercial quotation approval when required by annual value |

## Technology

- React, TypeScript, Vite, React Router, Axios
- Node.js, Express, TypeScript, Zod
- PostgreSQL and Prisma ORM
- Vitest and Supertest; ExcelJS for workbook handling; PDFKit for quotation PDFs
- Optional local or explicitly configured HTTPS Ollama-compatible integration for supplementary RFQ extraction suggestions

## Prerequisites

- Node.js and npm (the code was last exercised with Node 22 and npm 10).
- PostgreSQL compatible with the Prisma schema.
- The repository dependencies installed in `server/` and `client/`.
- A private, writable directory for uploaded RFQ documents.
- Optional: a locally installed Ollama model for model-assisted extraction. See [AI intake limitations](#ai-assisted-intake-and-routing).

For hosted deployment, use the [deployment quickstart](docs/deployment.md). The checked-in Render template is not a live deployment and requires account-owned environment configuration, a new hosted database, and approval of any public exposure or paid resources.

## Local setup

Use a new, dedicated local development database. Do not point local setup at a database containing business records. If your chosen database name already exists, stop and verify its owner and contents instead of reusing it blindly.

1. Install packages in the two workspaces:

   ```bash
   npm ci --prefix server
   npm ci --prefix client
   ```

2. Copy `server/.env.example` to the ignored, private `server/.env`. Set `DATABASE_URL` to your dedicated local database, replace the JWT placeholder with a unique random value of at least 32 characters, and choose a writable private `RFQ_DOCUMENT_STORAGE_DIR`.

3. Create the dedicated empty database, for example `forgeflow_dev`, using your local PostgreSQL administration procedure. Confirm it does not already exist before creating it. Do not use `rfq_quotation_db` or `forgeflow_synthetic_demo_test` for a new setup.

4. Apply checked-in Prisma migrations to that development database:

   ```bash
   cd server
   npx prisma migrate deploy
   ```

5. Configure bootstrap credentials privately in `server/.env` before seeding:

   ```dotenv
   BOOTSTRAP_ADMIN_NAME=Your Admin Name
   BOOTSTRAP_ADMIN_EMAIL=admin@example.invalid
   BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-private-password-at-least-12-characters
   ```

   Then run `npm run db:seed` from `server/`. The seed creates/upserts the bootstrap Admin without replacing an existing account. To provision a Sales Head during bootstrap, also set `SALES_HEAD_NAME`, `SALES_HEAD_EMAIL`, and `SALES_HEAD_PASSWORD` (12 or more characters). Do not put real credentials in tracked files. Create Estimator and Plant Head accounts through the authenticated Admin **Users & Roles** screen. No demo passwords are included in this repository.

6. Start the API in one terminal:

   ```bash
   cd server
   npm run dev
   ```

7. Start the Vite client in another terminal:

   ```bash
   cd client
   npm run dev
   ```

   Open the local URL Vite prints (normally `http://localhost:5173`). The API defaults to port `5000`; `VITE_API_BASE_URL` can override the client API base and should end in `/api`.

The server reads `server/.env`; see [`server/.env.example`](server/.env.example) for safe placeholders. Production configuration has additional requirements; see the [production readiness runbook](docs/production-readiness.md). Health endpoints are `/api/health` and `/api/health/database`.

## End-to-end demonstration

Use accounts provisioned for the appropriate roles; no credentials are bundled.

1. As **Estimator**, create an RFQ, select its customer and part information, and assign an owner and due date. Optionally use **RFQ Intake** to upload a PDF, XLSX, or `.eml`; inspect provenance and correct/accept suggestions before using them.
2. Create or edit a routing draft and save draft costing. Use historical routing recommendations as evidence-backed suggestions, then adjust the routing to the current part.
3. Submit the routing for **Plant Head** technical review. As Plant Head, review the current revision and approve it, or request changes with a mandatory comment. A routing edit creates a new revision and requires a fresh approval for a future quotation submission.
4. As Estimator, create a quotation with the available annual volume pricing, GST, and commercial terms. The existing deterministic costing and rounding rules are used; this README does not define or replace those formulas.
5. If the annual quotation value exceeds ₹25 lakh, a **Sales Head** must complete commercial approval. The Plant Head technical review is separate from Sales Head commercial approval.
6. Generate/download the quotation PDF. Configure the company profile in **Settings** as Admin before generating future customer-facing PDFs. Approval snapshots preserve the company details and commercial data captured at approval; later settings changes do not rewrite historical approved documents.

For historical data, open **History** and use the imported quotation search. The workbook and import behavior are documented in [the synthetic history guide](docs/synthetic-history-demo.md). Only use a newly verified isolated database for the demonstration import; the provided workbook is not real company history.

## Costing, approvals, and snapshots

Costing uses the application's existing deterministic calculation service and supports multiple annual volume tiers. Rate masters are effective dated. Plant Head review gates quotation progression on the current routing revision; Sales Head approval is a separate commercial control for annual value above ₹25 lakh. Approved quotation snapshots and previously generated documents are retained as historical records. No costing formula, GST rule, or approval threshold should be inferred from example workbook prices.

## AI-assisted intake and routing

PDF, XLSX, and `.eml` extraction are implemented. Deterministic extraction remains available, and Ollama can provide supplementary suggestions when explicitly configured. Suggestions are validated against source evidence and require human review; they do not create approved costing or quotations. A bounded synthetic service-level run with `qwen2.5:1.5b`, CPU-only inference, and four threads produced a validated `cycleTimeMinutes: 4.8` suggestion with literal workbook evidence in 137.8 seconds (model load 76.9s, prompt evaluation 30.8s, generation 28.3s). Browser/database completion after the thread-limit change remains unverified. Local inference was tested in WSL; a remote hosted endpoint requires separate configuration, free-quota/account verification, and Company A approval before any customer content is sent. Deterministic extraction and human review remain available if inference is unavailable. Email attachments are not extracted from `.eml` and must be uploaded separately. Outlook `.msg` is unsupported. Routing recommendations use historical similarity matching, not a generative model.

## Synthetic historical dataset

`demo-data/SYNTHETIC-DEMO-history-1400.xlsx` contains exactly 1,400 synthetic part rows grouped into 700 synthetic quotations. The sample names, identifiers, dates, and prices are illustrative and are not customer-provided transactions. Its generator and verified isolated import results are described in [docs/synthetic-history-demo.md](docs/synthetic-history-demo.md). The optional manufacturing seed is separate and is not part of the historical quotation import.

## Tests and builds

Run from the repository root. The backend test command should be run with optional database integration suites disabled unless a test database is separately configured and approved:

```bash
cd server
PHASE5_DB_TESTS=0 COMPANY_SETTINGS_DB_TESTS=0 npm test
npm run build
cd ../client
./../server/node_modules/.bin/vitest run --root . --config vitest.config.ts
npm run lint
npm run build
```

These test/build commands do not apply migrations or seed data. The database integration tests are opt-in and are not run by the commands above. `git diff --check` is also recommended before submission.

## Known limitations

- Local `qwen2.5:1.5b` inference produced a validated synthetic suggestion through the extraction service in 137.8 seconds with four CPU threads. A prior request timed out at 180 seconds, and browser/database completion after the thread-limit change remains unverified; do not treat local inference as reliable for operational SLAs.
- `.eml` attachments must be uploaded separately; Outlook `.msg` is unsupported.
- Routing suggestions are historical similarity recommendations, not AI-generated process plans.
- Historical imports contain synthetic commercial rows only and cannot reconstruct original manufacturing cost, routing, or approval evidence.
- Mailbox integration, automatic quotation emailing, CAD analysis, ERP integration, and supplier portal are out of scope.
- Production deployment requires environment-specific infrastructure, storage, backup, network, and monitoring controls described in the [runbook](docs/production-readiness.md).
