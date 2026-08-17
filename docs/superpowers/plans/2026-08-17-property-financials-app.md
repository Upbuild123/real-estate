# Property Financials App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js web app that ingests monthly property-manager PDF statements from Dropbox, extracts structured financial data via Claude, combines it with loan and tax/insurance data, and presents monthly/YTD dashboards with anomaly flags and after-tax cash flow.

**Architecture:** Next.js (App Router, TypeScript) full-stack app. Postgres via Prisma ORM. Server-side pipeline: Dropbox sync → Claude PDF extraction → normalized financial records → calculation layer (NOI, debt service, tax) → anomaly rules → dashboard views. Vitest for unit/integration tests.

**Tech Stack:** Next.js 14+ (App Router), TypeScript, Prisma + Postgres, Dropbox API (`dropbox` npm package), Anthropic SDK (`@anthropic-ai/sdk`) for Claude PDF extraction, Vitest + `@testing-library/react`, hosted on Vercel + Neon Postgres.

**Spec:** `docs/superpowers/specs/2026-08-17-property-financials-app-design.md` (plus `docs/superpowers/specs/sample-statement-format-notes.md` and `docs/superpowers/specs/sample-loan-format-notes.md`)

## Global Constraints

- Single user (Michael), no multi-user auth in v1.
- Statement `activityMonth` is read from the PDF's internal "Month" field, never the filename or remittance date.
- Manual corrections to `FinancialRecord` always take precedence over re-extraction — re-extraction must never overwrite a record with `source: manual`.
- Line items are tagged `recurring: true/false` via a deterministic lookup table, never left to model judgment.
- Extraction failures mark the `Extraction` as `failed` and must never silently drop a file.
- Taxable income for the tax calculation excludes loan principal (not deductible) but includes it in cash flow (it's still a real outflow). Taxable income floors at 0 (no loss carryforward in v1).
- Marginal tax rate is a single global editable setting (starting value 43%), not per-property.
- Known seed data: Ide tax ¥227,900/yr, insurance ¥46,040/yr; Residence DO5 tax ¥1,203,400/yr, insurance ¥117,402/yr.
- Property manager (statements) and lender (loans) extraction templates are matched per document source, not assumed universal — a third property may need a different statement template.

---

## File Structure

```
prisma/schema.prisma
lib/db.ts                          — Prisma client singleton
lib/amortization.ts                — annual → monthly amortization
lib/annualCosts.ts                 — AnnualCost CRUD
lib/properties.ts                  — Property CRUD
lib/settings.ts                    — Setting get/set (marginalTaxRate)
lib/loans.ts                       — Loan CRUD + schedule helpers
lib/dropboxClient.ts               — thin Dropbox API wrapper
lib/dropboxSync.ts                 — sync job: list, dedupe, download, store
lib/claudeClient.ts                — thin Anthropic PDF-extraction wrapper
lib/extraction/statementSchema.ts  — StatementExtraction types + recurring lookup
lib/extraction/extractStatement.ts — statement extraction + FinancialRecord ingestion
lib/extraction/loanSchema.ts       — LoanExtraction types
lib/extraction/extractLoan.ts      — loan extraction + Loan record update
lib/financialCalculations.ts       — NOI, debt service, pre/after-tax cash flow
lib/anomalyRules.ts                — anomaly rule engine
lib/dashboardData.ts               — monthly/YTD/portfolio aggregation queries
app/api/sync/route.ts              — triggers dropboxSync
app/api/loans/upload/route.ts      — manual loan PDF upload → extractLoan
app/api/financial-records/[id]/route.ts — manual correction endpoint
app/dashboard/page.tsx             — main dashboard (property + period selector)
app/dashboard/DashboardView.tsx    — presentational dashboard component
app/review-queue/page.tsx          — failed extractions review queue
test fixtures: tests/fixtures/statement-ide-jan2026.json, tests/fixtures/loan-do5.json
```

---

### Task 1: Project scaffolding, Prisma schema, DB connection

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `vitest.config.ts`
- Create: `prisma/schema.prisma`
- Create: `lib/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: `db` (Prisma client singleton, default export from `lib/db.ts`), and all Prisma model types (`Property`, `Loan`, `AnnualCost`, `Setting`, `DropboxFile`, `Extraction`, `FinancialRecord`, `AnomalyFlag`) generated into `@prisma/client`.

- [ ] **Step 1: Scaffold the Next.js project**

```bash
npx create-next-app@latest . --typescript --app --no-tailwind --eslint --src-dir=false --import-alias "@/*" --use-npm
npm install prisma @prisma/client dropbox @anthropic-ai/sdk
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
```

- [ ] **Step 3: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Property {
  id             String         @id @default(cuid())
  name           String
  address        String
  active         Boolean        @default(true)
  createdAt      DateTime       @default(now())
  loans          Loan[]
  annualCosts    AnnualCost[]
  dropboxFiles   DropboxFile[]
  financialRecords FinancialRecord[]
  anomalyFlags   AnomalyFlag[]
}

model Loan {
  id               String   @id @default(cuid())
  propertyId       String
  property         Property @relation(fields: [propertyId], references: [id])
  lender           String
  originalAmount   Int
  currentBalance   Int
  currentRate      Float
  rateChangeDate   DateTime?
  newRate          Float?
  monthlyPrincipal Int
  originationDate  DateTime
  maturityDate     DateTime
  sourceFileId     String?
  createdAt        DateTime @default(now())
}

model AnnualCost {
  id            String   @id @default(cuid())
  propertyId    String
  property      Property @relation(fields: [propertyId], references: [id])
  costType      String   // "tax" | "insurance"
  year          Int
  annualAmount  Int

  @@unique([propertyId, costType, year])
}

model Setting {
  key   String @id
  value String
}

model DropboxFile {
  id             String   @id @default(cuid())
  propertyId     String
  property       Property @relation(fields: [propertyId], references: [id])
  dropboxFileId  String   @unique
  filename       String
  uploadedAt     DateTime
  fileType       String   // "statement" | "loan"
  storageUrl     String
  extraction     Extraction?
}

model Extraction {
  id             String      @id @default(cuid())
  dropboxFileId  String      @unique
  dropboxFile    DropboxFile @relation(fields: [dropboxFileId], references: [id])
  rawModelOutput String
  status         String      // "success" | "failed"
  extractedAt    DateTime    @default(now())
  financialRecords FinancialRecord[]
}

model FinancialRecord {
  id            String      @id @default(cuid())
  propertyId    String
  property      Property    @relation(fields: [propertyId], references: [id])
  month         String      // "2026-01" format
  category      String      // "income" | "expense"
  accountItem   String
  amount        Int
  recurring     Boolean
  source        String      // "extracted" | "manual"
  extractionId  String?
  extraction    Extraction? @relation(fields: [extractionId], references: [id])
  createdAt     DateTime    @default(now())
}

model AnomalyFlag {
  id          String   @id @default(cuid())
  propertyId  String
  property    Property @relation(fields: [propertyId], references: [id])
  month       String
  ruleType    String
  description String
  status      String   @default("open") // "open" | "resolved"
  createdAt   DateTime @default(now())
}
```

- [ ] **Step 4: Write `lib/db.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
```

- [ ] **Step 5: Set up a local test database and run migration**

```bash
createdb property_financials_test
echo 'DATABASE_URL="postgresql://localhost:5432/property_financials_test"' > .env
npx prisma migrate dev --name init
```

- [ ] **Step 6: Write the failing test**

```typescript
// tests/db.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'

describe('db connection', () => {
  it('can create and read a Property', async () => {
    const property = await db.property.create({
      data: { name: 'Test Building', address: '123 Test St' },
    })
    const found = await db.property.findUnique({ where: { id: property.id } })
    expect(found?.name).toBe('Test Building')
  })

  afterAll(async () => {
    await db.property.deleteMany({ where: { name: 'Test Building' } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS (this confirms scaffolding + schema + migration are wired correctly)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js project with Prisma schema and DB connection"
```

---

### Task 2: Property and Setting CRUD

**Files:**
- Create: `lib/properties.ts`
- Create: `lib/settings.ts`
- Test: `tests/properties.test.ts`, `tests/settings.test.ts`

**Interfaces:**
- Consumes: `db` from `lib/db.ts` (Task 1)
- Produces: `createProperty(input: { name: string; address: string }): Promise<Property>`, `listProperties(): Promise<Property[]>`, `getProperty(id: string): Promise<Property | null>`; `getSetting(key: string): Promise<string | null>`, `setSetting(key: string, value: string): Promise<void>`, `getMarginalTaxRate(): Promise<number>` (returns fraction, e.g. 0.43, defaulting to 0.43 if unset)

- [ ] **Step 1: Write failing tests for `lib/properties.ts`**

```typescript
// tests/properties.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty, listProperties, getProperty } from '../lib/properties'

describe('properties', () => {
  it('creates and retrieves a property', async () => {
    const created = await createProperty({ name: 'Ide building', address: '東京都杉並区松ノ木3-22-14' })
    const found = await getProperty(created.id)
    expect(found?.name).toBe('Ide building')
  })

  it('lists only active properties by default', async () => {
    const p = await createProperty({ name: 'Inactive Test', address: 'x' })
    await db.property.update({ where: { id: p.id }, data: { active: false } })
    const active = await listProperties()
    expect(active.find((x) => x.id === p.id)).toBeUndefined()
  })

  afterAll(async () => {
    await db.property.deleteMany({ where: { name: { in: ['Ide building', 'Inactive Test'] } } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/properties.test.ts`
Expected: FAIL with "Cannot find module '../lib/properties'"

- [ ] **Step 3: Write `lib/properties.ts`**

```typescript
import { db } from './db'
import type { Property } from '@prisma/client'

export async function createProperty(input: { name: string; address: string }): Promise<Property> {
  return db.property.create({ data: input })
}

export async function listProperties(): Promise<Property[]> {
  return db.property.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
}

export async function getProperty(id: string): Promise<Property | null> {
  return db.property.findUnique({ where: { id } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/properties.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for `lib/settings.ts`**

```typescript
// tests/settings.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { getSetting, setSetting, getMarginalTaxRate } from '../lib/settings'

describe('settings', () => {
  it('defaults marginal tax rate to 0.43 when unset', async () => {
    expect(await getMarginalTaxRate()).toBe(0.43)
  })

  it('stores and retrieves an updated marginal tax rate', async () => {
    await setSetting('marginalTaxRate', '0.37')
    expect(await getMarginalTaxRate()).toBe(0.37)
  })

  afterAll(async () => {
    await db.setting.deleteMany({ where: { key: 'marginalTaxRate' } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL with "Cannot find module '../lib/settings'"

- [ ] **Step 7: Write `lib/settings.ts`**

```typescript
import { db } from './db'

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

export async function getMarginalTaxRate(): Promise<number> {
  const raw = await getSetting('marginalTaxRate')
  return raw !== null ? parseFloat(raw) : 0.43
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/properties.ts lib/settings.ts tests/properties.test.ts tests/settings.test.ts
git commit -m "Add Property and Setting CRUD with marginal tax rate default"
```

---

### Task 3: Amortization utility and AnnualCost CRUD

**Files:**
- Create: `lib/amortization.ts`
- Create: `lib/annualCosts.ts`
- Test: `tests/amortization.test.ts`, `tests/annualCosts.test.ts`

**Interfaces:**
- Consumes: `db`, `createProperty` (Task 2)
- Produces: `amortizeAnnual(annualAmount: number): number` (rounds to nearest cent-equivalent yen, i.e. integer division with remainder handling — see below); `upsertAnnualCost(input: { propertyId: string; costType: 'tax' | 'insurance'; year: number; annualAmount: number }): Promise<AnnualCost>`, `getAnnualCost(propertyId: string, costType: 'tax' | 'insurance', year: number): Promise<AnnualCost | null>`, `getMonthlyAmortizedCost(propertyId: string, costType: 'tax' | 'insurance', year: number): Promise<number>`

- [ ] **Step 1: Write failing test for `lib/amortization.ts`**

```typescript
// tests/amortization.test.ts
import { describe, it, expect } from 'vitest'
import { amortizeAnnual } from '../lib/amortization'

describe('amortizeAnnual', () => {
  it('divides an annual amount evenly by 12', () => {
    expect(amortizeAnnual(1203400)).toBeCloseTo(100283.33, 2)
  })

  it('handles amounts that divide evenly', () => {
    expect(amortizeAnnual(120000)).toBe(10000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/amortization.test.ts`
Expected: FAIL with "Cannot find module '../lib/amortization'"

- [ ] **Step 3: Write `lib/amortization.ts`**

```typescript
export function amortizeAnnual(annualAmount: number): number {
  return annualAmount / 12
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/amortization.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for `lib/annualCosts.ts`**

```typescript
// tests/annualCosts.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { upsertAnnualCost, getMonthlyAmortizedCost } from '../lib/annualCosts'

describe('annualCosts', () => {
  it('stores Ide tax and returns correct monthly amortization', async () => {
    const property = await createProperty({ name: 'Ide Test', address: 'x' })
    await upsertAnnualCost({ propertyId: property.id, costType: 'tax', year: 2026, annualAmount: 227900 })
    const monthly = await getMonthlyAmortizedCost(property.id, 'tax', 2026)
    expect(monthly).toBeCloseTo(18991.67, 2)
  })

  it('stores DO5 insurance and returns correct monthly amortization', async () => {
    const property = await createProperty({ name: 'DO5 Test', address: 'x' })
    await upsertAnnualCost({ propertyId: property.id, costType: 'insurance', year: 2026, annualAmount: 117402 })
    const monthly = await getMonthlyAmortizedCost(property.id, 'insurance', 2026)
    expect(monthly).toBeCloseTo(9783.5, 2)
  })

  it('returns 0 when no annual cost is recorded for that year', async () => {
    const property = await createProperty({ name: 'No Cost Test', address: 'x' })
    const monthly = await getMonthlyAmortizedCost(property.id, 'tax', 2026)
    expect(monthly).toBe(0)
  })

  afterAll(async () => {
    await db.annualCost.deleteMany({})
    await db.property.deleteMany({ where: { name: { in: ['Ide Test', 'DO5 Test', 'No Cost Test'] } } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/annualCosts.test.ts`
Expected: FAIL with "Cannot find module '../lib/annualCosts'"

- [ ] **Step 7: Write `lib/annualCosts.ts`**

```typescript
import { db } from './db'
import { amortizeAnnual } from './amortization'
import type { AnnualCost } from '@prisma/client'

type CostType = 'tax' | 'insurance'

export async function upsertAnnualCost(input: {
  propertyId: string
  costType: CostType
  year: number
  annualAmount: number
}): Promise<AnnualCost> {
  return db.annualCost.upsert({
    where: {
      propertyId_costType_year: {
        propertyId: input.propertyId,
        costType: input.costType,
        year: input.year,
      },
    },
    update: { annualAmount: input.annualAmount },
    create: input,
  })
}

export async function getAnnualCost(propertyId: string, costType: CostType, year: number): Promise<AnnualCost | null> {
  return db.annualCost.findUnique({
    where: { propertyId_costType_year: { propertyId, costType, year } },
  })
}

export async function getMonthlyAmortizedCost(propertyId: string, costType: CostType, year: number): Promise<number> {
  const record = await getAnnualCost(propertyId, costType, year)
  return record ? amortizeAnnual(record.annualAmount) : 0
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/annualCosts.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/amortization.ts lib/annualCosts.ts tests/amortization.test.ts tests/annualCosts.test.ts
git commit -m "Add amortization utility and AnnualCost CRUD for tax/insurance"
```

---

### Task 4: Loan CRUD and debt service helpers

**Files:**
- Create: `lib/loans.ts`
- Test: `tests/loans.test.ts`

**Interfaces:**
- Consumes: `db`, `createProperty` (Task 2)
- Produces: `createLoan(input: { propertyId: string; lender: string; originalAmount: number; currentBalance: number; currentRate: number; rateChangeDate?: Date; newRate?: number; monthlyPrincipal: number; originationDate: Date; maturityDate: Date; sourceFileId?: string }): Promise<Loan>`, `getLoanForProperty(propertyId: string): Promise<Loan | null>` (most recent by `createdAt`), `monthlyInterestExpense(balance: number, annualRatePercent: number): number`, `monthlyDebtService(loan: Loan): number` (principal + interest on current balance/rate)

- [ ] **Step 1: Write failing test**

```typescript
// tests/loans.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { createLoan, getLoanForProperty, monthlyInterestExpense, monthlyDebtService } from '../lib/loans'

describe('loans', () => {
  it('computes monthly interest expense from balance and annual rate', () => {
    // Ide loan: 104,968,000 balance, 1.825% annual rate
    // matches actual schedule: interest was 178,234 on a higher balance;
    // verify formula against known schedule row instead: DO5 loan
    // balance 210,700,000 at 1.825% -> monthly interest ≈ 320,440.42
    expect(monthlyInterestExpense(210700000, 1.825)).toBeCloseTo(320440.42, 1)
  })

  it('creates a loan and computes its debt service', async () => {
    const property = await createProperty({ name: 'Ide Loan Test', address: 'x' })
    const loan = await createLoan({
      propertyId: property.id,
      lender: 'Kiraboshi Bank',
      originalAmount: 110500000,
      currentBalance: 104968000,
      currentRate: 1.825,
      rateChangeDate: new Date('2026-09-01'),
      newRate: 2.075,
      monthlyPrincipal: 461000,
      originationDate: new Date('2025-07-31'),
      maturityDate: new Date('2045-07-31'),
    })
    const found = await getLoanForProperty(property.id)
    expect(found?.id).toBe(loan.id)
    const debtService = monthlyDebtService(loan)
    expect(debtService).toBeCloseTo(461000 + monthlyInterestExpense(104968000, 1.825), 1)
  })

  afterAll(async () => {
    await db.loan.deleteMany({})
    await db.property.deleteMany({ where: { name: 'Ide Loan Test' } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loans.test.ts`
Expected: FAIL with "Cannot find module '../lib/loans'"

- [ ] **Step 3: Write `lib/loans.ts`**

```typescript
import { db } from './db'
import type { Loan } from '@prisma/client'

export async function createLoan(input: {
  propertyId: string
  lender: string
  originalAmount: number
  currentBalance: number
  currentRate: number
  rateChangeDate?: Date
  newRate?: number
  monthlyPrincipal: number
  originationDate: Date
  maturityDate: Date
  sourceFileId?: string
}): Promise<Loan> {
  return db.loan.create({ data: input })
}

export async function getLoanForProperty(propertyId: string): Promise<Loan | null> {
  return db.loan.findFirst({ where: { propertyId }, orderBy: { createdAt: 'desc' } })
}

export function monthlyInterestExpense(balance: number, annualRatePercent: number): number {
  return (balance * (annualRatePercent / 100)) / 12
}

export function monthlyDebtService(loan: Loan): number {
  return loan.monthlyPrincipal + monthlyInterestExpense(loan.currentBalance, loan.currentRate)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/loans.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/loans.ts tests/loans.test.ts
git commit -m "Add Loan CRUD and monthly interest/debt service calculations"
```

---

### Task 5: Dropbox client wrapper

**Files:**
- Create: `lib/dropboxClient.ts`
- Test: `tests/dropboxClient.test.ts`

**Interfaces:**
- Produces: `listPdfFiles(folderPath: string): Promise<{ id: string; name: string; pathLower: string; serverModified: Date }[]>`, `downloadFile(pathLower: string): Promise<Buffer>`

- [ ] **Step 1: Write failing test using a mocked Dropbox SDK**

```typescript
// tests/dropboxClient.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('dropbox', () => {
  return {
    Dropbox: vi.fn().mockImplementation(() => ({
      filesListFolder: vi.fn().mockResolvedValue({
        result: {
          entries: [
            { '.tag': 'file', id: 'id1', name: 'a.pdf', path_lower: '/ide/a.pdf', server_modified: '2026-02-15T00:00:00Z' },
            { '.tag': 'file', id: 'id2', name: 'b.xlsx', path_lower: '/ide/b.xlsx', server_modified: '2026-02-15T00:00:00Z' },
            { '.tag': 'folder', id: 'id3', name: 'subfolder', path_lower: '/ide/subfolder' },
          ],
        },
      }),
      filesDownload: vi.fn().mockResolvedValue({
        result: { fileBinary: Buffer.from('pdf-bytes') },
      }),
    })),
  }
})

import { listPdfFiles, downloadFile } from '../lib/dropboxClient'

describe('dropboxClient', () => {
  it('lists only PDF files, filtering out other file types and folders', async () => {
    const files = await listPdfFiles('/ide')
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('a.pdf')
  })

  it('downloads a file as a Buffer', async () => {
    const buffer = await downloadFile('/ide/a.pdf')
    expect(buffer.toString()).toBe('pdf-bytes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dropboxClient.test.ts`
Expected: FAIL with "Cannot find module '../lib/dropboxClient'"

- [ ] **Step 3: Write `lib/dropboxClient.ts`**

```typescript
import { Dropbox } from 'dropbox'

function client(): Dropbox {
  return new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN })
}

export async function listPdfFiles(
  folderPath: string
): Promise<{ id: string; name: string; pathLower: string; serverModified: Date }[]> {
  const dbx = client()
  const response = await dbx.filesListFolder({ path: folderPath })
  return response.result.entries
    .filter((entry: any) => entry['.tag'] === 'file' && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      pathLower: entry.path_lower,
      serverModified: new Date(entry.server_modified),
    }))
}

export async function downloadFile(pathLower: string): Promise<Buffer> {
  const dbx = client()
  const response = await dbx.filesDownload({ path: pathLower })
  return (response.result as any).fileBinary as Buffer
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dropboxClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dropboxClient.ts tests/dropboxClient.test.ts
git commit -m "Add Dropbox client wrapper for listing and downloading PDFs"
```

---

### Task 6: Dropbox sync job

**Files:**
- Create: `lib/dropboxSync.ts`
- Create: `lib/blobStorage.ts` (thin wrapper so storage backend can be swapped later — v1 stores to Vercel Blob)
- Test: `tests/dropboxSync.test.ts`

**Interfaces:**
- Consumes: `listPdfFiles`, `downloadFile` (Task 5), `db` (Task 1), `Property` model
- Produces: `syncDropboxFolder(property: { id: string; dropboxFolderPath: string }): Promise<{ newFiles: number; skipped: number }>`, `uploadToStorage(filename: string, buffer: Buffer): Promise<string>` (returns storage URL)

- [ ] **Step 1: Write `lib/blobStorage.ts`**

```typescript
import { put } from '@vercel/blob'

export async function uploadToStorage(filename: string, buffer: Buffer): Promise<string> {
  const blob = await put(filename, buffer, { access: 'public' })
  return blob.url
}
```

Run: `npm install @vercel/blob`

- [ ] **Step 2: Write failing test for `lib/dropboxSync.ts`**

```typescript
// tests/dropboxSync.test.ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'

vi.mock('../lib/dropboxClient', () => ({
  listPdfFiles: vi.fn().mockResolvedValue([
    { id: 'dbx1', name: '429878_2026-02_report.pdf', pathLower: '/ide/429878_2026-02_report.pdf', serverModified: new Date('2026-02-15') },
  ]),
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}))

vi.mock('../lib/blobStorage', () => ({
  uploadToStorage: vi.fn().mockResolvedValue('https://blob.example.com/429878_2026-02_report.pdf'),
}))

import { syncDropboxFolder } from '../lib/dropboxSync'

describe('syncDropboxFolder', () => {
  it('creates a DropboxFile record for a new file', async () => {
    const property = await createProperty({ name: 'Ide Sync Test', address: 'x' })
    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })
    expect(result.newFiles).toBe(1)
    expect(result.skipped).toBe(0)
    const stored = await db.dropboxFile.findUnique({ where: { dropboxFileId: 'dbx1' } })
    expect(stored?.filename).toBe('429878_2026-02_report.pdf')
    expect(stored?.fileType).toBe('statement')
  })

  it('skips a file already ingested (dedupe by dropboxFileId)', async () => {
    const property = await createProperty({ name: 'Ide Sync Test 2', address: 'x' })
    await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx1',
        filename: '429878_2026-02_report.pdf',
        uploadedAt: new Date('2026-02-15'),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/existing.pdf',
      },
    })
    const result = await syncDropboxFolder({ id: property.id, dropboxFolderPath: '/ide' })
    expect(result.newFiles).toBe(0)
    expect(result.skipped).toBe(1)
  })

  afterAll(async () => {
    await db.dropboxFile.deleteMany({})
    await db.property.deleteMany({ where: { name: { in: ['Ide Sync Test', 'Ide Sync Test 2'] } } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/dropboxSync.test.ts`
Expected: FAIL with "Cannot find module '../lib/dropboxSync'"

- [ ] **Step 4: Write `lib/dropboxSync.ts`**

```typescript
import { db } from './db'
import { listPdfFiles, downloadFile } from './dropboxClient'
import { uploadToStorage } from './blobStorage'

export async function syncDropboxFolder(property: {
  id: string
  dropboxFolderPath: string
}): Promise<{ newFiles: number; skipped: number }> {
  const files = await listPdfFiles(property.dropboxFolderPath)
  let newFiles = 0
  let skipped = 0

  for (const file of files) {
    const existing = await db.dropboxFile.findUnique({ where: { dropboxFileId: file.id } })
    if (existing) {
      skipped++
      continue
    }

    const buffer = await downloadFile(file.pathLower)
    const storageUrl = await uploadToStorage(file.name, buffer)
    const fileType = file.name.toLowerCase().includes('loan') ? 'loan' : 'statement'

    await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: file.id,
        filename: file.name,
        uploadedAt: file.serverModified,
        fileType,
        storageUrl,
      },
    })
    newFiles++
  }

  return { newFiles, skipped }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/dropboxSync.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/dropboxSync.ts lib/blobStorage.ts tests/dropboxSync.test.ts package.json package-lock.json
git commit -m "Add Dropbox sync job with dedupe and blob storage upload"
```

---

### Task 7: Claude PDF extraction client wrapper

**Files:**
- Create: `lib/claudeClient.ts`
- Test: `tests/claudeClient.test.ts`

**Interfaces:**
- Produces: `extractStructuredDataFromPdf<T>(params: { pdfBase64: string; systemPrompt: string; schemaDescription: string }): Promise<T>` — sends the PDF to Claude with a prompt instructing it to return only JSON matching `schemaDescription`, parses and returns the JSON as `T`. Throws `ExtractionParseError` if the response isn't valid JSON.

- [ ] **Step 1: Write failing test using a mocked Anthropic SDK**

```typescript
// tests/claudeClient.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"foo": "bar"}' }],
        }),
      },
    })),
  }
})

import { extractStructuredDataFromPdf, ExtractionParseError } from '../lib/claudeClient'

describe('extractStructuredDataFromPdf', () => {
  it('parses a valid JSON response into the expected shape', async () => {
    const result = await extractStructuredDataFromPdf<{ foo: string }>({
      pdfBase64: 'ZmFrZS1wZGY=',
      systemPrompt: 'Extract data',
      schemaDescription: '{ foo: string }',
    })
    expect(result).toEqual({ foo: 'bar' })
  })
})

describe('extractStructuredDataFromPdf with malformed response', () => {
  it('throws ExtractionParseError when the model does not return valid JSON', async () => {
    const anthropicModule = await import('@anthropic-ai/sdk')
    ;(anthropicModule.default as any).mockImplementation(() => ({
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] }) },
    }))
    await expect(
      extractStructuredDataFromPdf({ pdfBase64: 'x', systemPrompt: 'x', schemaDescription: 'x' })
    ).rejects.toThrow(ExtractionParseError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/claudeClient.test.ts`
Expected: FAIL with "Cannot find module '../lib/claudeClient'"

- [ ] **Step 3: Write `lib/claudeClient.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'

export class ExtractionParseError extends Error {}

export async function extractStructuredDataFromPdf<T>(params: {
  pdfBase64: string
  systemPrompt: string
  schemaDescription: string
}): Promise<T> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: `${params.systemPrompt}\n\nRespond with ONLY valid JSON matching this shape, no prose, no markdown fences:\n${params.schemaDescription}`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: params.pdfBase64 },
          },
          { type: 'text', text: 'Extract the data as specified.' },
        ],
      },
    ],
  })

  const textBlock = response.content.find((block: any) => block.type === 'text')
  const text = (textBlock as any)?.text ?? ''

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ExtractionParseError(`Model did not return valid JSON: ${text.slice(0, 200)}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/claudeClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/claudeClient.ts tests/claudeClient.test.ts
git commit -m "Add Claude PDF extraction client wrapper"
```

---

### Task 8: Statement extraction schema and recurring-item lookup

**Files:**
- Create: `lib/extraction/statementSchema.ts`
- Test: `tests/extraction/statementSchema.test.ts`

**Interfaces:**
- Produces: TypeScript types `StatementExtraction`, `RentRollEntry`, `StatementLineItem`; function `isRecurringAccountItem(accountItem: string): boolean`; constant `STATEMENT_SCHEMA_DESCRIPTION: string` (human-readable schema text passed to Claude)

- [ ] **Step 1: Write failing test**

```typescript
// tests/extraction/statementSchema.test.ts
import { describe, it, expect } from 'vitest'
import { isRecurringAccountItem } from '../../lib/extraction/statementSchema'

describe('isRecurringAccountItem', () => {
  it('classifies rent, PM fee, electricity, cleaning, elevator maintenance as recurring', () => {
    expect(isRecurringAccountItem('Rent')).toBe(true)
    expect(isRecurringAccountItem('Property management fee')).toBe(true)
    expect(isRecurringAccountItem('Electricity charge')).toBe(true)
    expect(isRecurringAccountItem('Regular cleaning')).toBe(true)
    expect(isRecurringAccountItem('Building Management fee')).toBe(true)
    expect(isRecurringAccountItem('Elevator maintenance fee')).toBe(true)
  })

  it('classifies renewal fees, deposits, restoration, agent fees as one-time', () => {
    expect(isRecurringAccountItem('Renewal fee')).toBe(false)
    expect(isRecurringAccountItem('Renewal fee income')).toBe(false)
    expect(isRecurringAccountItem('Deposit')).toBe(false)
    expect(isRecurringAccountItem('Deposit refund')).toBe(false)
    expect(isRecurringAccountItem('Restration cost')).toBe(false)
    expect(isRecurringAccountItem('Restration cost received')).toBe(false)
    expect(isRecurringAccountItem('Building maintenance fee')).toBe(false)
    expect(isRecurringAccountItem('Brokerage fee')).toBe(false)
    expect(isRecurringAccountItem('Agent fee')).toBe(false)
    expect(isRecurringAccountItem('Co-agent fee')).toBe(false)
    expect(isRecurringAccountItem('Repair expense')).toBe(false)
    expect(isRecurringAccountItem('Cancellation penalty income')).toBe(false)
    expect(isRecurringAccountItem('Miscellaneous income')).toBe(false)
  })

  it('defaults unknown account items to one-time (conservative default)', () => {
    expect(isRecurringAccountItem('Some new category never seen before')).toBe(false)
  })

  it('is case-insensitive and tolerant of surrounding whitespace', () => {
    expect(isRecurringAccountItem('  rent  ')).toBe(true)
    expect(isRecurringAccountItem('ELECTRICITY CHARGE')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extraction/statementSchema.test.ts`
Expected: FAIL with "Cannot find module '../../lib/extraction/statementSchema'"

- [ ] **Step 3: Write `lib/extraction/statementSchema.ts`**

```typescript
export interface RentRollEntry {
  unitType: 'Residence' | 'Parking'
  roomNumber: string
  lessee: string
  monthlyCharge: number
  rentCollected: number
  arrearsCurrentMonth: number
  arrearsTotal: number
  depositBalance: number
  leaseStart: string | null
  leaseEnd: string | null
}

export interface StatementLineItem {
  category: 'income' | 'expense'
  accountItem: string
  settlementDate: string
  amount: number
  tax: number
  total: number
  note: string
}

export interface StatementExtraction {
  propertyName: string
  activityMonth: string // "YYYY-MM"
  remittanceDate: string
  netRemittanceAmount: number
  rentRoll: RentRollEntry[]
  lineItems: StatementLineItem[]
}

const RECURRING_ACCOUNT_ITEMS = [
  'rent',
  'parking',
  'property management fee',
  'pm fee',
  'electricity charge',
  'water charge',
  'regular cleaning',
  'building management fee',
  'elevator maintenance fee',
]

export function isRecurringAccountItem(accountItem: string): boolean {
  const normalized = accountItem.trim().toLowerCase()
  return RECURRING_ACCOUNT_ITEMS.some((known) => normalized === known)
}

export const STATEMENT_SCHEMA_DESCRIPTION = `
{
  "propertyName": string,
  "activityMonth": string (YYYY-MM, read from the statement's internal "Month" field, NOT the filename or remittance date),
  "remittanceDate": string (YYYY-MM-DD),
  "netRemittanceAmount": number,
  "rentRoll": [{
    "unitType": "Residence" | "Parking",
    "roomNumber": string,
    "lessee": string (use "vacant" if the unit is unoccupied),
    "monthlyCharge": number,
    "rentCollected": number,
    "arrearsCurrentMonth": number,
    "arrearsTotal": number,
    "depositBalance": number,
    "leaseStart": string | null (YYYY-MM-DD),
    "leaseEnd": string | null (YYYY-MM-DD)
  }],
  "lineItems": [{
    "category": "income" | "expense",
    "accountItem": string (e.g. "Rent", "Property management fee", "Electricity charge"),
    "settlementDate": string (YYYY-MM-DD),
    "amount": number (pre-tax),
    "tax": number,
    "total": number (amount + tax),
    "note": string
  }]
}
`
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extraction/statementSchema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/extraction/statementSchema.ts tests/extraction/statementSchema.test.ts
git commit -m "Add statement extraction schema and recurring-item lookup table"
```

---

### Task 9: Statement extraction pipeline (ingestion into FinancialRecord)

**Files:**
- Create: `lib/extraction/extractStatement.ts`
- Create: `tests/fixtures/statement-ide-jan2026.json` (fixture matching `StatementExtraction` shape, based on the real Jan-2026 Ide statement)
- Test: `tests/extraction/extractStatement.test.ts`

**Interfaces:**
- Consumes: `extractStructuredDataFromPdf`, `ExtractionParseError` (Task 7); `StatementExtraction`, `isRecurringAccountItem`, `STATEMENT_SCHEMA_DESCRIPTION` (Task 8); `db` (Task 1)
- Produces: `ingestStatement(params: { dropboxFileId: string; propertyId: string; pdfBase64: string }): Promise<{ status: 'success'; extractionId: string; recordsCreated: number } | { status: 'failed'; extractionId: string; error: string }>`

- [ ] **Step 1: Write the fixture**

```json
// tests/fixtures/statement-ide-jan2026.json
{
  "propertyName": "Ide building",
  "activityMonth": "2026-01",
  "remittanceDate": "2026-02-15",
  "netRemittanceAmount": 778201,
  "rentRoll": [
    {
      "unitType": "Residence",
      "roomNumber": "101",
      "lessee": "ZHU JIAOJIAO",
      "monthlyCharge": 125000,
      "rentCollected": 125000,
      "arrearsCurrentMonth": 0,
      "arrearsTotal": 0,
      "depositBalance": 119000,
      "leaseStart": "2024-03-28",
      "leaseEnd": "2026-03-27"
    }
  ],
  "lineItems": [
    {
      "category": "income",
      "accountItem": "Rent",
      "settlementDate": "2026-01-30",
      "amount": 125000,
      "tax": 0,
      "total": 125000,
      "note": "101-ZHU JIAOJIAO 2026-02分Rent"
    },
    {
      "category": "expense",
      "accountItem": "Property management fee",
      "settlementDate": "2026-02-15",
      "amount": 37339,
      "tax": 3734,
      "total": 41073,
      "note": "2026-02 井手ビル 管理委託料支払い"
    },
    {
      "category": "expense",
      "accountItem": "Regular cleaning",
      "settlementDate": "2026-02-15",
      "amount": 27273,
      "tax": 2727,
      "total": 30000,
      "note": "2026-02 井手ビル Dairy cleaning"
    }
  ]
}
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/extraction/extractStatement.test.ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import fixture from '../fixtures/statement-ide-jan2026.json'

vi.mock('../../lib/claudeClient', () => ({
  extractStructuredDataFromPdf: vi.fn().mockResolvedValue(fixture),
  ExtractionParseError: class ExtractionParseError extends Error {},
}))

import { ingestStatement } from '../../lib/extraction/extractStatement'
import { extractStructuredDataFromPdf, ExtractionParseError } from '../../lib/claudeClient'

describe('ingestStatement', () => {
  it('creates FinancialRecord rows from extracted line items, tagging recurring correctly', async () => {
    const property = await createProperty({ name: 'Ide Extract Test', address: 'x' })
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

    expect(result.status).toBe('success')
    const records = await db.financialRecord.findMany({ where: { propertyId: property.id } })
    expect(records).toHaveLength(3)
    expect(records.find((r) => r.accountItem === 'Rent')?.recurring).toBe(true)
    expect(records.find((r) => r.accountItem === 'Property management fee')?.recurring).toBe(true)
    expect(records.every((r) => r.month === '2026-01')).toBe(true)
    expect(records.every((r) => r.source === 'extracted')).toBe(true)
  })

  it('preserves a manual correction when the same file is re-ingested', async () => {
    const property = await createProperty({ name: 'Ide Extract Test 2', address: 'x' })
    const dropboxFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx-statement-2',
        filename: 'x.pdf',
        uploadedAt: new Date(),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/x.pdf',
      },
    })
    const first = await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })
    if (first.status !== 'success') throw new Error('setup failed')

    const rentRecord = await db.financialRecord.findFirstOrThrow({
      where: { propertyId: property.id, accountItem: 'Rent' },
    })
    await db.financialRecord.update({ where: { id: rentRecord.id }, data: { amount: 999999, source: 'manual' } })

    await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })

    const afterReingest = await db.financialRecord.findUniqueOrThrow({ where: { id: rentRecord.id } })
    expect(afterReingest.amount).toBe(999999)
    expect(afterReingest.source).toBe('manual')
  })

  it('marks the extraction as failed and creates no records when the model output cannot be parsed', async () => {
    ;(extractStructuredDataFromPdf as any).mockRejectedValueOnce(new ExtractionParseError('bad json'))
    const property = await createProperty({ name: 'Ide Extract Fail Test', address: 'x' })
    const dropboxFile = await db.dropboxFile.create({
      data: {
        propertyId: property.id,
        dropboxFileId: 'dbx-statement-3',
        filename: 'x.pdf',
        uploadedAt: new Date(),
        fileType: 'statement',
        storageUrl: 'https://blob.example.com/x.pdf',
      },
    })

    const result = await ingestStatement({ dropboxFileId: dropboxFile.id, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })

    expect(result.status).toBe('failed')
    const extraction = await db.extraction.findUnique({ where: { dropboxFileId: dropboxFile.id } })
    expect(extraction?.status).toBe('failed')
    const records = await db.financialRecord.findMany({ where: { propertyId: property.id } })
    expect(records).toHaveLength(0)
  })

  afterAll(async () => {
    await db.financialRecord.deleteMany({})
    await db.extraction.deleteMany({})
    await db.dropboxFile.deleteMany({})
    await db.property.deleteMany({
      where: { name: { in: ['Ide Extract Test', 'Ide Extract Test 2', 'Ide Extract Fail Test'] } },
    })
    await db.$disconnect()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/extraction/extractStatement.test.ts`
Expected: FAIL with "Cannot find module '../../lib/extraction/extractStatement'"

- [ ] **Step 4: Write `lib/extraction/extractStatement.ts`**

```typescript
import { db } from '../db'
import { extractStructuredDataFromPdf, ExtractionParseError } from '../claudeClient'
import { isRecurringAccountItem, STATEMENT_SCHEMA_DESCRIPTION, type StatementExtraction } from './statementSchema'

const STATEMENT_SYSTEM_PROMPT = `You are extracting structured financial data from a Japanese property management monthly statement PDF (issued by Axios Management Inc.). The document has a summary/rent-roll page and an itemized income/expense ledger. Extract every rent roll row and every line item from the ledger.`

export async function ingestStatement(params: {
  dropboxFileId: string
  propertyId: string
  pdfBase64: string
}): Promise<
  | { status: 'success'; extractionId: string; recordsCreated: number }
  | { status: 'failed'; extractionId: string; error: string }
> {
  let extracted: StatementExtraction
  let rawOutput = ''

  try {
    extracted = await extractStructuredDataFromPdf<StatementExtraction>({
      pdfBase64: params.pdfBase64,
      systemPrompt: STATEMENT_SYSTEM_PROMPT,
      schemaDescription: STATEMENT_SCHEMA_DESCRIPTION,
    })
    rawOutput = JSON.stringify(extracted)
  } catch (err) {
    const message = err instanceof ExtractionParseError ? err.message : String(err)
    const extraction = await db.extraction.create({
      data: { dropboxFileId: params.dropboxFileId, rawModelOutput: message, status: 'failed' },
    })
    return { status: 'failed', extractionId: extraction.id, error: message }
  }

  const existingExtraction = await db.extraction.findUnique({ where: { dropboxFileId: params.dropboxFileId } })

  const extraction = existingExtraction
    ? await db.extraction.update({
        where: { id: existingExtraction.id },
        data: { rawModelOutput: rawOutput, status: 'success', extractedAt: new Date() },
      })
    : await db.extraction.create({
        data: { dropboxFileId: params.dropboxFileId, rawModelOutput: rawOutput, status: 'success' },
      })

  let recordsCreated = 0

  for (const item of extracted.lineItems) {
    const existingManual = await db.financialRecord.findFirst({
      where: {
        propertyId: params.propertyId,
        extractionId: extraction.id,
        accountItem: item.accountItem,
        source: 'manual',
      },
    })
    if (existingManual) continue // manual correction takes precedence, never overwritten

    const existingExtracted = await db.financialRecord.findFirst({
      where: {
        propertyId: params.propertyId,
        extractionId: extraction.id,
        accountItem: item.accountItem,
        source: 'extracted',
      },
    })

    const data = {
      propertyId: params.propertyId,
      month: extracted.activityMonth,
      category: item.category,
      accountItem: item.accountItem,
      amount: item.total,
      recurring: isRecurringAccountItem(item.accountItem),
      source: 'extracted' as const,
      extractionId: extraction.id,
    }

    if (existingExtracted) {
      await db.financialRecord.update({ where: { id: existingExtracted.id }, data })
    } else {
      await db.financialRecord.create({ data })
      recordsCreated++
    }
  }

  return { status: 'success', extractionId: extraction.id, recordsCreated }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/extraction/extractStatement.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/extraction/extractStatement.ts tests/extraction/extractStatement.test.ts tests/fixtures/statement-ide-jan2026.json
git commit -m "Add statement extraction pipeline with manual-correction preservation"
```

---

### Task 10: Loan extraction schema and pipeline

**Files:**
- Create: `lib/extraction/loanSchema.ts`
- Create: `lib/extraction/extractLoan.ts`
- Create: `tests/fixtures/loan-do5.json`
- Test: `tests/extraction/extractLoan.test.ts`

**Interfaces:**
- Consumes: `extractStructuredDataFromPdf` (Task 7), `db`, `createLoan` (Task 4)
- Produces: type `LoanExtraction`; constant `LOAN_SCHEMA_DESCRIPTION`; function `ingestLoanDocument(params: { dropboxFileId: string | null; propertyId: string; pdfBase64: string }): Promise<{ status: 'success'; loanId: string } | { status: 'failed'; error: string }>`

- [ ] **Step 1: Write `lib/extraction/loanSchema.ts`**

```typescript
export interface LoanPaymentScheduleRow {
  date: string
  totalPayment: number
  principal: number
  interest: number
  remainingBalance: number
}

export interface LoanExtraction {
  lender: string
  originationDate: string
  maturityDate: string
  originalLoanAmount: number
  currentInterestRate: number
  rateChangeDate: string | null
  newInterestRate: number | null
  monthlyPrincipal: number
  paymentSchedule: LoanPaymentScheduleRow[]
}

export const LOAN_SCHEMA_DESCRIPTION = `
{
  "lender": string,
  "originationDate": string (YYYY-MM-DD),
  "maturityDate": string (YYYY-MM-DD),
  "originalLoanAmount": number,
  "currentInterestRate": number (as a percentage, e.g. 1.825),
  "rateChangeDate": string | null (YYYY-MM-DD, the date a new rate takes effect if shown),
  "newInterestRate": number | null (percentage),
  "monthlyPrincipal": number (the fixed principal amount per scheduled payment),
  "paymentSchedule": [{
    "date": string (YYYY-MM-DD),
    "totalPayment": number,
    "principal": number,
    "interest": number,
    "remainingBalance": number
  }]
}
`
```

- [ ] **Step 2: Write the fixture**

```json
// tests/fixtures/loan-do5.json
{
  "lender": "Kiraboshi Bank",
  "originationDate": "2025-07-31",
  "maturityDate": "2045-07-31",
  "originalLoanAmount": 221800000,
  "currentInterestRate": 1.825,
  "rateChangeDate": "2026-09-01",
  "newInterestRate": 2.075,
  "monthlyPrincipal": 925000,
  "paymentSchedule": [
    { "date": "2026-08-31", "totalPayment": 1282766, "principal": 925000, "interest": 357766, "remainingBalance": 209775000 },
    { "date": "2026-09-30", "totalPayment": 1316808, "principal": 925000, "interest": 391808, "remainingBalance": 208850000 }
  ]
}
```

- [ ] **Step 3: Write failing test**

```typescript
// tests/extraction/extractLoan.test.ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { getLoanForProperty } from '../../lib/loans'
import fixture from '../fixtures/loan-do5.json'

vi.mock('../../lib/claudeClient', () => ({
  extractStructuredDataFromPdf: vi.fn().mockResolvedValue(fixture),
  ExtractionParseError: class ExtractionParseError extends Error {},
}))

import { ingestLoanDocument } from '../../lib/extraction/extractLoan'

describe('ingestLoanDocument', () => {
  it('creates a Loan record from extracted data, using the first schedule row as current balance', async () => {
    const property = await createProperty({ name: 'DO5 Loan Extract Test', address: 'x' })

    const result = await ingestLoanDocument({ dropboxFileId: null, propertyId: property.id, pdfBase64: 'ZmFrZQ==' })

    expect(result.status).toBe('success')
    const loan = await getLoanForProperty(property.id)
    expect(loan?.lender).toBe('Kiraboshi Bank')
    expect(loan?.originalAmount).toBe(221800000)
    expect(loan?.currentBalance).toBe(209775000) // first schedule row's remaining balance
    expect(loan?.currentRate).toBe(1.825)
    expect(loan?.monthlyPrincipal).toBe(925000)
    expect(loan?.newRate).toBe(2.075)
  })

  afterAll(async () => {
    await db.loan.deleteMany({})
    await db.property.deleteMany({ where: { name: 'DO5 Loan Extract Test' } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/extraction/extractLoan.test.ts`
Expected: FAIL with "Cannot find module '../../lib/extraction/extractLoan'"

- [ ] **Step 5: Write `lib/extraction/extractLoan.ts`**

```typescript
import { db } from '../db'
import { extractStructuredDataFromPdf, ExtractionParseError } from '../claudeClient'
import { createLoan } from '../loans'
import { LOAN_SCHEMA_DESCRIPTION, type LoanExtraction } from './loanSchema'

const LOAN_SYSTEM_PROMPT = `You are extracting structured data from a Japanese bank loan repayment schedule (証書貸付ご返済予定表). Extract the loan terms and every row of the payment schedule table.`

export async function ingestLoanDocument(params: {
  dropboxFileId: string | null
  propertyId: string
  pdfBase64: string
}): Promise<{ status: 'success'; loanId: string } | { status: 'failed'; error: string }> {
  let extracted: LoanExtraction

  try {
    extracted = await extractStructuredDataFromPdf<LoanExtraction>({
      pdfBase64: params.pdfBase64,
      systemPrompt: LOAN_SYSTEM_PROMPT,
      schemaDescription: LOAN_SCHEMA_DESCRIPTION,
    })
  } catch (err) {
    const message = err instanceof ExtractionParseError ? err.message : String(err)
    return { status: 'failed', error: message }
  }

  const firstRow = extracted.paymentSchedule[0]

  const loan = await createLoan({
    propertyId: params.propertyId,
    lender: extracted.lender,
    originalAmount: extracted.originalLoanAmount,
    currentBalance: firstRow ? firstRow.remainingBalance + firstRow.principal : extracted.originalLoanAmount,
    currentRate: extracted.currentInterestRate,
    rateChangeDate: extracted.rateChangeDate ? new Date(extracted.rateChangeDate) : undefined,
    newRate: extracted.newInterestRate ?? undefined,
    monthlyPrincipal: extracted.monthlyPrincipal,
    originationDate: new Date(extracted.originationDate),
    maturityDate: new Date(extracted.maturityDate),
    sourceFileId: params.dropboxFileId ?? undefined,
  })

  return { status: 'success', loanId: loan.id }
}
```

Note: `currentBalance` is set to the balance *before* the first scheduled payment (`remainingBalance + principal` of the first row), since the schedule shows balances *after* each payment — this matches "current balance as of the document issue date."

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/extraction/extractLoan.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/extraction/loanSchema.ts lib/extraction/extractLoan.ts tests/extraction/extractLoan.test.ts tests/fixtures/loan-do5.json
git commit -m "Add loan document extraction schema and ingestion pipeline"
```

---

### Task 11: Financial calculations (NOI, debt service, pre/after-tax cash flow)

**Files:**
- Create: `lib/financialCalculations.ts`
- Test: `tests/financialCalculations.test.ts`

**Interfaces:**
- Consumes: `db`, `FinancialRecord` model (Task 1); `getLoanForProperty`, `monthlyInterestExpense`, `monthlyDebtService` (Task 4); `getMonthlyAmortizedCost` (Task 3); `getMarginalTaxRate` (Task 2)
- Produces: `getMonthlyFinancials(propertyId: string, month: string): Promise<{ income: number; operatingExpenses: number; noi: number; debtService: number; interestExpense: number; principalPaydown: number; amortizedTax: number; amortizedInsurance: number; preTaxCashFlow: number; taxableIncome: number; incomeTaxOwed: number; afterTaxCashFlow: number }>`

- [ ] **Step 1: Write failing test**

```typescript
// tests/financialCalculations.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { createLoan } from '../lib/loans'
import { upsertAnnualCost } from '../lib/annualCosts'
import { setSetting } from '../lib/settings'
import { getMonthlyFinancials } from '../lib/financialCalculations'

describe('getMonthlyFinancials', () => {
  it('computes NOI, debt service, and pre/after-tax cash flow for a month with income, expenses, a loan, tax, and insurance', async () => {
    const property = await createProperty({ name: 'Ide Calc Test', address: 'x' })

    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 859500, recurring: true, source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Property management fee', amount: 41073, recurring: true, source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Utilities', amount: 10226, recurring: true, source: 'extracted' },
      ],
    })

    await createLoan({
      propertyId: property.id,
      lender: 'Kiraboshi Bank',
      originalAmount: 110500000,
      currentBalance: 104968000,
      currentRate: 1.825,
      monthlyPrincipal: 461000,
      originationDate: new Date('2025-07-31'),
      maturityDate: new Date('2045-07-31'),
    })

    await upsertAnnualCost({ propertyId: property.id, costType: 'tax', year: 2026, annualAmount: 227900 })
    await upsertAnnualCost({ propertyId: property.id, costType: 'insurance', year: 2026, annualAmount: 46040 })
    await setSetting('marginalTaxRate', '0.43')

    const result = await getMonthlyFinancials(property.id, '2026-01')

    expect(result.income).toBe(859500)
    expect(result.operatingExpenses).toBe(51299) // 41073 + 10226
    expect(result.noi).toBe(808201) // 859500 - 51299
    const expectedInterest = (104968000 * (1.825 / 100)) / 12
    expect(result.interestExpense).toBeCloseTo(expectedInterest, 1)
    expect(result.debtService).toBeCloseTo(461000 + expectedInterest, 1)
    expect(result.principalPaydown).toBe(461000)
    expect(result.amortizedTax).toBeCloseTo(227900 / 12, 2)
    expect(result.amortizedInsurance).toBeCloseTo(46040 / 12, 2)

    const expectedTaxableIncome = result.noi - result.interestExpense - result.amortizedTax - result.amortizedInsurance
    expect(result.taxableIncome).toBeCloseTo(expectedTaxableIncome, 1)
    expect(result.incomeTaxOwed).toBeCloseTo(expectedTaxableIncome * 0.43, 1)

    const expectedPreTaxCashFlow = result.noi - result.debtService - result.amortizedTax - result.amortizedInsurance
    expect(result.preTaxCashFlow).toBeCloseTo(expectedPreTaxCashFlow, 1)
    expect(result.afterTaxCashFlow).toBeCloseTo(expectedPreTaxCashFlow - result.incomeTaxOwed, 1)
  })

  it('floors taxable income at 0 when expenses and debt service exceed income', async () => {
    const property = await createProperty({ name: 'Loss Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-02', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, source: 'extracted' },
    })
    await createLoan({
      propertyId: property.id,
      lender: 'Kiraboshi Bank',
      originalAmount: 100000000,
      currentBalance: 100000000,
      currentRate: 2,
      monthlyPrincipal: 500000,
      originationDate: new Date('2025-01-01'),
      maturityDate: new Date('2045-01-01'),
    })
    const result = await getMonthlyFinancials(property.id, '2026-02')
    expect(result.taxableIncome).toBe(0)
    expect(result.incomeTaxOwed).toBe(0)
  })

  afterAll(async () => {
    await db.financialRecord.deleteMany({})
    await db.loan.deleteMany({})
    await db.annualCost.deleteMany({})
    await db.setting.deleteMany({ where: { key: 'marginalTaxRate' } })
    await db.property.deleteMany({ where: { name: { in: ['Ide Calc Test', 'Loss Test'] } } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/financialCalculations.test.ts`
Expected: FAIL with "Cannot find module '../lib/financialCalculations'"

- [ ] **Step 3: Write `lib/financialCalculations.ts`**

```typescript
import { db } from './db'
import { getLoanForProperty, monthlyInterestExpense, monthlyDebtService } from './loans'
import { getMonthlyAmortizedCost } from './annualCosts'
import { getMarginalTaxRate } from './settings'

export interface MonthlyFinancials {
  income: number
  operatingExpenses: number
  noi: number
  debtService: number
  interestExpense: number
  principalPaydown: number
  amortizedTax: number
  amortizedInsurance: number
  preTaxCashFlow: number
  taxableIncome: number
  incomeTaxOwed: number
  afterTaxCashFlow: number
}

export async function getMonthlyFinancials(propertyId: string, month: string): Promise<MonthlyFinancials> {
  const records = await db.financialRecord.findMany({ where: { propertyId, month } })

  const income = records.filter((r) => r.category === 'income').reduce((sum, r) => sum + r.amount, 0)
  const operatingExpenses = records.filter((r) => r.category === 'expense').reduce((sum, r) => sum + r.amount, 0)
  const noi = income - operatingExpenses

  const loan = await getLoanForProperty(propertyId)
  const interestExpense = loan ? monthlyInterestExpense(loan.currentBalance, loan.currentRate) : 0
  const principalPaydown = loan ? loan.monthlyPrincipal : 0
  const debtService = loan ? monthlyDebtService(loan) : 0

  const year = parseInt(month.split('-')[0], 10)
  const amortizedTax = await getMonthlyAmortizedCost(propertyId, 'tax', year)
  const amortizedInsurance = await getMonthlyAmortizedCost(propertyId, 'insurance', year)

  const rawTaxableIncome = noi - interestExpense - amortizedTax - amortizedInsurance
  const taxableIncome = Math.max(rawTaxableIncome, 0)

  const marginalRate = await getMarginalTaxRate()
  const incomeTaxOwed = taxableIncome * marginalRate

  const preTaxCashFlow = noi - debtService - amortizedTax - amortizedInsurance
  const afterTaxCashFlow = preTaxCashFlow - incomeTaxOwed

  return {
    income,
    operatingExpenses,
    noi,
    debtService,
    interestExpense,
    principalPaydown,
    amortizedTax,
    amortizedInsurance,
    preTaxCashFlow,
    taxableIncome,
    incomeTaxOwed,
    afterTaxCashFlow,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/financialCalculations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/financialCalculations.ts tests/financialCalculations.test.ts
git commit -m "Add NOI, debt service, and pre/after-tax cash flow calculations"
```

---

### Task 12: Anomaly detection rule engine

**Files:**
- Create: `lib/anomalyRules.ts`
- Test: `tests/anomalyRules.test.ts`

**Interfaces:**
- Consumes: `db`, `FinancialRecord` model (Task 1)
- Produces: `runAnomalyRules(propertyId: string, month: string): Promise<AnomalyFlag[]>` — evaluates all rules for the given property/month, creates `AnomalyFlag` rows for new findings (skipping duplicates already open for the same property/month/ruleType), and returns the flags created.

- [ ] **Step 1: Write failing test**

```typescript
// tests/anomalyRules.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { runAnomalyRules } from '../lib/anomalyRules'

async function seedRecurringExpense(propertyId: string, month: string, amount: number) {
  await db.financialRecord.create({
    data: { propertyId, month, category: 'expense', accountItem: 'Electricity charge', amount, recurring: true, source: 'extracted' },
  })
}

describe('runAnomalyRules', () => {
  it('flags a recurring expense that deviates more than 50% from its trailing 3-month average', async () => {
    const property = await createProperty({ name: 'Anomaly Test', address: 'x' })
    await seedRecurringExpense(property.id, '2025-11', 10000)
    await seedRecurringExpense(property.id, '2025-12', 10000)
    await seedRecurringExpense(property.id, '2026-01', 10000)
    await seedRecurringExpense(property.id, '2026-02', 50000) // huge spike

    const flags = await runAnomalyRules(property.id, '2026-02')

    expect(flags.some((f) => f.ruleType === 'expense_deviation' && f.description.includes('Electricity charge'))).toBe(true)
  })

  it('does not flag a recurring expense within normal range', async () => {
    const property = await createProperty({ name: 'Normal Range Test', address: 'x' })
    await seedRecurringExpense(property.id, '2025-11', 10000)
    await seedRecurringExpense(property.id, '2025-12', 10500)
    await seedRecurringExpense(property.id, '2026-01', 9800)
    await seedRecurringExpense(property.id, '2026-02', 10200)

    const flags = await runAnomalyRules(property.id, '2026-02')
    expect(flags.some((f) => f.ruleType === 'expense_deviation')).toBe(false)
  })

  it('flags a missing statement past the 20th of the month', async () => {
    const property = await createProperty({ name: 'Missing Statement Test', address: 'x' })
    const targetMonth = '2026-03'
    // simulate "today" via a rule param instead of relying on real clock in tests
    const flags = await runAnomalyRules(property.id, targetMonth, { today: new Date('2026-04-25') })
    expect(flags.some((f) => f.ruleType === 'missing_statement')).toBe(true)
  })

  it('does not flag a missing statement before the 20th of the following month', async () => {
    const property = await createProperty({ name: 'Not Yet Late Test', address: 'x' })
    const flags = await runAnomalyRules(property.id, '2026-03', { today: new Date('2026-04-10') })
    expect(flags.some((f) => f.ruleType === 'missing_statement')).toBe(false)
  })

  it('flags negative cash flow after debt service', async () => {
    const property = await createProperty({ name: 'Negative Cashflow Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, source: 'extracted' },
    })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Repair expense', amount: 500000, recurring: false, source: 'extracted' },
    })
    const flags = await runAnomalyRules(property.id, '2026-01')
    expect(flags.some((f) => f.ruleType === 'negative_cash_flow')).toBe(true)
  })

  it('does not create a duplicate open flag if the rule already fired for this property/month', async () => {
    const property = await createProperty({ name: 'Dedupe Test', address: 'x' })
    await seedRecurringExpense(property.id, '2025-11', 10000)
    await seedRecurringExpense(property.id, '2025-12', 10000)
    await seedRecurringExpense(property.id, '2026-01', 10000)
    await seedRecurringExpense(property.id, '2026-02', 50000)

    await runAnomalyRules(property.id, '2026-02')
    await runAnomalyRules(property.id, '2026-02')

    const allFlags = await db.anomalyFlag.findMany({
      where: { propertyId: property.id, month: '2026-02', ruleType: 'expense_deviation' },
    })
    expect(allFlags).toHaveLength(1)
  })

  afterAll(async () => {
    await db.anomalyFlag.deleteMany({})
    await db.financialRecord.deleteMany({})
    await db.property.deleteMany({
      where: {
        name: {
          in: [
            'Anomaly Test',
            'Normal Range Test',
            'Missing Statement Test',
            'Not Yet Late Test',
            'Negative Cashflow Test',
            'Dedupe Test',
          ],
        },
      },
    })
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/anomalyRules.test.ts`
Expected: FAIL with "Cannot find module '../lib/anomalyRules'"

- [ ] **Step 3: Write `lib/anomalyRules.ts`**

```typescript
import { db } from './db'
import type { AnomalyFlag } from '@prisma/client'

const DEVIATION_THRESHOLD = 0.5 // 50%

function previousMonths(month: string, count: number): string[] {
  const [year, mo] = month.split('-').map(Number)
  const result: string[] = []
  let y = year
  let m = mo
  for (let i = 0; i < count; i++) {
    m -= 1
    if (m === 0) {
      m = 12
      y -= 1
    }
    result.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return result
}

async function createFlagIfNew(
  propertyId: string,
  month: string,
  ruleType: string,
  description: string
): Promise<AnomalyFlag | null> {
  const existing = await db.anomalyFlag.findFirst({
    where: { propertyId, month, ruleType, status: 'open' },
  })
  if (existing) return null
  return db.anomalyFlag.create({ data: { propertyId, month, ruleType, description, status: 'open' } })
}

async function checkExpenseDeviation(propertyId: string, month: string): Promise<AnomalyFlag[]> {
  const flags: AnomalyFlag[] = []
  const currentRecords = await db.financialRecord.findMany({
    where: { propertyId, month, category: 'expense', recurring: true },
  })

  const trailingMonths = previousMonths(month, 3)

  for (const record of currentRecords) {
    const trailingRecords = await db.financialRecord.findMany({
      where: { propertyId, month: { in: trailingMonths }, accountItem: record.accountItem, category: 'expense' },
    })
    if (trailingRecords.length === 0) continue

    const average = trailingRecords.reduce((sum, r) => sum + r.amount, 0) / trailingRecords.length
    if (average === 0) continue

    const deviation = Math.abs(record.amount - average) / average
    if (deviation > DEVIATION_THRESHOLD) {
      const flag = await createFlagIfNew(
        propertyId,
        month,
        'expense_deviation',
        `${record.accountItem} was ${record.amount} vs. trailing 3-month average of ${Math.round(average)} (${Math.round(deviation * 100)}% deviation)`
      )
      if (flag) flags.push(flag)
    }
  }

  return flags
}

async function checkMissingStatement(propertyId: string, month: string, today: Date): Promise<AnomalyFlag[]> {
  const [year, mo] = month.split('-').map(Number)
  const dueDate = new Date(year, mo, 20) // 20th of the month AFTER the activity month

  if (today <= dueDate) return []

  const records = await db.financialRecord.findFirst({ where: { propertyId, month } })
  if (records) return []

  const flag = await createFlagIfNew(propertyId, month, 'missing_statement', `No statement received for ${month} as of ${today.toISOString().slice(0, 10)}`)
  return flag ? [flag] : []
}

async function checkNegativeCashFlow(propertyId: string, month: string): Promise<AnomalyFlag[]> {
  const records = await db.financialRecord.findMany({ where: { propertyId, month } })
  const income = records.filter((r) => r.category === 'income').reduce((sum, r) => sum + r.amount, 0)
  const expenses = records.filter((r) => r.category === 'expense').reduce((sum, r) => sum + r.amount, 0)

  if (income - expenses >= 0) return []

  const flag = await createFlagIfNew(propertyId, month, 'negative_cash_flow', `Net cash flow for ${month} is negative: ${income - expenses}`)
  return flag ? [flag] : []
}

export async function runAnomalyRules(
  propertyId: string,
  month: string,
  options: { today?: Date } = {}
): Promise<AnomalyFlag[]> {
  const today = options.today ?? new Date()

  const [deviationFlags, missingFlags, cashFlowFlags] = await Promise.all([
    checkExpenseDeviation(propertyId, month),
    checkMissingStatement(propertyId, month, today),
    checkNegativeCashFlow(propertyId, month),
  ])

  return [...deviationFlags, ...missingFlags, ...cashFlowFlags]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/anomalyRules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/anomalyRules.ts tests/anomalyRules.test.ts
git commit -m "Add deterministic anomaly detection rule engine"
```

---

### Task 13: Dashboard data aggregation (monthly / YTD / portfolio)

**Files:**
- Create: `lib/dashboardData.ts`
- Test: `tests/dashboardData.test.ts`

**Interfaces:**
- Consumes: `getMonthlyFinancials` (Task 11), `db`, `listProperties` (Task 2), `AnomalyFlag` model
- Produces: `getPropertyMonthlyDashboard(propertyId: string, month: string): Promise<MonthlyFinancials & { flags: AnomalyFlag[] }>`, `getPropertyYtdDashboard(propertyId: string, year: number, throughMonth: number): Promise<MonthlyFinancials>` (sums each field across Jan..throughMonth of `year`), `getPortfolioDashboard(month: string): Promise<MonthlyFinancials & { perProperty: { propertyId: string; propertyName: string; financials: MonthlyFinancials }[] }>`

- [ ] **Step 1: Write failing test**

```typescript
// tests/dashboardData.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { getPropertyMonthlyDashboard, getPropertyYtdDashboard, getPortfolioDashboard } from '../lib/dashboardData'

describe('dashboardData', () => {
  it('returns monthly financials plus open anomaly flags for a property', async () => {
    const property = await createProperty({ name: 'Dash Monthly Test', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, source: 'extracted' },
    })
    await db.anomalyFlag.create({
      data: { propertyId: property.id, month: '2026-01', ruleType: 'negative_cash_flow', description: 'test flag', status: 'open' },
    })

    const result = await getPropertyMonthlyDashboard(property.id, '2026-01')
    expect(result.income).toBe(100000)
    expect(result.flags).toHaveLength(1)
  })

  it('sums financials across Jan through the given month for YTD', async () => {
    const property = await createProperty({ name: 'Dash YTD Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, source: 'extracted' },
        { propertyId: property.id, month: '2026-02', category: 'income', accountItem: 'Rent', amount: 110000, recurring: true, source: 'extracted' },
        { propertyId: property.id, month: '2026-03', category: 'income', accountItem: 'Rent', amount: 999999, recurring: true, source: 'extracted' }, // excluded, after throughMonth
      ],
    })

    const result = await getPropertyYtdDashboard(property.id, 2026, 2)
    expect(result.income).toBe(210000)
  })

  it('aggregates portfolio-wide totals across all active properties for a month', async () => {
    const propertyA = await createProperty({ name: 'Portfolio A', address: 'x' })
    const propertyB = await createProperty({ name: 'Portfolio B', address: 'x' })
    await db.financialRecord.create({
      data: { propertyId: propertyA.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, source: 'extracted' },
    })
    await db.financialRecord.create({
      data: { propertyId: propertyB.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 200000, recurring: true, source: 'extracted' },
    })

    const result = await getPortfolioDashboard('2026-01')
    expect(result.income).toBe(300000)
    expect(result.perProperty).toHaveLength(2)
    expect(result.perProperty.find((p) => p.propertyName === 'Portfolio A')?.financials.income).toBe(100000)
  })

  afterAll(async () => {
    await db.anomalyFlag.deleteMany({})
    await db.financialRecord.deleteMany({})
    await db.property.deleteMany({
      where: { name: { in: ['Dash Monthly Test', 'Dash YTD Test', 'Portfolio A', 'Portfolio B'] } },
    })
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dashboardData.test.ts`
Expected: FAIL with "Cannot find module '../lib/dashboardData'"

- [ ] **Step 3: Write `lib/dashboardData.ts`**

```typescript
import { db } from './db'
import { getMonthlyFinancials, type MonthlyFinancials } from './financialCalculations'
import { listProperties } from './properties'
import type { AnomalyFlag } from '@prisma/client'

const ZERO_FINANCIALS: MonthlyFinancials = {
  income: 0,
  operatingExpenses: 0,
  noi: 0,
  debtService: 0,
  interestExpense: 0,
  principalPaydown: 0,
  amortizedTax: 0,
  amortizedInsurance: 0,
  preTaxCashFlow: 0,
  taxableIncome: 0,
  incomeTaxOwed: 0,
  afterTaxCashFlow: 0,
}

function sumFinancials(a: MonthlyFinancials, b: MonthlyFinancials): MonthlyFinancials {
  const result = { ...ZERO_FINANCIALS }
  for (const key of Object.keys(ZERO_FINANCIALS) as (keyof MonthlyFinancials)[]) {
    result[key] = a[key] + b[key]
  }
  return result
}

export async function getPropertyMonthlyDashboard(
  propertyId: string,
  month: string
): Promise<MonthlyFinancials & { flags: AnomalyFlag[] }> {
  const financials = await getMonthlyFinancials(propertyId, month)
  const flags = await db.anomalyFlag.findMany({ where: { propertyId, month, status: 'open' } })
  return { ...financials, flags }
}

export async function getPropertyYtdDashboard(
  propertyId: string,
  year: number,
  throughMonth: number
): Promise<MonthlyFinancials> {
  let total = { ...ZERO_FINANCIALS }
  for (let m = 1; m <= throughMonth; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`
    const financials = await getMonthlyFinancials(propertyId, month)
    total = sumFinancials(total, financials)
  }
  return total
}

export async function getPortfolioDashboard(
  month: string
): Promise<MonthlyFinancials & { perProperty: { propertyId: string; propertyName: string; financials: MonthlyFinancials }[] }> {
  const properties = await listProperties()
  const perProperty = await Promise.all(
    properties.map(async (property) => ({
      propertyId: property.id,
      propertyName: property.name,
      financials: await getMonthlyFinancials(property.id, month),
    }))
  )

  const total = perProperty.reduce((acc, p) => sumFinancials(acc, p.financials), { ...ZERO_FINANCIALS })

  return { ...total, perProperty }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dashboardData.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dashboardData.ts tests/dashboardData.test.ts
git commit -m "Add monthly/YTD/portfolio dashboard data aggregation"
```

---

### Task 14: API routes (sync trigger, manual loan upload, manual correction)

**Files:**
- Create: `app/api/sync/route.ts`
- Create: `app/api/loans/upload/route.ts`
- Create: `app/api/financial-records/[id]/route.ts`
- Test: `tests/api/sync.test.ts`, `tests/api/loansUpload.test.ts`, `tests/api/financialRecordsUpdate.test.ts`

**Interfaces:**
- Consumes: `syncDropboxFolder` (Task 6), `ingestLoanDocument` (Task 10), `db` (Task 1)
- Produces: `POST /api/sync` (body: `{ propertyId: string; dropboxFolderPath: string }`, returns `{ newFiles: number; skipped: number }`); `POST /api/loans/upload` (multipart form with `propertyId` and `file`, returns `{ status; loanId? }`); `PATCH /api/financial-records/:id` (body: `{ amount: number }`, sets `source: 'manual'`, returns updated record)

- [ ] **Step 1: Write failing test for the sync route**

```typescript
// tests/api/sync.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/dropboxSync', () => ({
  syncDropboxFolder: vi.fn().mockResolvedValue({ newFiles: 2, skipped: 1 }),
}))

import { POST } from '../../app/api/sync/route'

describe('POST /api/sync', () => {
  it('triggers a Dropbox sync for the given property and returns the result', async () => {
    const request = new Request('http://localhost/api/sync', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'prop-1', dropboxFolderPath: '/ide' }),
    })
    const response = await POST(request)
    const body = await response.json()
    expect(body).toEqual({ newFiles: 2, skipped: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/sync.test.ts`
Expected: FAIL with "Cannot find module '../../app/api/sync/route'"

- [ ] **Step 3: Write `app/api/sync/route.ts`**

```typescript
import { syncDropboxFolder } from '../../../lib/dropboxSync'

export async function POST(request: Request) {
  const body = await request.json()
  const result = await syncDropboxFolder({ id: body.propertyId, dropboxFolderPath: body.dropboxFolderPath })
  return Response.json(result)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/sync.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for the loan upload route**

```typescript
// tests/api/loansUpload.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/extraction/extractLoan', () => ({
  ingestLoanDocument: vi.fn().mockResolvedValue({ status: 'success', loanId: 'loan-1' }),
}))

import { POST } from '../../app/api/loans/upload/route'

describe('POST /api/loans/upload', () => {
  it('extracts and stores a loan from an uploaded PDF', async () => {
    const formData = new FormData()
    formData.append('propertyId', 'prop-1')
    formData.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }), 'loan.pdf')

    const request = new Request('http://localhost/api/loans/upload', { method: 'POST', body: formData })
    const response = await POST(request)
    const body = await response.json()
    expect(body).toEqual({ status: 'success', loanId: 'loan-1' })
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/api/loansUpload.test.ts`
Expected: FAIL with "Cannot find module '../../app/api/loans/upload/route'"

- [ ] **Step 7: Write `app/api/loans/upload/route.ts`**

```typescript
import { ingestLoanDocument } from '../../../../lib/extraction/extractLoan'

export async function POST(request: Request) {
  const formData = await request.formData()
  const propertyId = formData.get('propertyId') as string
  const file = formData.get('file') as File

  const arrayBuffer = await file.arrayBuffer()
  const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')

  const result = await ingestLoanDocument({ dropboxFileId: null, propertyId, pdfBase64 })
  return Response.json(result)
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/api/loansUpload.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing test for the manual correction route**

```typescript
// tests/api/financialRecordsUpdate.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../../lib/db'
import { createProperty } from '../../lib/properties'
import { PATCH } from '../../app/api/financial-records/[id]/route'

describe('PATCH /api/financial-records/:id', () => {
  it('updates the amount and sets source to manual', async () => {
    const property = await createProperty({ name: 'Correction Test', address: 'x' })
    const record = await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Utilities', amount: 5000, recurring: true, source: 'extracted' },
    })

    const request = new Request(`http://localhost/api/financial-records/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: 7500 }),
    })
    const response = await PATCH(request, { params: { id: record.id } })
    const body = await response.json()

    expect(body.amount).toBe(7500)
    expect(body.source).toBe('manual')
  })

  afterAll(async () => {
    await db.financialRecord.deleteMany({})
    await db.property.deleteMany({ where: { name: 'Correction Test' } })
    await db.$disconnect()
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run tests/api/financialRecordsUpdate.test.ts`
Expected: FAIL with "Cannot find module '../../app/api/financial-records/[id]/route'"

- [ ] **Step 11: Write `app/api/financial-records/[id]/route.ts`**

```typescript
import { db } from '../../../../lib/db'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json()
  const updated = await db.financialRecord.update({
    where: { id: params.id },
    data: { amount: body.amount, source: 'manual' },
  })
  return Response.json(updated)
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run tests/api/financialRecordsUpdate.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add app/api tests/api
git commit -m "Add sync, loan upload, and manual correction API routes"
```

---

### Task 15: Dashboard UI

**Files:**
- Create: `app/dashboard/page.tsx`
- Create: `app/dashboard/DashboardView.tsx`
- Create: `app/api/dashboard/route.ts`
- Test: `tests/components/DashboardView.test.tsx`

**Interfaces:**
- Consumes: `getPropertyMonthlyDashboard`, `getPropertyYtdDashboard`, `getPortfolioDashboard` (Task 13); `listProperties` (Task 2)
- Produces: `DashboardView` React component accepting `{ properties: { id: string; name: string }[]; selectedPropertyId: string | 'portfolio'; month: string; monthly: MonthlyFinancials & { flags: AnomalyFlag[] }; ytd: MonthlyFinancials }` and rendering a metrics table + flags list

- [ ] **Step 1: Write `app/api/dashboard/route.ts`** (data endpoint the client component fetches from)

```typescript
import { getPropertyMonthlyDashboard, getPropertyYtdDashboard, getPortfolioDashboard } from '../../../lib/dashboardData'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const propertyId = url.searchParams.get('propertyId') ?? 'portfolio'
  const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)
  const year = parseInt(month.split('-')[0], 10)
  const monthNum = parseInt(month.split('-')[1], 10)

  if (propertyId === 'portfolio') {
    const monthly = await getPortfolioDashboard(month)
    return Response.json({ monthly, ytd: null })
  }

  const [monthly, ytd] = await Promise.all([
    getPropertyMonthlyDashboard(propertyId, month),
    getPropertyYtdDashboard(propertyId, year, monthNum),
  ])
  return Response.json({ monthly, ytd })
}
```

- [ ] **Step 2: Write failing test for `DashboardView`**

```typescript
// tests/components/DashboardView.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardView } from '../../app/dashboard/DashboardView'

describe('DashboardView', () => {
  it('renders NOI, cash flow figures, and open anomaly flags', () => {
    render(
      <DashboardView
        properties={[{ id: 'p1', name: 'Ide building' }]}
        selectedPropertyId="p1"
        month="2026-01"
        monthly={{
          income: 859500,
          operatingExpenses: 51299,
          noi: 808201,
          debtService: 500000,
          interestExpense: 39000,
          principalPaydown: 461000,
          amortizedTax: 18991.67,
          amortizedInsurance: 3836.67,
          preTaxCashFlow: 285372.66,
          taxableIncome: 746372.66,
          incomeTaxOwed: 320940.24,
          afterTaxCashFlow: -35567.58,
          flags: [{ id: 'f1', propertyId: 'p1', month: '2026-01', ruleType: 'negative_cash_flow', description: 'Net cash flow is negative', status: 'open', createdAt: new Date() }],
        }}
        ytd={{
          income: 859500,
          operatingExpenses: 51299,
          noi: 808201,
          debtService: 500000,
          interestExpense: 39000,
          principalPaydown: 461000,
          amortizedTax: 18991.67,
          amortizedInsurance: 3836.67,
          preTaxCashFlow: 285372.66,
          taxableIncome: 746372.66,
          incomeTaxOwed: 320940.24,
          afterTaxCashFlow: -35567.58,
        }}
      />
    )

    expect(screen.getByText(/808,201/)).toBeInTheDocument()
    expect(screen.getByText(/Net cash flow is negative/)).toBeInTheDocument()
    expect(screen.getByText(/-35,568/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/DashboardView.test.tsx`
Expected: FAIL with "Cannot find module '../../app/dashboard/DashboardView'"

- [ ] **Step 4: Write `app/dashboard/DashboardView.tsx`**

```tsx
'use client'

import type { MonthlyFinancials } from '../../lib/financialCalculations'
import type { AnomalyFlag } from '@prisma/client'

function formatYen(amount: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(amount))
}

function MetricsTable({ title, financials }: { title: string; financials: MonthlyFinancials }) {
  const rows: [string, number][] = [
    ['Income', financials.income],
    ['Operating Expenses', financials.operatingExpenses],
    ['NOI', financials.noi],
    ['Interest Expense', financials.interestExpense],
    ['Principal Paydown', financials.principalPaydown],
    ['Debt Service', financials.debtService],
    ['Amortized Tax', financials.amortizedTax],
    ['Amortized Insurance', financials.amortizedInsurance],
    ['Pre-Tax Cash Flow', financials.preTaxCashFlow],
    ['Taxable Income', financials.taxableIncome],
    ['Income Tax Owed', financials.incomeTaxOwed],
    ['After-Tax Cash Flow', financials.afterTaxCashFlow],
  ]

  return (
    <table>
      <caption>{title}</caption>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{formatYen(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DashboardView(props: {
  properties: { id: string; name: string }[]
  selectedPropertyId: string
  month: string
  monthly: MonthlyFinancials & { flags: AnomalyFlag[] }
  ytd: MonthlyFinancials | null
}) {
  return (
    <div>
      <h1>{props.month}</h1>
      <MetricsTable title="Monthly" financials={props.monthly} />
      {props.ytd && <MetricsTable title="Year to Date" financials={props.ytd} />}
      <h2>Flags</h2>
      <ul>
        {props.monthly.flags.map((flag) => (
          <li key={flag.id}>{flag.description}</li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/DashboardView.test.tsx`
Expected: PASS

- [ ] **Step 6: Write `app/dashboard/page.tsx`** (server component that fetches initial data and renders `DashboardView`)

```tsx
import { listProperties } from '../../lib/properties'
import { getPropertyMonthlyDashboard, getPropertyYtdDashboard } from '../../lib/dashboardData'
import { DashboardView } from './DashboardView'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { propertyId?: string; month?: string }
}) {
  const properties = await listProperties()
  const month = searchParams.month ?? new Date().toISOString().slice(0, 7)
  const propertyId = searchParams.propertyId ?? properties[0]?.id

  if (!propertyId) {
    return <p>No properties found. Add a property to get started.</p>
  }

  const year = parseInt(month.split('-')[0], 10)
  const monthNum = parseInt(month.split('-')[1], 10)

  const [monthly, ytd] = await Promise.all([
    getPropertyMonthlyDashboard(propertyId, month),
    getPropertyYtdDashboard(propertyId, year, monthNum),
  ])

  return (
    <DashboardView
      properties={properties.map((p) => ({ id: p.id, name: p.name }))}
      selectedPropertyId={propertyId}
      month={month}
      monthly={monthly}
      ytd={ytd}
    />
  )
}
```

- [ ] **Step 7: Run the full test suite to confirm nothing regressed**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add app/dashboard app/api/dashboard tests/components
git commit -m "Add dashboard UI with monthly/YTD metrics and anomaly flags"
```

---

## Self-Review Notes

**Spec coverage:**
- Dropbox API auto-ingestion → Tasks 5, 6, 14 (sync route)
- Claude PDF extraction (statements + loans) → Tasks 7, 8, 9, 10
- Loan data via PDF upload → Tasks 4, 10, 14
- Manual tax/insurance entry, amortized monthly → Tasks 2, 3
- Monthly/YTD/portfolio dashboards with pre/after-tax cash flow → Tasks 11, 13, 15
- Anomaly detection (deviation, missing statement, negative cash flow) → Task 12
- Manual correction takes precedence over re-extraction → Task 9 (tested explicitly)
- Extraction failures never silently drop a file → Task 9 (tested explicitly)
- Source traceability (record → source PDF) → `FinancialRecord.extractionId` → `Extraction.dropboxFileId` → `DropboxFile.storageUrl`, present in schema from Task 1; a dedicated "click to view source PDF" UI affordance is a small follow-up not included as its own task since the data path is fully wired.

**Not included in this plan (explicitly out of scope per spec, or follow-up UI polish):**
- Multi-user auth, notifications, automatic tax bill ingestion — out of scope per spec.
- Extraction failure review queue UI (`app/review-queue/page.tsx` mentioned in File Structure) — the underlying data (`Extraction.status = 'failed'`) is fully modeled and testable from Task 9 onward; the queue page itself is a straightforward read of failed `Extraction` rows using patterns already established in Task 15 and can be added as a fast follow using the same `DashboardView`-style approach once the core pipeline is verified end-to-end with real Dropbox data.
- Property/loan/annual-cost creation forms (v1 can seed via a script or direct DB calls using the CRUD functions from Tasks 2-4; a settings/admin UI is straightforward CRUD following the Task 15 component pattern and can follow once the core pipeline is proven).

**Type consistency check:** `MonthlyFinancials` fields (`income`, `operatingExpenses`, `noi`, `debtService`, `interestExpense`, `principalPaydown`, `amortizedTax`, `amortizedInsurance`, `preTaxCashFlow`, `taxableIncome`, `incomeTaxOwed`, `afterTaxCashFlow`) are defined once in Task 11 and reused verbatim in Tasks 13 and 15 — confirmed consistent.

