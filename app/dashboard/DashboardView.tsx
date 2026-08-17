'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MonthlyFinancials } from '../../lib/financialCalculations'
import type { PeriodOption } from '../../lib/periods'
import type { AnomalyFlag } from '@prisma/client'
import { formatYenCompact } from '../../lib/formatYen'
import styles from './dashboard.module.css'

const METRIC_ROWS: { label: string; key: keyof MonthlyFinancials; total?: boolean }[] = [
  { label: 'Income', key: 'income' },
  { label: 'Operating Expenses', key: 'operatingExpenses' },
  { label: 'NOI', key: 'noi', total: true },
  { label: 'Interest Expense', key: 'interestExpense' },
  { label: 'Principal Paydown', key: 'principalPaydown' },
  { label: 'Debt Service', key: 'debtService' },
  { label: 'Amortized Tax', key: 'amortizedTax' },
  { label: 'Amortized Insurance', key: 'amortizedInsurance' },
  { label: 'Pre-Tax Cash Flow', key: 'preTaxCashFlow', total: true },
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

export function DashboardView(props: {
  properties: { id: string; name: string }[]
  selectedPropertyId: string
  period: string
  periodOptions: PeriodOption[]
  dashboard: MonthlyFinancials & { flags: AnomalyFlag[] }
}) {
  const router = useRouter()

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/dashboard?propertyId=${props.selectedPropertyId}&period=${e.target.value}`)
  }

  return (
    <div className={styles.page}>
      <nav className={styles.tabs}>
        {props.properties.map((property) => (
          <Link
            key={property.id}
            href={`/dashboard?propertyId=${property.id}&period=${props.period}`}
            className={property.id === props.selectedPropertyId ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {property.name}
          </Link>
        ))}
      </nav>

      <div className={styles.periodRow}>
        <select className={styles.periodSelect} value={props.period} onChange={handlePeriodChange}>
          {props.periodOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Yen</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => {
            const { text, negative } = formatCell(props.dashboard[row.key])
            return (
              <tr key={row.key} className={row.total ? styles.totalRow : undefined}>
                <td>{row.label}</td>
                <td className={negative ? styles.negative : undefined}>{text}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

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
    </div>
  )
}
