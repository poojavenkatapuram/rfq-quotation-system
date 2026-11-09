# ForgeFlow deployment quickstart

This is a deployment template, not a live deployment. It does not contain account credentials, a production database URL, or an AI key. Importing `render.yaml` and creating its resources is a manual account action; do not sync it until the database target and expected spend have been approved.

## Recommended deadline path

- **Frontend:** Render Static Site. Vite produces `client/dist`; set build-time `VITE_API_BASE_URL` to the API's HTTPS origin ending in `/api`.
- **API:** Render Web Service using the checked-in Blueprint. It uses an always-on paid `0.5c-1g` plan and a 1 GB persistent disk mounted at `/var/data`. The app writes uploads under `/var/data/rfq-documents`. Do not change this to a free web service: free services have ephemeral filesystems and spin down.
- **PostgreSQL:** create a new, empty Neon project/database for the hosted app. Use its direct PostgreSQL connection URL as the Render `DATABASE_URL`; do not reuse either local ForgeFlow database. Neon Free currently includes 1 GB storage and 100 compute-hours per project/month, subject to its current limits. Choose a matching Singapore region where available.

Render's current listed `0.5c-1g` compute is about **US$19/month**; a 1 GB Render disk is listed at **US$0.25/month**. Render static hosting and the Neon free allowance can be $0 within their limits. Taxes, overages, and provider plan changes may apply. Render's free Postgres is unsuitable for persistent assignment data: it is limited to 1 GB and expires after 30 days. See current [Render pricing](https://render.com/pricing), [Render free-service limitations](https://render.com/docs/free), [Render persistent disks](https://render.com/docs/disks), and [Neon Free plan details](https://neon.com/blog/neon-free-plan-1-gb-per-project).

Vercel can host the Vite static frontend technically, but its Hobby plan is for personal, non-commercial use. For a Company A assignment, use a plan permitted by the intended use; this template uses Render static hosting instead. See [Vercel's Hobby plan terms](https://vercel.com/docs/plans/hobby).

## Provisioning sequence

1. Create the hosted database in the intended account and region. Confirm the project/database name and host in the provider dashboard. It must be a new empty database; never point deployment variables at `rfq_quotation_db` or `forgeflow_synthetic_demo_test`.
2. Import `render.yaml` into Render. Enter the new database URL and the frontend origin in the prompted backend values. Keep the generated JWT secret in Render's secret store. Render creates an API service with a persistent disk and a static frontend; the template has automatic deploys disabled after initial creation.
3. Set the static site's `VITE_API_BASE_URL` to the actual API origin plus `/api`. Set the API's `CLIENT_URL` to the exact static-site HTTPS origin (origin only, no path). These values are intentionally entered after Render assigns the service URLs.
4. Before the first deploy, verify the API's `DATABASE_URL` target in Render is the newly created hosted database. The API Blueprint's pre-deploy command runs only `npx prisma migrate deploy`; it never runs `db push`, reset, seed, or destructive cleanup. It applies the repository's checked-in migrations to the new target. Do not use a production/business database for this first deploy.
5. Set the API health check to `/api/health/database`. Confirm both `/api/health` and `/api/health/database` return success. Verify the API is allowing the exact frontend origin via `CLIENT_URL`; do not use wildcard CORS.
6. Build and publish the frontend after setting `VITE_API_BASE_URL`. Test login and role-protected pages using accounts provisioned for this new environment. Do not seed real customer data. For the first Admin only, use the existing one-time seed with a new deployment-only database and bootstrap credentials in a protected one-off process; never add those credentials to Git or use historical/local databases.
7. Upload only explicitly synthetic test files. Confirm downloads remain authorized and files still exist after an approved service redeploy/restart before treating document persistence as verified.

The API disk is private to one Render instance and prevents horizontal scaling/zero-downtime replacement while attached. It is suitable for a small assignment demo, not a multi-instance production deployment. For multiple instances, replace the filesystem adapter with private S3-compatible object storage and test access-control behavior before moving uploads.

## AI deployment choice and data handling

The current production code defaults AI off and the local Ollama URL points to the backend's loopback. A cloud host cannot reach Ollama in WSL. The latest code supports a configurable HTTPS Ollama-compatible URL and a backend-only bearer key. For a fast hosted inference proof, Ollama Cloud provides a direct API at `https://ollama.com` with `Authorization: Bearer ...`; available cloud models and token prices change, so confirm model availability in the account before enabling it. For example, the current price page lists `gpt-oss:20b` at US$0.07 per million input tokens and US$0.30 per million output tokens; usage requires an Ollama account/API key and funded usage credits. The Ollama pricing page also advertises Pro at US$20/month including US$60 usage credits. See [Ollama Cloud API authentication](https://github.com/ollama/ollama/blob/main/docs/api/authentication.mdx), [Ollama Cloud model access](https://ollama.com/blog/cloud-models), and [current model pricing](https://ollama.com/pricing).

**Do not enable remote AI for Company A documents until Company A explicitly approves sending extracted RFQ text to Ollama Cloud and reviews its data-processing terms/location.** Ollama states prompts/responses are not logged or used for training and that hosted inference may run in the US, Europe, or Singapore; this is provider policy, not a substitute for Company A approval. The Blueprint intentionally sets `LOCAL_AI_ENABLED=false`. After approval, configure `OLLAMA_RFQ_BASE_URL=https://ollama.com`, a currently supported hosted model, and `OLLAMA_API_KEY` in Render's backend secret store; then set `LOCAL_AI_ENABLED=true` and run one bounded synthetic end-to-end extraction. Do not put the key in Vite variables, the frontend, logs, or Git.

Remote model compatibility, structured-output behavior, provider quotas, and latency have not been validated against an Ollama Cloud account. Until that smoke test succeeds, document intake still uses deterministic extraction and AI suggestions are unavailable on the hosted app. Suggestions remain evidence-validated and require estimator review; this does not alter costing or quotation approval.

## Account actions still required

- GitHub access for Render to read the repository.
- Render account, billing approval for the always-on API and persistent disk, and permission to create publicly reachable services.
- Neon account and approval to create a **new empty** hosted database.
- Admin account provisioning for the new database, then role-specific demonstration accounts created through Admin.
- Company decision on whether RFQ document text may be sent to Ollama Cloud; if approved, an Ollama account/API key and usage budget.

No service, database, hosted key, migration, or public URL is created by this repository configuration. A URL is live only after deployment and public health/login/workflow checks succeed.
