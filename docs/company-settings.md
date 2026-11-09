# Company Settings (Phase A)

Admin accounts can open **Settings → Company details**. The five supported fields are company name, registered address, contact email, contact phone, and GSTIN. Name and address are required. Contact fields and GSTIN are optional; a supplied GSTIN is checked for format, not registration authenticity. Phone numbers support 7–15 digits with an optional leading plus and common separators, without extensions. Company names are limited to 200 characters and addresses to 2000.

`GET /api/settings/company` and `PUT /api/settings/company` both require an active authenticated Admin. PUT takes the five fields and `expectedVersion`. The first save uses version 0, creates singleton profile 1, and returns version 1. Subsequent saves conditionally increment the version. Conflicting saves return HTTP 409; the form retains the entered values and requires an explicit reload before another save. Reloading replaces edits with the saved values.

Settings and the `COMPANY_SETTINGS_SAVED` audit are committed in the same database transaction. Audit evidence includes the acting administrator, previous/current values, prior source, and versions. The profile is stored in PostgreSQL and survives refreshes and application restarts. Reads do not create rows.

Until the first save, the existing `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_EMAIL`, `COMPANY_PHONE`, and `COMPANY_GST_NUMBER` environment variables remain the fallback. Once a database profile exists, all its fields are authoritative, including intentionally cleared optional values. A server restart is not needed after saving through Settings.

Future quotation snapshots receive the company details effective at approval time. Both automatic approval and Sales Head approval read the profile inside their existing transaction. A quotation waiting for Sales Head approval does not freeze company details at submission. The existing snapshot format and financial calculations are unchanged; the profile version/source are recorded in approval audit evidence.

Existing approved/sent snapshots are never backfilled. PDF download uses the saved snapshot, not current settings. Consequently an older PDF may still show “Company details pending configuration” after company settings are saved. Create and approve a new quotation to use the new details. PDFs are generated on demand, so comparisons should check commercial content rather than metadata-dependent byte equality.

No theme or logo implementation is included. The existing PDF layout is unchanged; review the first PDF with the actual company name/address, especially long names and multiline addresses.

## Verification

From `server/`:

```sh
npm run build
npm test -- --maxWorkers=2
```

Opt-in local database checks use transactions that roll back, leaving no test company profile or audit records. They refuse to touch an already configured profile:

```sh
COMPANY_SETTINGS_DB_TESTS=1 npm test -- --maxWorkers=2
```

From `client/`, using the repository's installed test runners:

```sh
../server/node_modules/.bin/vitest run --config vitest.config.ts
../server/node_modules/.bin/tsx --test tests/intake-state.test.ts
npm run lint
npm run build
```

Run `git diff --check` from the repository root. Browser checks: Admin save → reload → sign out/in → Settings retains values; non-Admins cannot view/edit company settings; two Admin tabs produce a conflict for the stale save; a fresh approved PDF contains configured details while an old approved PDF retains its original content. The singleton migration must only be applied to an explicitly approved database.
