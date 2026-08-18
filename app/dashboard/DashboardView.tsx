'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MonthlyFinancials } from '../../lib/financialCalculations'
import type { PeriodOption } from '../../lib/periods'
import type { RoomBreakdownEntry, ExpenseBreakdownEntry } from '../../lib/lineItemBreakdown'
import type { YearlyComparisonColumn } from '../../lib/dashboardData'
import type { AnomalyFlag } from '@prisma/client'
import { formatYenCompact } from '../../lib/formatYen'
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

function RoomBreakdownTable({ entries }: { entries: RoomBreakdownEntry[] }) {
  if (entries.length === 0) return null

  const rooms = new Map<string, RoomBreakdownEntry[]>()
  for (const entry of entries) {
    const list = rooms.get(entry.room) ?? []
    list.push(entry)
    rooms.set(entry.room, list)
  }

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
            <th>Room / Item</th>
            <th>Yen</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(rooms.entries()).map(([room, items]) => (
            <Fragment key={room}>
              <tr className={styles.roomGroupLabel}>
                <td colSpan={2}>Room {room}</td>
              </tr>
              {items.map((item) => {
                const { text, negative } = formatCell(item.category === 'expense' ? -item.amount : item.amount)
                return (
                  <tr key={`${room}-${item.accountItem}-${item.category}`}>
                    <td className={styles.itemLabel}>{item.accountItem}</td>
                    <td className={negative ? styles.negative : undefined}>{text}</td>
                  </tr>
                )
              })}
            </Fragment>
          ))}
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
            <tr key={entry.accountItem} className={entry.recurring ? undefined : styles.flaggedRow}>
              <td>{entry.accountItem}</td>
              <td>{formatYenCompact(entry.amount)}</td>
            </tr>
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
}) {
  const router = useRouter()

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/dashboard?propertyId=${props.selectedPropertyId}&period=${e.target.value}&view=${props.view}`)
  }

  const isOperations = props.view === 'operations'
  const isCompare = props.view === 'compare'

  return (
    <div className={styles.page}>
      <nav className={styles.tabs}>
        {props.properties.map((property) => (
          <Link
            key={property.id}
            href={`/dashboard?propertyId=${property.id}&period=${props.period}&view=${props.view}`}
            className={property.id === props.selectedPropertyId ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {property.name}
          </Link>
        ))}
      </nav>

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

          {isOperations && (
            <>
              {props.dashboard.flags.length > 0 && (
                <div className={styles.flagsSection}>
                  <h2>Flags</h2>
                  <ul>
                    {props.dashboard.flags.map((flag) => (
                      <li key={flag.id}>{flag.description}</li>
                    ))}
                  </ul>
                </div>
              )}

              <RoomBreakdownTable entries={props.roomBreakdown} />
              <ExpenseBreakdownTable entries={props.expenseBreakdown} />
            </>
          )}
        </>
      )}
    </div>
  )
}
