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
