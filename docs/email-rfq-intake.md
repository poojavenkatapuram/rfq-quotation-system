# Email RFQ intake (.eml)

ForgeFlow accepts RFC 822 `.eml` files through the existing authenticated RFQ Intake upload. The original email remains a private attachment and follows the same 10 MB limit, content-hash duplicate handling, document access policy, audit events, extraction job, and field-review workflow as PDF/XLSX files.

The parser extracts a sender email address, subject, valid date, and plain-text body. For HTML-only messages it removes markup and active-content elements before producing inert text. MIME parts are bounded by depth, part count, header size, body size, and the existing total upload limit. Malformed email structure is reported as an upload/extraction error. No email HTML is rendered in the browser.

Email header values and body-derived fields are suggestions. Body fields retain source ID, source reference, literal evidence, deterministic confidence, and extraction method; optional Ollama suggestions remain local, schema-validated, and subject to the existing mandatory human review. Email sender, subject, and date are shown as reviewable metadata fields. Nothing in an email automatically creates a customer, RFQ, costing, or quotation.

## Attachments and unsupported formats

Attachments embedded in an email are **not extracted**. They remain in the private original `.eml` file and the intake warning tells the estimator to upload each supported attachment separately. This deliberately avoids bypassing the existing PDF signature checks and XLSX archive safety checks. Direct PDF and XLSX intake behavior is unchanged.

Supported email input is `.eml` (RFC 822). Outlook `.msg`, Gmail/Outlook synchronization, automatic customer matching/creation, sending, and background email polling are not supported. Legacy `.xls`, executable or macro-enabled attachments, and other document formats are not supported.

## Manual verification

1. Sign in as an Estimator and open **RFQ Intake**.
2. Upload a plain-text `.eml` containing `From`, `Subject`, `Date`, `RFQ No`, `Part Number`, `Part Name`, and `Annual Volume` labels.
3. Confirm the original email appears in the extraction review and the sender/subject/date and body values are labeled as suggestions with source evidence.
4. Accept or reject every suggestion, correct values, select the registered customer, confirm RFQ details, and create the RFQ through the existing flow.
5. Upload an HTML-only message and a multipart message with a PDF/XLSX attachment. Confirm HTML scripts/markup do not render and the attachment warning asks the estimator to upload supported files separately.
6. Re-upload the same `.eml` as the same Estimator and confirm the existing extraction/review state is reused. Confirm unsupported or malformed input is rejected without creating an extraction job.
7. Sign in as a role without intake-write permission and confirm upload is denied. Existing document read authorization still governs stored email-derived fields and evidence.
