'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MonthlyFinancials } from '../../lib/financialCalculations'
import type { PeriodOption } from '../../lib/periods'
import type { RoomBreakdownEntry, ExpenseBreakdownEntry } from '../../lib/lineItemBreakdown'
import type { YearlyComparisonColumn } from '../../lib/dashboardData'
import type { UpcomingLeaseExpiration, PortfolioUpcomingLeaseExpiration } from '../../lib/leaseTracking'
import type { AnomalyFlag } from '@prisma/client'
import { formatYenCompact } from '../../lib/formatYen'
import { translateNote } from '../../lib/translateNote'
import styles from './dashboard.module.css'

export type DashboardViewMode = 'operations' | 'financials' | 'compare'

// Operations: what you'd check monthly to catch anything the PM should explain — no
// depreciation/tax/interest/loan noise. Financials: the full picture, for tax/loan review.
// Compare reuses the Operations rows since it's also a trend/discrepancy view, not a tax view.
const OPERATIONS_METRIC_ROWS: { label: string; key: keyof MonthlyFinancials; total?: boolean }[] = [
  { label: 'Income', key: 'income' },
  { label: 'Operating Expenses', key: 'operatingExpenses' },
  { label: 'NOI', key: 'noi', total: true },
]

const FINANCIALS_METRIC_ROWS: { label: string; key: keyof MonthlyFinancials; total?: boolean }[] = [
  { label: 'Income', key: 'income' },
  { label: 'Operating Expenses', key: 'operatingExpenses' },
  { label: 'NOI', key: 'noi', total: true },
  { label: 'Interest Expense', key: 'interestExpense' },
  { label: 'Principal Paydown', key: 'principalPaydown' },
  { label: 'Debt Service', key: 'debtService' },
  { label: 'Amortized Tax', key: 'amortizedTax' },
  { label: 'Amortized Insurance', key: 'amortizedInsurance' },
  { label: 'Pre-Tax Cash Flow', key: 'preTaxCashFlow', total: true },
  { label: 'Amortized Depreciation (non-cash)', key: 'amortizedDepreciation' },
  { label: 'Taxable Income', key: 'taxableIncome' },
  { label: 'Income Tax Owed', key: 'incomeTaxOwed' },
  { label: 'After-Tax Cash Flow', key: 'afterTaxCashFlow', total: true },
]

function formatCell(value: number): { text: string; negative: boolean } {
  if (value < 0) {
    return { text: `(${formatYenCompact(Math.abs(value))})`, negative: true }
  }
  return { text: formatYenCompact(value), negative: false }
}

function MetricsTable({ rows, dashboard }: { rows: typeof FINANCIALS_METRIC_ROWS; dashboard: MonthlyFinancials }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Yen</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { text, negative } = formatCell(dashboard[row.key])
          return (
            <tr key={row.key} className={row.total ? styles.totalRow : undefined}>
              <td>{row.label}</td>
              <td className={negative ? styles.negative : undefined}>{text}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const STATUS_LABELS: Record<NonNullable<RoomBreakdownEntry['status']>, string> = {
  normal: 'Normal',
  vacant: 'Vacant',
  arrears: 'Arrears',
  additional: 'Additional collected',
}

function RoomBreakdownTable({ entries }: { entries: RoomBreakdownEntry[] }) {
  if (entries.length === 0) return null

  return (
    <>
      <h2 className={styles.sectionTitle}>By Room</h2>
      <p className={styles.sectionHint}>
        Only line items linked to a specific unit are shown here; building-wide costs (PM fee, utilities, cleaning)
        appear in Expenses by Category below.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Room</th>
            <th>Item</th>
            <th>Yen</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const { text, negative } = formatCell(entry.category === 'expense' ? -entry.amount : entry.amount)
            // Explain the unusual cases: extra rent collected (why more than expected came in),
            // any room-linked expense (these are never routine — a normal recurring cost like
            // PM fee/utilities is building-wide, not per-room), and the "Rental Cycle"
            // pseudo-room (it has no rent-roll snapshot to compute a status against, so the
            // note is the only way to tell what it actually is).
            const showExplanation =
              entry.notes.length > 0 &&
              (entry.category === 'expense' || entry.status === 'additional' || entry.room === 'Rental Cycle')
            return (
              <Fragment key={`${entry.room}-${entry.accountItem}-${entry.category}`}>
                <tr>
                  <td>{entry.room}</td>
                  <td className={styles.itemLabel}>{entry.accountItem}</td>
                  <td className={negative ? styles.negative : undefined}>{text}</td>
                  <td className={entry.status && entry.status !== 'normal' ? styles.statusFlag : undefined}>
                    {entry.status ? STATUS_LABELS[entry.status] : ''}
                  </td>
                </tr>
                {showExplanation && (
                  <tr>
                    <td colSpan={4} className={styles.explanationRow}>
                      {entry.notes.map(translateNote).join(' · ')}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function ExpenseBreakdownTable({ entries }: { entries: ExpenseBreakdownEntry[] }) {
  if (entries.length === 0) return null

  return (
    <>
      <h2 className={styles.sectionTitle}>Expenses by Category</h2>
      <p className={styles.sectionHint}>
        ⚠ marks anything out of the ordinary — normal recurring costs (rent, PM fee, elevator, cleaning, utilities)
        aren&apos;t flagged.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Category</th>
            <th>Yen</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Fragment key={entry.accountItem}>
              <tr className={entry.recurring ? undefined : styles.flaggedRow}>
                <td>{entry.accountItem}</td>
                <td>{formatYenCompact(entry.amount)}</td>
              </tr>
              {!entry.recurring && entry.notes.length > 0 && (
                <tr>
                  <td colSpan={2} className={styles.explanationRow}>
                    {entry.notes.map(translateNote).join(' · ')}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  )
}

function ComparisonTable({ columns }: { columns: YearlyComparisonColumn[] }) {
  if (columns.length === 0) return null

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Metric</th>
          {columns.map((column) => (
            <th key={column.year}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {OPERATIONS_METRIC_ROWS.map((row) => (
          <tr key={row.key} className={row.total ? styles.totalRow : undefined}>
            <td>{row.label}</td>
            {columns.map((column) => {
              const { text, negative } = formatCell(column.financials[row.key])
              return (
                <td key={column.year} className={negative ? styles.negative : undefined}>
                  {text}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PortfolioLeaseBanner({ entries }: { entries: PortfolioUpcomingLeaseExpiration[] }) {
  if (entries.length === 0) return null

  return (
    <div className={styles.portfolioLeaseBanner}>
      <strong>Upcoming lease expirations (next 90 days):</strong>{' '}
      {entries.map((entry, i) => (
        <span key={`${entry.propertyId}-${entry.roomNumber}`}>
          {entry.propertyName} #{entry.roomNumber} ({entry.lessee}) — {entry.leaseEnd}
          {i < entries.length - 1 ? '; ' : ''}
        </span>
      ))}
    </div>
  )
}

function LeaseExpirationsTable({ entries }: { entries: UpcomingLeaseExpiration[] }) {
  if (entries.length === 0) return null

  return (
    <>
      <h2 className={styles.sectionTitle}>Upcoming Lease Expirations</h2>
      <p className={styles.sectionHint}>Leases ending within the next 90 days, based on the latest rent roll.</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Room</th>
            <th>Tenant</th>
            <th>Lease End</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.roomNumber}>
              <td>{entry.roomNumber}</td>
              <td>{entry.lessee}</td>
              <td>{entry.leaseEnd}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function FlagsSection({ flags, onResolved }: { flags: AnomalyFlag[]; onResolved: () => void }) {
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  if (flags.length === 0) return null

  async function resolve(id: string) {
    setResolvingId(id)
    try {
      await fetch(`/api/anomaly-flags/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      })
      onResolved()
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <div className={styles.flagsSection}>
      <h2>Flags</h2>
      <ul className={styles.flagsList}>
        {flags.map((flag) => (
          <li key={flag.id} className={styles.flagItem}>
            <div className={styles.flagRow}>
              <ul className={styles.flagDetailList}>
                {flag.description.split('; ').map((part, i) => (
                  <li key={i}>{translateNote(part)}</li>
                ))}
              </ul>
              <button
                type="button"
                className={styles.resolveButton}
                disabled={resolvingId === flag.id}
                onClick={() => resolve(flag.id)}
              >
                {resolvingId === flag.id ? 'Resolving…' : 'Resolve'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const COMBINED_PROPERTY_ID = 'combined'

function LoanBalanceSection({ loanBalance }: { loanBalance: { startingBalance: number; endingBalance: number } | null }) {
  if (!loanBalance) return null

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Loan Balance</th>
          <th>Yen</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Starting Balance</td>
          <td>{formatYenCompact(loanBalance.startingBalance)}</td>
        </tr>
        <tr>
          <td>Ending Balance</td>
          <td>{formatYenCompact(loanBalance.endingBalance)}</td>
        </tr>
      </tbody>
    </table>
  )
}

export function DashboardView(props: {
  properties: { id: string; name: string }[]
  selectedPropertyId: string
  period: string
  periodOptions: PeriodOption[]
  view: DashboardViewMode
  dashboard: MonthlyFinancials & { flags: AnomalyFlag[] }
  roomBreakdown: RoomBreakdownEntry[]
  expenseBreakdown: ExpenseBreakdownEntry[]
  comparison: YearlyComparisonColumn[]
  upcomingLeaseExpirations: UpcomingLeaseExpiration[]
  portfolioLeaseExpirations: PortfolioUpcomingLeaseExpiration[]
  loanBalance: { startingBalance: number; endingBalance: number } | null
}) {
  const router = useRouter()

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/dashboard?propertyId=${props.selectedPropertyId}&period=${e.target.value}&view=${props.view}`)
  }

  const isCombined = props.selectedPropertyId === COMBINED_PROPERTY_ID
  const isOperations = props.view === 'operations'
  const isCompare = props.view === 'compare'

  return (
    <div className={styles.page}>
      <PortfolioLeaseBanner entries={props.portfolioLeaseExpirations} />

      <nav className={styles.tabs}>
        {props.properties.map((property) => (
          <Link
            key={property.id}
            href={
              property.id === COMBINED_PROPERTY_ID
                ? `/dashboard?propertyId=${property.id}&period=${props.period}&view=financials`
                : `/dashboard?propertyId=${property.id}&period=${props.period}&view=${props.view}`
            }
            className={property.id === props.selectedPropertyId ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {property.name}
          </Link>
        ))}
      </nav>

      {/* Combined only ever shows Financials — per-room breakdown, flags, and anomaly
          detection are all inherently single-property concepts, so there's nothing for
          Operations/Compare to show. */}
      {!isCombined && (
        <nav className={styles.tabs}>
          <Link
            href={`/dashboard?propertyId=${props.selectedPropertyId}&period=${props.period}&view=operations`}
            className={isOperations ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            Operations
          </Link>
          <Link
            href={`/dashboard?propertyId=${props.selectedPropertyId}&period=${props.period}&view=financials`}
            className={!isOperations && !isCompare ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            Financials
          </Link>
          <Link
            href={`/dashboard?propertyId=${props.selectedPropertyId}&period=${props.period}&view=compare`}
            className={isCompare ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            Compare
          </Link>
        </nav>
      )}

      {!isCompare && (
        <div className={styles.periodRow}>
          <select className={styles.periodSelect} value={props.period} onChange={handlePeriodChange}>
            {props.periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {isCompare ? (
        <ComparisonTable columns={props.comparison} />
      ) : (
        <>
          <MetricsTable rows={isOperations ? OPERATIONS_METRIC_ROWS : FINANCIALS_METRIC_ROWS} dashboard={props.dashboard} />

          {!isOperations && <LoanBalanceSection loanBalance={props.loanBalance} />}

          {isOperations && (
            <>
              <FlagsSection flags={props.dashboard.flags} onResolved={() => router.refresh()} />

              <LeaseExpirationsTable entries={props.upcomingLeaseExpirations} />

              <RoomBreakdownTable entries={props.roomBreakdown} />
              <ExpenseBreakdownTable entries={props.expenseBreakdown} />
            </>
          )}
        </>
      )}
    </div>
  )
}
