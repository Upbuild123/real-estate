# Property Financials App — Design Spec

Date: 2026-08-17

## Purpose

Michael owns 2 properties (soon 3), each managed by a property manager who
uploads a monthly PDF statement (income/expenses) to a shared Dropbox folder
around the 15th of each month. This app automatically ingests those
statements, extracts structured financial data, combines it with loan terms
and annual property taxes, and presents an easy-to-understand monthly and
year-to-date view per property — flagging anomalies and follow-ups.

## Scope (v1)

In scope:
- Automatic detection and ingestion of new property-manager PDFs from a
  shared Dropbox folder via the Dropbox API.
- AI-based (Claude) extraction of structured income/expense line items from
  each PDF.
- Manual upload of loan documents (parsed the same way as statements) to
  capture loan balance, interest rate, and payment schedule per property.
- Manual entry of annual property tax amounts, amortized monthly.
- Monthly and year-to-date dashboards per property and combined across all
  properties, including cash flow, interest expense, and tax amortization
  against actuals.
- Rule-based anomaly detection (statistical deviation from trailing
  average, missing expected line items, missing monthly statement) with
  flags for follow-up.
- Web app, hosted, accessible from anywhere, single user (Michael) — no
  multi-user auth in v1 beyond basic login for Michael himself.

Out of scope (v1):
- Multi-user accounts/roles (accountant/partner access).
- Automatic tax bill ingestion (manual entry only).
- Automatic loan statement re-sync (loan doc re-upload is manual when terms
  change).
- Notifications/alerts (email/SMS) — dashboard-only flags for now.

## Architecture

Next.js (App Router) full-stack application — React frontend and
server-side API routes/server actions in a single codebase. Postgres
database via Prisma ORM. Hosted on Vercel with a managed Postgres provider
(e.g. Neon). Claude API used for PDF data extraction (supports native PDF
input). Dropbox API used for folder access.

```
Dropbox (shared folder)
   │  API polling (scheduled job, e.g. daily or on-demand)
   ▼
dropbox-sync ──► raw PDF stored (blob storage) + DropboxFile record
   │
   ▼
pdf-extraction (Claude API) ──► structured JSON (line items)
   │
   ▼
financials (DB) ──linked to──► properties, loans, taxes
   │
   ▼
anomaly-detection (rule engine) ──► flags
   │
   ▼
dashboard (monthly / YTD views)
```

## Components

### `properties`
Core entity. Fields: id, name/address, acquisition date, active flag.
Each property has one Dropbox subfolder (or naming convention) mapped to
it, one or more loans, and a monthly financials history.

### `dropbox-sync`
Connects to Dropbox via OAuth app. Scheduled job (e.g. daily, or triggered
manually from the dashboard) lists files in the configured folder(s),
identifies new PDFs not yet ingested (by file id/hash), downloads them, and
stores them (raw file + metadata: property, source filename, upload
timestamp, statement month if inferable from filename).

### `pdf-extraction`
Sends a PDF (property statement or loan document) to Claude with a
structured-extraction prompt, requesting line items (category, description,
amount, month) as JSON matching a defined schema. Two extraction types:
- **Statement extraction**: income lines, expense lines, statement period,
  property manager summary totals, plus a per-unit rent roll (see below).
- **Loan document extraction**: original loan amount, current balance,
  interest rate, monthly payment, principal/interest split if shown. Loan
  documents (from Kiraboshi Bank, a Japanese bank, for both current
  properties) are variable-rate repayment schedules distinct in format
  from the Axios statements — see
  `docs/superpowers/specs/sample-loan-format-notes.md`. Key fields:
  origination date, maturity date, original loan amount, current
  interest rate, scheduled rate-change date + new rate, and a payment
  schedule table (date, total payment, principal, interest, remaining
  balance) — principal is a fixed amount per payment while interest
  varies with the declining balance and current rate. Property manager
  (for statements) and bank (for loans) may differ per property, so
  extraction templates are matched per-document-source, not assumed
  universal across properties.

Extraction results are stored alongside a reference to the source file for
traceability, plus the raw model output for auditability/debugging.

Both current properties are managed by the same property manager (Axios
Management), whose statements follow one consistent bilingual
(Japanese/English) PDF format — a summary + rent-roll page followed by an
itemized transaction ledger. The statement schema below is derived from
that format; details in
`docs/superpowers/specs/sample-statement-format-notes.md`. A different
property manager's format (for the third property) may require a second
extraction template — the extraction prompt/schema should be keyed by
property manager, not assumed universal.

Statement extraction schema:
- `activityMonth` — read from the statement's internal "Month" field, not
  the filename or remittance date (statements are remitted, and named,
  one month after the activity they cover).
- `rentRoll[]` — per unit: type (residence/parking), lessee (or vacant),
  monthly charge, rent collected, current/total arrears, deposit balance,
  lease start/end. This is the primary source for vacancy and
  delinquent-tenant anomaly signals.
- `lineItems[]` — per transaction: category (income/expense), account
  item, amount, tax, total, settlement date, note. Each line item is
  tagged `recurring: true/false` via a deterministic lookup table (e.g.
  rent, PM fee, utilities = recurring; renewal fees, deposits,
  restoration costs, agent fees = one-time) applied during normalization,
  not left to model judgment — this keeps anomaly detection consistent
  and prevents normal one-time items (e.g. a security deposit) from being
  flagged as expense/income anomalies.

### `financials`
Normalized monthly income/expense records per property, derived from
extracted statement data. Each record links back to its source
`DropboxFile`/extraction. Supports manual correction (in case extraction
is imperfect) — corrections are stored distinctly from raw extraction so
re-extraction doesn't silently overwrite manual fixes.

### `loans`
Loan records per property (a property may have one active loan in v1;
schema allows more for refinance history). Populated from uploaded loan
PDFs via `pdf-extraction`. Used to compute monthly interest expense,
principal paydown, and cash flow after debt service.

### `taxes`
Manually entered annual tax amount per property per tax year. Amortized
evenly across 12 months for monthly comparison views (actual vs.
amortized).

### `anomaly-detection`
Deterministic rule engine (not LLM-based, for cost/consistency) run after
each new month's financials are ingested. Initial rules:
- Expense line item deviates >X% from trailing 3-month average for that
  category.
- Expected monthly statement missing past the 20th of the month.
- Income line missing or zero when prior months had a value.
- Negative cash flow after debt service.
Rules are configurable thresholds, not hardcoded, so they can be tuned.
Flags surface on the dashboard per property/month with a dismiss/resolve
action.

### `dashboard`
- Per-property monthly view: income, expenses (by category), NOI, debt
  service, cash flow, tax amortization vs. actual, active flags.
- Per-property YTD view: same metrics aggregated year-to-date, with
  month-over-month trend.
- Portfolio view: all properties combined, monthly and YTD.
- Source traceability: every number links back to the source PDF and
  extraction for verification.

## Data Model (high-level)

- `Property` (id, name, address, active)
- `Loan` (id, propertyId, originalAmount, currentBalance, interestRate,
  monthlyPayment, startDate, sourceFileId)
- `TaxRecord` (id, propertyId, taxYear, annualAmount)
- `DropboxFile` (id, propertyId, dropboxFileId, filename, uploadedAt,
  fileType: statement|loan, storageUrl)
- `Extraction` (id, dropboxFileId, rawModelOutput, extractedAt, status)
- `FinancialRecord` (id, propertyId, month, category, description, amount,
  source: extracted|manual, extractionId nullable)
- `AnomalyFlag` (id, propertyId, month, ruleType, description, status:
  open|resolved, createdAt)

## Error Handling

- Dropbox sync failures (auth expiry, rate limits) logged and surfaced as a
  dashboard banner, retried on next scheduled run.
- Extraction failures (malformed PDF, model can't parse) mark the
  `Extraction` as `failed` and surface in a review queue — never silently
  drop a file.
- Manual corrections always take precedence over re-extraction; a
  re-extraction on the same file does not overwrite a `FinancialRecord`
  with `source: manual`.

## Testing

- Unit tests for anomaly rule engine (given fixture financial records,
  correct flags produced).
- Unit tests for tax amortization math and loan interest/cash-flow
  calculations.
- Integration test for the extraction pipeline using fixture PDFs and
  mocked Claude responses (verify schema parsing, not model accuracy).
- Manual verification pass on real (redacted) property manager PDFs before
  relying on extraction in production.

## Open Questions for Later

- Exact folder/naming convention Dropbox uses per property (needed before
  building `dropbox-sync` mapping logic) — resolve during implementation
  once real folder structure is confirmed.
- Whether to add email/SMS notifications for flags in a later version.
