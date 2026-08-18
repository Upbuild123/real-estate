// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import { DashboardView } from '../../app/dashboard/DashboardView'

const SAMPLE_DASHBOARD = {
  income: 859500,
  operatingExpenses: 51299,
  noi: 808201,
  debtService: 500000,
  interestExpense: 39000,
  principalPaydown: 461000,
  amortizedTax: 18991.67,
  amortizedInsurance: 3836.67,
  amortizedDepreciation: 139166.67,
  preTaxCashFlow: 285372.66,
  taxableIncome: 746372.66,
  incomeTaxOwed: 320940.24,
  afterTaxCashFlow: -35567.58,
  flags: [
    {
      id: 'f1',
      propertyId: 'p1',
      month: '2026-01',
      ruleType: 'negative_cash_flow',
      description: 'Net cash flow is negative',
      status: 'open',
      createdAt: new Date(),
    },
  ],
}

const DEFAULT_PROPS = {
  properties: [
    { id: 'p1', name: 'Ide building' },
    { id: 'p2', name: 'Residence DO5' },
  ],
  selectedPropertyId: 'p1',
  period: '2026-01',
  periodOptions: [
    { value: '2026-ytd', label: '2026 YTD' },
    { value: '2026-01', label: 'January 2026' },
  ],
  dashboard: SAMPLE_DASHBOARD,
  roomBreakdown: [],
  expenseBreakdown: [],
}

describe('DashboardView', () => {
  it('renders rounded/compact NOI and cash flow figures, and open anomaly flags', () => {
    render(<DashboardView {...DEFAULT_PROPS} />)

    // 808201 rounds to the nearest thousand and displays compact, not the raw number
    expect(screen.getByText('808K')).toBeInTheDocument()
    // negative after-tax cash flow (-35567.58) shows compact and parenthesized
    expect(screen.getByText('(36K)')).toBeInTheDocument()
    expect(screen.getByText('Net cash flow is negative')).toBeInTheDocument()
  })

  it('renders a tab per property, marking the selected one', () => {
    render(<DashboardView {...DEFAULT_PROPS} selectedPropertyId="p2" />)

    expect(screen.getByText('Ide building')).toBeInTheDocument()
    expect(screen.getByText('Residence DO5')).toBeInTheDocument()
  })

  it('renders every period option in the selector', () => {
    render(<DashboardView {...DEFAULT_PROPS} />)

    expect(screen.getByText('2026 YTD')).toBeInTheDocument()
    expect(screen.getByText('January 2026')).toBeInTheDocument()
  })

  it('does not render a Flags section when there are no open flags', () => {
    render(<DashboardView {...DEFAULT_PROPS} dashboard={{ ...SAMPLE_DASHBOARD, flags: [] }} />)

    expect(screen.queryByText('Flags')).not.toBeInTheDocument()
  })

  it('groups room breakdown entries under a room header', () => {
    render(
      <DashboardView
        {...DEFAULT_PROPS}
        roomBreakdown={[
          { room: '101', accountItem: 'Rent', category: 'income', amount: 125000 },
          { room: '101', accountItem: 'Repair expense', category: 'expense', amount: 20000 },
        ]}
      />
    )

    expect(screen.getByText('Room 101')).toBeInTheDocument()
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Repair expense')).toBeInTheDocument()
    expect(screen.getByText('125K')).toBeInTheDocument()
  })

  it('does not render the By Room section when there is no room breakdown data', () => {
    render(<DashboardView {...DEFAULT_PROPS} roomBreakdown={[]} />)
    expect(screen.queryByText('By Room')).not.toBeInTheDocument()
  })

  it('renders the expense breakdown with normal categories unmarked', () => {
    render(
      <DashboardView
        {...DEFAULT_PROPS}
        expenseBreakdown={[{ accountItem: 'Property management fee', amount: 40000, recurring: true }]}
      />
    )

    expect(screen.getByText('Expenses by Category')).toBeInTheDocument()
    expect(screen.getByText('Property management fee')).toBeInTheDocument()
  })

  it('does not render the Expenses by Category section when there is no expense breakdown data', () => {
    render(<DashboardView {...DEFAULT_PROPS} expenseBreakdown={[]} />)
    expect(screen.queryByText('Expenses by Category')).not.toBeInTheDocument()
  })
})
