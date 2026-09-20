# Google Drive Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dropbox document-sync integration with Google Drive (service-account auth, per-property Drive folders), renaming all Dropbox-specific naming to generic/Drive terms end to end.

**Architecture:** A new `googleDriveAuth.ts` mints short-lived OAuth access tokens per call by signing a JWT with a service-account private key and exchanging it at Google's token endpoint — no `googleapis` SDK, raw `fetch` + Node `crypto`, matching the existing "no SDK" pattern. `googleDriveClient.ts` and `driveSync.ts` replace their Dropbox equivalents with equivalent behavior against the Drive v3 REST API. The Prisma schema is renamed via a fresh migration (`DropboxFile` → `SourceFile`, `dropboxFileId` → `driveFileId`/`sourceFileId` as appropriate, `Property.dropboxFolderPath` → `Property.googleDriveFolderId`). All call sites (extraction functions, API routes, admin UI, tests) are updated in lockstep. This is a full cutover — no dual-provider support.

**Tech Stack:** Next.js 16 (App Router), Prisma 6 + PostgreSQL (Neon), Vitest, `@vercel/blob`. No new npm dependency — JWT signing uses Node's built-in `crypto` module.

**Spec:** `docs/superpowers/specs/2026-09-20-google-drive-migration-design.md`

## Global Constraints

- Full cutover, no dual Dropbox/Drive support window.
- No `googleapis` SDK — raw HTTP (`fetch`) + Node `crypto`, consistent with the existing Dropbox integration's approach.
- New env vars: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (PEM, `\n`-escaped). Remove `DROPBOX_REFRESH_TOKEN`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` from `.env.local` (leave other keys untouched).
- Schema migration is additive-in-history (new migration file), never edits existing migration files.
- `getAccessToken(): Promise<string>` mints a fresh token on every call — no caching across invocations.

---

### Task 1: Rename Prisma schema and generate migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: new migration folder under `prisma/migrations/` (via `prisma migrate dev`)

**Interfaces:**
- Produces: `Property.googleDriveFolderId: String?` (was `dropboxFolderPath`), `Property.sourceFiles` relation (was `dropboxFiles`), `SourceFile` model (was `DropboxFile`) with `driveFileId: String @unique` (was `dropboxFileId`), `Extraction.sourceFileId: String @unique` FK to `SourceFile.id` (was `Extraction.dropboxFileId` FK to `DropboxFile.id`).

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Change the `Property` model:
```prisma
model Property {
  id                 String         @id @default(cuid())
  name               String
  address            String
  googleDriveFolderId String?
  active             Boolean        @default(true)
  createdAt      DateTime       @default(now())
  loans          Loan[]
  annualCosts    AnnualCost[]
  sourceFiles    SourceFile[]
  financialRecords FinancialRecord[]
  anomalyFlags   AnomalyFlag[]
  rentRollEntries RentRollEntry[]
}
```

Rename the `DropboxFile` model to `SourceFile` and rename its unique field:
```prisma
model SourceFile {
  id             String   @id @default(cuid())
  propertyId     String
  property       Property @relation(fields: [propertyId], references: [id])
  driveFileId    String   @unique
  filename       String
  uploadedAt     DateTime
  fileType       String   // "statement" | "loan"
  storageUrl     String
  extraction     Extraction?
}
```

Rename the `Extraction` model's FK field and relation:
```prisma
model Extraction {
  id             String      @id @default(cuid())
  sourceFileId   String      @unique
  sourceFile     SourceFile  @relation(fields: [sourceFileId], references: [id])
  rawModelOutput String
  status         String      // "success" | "failed"
  extractedAt    DateTime    @default(now())
  financialRecords FinancialRecord[]
  rentRollEntries RentRollEntry[]
}
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name rename_dropbox_to_drive`

Expected: a new folder appears under `prisma/migrations/` containing SQL that renames the table and columns (Prisma's diff engine detects the rename via matching structure — if it instead generates a drop+recreate, edit the generated SQL file to use `ALTER TABLE ... RENAME TO` / `ALTER TABLE ... RENAME COLUMN ...` statements instead, to preserve existing data. Do not edit any other migration file.)

- [ ] **Step 3: Verify the Prisma client regenerated cleanly**

Run: `npx prisma generate`
Expected: no errors; `@prisma/client` types now expose `SourceFile`, `Property.googleDriveFolderId`, `Extraction.sourceFileId`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Rename Dropbox schema fields to Google Drive equivalents"
```

---

### Task 2: Google Drive auth module

**Files:**
- Create: `lib/googleDriveAuth.ts`
- Create: `tests/googleDriveAuth.test.ts`
- Delete: `lib/dropboxAuth.ts`, `tests/dropboxAuth.test.ts`

**Interfaces:**
- Produces: `getAccessToken(): Promise<string>` — reads `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` from env, throws if either is missing, builds and signs a JWT, exchanges it at `https://oauth2.googleapis.com/token`, returns `data.access_token`.

- [ ] **Step 1: Write the failing tests**

Create `tests/googleDriveAuth.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getAccessToken } from '../lib/googleDriveAuth'

const ORIGINAL_ENV = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
}

// A real RSA private key so the JWT signing step in getAccessToken succeeds; the token
// exchange itself is mocked, so the key's validity (not its authenticity to Google) is
// what these tests exercise.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
MzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu
NMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCdPEovGhLa0VzMaQ8s+CLOyS56YyCFGeJZ
qgtzJ6GR3eqoYSW9b9UMvkBpZODSctWSNGj3P7jRFDO5VoTwCQAWbFnOjDfH5Ulg
p2PKSQnSJP3AJLQNFNe7br1XbrhV//eO+t51mIpGSDCUv3E0DDFcWDTH9cXDTTlR
ZVEiR2BwpZOOkE/Z0/BVnhZYL71oZV34bKfWjQIt6V/isSMahdsAASACp4ZTGtwi
VuNd9tuvAgMBAAECggEBAKTmjaS6tkK8BlPXClTQ2vpz/N6uxDeS35mXpqasqskV
laAidgg/sWqpjXDbXr93otIMLlWsM+X0CqMDgSXKejLS2jx4GDjI1ZTXg++0AMJ8
sJ74pWzVDOfmCEQ/7wXs3+cbnXhKriO8Z036q92Qc1+N87SI38nkGa0ABH9CN83H
mQqt4fB7UdHzuIRe/me2PGhIq5ZBzj6h3BpoPGzEP+x3l9YmK8t/1cN0pqI+dQwY
dgfGjackLu/2qH80MCF7IyQaseZUOJyKrCLtSD/Iixv/hzDEUPfOCjFDgTpzf3cw
ta8+oE4wHCo1iI1/4TlPkwmXx4qSXtmw4aQPz7IDQvECgYEA8KNThCO2gsC2I9PQ
DM/8Cw0O983WCDY+oi+7JPiNAJwv5DYBqEZB1QYdj06YD16XlC/HAZMsMku1na2T
N0driwenQQWzoev3g2S7gRDoS/FCJSI3jJ+kjgtaA7Qmzlgk1TxODN+G1H91HW7t
0l7VnL27IWyYo2qRRK3jzxqUiPUCgYEAx0oQs2reBQGMVZnApD1jeq7n4MvNLcPv
t8b/eU9iUv6Y4Mj0Suo/AU8lYZXm8ubbqAlwz2VSVunD2tOplHyMUrtCtObAfVDU
AhCndKaA9gApgfb3xw1IKbuQ1u4IF1FJl3VtumfQn//LiH1B3rXhcdyo3/vIttEk
48RakUKClU8CgYEAzV7W3COOlDDcQd935DdtKBFRAPRPAlspQUnzMi5eSHMD/ISL
DY5IiQHbIH83D4bvXq0X7qQoSBSNP7Dvv3HYuqMhf0DaegrlBuJllFVVq9qPVRnK
xt1Il2HgxOBvbhOT+9in1BzA+YJ99UzC85O0Qz06A+CmtHEy4aZ2kj5hHjECgYEA
mNS4+A8Fkss8Js1RieK2LniBxMgmYml3pfVLKGnzmng7H2+cwPLhPIzIuwytXywh
2bzbsYEfYx3EoEVgMEpPhoarQnYPukrJO4gwE2o5Te6T5mJSZGlQJQj9q4ZB2Dfz
et6INsK0oG8XVGXSpQvQh3RUYekCZQkBBFcpqWpbIEsCgYAnM3DQf3FJoSnXaMhr
VBIovic5l0xFkEHskAjFTevO86Fsz1C2aSeRKSqGFoOQ0tmJzBEs1R6KqnHInicD
TQrKhArgLXX4v3CddjfTRJkFWDbE/CkvKZNHVeFTM/M/BEcT
-----END PRIVATE KEY-----`

describe('getAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = ORIGINAL_ENV.GOOGLE_SERVICE_ACCOUNT_EMAIL
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = ORIGINAL_ENV.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  })

  it('exchanges a signed JWT for an access token via the Google OAuth endpoint', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@test-project.iam.gserviceaccount.com'
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = TEST_PRIVATE_KEY

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh-access-token', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const token = await getAccessToken()

    expect(token).toBe('fresh-access-token')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' })
    )
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(typeof body.get('assertion')).toBe('string')
    expect(body.get('assertion')!.split('.')).toHaveLength(3)
  })

  it('throws a descriptive error when the token exchange fails', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@test-project.iam.gserviceaccount.com'
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = TEST_PRIVATE_KEY

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid_grant' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAccessToken()).rejects.toThrow(/401/)
  })

  it('throws if any of the required env vars are missing', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = TEST_PRIVATE_KEY

    await expect(getAccessToken()).rejects.toThrow(/GOOGLE_SERVICE_ACCOUNT_EMAIL/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/googleDriveAuth.test.ts`
Expected: FAIL — `lib/googleDriveAuth.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/googleDriveAuth.ts`**

```typescript
import { createSign } from 'crypto'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function buildSignedJwt(email: string, privateKey: string): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claimSet = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const signature = base64url(signer.sign(privateKey))

  return `${unsigned}.${signature}`
}

// Google's service-account tokens are short-lived (1 hour) with no unattended way to extend
// them, so — same approach as the prior Dropbox integration — mint a fresh access token from
// the service account credentials before every Drive API call rather than caching one across
// serverless invocations.
export async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

  if (!email || !privateKey) {
    throw new Error(
      'Google service account credentials are not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)'
    )
  }

  const jwt = buildSignedJwt(email, privateKey.replace(/\\n/g, '\n'))

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google token exchange failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.access_token as string
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/googleDriveAuth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Delete the old Dropbox auth module and test**

```bash
git rm lib/dropboxAuth.ts tests/dropboxAuth.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/googleDriveAuth.ts tests/googleDriveAuth.test.ts
git commit -m "Replace Dropbox auth with Google service-account JWT auth"
```

---

### Task 3: Google Drive client (list + download)

**Files:**
- Create: `lib/googleDriveClient.ts`
- Create: `tests/googleDriveClient.test.ts`
- Delete: `lib/dropboxClient.ts`, `tests/dropboxClient.test.ts`

**Interfaces:**
- Consumes: `getAccessToken(): Promise<string>` from `lib/googleDriveAuth.ts` (Task 2).
- Produces: `listStatementFiles(folderId: string): Promise<{ id: string; name: string; modifiedTime: Date }[]>`, `downloadFile(fileId: string): Promise<Buffer>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/googleDriveClient.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../lib/googleDriveAuth', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
}))

import { listStatementFiles, downloadFile } from '../lib/googleDriveClient'

describe('googleDriveClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists PDF files, filtering out unrelated xlsx workbooks and Drive folders', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          { id: 'id1', name: 'a.pdf', mimeType: 'application/pdf', modifiedTime: '2026-02-15T00:00:00.000Z' },
          { id: 'id2', name: '2026 result vs budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-02-15T00:00:00.000Z' },
          { id: 'id3', name: 'subfolder', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-02-15T00:00:00.000Z' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const files = await listStatementFiles('folder-abc')

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('a.pdf')
    expect(files[0].id).toBe('id1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('https://www.googleapis.com/drive/v3/files')
    expect(url).toContain(encodeURIComponent("'folder-abc' in parents and trashed=false"))
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer mock-access-token' })
  })

  it('lists an xlsx statement whose filename matches the "<id>_<YYYY-MM>_report" pattern', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          { id: 'id1', name: '457917_2026-08_report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-08-14T00:00:00.000Z' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const files = await listStatementFiles('folder-abc')

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('457917_2026-08_report.xlsx')
  })

  it('throws a descriptive error when listing fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid credentials' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listStatementFiles('folder-abc')).rejects.toThrow(/401/)
  })

  it('downloads a file as a Buffer via the Drive media endpoint, using a refreshed access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('pdf-bytes').buffer,
    })
    vi.stubGlobal('fetch', fetchMock)

    const buffer = await downloadFile('file-id-1')

    expect(buffer.toString()).toBe('pdf-bytes')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-id-1?alt=media',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mock-access-token' }),
      })
    )
  })

  it('throws a descriptive error when the download request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'File not found',
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadFile('missing-id')).rejects.toThrow(/404/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/googleDriveClient.test.ts`
Expected: FAIL — `lib/googleDriveClient.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/googleDriveClient.ts`**

```typescript
import { getAccessToken } from './googleDriveAuth'

// A monthly statement filename follows "<id>_<YYYY-MM>_report.<ext>" (with the PM's chosen
// extension — pdf or, as of Aug 2026, xlsx). Requiring this pattern for .xlsx specifically
// excludes other spreadsheets the PM occasionally drops in the same folder (e.g. an annual
// "result vs budget" workbook) that aren't monthly statements at all. Older-year PDFs used a
// looser naming convention before this pattern was adopted, so .pdf is accepted unconditionally.
const XLSX_STATEMENT_PATTERN = /^\d+_\d{4}-\d{2}_report/i

function isStatementFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return true
  if (lower.endsWith('.xlsx')) return XLSX_STATEMENT_PATTERN.test(name)
  return false
}

export async function listStatementFiles(
  folderId: string
): Promise<{ id: string; name: string; modifiedTime: Date }[]> {
  const accessToken = await getAccessToken()

  const query = `'${folderId}' in parents and trashed=false`
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime)')}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Drive files.list failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.files
    .filter((file: any) => file.mimeType !== 'application/vnd.google-apps.folder' && isStatementFile(file.name))
    .map((file: any) => ({
      id: file.id,
      name: file.name,
      modifiedTime: new Date(file.modifiedTime),
    }))
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const accessToken = await getAccessToken()

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Drive download failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/googleDriveClient.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Delete the old Dropbox client and test**

```bash
git rm lib/dropboxClient.ts tests/dropboxClient.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/googleDriveClient.ts tests/googleDriveClient.test.ts
git commit -m "Replace Dropbox client with Google Drive files.list/download client"
```

---

### Task 4: Extraction function param renames (`dropboxFileId` → `sourceFileId`)

**Files:**
- Modify: `lib/extraction/extractLoan.ts`
- Modify: `lib/extraction/extractStatement.ts`
- Modify: `tests/extraction/extractLoan.test.ts`
- Modify: `tests/extraction/extractStatement.test.ts`

**Interfaces:**
- Consumes: `db.sourceFile`, `db.extraction` (Prisma client renamed per Task 1: `Extraction.sourceFileId`, `SourceFile.driveFileId`).
- Produces: `ingestLoanDocument(params: { sourceFileId: string | null; propertyId: string; pdfBase64: string })`, `ingestStatement(params: { sourceFileId: string; propertyId: string } & ({ pdfBase64: string } | { xlsxBase64: string }))`.

- [ ] **Step 1: Update `tests/extraction/extractLoan.test.ts`**

Replace every `dropboxFileId` occurrence with `sourceFileId` (parameter name only — test data/assertions otherwise unchanged). E.g.:
```typescript
const result = await ingestLoanDocument({ sourceFileId: null, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })
```
and
```typescript
it('does not create a duplicate Loan when the same sourceFileId is re-processed', async () => {
  const property = await createProperty({ name: 'DO5 Loan Dedupe Test', address: 'x' })

  const first = await ingestLoanDocument({ sourceFileId: 'drive-loan-dedupe-1', propertyId: property.id, pdfBase64: 'ZmFrZQ==' })
  expect(first.status).toBe('success')

  const second = await ingestLoanDocument({ sourceFileId: 'drive-loan-dedupe-1', propertyId: property.id, pdfBase64: 'ZmFrZQ==' })
  expect(second.status).toBe('success')
  // ... existing dedupe assertions unchanged
})
```

- [ ] **Step 2: Update `tests/extraction/extractStatement.test.ts`**

Replace every `dropboxFileId` occurrence — both as the `db.sourceFile.create({ data: { ... } })` field (rename to match Task 1's `SourceFile.driveFileId` for the seeded row's external id, and use the created row's `.id` as `sourceFileId` when calling `ingestStatement`). For example, the pattern:
```typescript
const dropboxFile = await db.dropboxFile.create({
  data: {
    propertyId: property.id,
    dropboxFileId: 'dbx-statement-1',
    filename: '429878_2026-02_report.pdf',
    uploadedAt: new Date(),
    fileType: 'statement',
    storageUrl: 'https://blob.example.com/x.pdf',
  },
})

const result = await ingestStatement({
  dropboxFileId: dropboxFile.id,
  propertyId: property.id,
  pdfBase64: 'ZmFrZQ==',
})
```
becomes:
```typescript
const sourceFile = await db.sourceFile.create({
  data: {
    propertyId: property.id,
    driveFileId: 'drive-statement-1',
    filename: '429878_2026-02_report.pdf',
    uploadedAt: new Date(),
    fileType: 'statement',
    storageUrl: 'https://blob.example.com/x.pdf',
  },
})

const result = await ingestStatement({
  sourceFileId: sourceFile.id,
  propertyId: property.id,
  pdfBase64: 'ZmFrZQ==',
})
```
Apply this same `db.dropboxFile` → `db.sourceFile`, `dropboxFileId:` (external id field) → `driveFileId:`, and `dropboxFileId:` (param to `ingestStatement`) → `sourceFileId:` rename consistently across every test case in the file (there are 6 such blocks — statement, xlsx, rentroll x2, multiunit, manual-multiunit).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/extraction/extractLoan.test.ts tests/extraction/extractStatement.test.ts`
Expected: FAIL — `lib/extraction/*.ts` still expects `dropboxFileId`, and `db.sourceFile` doesn't exist as a Prisma client property under the old param names used internally (implementation not yet updated).

- [ ] **Step 4: Update `lib/extraction/extractLoan.ts`**

Rename the param and internal references:
```typescript
export async function ingestLoanDocument(params: {
  sourceFileId: string | null
  propertyId: string
  pdfBase64: string
}): Promise<{ status: 'success'; loanId: string } | { status: 'failed'; error: string }> {
  // ... extraction logic unchanged ...

  const loanData = {
    // ... unchanged fields ...
    sourceFileId: params.sourceFileId ?? undefined,
  }

  // Prevent duplicate Loan rows when the same source file is re-processed (e.g. a
  // re-triggered sync). Manual uploads (sourceFileId === null) always create a new row,
  // since there's no reliable way to tell "same document re-uploaded" from "new document"
  // without a source file identity to key on.
  const existingLoan = params.sourceFileId
    ? await db.loan.findFirst({ where: { propertyId: params.propertyId, sourceFileId: params.sourceFileId } })
    : null

  // ... rest unchanged ...
}
```
(Only the `dropboxFileId` param name, its two internal usages, and the comment wording change — `Loan.sourceFileId` itself was already correctly named and is untouched.)

- [ ] **Step 5: Update `lib/extraction/extractStatement.ts`**

Rename the param and internal references:
```typescript
export async function ingestStatement(
  params: {
    sourceFileId: string
    propertyId: string
  } & ({ pdfBase64: string } | { xlsxBase64: string })
): Promise<
  | { status: 'success'; extractionId: string; recordsCreated: number; activityMonth: string }
  | { status: 'failed'; extractionId: string; error: string }
> {
  // ... extraction logic unchanged, replacing every params.dropboxFileId with params.sourceFileId
  // and every db.extraction.{upsert,findUnique,create} `where`/`create` key
  // `dropboxFileId: params.dropboxFileId` with `sourceFileId: params.sourceFileId` ...
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/extraction/extractLoan.test.ts tests/extraction/extractStatement.test.ts`
Expected: PASS (all existing test cases, unchanged in count and assertions)

- [ ] **Step 7: Commit**

```bash
git add lib/extraction/extractLoan.ts lib/extraction/extractStatement.ts tests/extraction/extractLoan.test.ts tests/extraction/extractStatement.test.ts
git commit -m "Rename extraction function params from dropboxFileId to sourceFileId"
```

---

### Task 5: Drive sync engine

**Files:**
- Create: `lib/driveSync.ts`
- Create: `tests/driveSync.test.ts`
- Delete: `lib/dropboxSync.ts`, `tests/dropboxSync.test.ts`

**Interfaces:**
- Consumes: `listStatementFiles`, `downloadFile` from `lib/googleDriveClient.ts` (Task 3); `uploadToStorage` from `lib/blobStorage.ts` (unchanged); `ingestStatement({ sourceFileId, propertyId, pdfBase64 | xlsxBase64 })`, `ingestLoanDocument({ sourceFileId, propertyId, pdfBase64 })` from Task 4; `runAnomalyRules(propertyId, activityMonth)` (unchanged); `db.sourceFile`, `db.extraction` (Task 1 schema).
- Produces: `syncDriveFolder(property: { id: string; googleDriveFolderId: string }): Promise<{ newFiles: number; skipped: number; failed: number }>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/driveSync.test.ts` (adapted from the deleted `tests/dropboxSync.test.ts` — same scenarios, renamed types/fields, dropping the Dropbox-specific `pathLower` field since Drive addresses files by `id`):
```typescript
// tests/driveSync.test.ts
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'

vi.mock('../lib/googleDriveClient', () => ({
  listStatementFiles: vi.fn().mockResolvedValue([
    { id: 'drive1', name: '429878_2026-02_report.pdf', modifiedTime: new Date('2026-02-15') },
  ]),
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}))

vi.mock('../lib/blobStorage', () => ({
  uploadToStorage: vi.fn().mockResolvedValue('https://blob.example.com/429878_2026-02_report.pdf'),
}))

vi.mock('../lib/extraction/extractStatement', () => ({
  ingestStatement: vi.fn().mockResolvedValue({
    status: 'success',
    extractionId: 'ext1',
    recordsCreated: 1,
    activityMonth: '2026-02',
  }),
}))

vi.mock('../lib/extraction/extractLoan', () => ({
  ingestLoanDocument: vi.fn().mockResolvedValue({ status: 'success', loanId: 'loan1' }),
}))

vi.mock('../lib/anomalyRules', () => ({
  runAnomalyRules: vi.fn().mockResolvedValue([]),
}))

import { syncDriveFolder } from '../lib/driveSync'
import { listStatementFiles } from '../lib/googleDriveClient'
import { ingestStatement } from '../lib/extraction/extractStatement'
import { ingestLoanDocument } from '../lib/extraction/extractLoan'
import { runAnomalyRules } from '../lib/anomalyRules'

describe('syncDriveFolder', () => {
  it('creates a SourceFile record for a new file', async () => {
    const property = await createProperty({ name: 'Ide Sync Test', address: 'x' })
    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })
    expect(result.newFiles).toBe(1)
    expect(result.skipped).toBe(0)
    const stored = await db.sourceFile.findUnique({ where: { driveFileId: 'drive1' } })
    expect(stored?.filename).toBe('429878_2026-02_report.pdf')
    expect(stored?.fileType).toBe('statement')
  })

  it('passes an xlsx statement to ingestStatement as xlsxBase64 rather than pdfBase64', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'drive-xlsx-1', name: '457917_2026-08_report.xlsx', modifiedTime: new Date('2026-08-14') },
    ])
    vi.mocked(ingestStatement).mockClear()

    const property = await createProperty({ name: 'Ide Sync Xlsx Test', address: 'x' })
    await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(ingestStatement).toHaveBeenCalledWith(
      expect.objectContaining({ xlsxBase64: expect.any(String) })
    )
    const call = vi.mocked(ingestStatement).mock.calls[0][0]
    expect('pdfBase64' in call).toBe(false)
  })

  it('skips a file already ingested with a successful extraction (dedupe by driveFileId)', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 2', address: 'x' })
    const existingFile = await db.sourceFile.create({
      data: {
        propertyId: property.id,
        driveFileId: 'drive1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/existing.pdf',
      },
    })
    await db.extraction.create({
      data: { sourceFileId: existingFile.id, rawModelOutput: '{}', status: 'success' },
    })
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(1)
    expect(ingestStatement).not.toHaveBeenCalled()
  })

  it('retries a file that has a SourceFile row but no successful extraction (self-heals a stuck/interrupted sync)', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 6', address: 'x' })
    const stuckFile = await db.sourceFile.create({
      data: {
        propertyId: property.id,
        driveFileId: 'drive1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/stuck.pdf',
      },
    })
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(0)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
    expect(ingestStatement).toHaveBeenCalledWith(expect.objectContaining({ sourceFileId: stuckFile.id }))
  })

  it('retries a file whose only extraction attempt failed', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 7', address: 'x' })
    const failedFile = await db.sourceFile.create({
      data: {
        propertyId: property.id,
        driveFileId: 'drive1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/failed.pdf',
      },
    })
    await db.extraction.create({
      data: { sourceFileId: failedFile.id, rawModelOutput: 'bad json', status: 'failed' },
    })
    vi.mocked(ingestStatement).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(0)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
  })

  it('triggers ingestStatement and, on success, runAnomalyRules for a new statement file', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 3', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(runAnomalyRules).mockClear()
    vi.mocked(ingestLoanDocument).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(1)
    expect(ingestStatement).toHaveBeenCalledTimes(1)
    const sourceFile = await db.sourceFile.findUnique({ where: { driveFileId: 'drive1' } })
    expect(ingestStatement).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: property.id, sourceFileId: sourceFile!.id })
    )
    expect(runAnomalyRules).toHaveBeenCalledTimes(1)
    expect(runAnomalyRules).toHaveBeenCalledWith(property.id, '2026-02')
    expect(ingestLoanDocument).not.toHaveBeenCalled()
  })

  it('triggers ingestLoanDocument (and not ingestStatement) for a new loan file', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'drive-loan-1', name: 'loan-schedule.pdf', modifiedTime: new Date('2026-02-15') },
    ])
    const property = await createProperty({ name: 'Ide Sync Test 4', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(ingestLoanDocument).mockClear()
    vi.mocked(runAnomalyRules).mockClear()

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(1)
    expect(ingestLoanDocument).toHaveBeenCalledTimes(1)
    const sourceFile = await db.sourceFile.findUnique({ where: { driveFileId: 'drive-loan-1' } })
    expect(ingestLoanDocument).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: property.id, sourceFileId: sourceFile!.id })
    )
    expect(ingestStatement).not.toHaveBeenCalled()
    expect(runAnomalyRules).not.toHaveBeenCalled()

    await db.sourceFile.deleteMany({ where: { driveFileId: 'drive-loan-1' } })
  })

  it('continues processing subsequent files when one ingestion fails', async () => {
    vi.mocked(listStatementFiles).mockResolvedValueOnce([
      { id: 'drive-fail-1', name: 'fail_report.pdf', modifiedTime: new Date('2026-02-15') },
      { id: 'drive-fail-2', name: 'ok_report.pdf', modifiedTime: new Date('2026-02-16') },
    ])
    const property = await createProperty({ name: 'Ide Sync Test 5', address: 'x' })
    vi.mocked(ingestStatement).mockClear()
    vi.mocked(ingestStatement)
      .mockRejectedValueOnce(new Error('extraction blew up'))
      .mockResolvedValueOnce({ status: 'success', extractionId: 'ext2', recordsCreated: 1, activityMonth: '2026-02' })

    const result = await syncDriveFolder({ id: property.id, googleDriveFolderId: 'folder-ide' })

    expect(result.newFiles).toBe(2)
    expect(result.failed).toBe(1)
    expect(ingestStatement).toHaveBeenCalledTimes(2)
    const firstFile = await db.sourceFile.findUnique({ where: { driveFileId: 'drive-fail-1' } })
    const secondFile = await db.sourceFile.findUnique({ where: { driveFileId: 'drive-fail-2' } })
    expect(firstFile).not.toBeNull()
    expect(secondFile).not.toBeNull()

    await db.sourceFile.deleteMany({ where: { driveFileId: { in: ['drive-fail-1', 'drive-fail-2'] } } })
  })

  afterEach(async () => {
    // driveFileId is globally unique; clean up between tests so a later test's sync of
    // 'drive1' doesn't collide with an earlier test's record. Extraction has a required FK
    // to SourceFile, so it must go first.
    const existing = await db.sourceFile.findUnique({ where: { driveFileId: 'drive1' } })
    if (existing) {
      await db.extraction.deleteMany({ where: { sourceFileId: existing.id } })
      await db.sourceFile.delete({ where: { id: existing.id } })
    }
  })

  afterAll(async () => {
    await db.sourceFile.deleteMany({})
    await db.property.deleteMany({
      where: {
        name: {
          in: [
            'Ide Sync Test',
            'Ide Sync Test 2',
            'Ide Sync Test 3',
            'Ide Sync Test 4',
            'Ide Sync Test 5',
            'Ide Sync Test 6',
            'Ide Sync Test 7',
          ],
        },
      },
    })
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/driveSync.test.ts`
Expected: FAIL — `lib/driveSync.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/driveSync.ts`**

```typescript
import { db } from './db'
import { listStatementFiles, downloadFile } from './googleDriveClient'
import { uploadToStorage } from './blobStorage'
import { ingestStatement } from './extraction/extractStatement'
import { ingestLoanDocument } from './extraction/extractLoan'
import { runAnomalyRules } from './anomalyRules'

// A SourceFile row alone doesn't mean the file was ever successfully processed — a sync
// can be interrupted (e.g. a serverless function timeout mid-loop) after creating the row
// but before extraction/ingestion completes or succeeds. Distinguishing "done" from
// "recorded but unfinished" is what lets a later sync call safely retry the latter instead
// of skipping it forever.
async function wasSuccessfullyProcessed(sourceFile: { id: string; fileType: string }): Promise<boolean> {
  if (sourceFile.fileType === 'statement') {
    const extraction = await db.extraction.findUnique({ where: { sourceFileId: sourceFile.id } })
    return extraction?.status === 'success'
  }
  const loan = await db.loan.findFirst({ where: { sourceFileId: sourceFile.id } })
  return loan !== null
}

export async function syncDriveFolder(property: {
  id: string
  googleDriveFolderId: string
}): Promise<{ newFiles: number; skipped: number; failed: number }> {
  const files = await listStatementFiles(property.googleDriveFolderId)
  let newFiles = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    const existing = await db.sourceFile.findUnique({ where: { driveFileId: file.id } })

    if (existing && (await wasSuccessfullyProcessed(existing))) {
      skipped++
      continue
    }

    const buffer = await downloadFile(file.id)
    const storageUrl = await uploadToStorage(file.name, buffer)
    const fileType = file.name.toLowerCase().includes('loan') ? 'loan' : 'statement'

    const sourceFile = existing
      ? await db.sourceFile.update({
          where: { id: existing.id },
          data: { storageUrl, uploadedAt: file.modifiedTime, fileType },
        })
      : await db.sourceFile.create({
          data: {
            propertyId: property.id,
            driveFileId: file.id,
            filename: file.name,
            uploadedAt: file.modifiedTime,
            fileType,
            storageUrl,
          },
        })

    if (!existing) newFiles++

    const fileBase64 = buffer.toString('base64')
    const isXlsx = file.name.toLowerCase().endsWith('.xlsx')

    try {
      if (fileType === 'statement') {
        const result = await ingestStatement(
          isXlsx
            ? { sourceFileId: sourceFile.id, propertyId: property.id, xlsxBase64: fileBase64 }
            : { sourceFileId: sourceFile.id, propertyId: property.id, pdfBase64: fileBase64 }
        )
        if (result.status === 'success') {
          await runAnomalyRules(property.id, result.activityMonth)
        }
      } else {
        await ingestLoanDocument({
          sourceFileId: sourceFile.id,
          propertyId: property.id,
          pdfBase64: fileBase64,
        })
      }
    } catch (err) {
      // Don't let one file's extraction failure abort the sync of the rest of the folder.
      failed++
      console.error(`driveSync: extraction failed for file ${file.name} (${file.id}):`, err)
    }
  }

  return { newFiles, skipped, failed }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/driveSync.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Delete the old Dropbox sync module and test**

```bash
git rm lib/dropboxSync.ts tests/dropboxSync.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/driveSync.ts tests/driveSync.test.ts
git commit -m "Replace Dropbox sync engine with Google Drive sync engine"
```

---

### Task 6: API routes and `properties.ts`

**Files:**
- Modify: `lib/properties.ts`
- Modify: `app/api/sync/route.ts`
- Modify: `app/api/cron/sync/route.ts`
- Modify: `app/api/properties/route.ts`
- Modify: `app/api/loans/upload/route.ts`
- Modify: `tests/properties.test.ts`
- Modify: `tests/api/sync.test.ts`
- Modify: `tests/api/cronSync.test.ts`

**Interfaces:**
- Consumes: `syncDriveFolder({ id, googleDriveFolderId })` from `lib/driveSync.ts` (Task 5); `ingestLoanDocument({ sourceFileId, propertyId, pdfBase64 })` from Task 4.
- Produces: `createProperty(input: { name: string; address: string; googleDriveFolderId?: string })`, unchanged `listProperties()`/`getProperty(id)` signatures (only the `Property` shape they return changes, via Task 1's schema).

- [ ] **Step 1: Update `lib/properties.ts`**

```typescript
import { db } from './db'
import type { Property } from '@prisma/client'

export async function createProperty(input: {
  name: string
  address: string
  googleDriveFolderId?: string
}): Promise<Property> {
  return db.property.create({ data: input })
}

export async function listProperties(): Promise<Property[]> {
  return db.property.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
}

export async function getProperty(id: string): Promise<Property | null> {
  return db.property.findUnique({ where: { id } })
}
```

- [ ] **Step 2: Update `tests/properties.test.ts`**

Rename the second test and its assertions:
```typescript
it('stores an optional googleDriveFolderId', async () => {
  const created = await createProperty({
    name: 'Ide building',
    address: 'x',
    googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ',
  })
  expect(created.googleDriveFolderId).toBe('1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ')
})
```
(Leave the other two tests — create/retrieve, active-only listing — unchanged.)

- [ ] **Step 3: Update `app/api/sync/route.ts`**

```typescript
import { syncDriveFolder } from '../../../lib/driveSync'
import { getProperty } from '../../../lib/properties'

export const maxDuration = 300

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const { propertyId } = body ?? {}

  if (typeof propertyId !== 'string' || propertyId.trim() === '') {
    return Response.json({ error: 'propertyId is required and must be a non-empty string' }, { status: 400 })
  }

  const property = await getProperty(propertyId)

  if (!property) {
    return Response.json({ error: 'Property not found' }, { status: 404 })
  }

  if (!property.googleDriveFolderId) {
    return Response.json(
      { error: 'This property has no googleDriveFolderId configured. Set one via /admin before syncing.' },
      { status: 400 }
    )
  }

  try {
    const result = await syncDriveFolder({ id: propertyId, googleDriveFolderId: property.googleDriveFolderId })
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync Google Drive folder'
    return Response.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 4: Update `tests/api/sync.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/driveSync', () => ({
  syncDriveFolder: vi.fn().mockResolvedValue({ newFiles: 2, skipped: 1, failed: 0 }),
}))

vi.mock('../../lib/properties', () => ({
  getProperty: vi.fn(),
}))

import { POST } from '../../app/api/sync/route'
import { syncDriveFolder } from '../../lib/driveSync'
import { getProperty } from '../../lib/properties'

describe('POST /api/sync', () => {
  it('looks up the property\'s stored googleDriveFolderId and triggers a sync', async () => {
    ;(getProperty as any).mockResolvedValueOnce({
      id: 'prop-1',
      name: 'Ide building',
      googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ',
    })

    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'prop-1' }),
    })
    const response = await POST(request)
    const body = await response.json()

    expect(syncDriveFolder).toHaveBeenCalledWith({
      id: 'prop-1',
      googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ',
    })
    expect(body).toEqual({ newFiles: 2, skipped: 1, failed: 0 })
  })

  it('returns 400 when propertyId is missing', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 404 when the property does not exist', async () => {
    ;(getProperty as any).mockResolvedValueOnce(null)
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'nonexistent' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(404)
  })

  it('returns 400 when the property has no googleDriveFolderId configured', async () => {
    ;(getProperty as any).mockResolvedValueOnce({ id: 'prop-2', name: 'No Folder', googleDriveFolderId: null })
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'prop-2' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/googleDriveFolderId/i)
  })

  it('returns 400 for malformed JSON body', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: '{not valid json',
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})
```

- [ ] **Step 5: Update `app/api/cron/sync/route.ts`**

```typescript
import { syncDriveFolder } from '../../../../lib/driveSync'
import { listProperties } from '../../../../lib/properties'
import { checkAndNotify } from '../../../../lib/notifications'

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const properties = await listProperties()
  const withFolder = properties.filter((p) => p.googleDriveFolderId)
  const skippedProperties = properties.filter((p) => !p.googleDriveFolderId).map((p) => p.id)

  const results: { propertyId: string; status: 'success' | 'failed'; detail: unknown }[] = []

  for (const property of withFolder) {
    try {
      const result = await syncDriveFolder({
        id: property.id,
        googleDriveFolderId: property.googleDriveFolderId as string,
      })
      results.push({ propertyId: property.id, status: 'success', detail: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      results.push({ propertyId: property.id, status: 'failed', detail: message })
    }
  }

  const notificationEmail = process.env.NOTIFICATION_EMAIL_TO
  if (notificationEmail) {
    try {
      await checkAndNotify({ to: notificationEmail })
    } catch (err) {
      console.error('checkAndNotify failed:', err)
    }
  }

  return Response.json({ results, skippedProperties })
}
```

- [ ] **Step 6: Update `tests/api/cronSync.test.ts`**

Replace `dropboxSync`/`syncDropboxFolder`/`dropboxFolderPath` with `driveSync`/`syncDriveFolder`/`googleDriveFolderId` throughout (mock module path, imported symbol, and test-data field name), e.g.:
```typescript
vi.mock('../../lib/driveSync', () => ({
  syncDriveFolder: vi.fn().mockResolvedValue({ newFiles: 1, skipped: 0, failed: 0 }),
}))
// ...
import { syncDriveFolder } from '../../lib/driveSync'
// ...
;(listProperties as any).mockResolvedValueOnce([
  { id: 'prop-1', name: 'Ide', googleDriveFolderId: '1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ' },
  { id: 'prop-2', name: 'No Folder Property', googleDriveFolderId: null },
])
// ... and so on for every syncDropboxFolder/dropboxFolderPath occurrence in the file, including
// the 'continues syncing...' test's error message ('Dropbox API error' -> 'Google Drive API error')
```

- [ ] **Step 7: Update `app/api/properties/route.ts`**

```typescript
import { createProperty, listProperties } from '../../../lib/properties'

export async function GET() {
  const properties = await listProperties()
  return Response.json(properties)
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 })
  }

  const { name, address, googleDriveFolderId } = body as {
    name?: unknown
    address?: unknown
    googleDriveFolderId?: unknown
  }

  if (typeof name !== 'string' || name.trim() === '') {
    return Response.json({ error: 'name is required and must be a non-empty string' }, { status: 400 })
  }
  if (typeof address !== 'string' || address.trim() === '') {
    return Response.json({ error: 'address is required and must be a non-empty string' }, { status: 400 })
  }
  if (googleDriveFolderId !== undefined && typeof googleDriveFolderId !== 'string') {
    return Response.json({ error: 'googleDriveFolderId must be a string if provided' }, { status: 400 })
  }

  try {
    const property = await createProperty({
      name,
      address,
      googleDriveFolderId: googleDriveFolderId || undefined,
    })
    return Response.json(property)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create property'
    return Response.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 8: Update `app/api/loans/upload/route.ts`**

Change the one call site:
```typescript
const result = await ingestLoanDocument({ sourceFileId: null, propertyId, pdfBase64 })
```

- [ ] **Step 9: Run all updated tests**

Run: `npx vitest run tests/properties.test.ts tests/api/sync.test.ts tests/api/cronSync.test.ts tests/extraction/extractLoan.test.ts`
Expected: PASS (all tests)

- [ ] **Step 10: Commit**

```bash
git add lib/properties.ts app/api/sync/route.ts app/api/cron/sync/route.ts app/api/properties/route.ts app/api/loans/upload/route.ts tests/properties.test.ts tests/api/sync.test.ts tests/api/cronSync.test.ts
git commit -m "Rename API routes and properties.ts from Dropbox to Google Drive terms"
```

---

### Task 7: Admin UI

**Files:**
- Modify: `app/admin/AdminView.tsx`

**Interfaces:**
- Consumes: `POST /api/properties` with body `{ name, address, googleDriveFolderId? }` (Task 6).

- [ ] **Step 1: Update `AddPropertyForm` in `app/admin/AdminView.tsx`**

```tsx
function AddPropertyForm({ onSaved }: { onSaved: () => void }) {
  const { message, isError, submit } = useSubmitState()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const ok = await submit('/api/properties', { name, address, googleDriveFolderId: googleDriveFolderId || undefined })
    if (ok) {
      setName('')
      setAddress('')
      setGoogleDriveFolderId('')
      onSaved()
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Add Property</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Address
        <input value={address} onChange={(e) => setAddress(e.target.value)} required />
      </label>
      <label>
        Google Drive Folder ID (optional, e.g. from the folder's URL: drive.google.com/drive/folders/FOLDER_ID)
        <input value={googleDriveFolderId} onChange={(e) => setGoogleDriveFolderId(e.target.value)} />
      </label>
      <button type="submit">Add Property</button>
      <StatusLine message={message} isError={isError} />
    </form>
  )
}
```
(No other function in this file references Dropbox — leave `AddLoanForm`, `AddAnnualCostForm`, and `AdminView` untouched.)

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, navigate to `/admin`, submit the "Add Property" form with a Google Drive folder ID (e.g. `1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ`), confirm it saves and the new property shows up in the Loan/Annual Cost property dropdowns.

- [ ] **Step 3: Commit**

```bash
git add app/admin/AdminView.tsx
git commit -m "Update admin UI to collect a Google Drive folder ID instead of a Dropbox path"
```

---

### Task 8: Env vars and remaining comment cleanup

**Files:**
- Modify: `.env.local` (remove `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, `DROPBOX_ACCESS_TOKEN`; add `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`)
- Modify: `lib/blobStorage.ts` (comment wording only)
- Modify: `lib/email.ts` (comment wording only)

**Interfaces:** None — this task only touches comments and local env configuration, no code behavior changes.

- [ ] **Step 1: Update `.env.local`**

Remove the `DROPBOX_APP_KEY=`, `DROPBOX_APP_SECRET=`, `DROPBOX_REFRESH_TOKEN=`, and `DROPBOX_ACCESS_TOKEN=` lines. Add:
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```
Leave every other line untouched. This file is local-only (not committed if gitignored — check `git status` after this step; if it's tracked, be careful not to commit real secret values, only the key names with empty/placeholder values as they already are).

- [ ] **Step 2: Update `lib/blobStorage.ts` comment**

```typescript
import { put } from '@vercel/blob'

export async function uploadToStorage(filename: string, buffer: Buffer): Promise<string> {
  // Private: these are personal financial statement PDFs, not publicly accessible files.
  // allowOverwrite: syncDriveFolder only reaches this call for a file it believes is new
  // (deduped by SourceFile.driveFileId beforehand), but a prior sync attempt that failed
  // after uploading and before recording the SourceFile row (or a manually reset retry)
  // can leave a blob already sitting under this filename — retrying must not fail on that.
  const blob = await put(filename, buffer, { access: 'private', allowOverwrite: true })
  return blob.url
}
```

- [ ] **Step 3: Update the comment in `lib/email.ts`**

Find the line `// Sent via a direct call to Resend's HTTP API — same reasoning as the Dropbox content` and update it to reference the Drive content API instead (read the full comment in context first, since it likely continues on the next line, and adjust only the Dropbox-specific wording to Drive-specific wording without changing the underlying point being made).

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no test file anywhere still references `dropbox`/`Dropbox` (confirm with `grep -ril dropbox tests/ lib/ app/` returning no results).

- [ ] **Step 5: Commit**

```bash
git add .env.local lib/blobStorage.ts lib/email.ts
git commit -m "Update env vars and remaining comments for Google Drive migration"
```

---

## Post-implementation note (not a task — manual, outside this plan)

After this ships, the PM's two known property folders need their Drive folder IDs entered via `/admin`:
- Ide building: folder ID `1QcFp8ir-wttFotseKq4A7RYQY1gtXasJ`
- Residence D05: folder ID `1tfDoPjg-bsI7uZbhyiykAnDoEtXnIJSM`

Both folders must also be shared with the service account's email address (from `GOOGLE_SERVICE_ACCOUNT_EMAIL`) before syncing will work.
