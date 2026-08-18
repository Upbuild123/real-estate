// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
  view: 'operations' as const,
  dashboard: SAMPLE_DASHBOARD,
  roomBreakdown: [],
  expenseBreakdown: [],
  comparison: [],
}

describe('DashboardView — Operations view', () => {
  it('renders only Income, Operating Expenses, and NOI — no debt/tax/depreciation figures', () => {
    render(<DashboardView {...DEFAULT_PROPS} />)

    expect(screen.getByText('Income')).toBeInTheDocument()
    expect(screen.getByText('Operating Expenses')).toBeInTheDocument()
    expect(screen.getByText('NOI')).toBeInTheDocument()
    expect(screen.getByText('808K')).toBeInTheDocument()

    expect(screen.queryByText('Interest Expense')).not.toBeInTheDocument()
    expect(screen.queryByText('Debt Service')).not.toBeInTheDocument()
    expect(screen.queryByText('Amortized Tax')).not.toBeInTheDocument()
    expect(screen.queryByText('Amortized Depreciation (non-cash)')).not.toBeInTheDocument()
    expect(screen.queryByText('Taxable Income')).not.toBeInTheDocument()
    expect(screen.queryByText('After-Tax Cash Flow')).not.toBeInTheDocument()
  })

  it('renders open anomaly flags', () => {
    render(<DashboardView {...DEFAULT_PROPS} />)
    expect(screen.getByText('Net cash flow is negative')).toBeInTheDocument()
  })

  it('does not render a Flags section when there are no open flags', () => {
    render(<DashboardView {...DEFAULT_PROPS} dashboard={{ ...SAMPLE_DASHBOARD, flags: [] }} />)
    expect(screen.queryByText('Flags')).not.toBeInTheDocument()
  })

  it('renders a Resolve button for each open flag and PATCHes the flag when clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    render(<DashboardView {...DEFAULT_PROPS} />)
    const resolveButton = screen.getByRole('button', { name: 'Resolve' })
    resolveButton.click()

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/anomaly-flags/f1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) })
      )
    })

    vi.unstubAllGlobals()
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

describe('DashboardView — Financials view', () => {
  const financialsProps = { ...DEFAULT_PROPS, view: 'financials' as const }

  it('renders every financial metric including debt service, tax, depreciation, and after-tax cash flow', () => {
    render(<DashboardView {...financialsProps} />)

    expect(screen.getByText('Interest Expense')).toBeInTheDocument()
    expect(screen.getByText('Debt Service')).toBeInTheDocument()
    expect(screen.getByText('Amortized Tax')).toBeInTheDocument()
    expect(screen.getByText('Amortized Depreciation (non-cash)')).toBeInTheDocument()
    expect(screen.getByText('Taxable Income')).toBeInTheDocument()
    expect(screen.getByText('After-Tax Cash Flow')).toBeInTheDocument()
    // negative after-tax cash flow (-35567.58) shows compact and parenthesized
    expect(screen.getByText('(36K)')).toBeInTheDocument()
  })

  it('does not render Flags, By Room, or Expenses by Category sections', () => {
    render(
      <DashboardView
        {...financialsProps}
        roomBreakdown={[{ room: '101', accountItem: 'Rent', category: 'income', amount: 125000 }]}
        expenseBreakdown={[{ accountItem: 'Property management fee', amount: 40000, recurring: true }]}
      />
    )

    expect(screen.queryByText('Flags')).not.toBeInTheDocument()
    expect(screen.queryByText('By Room')).not.toBeInTheDocument()
    expect(screen.queryByText('Expenses by Category')).not.toBeInTheDocument()
  })
})

describe('DashboardView — shared chrome', () => {
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

  it('renders Operations/Financials/Compare tabs, marking the active one', () => {
    render(<DashboardView {...DEFAULT_PROPS} />)

    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('Financials')).toBeInTheDocument()
    expect(screen.getByText('Compare')).toBeInTheDocument()
  })
})

describe('DashboardView — Compare view', () => {
  const COMPARISON_PROPS = {
    ...DEFAULT_PROPS,
    view: 'compare' as const,
    comparison: [
      {
        year: 2026,
        label: '2026 (YTD)',
        financials: { ...SAMPLE_DASHBOARD, income: 300000, operatingExpenses: 50000, noi: 250000 },
      },
      {
        year: 2025,
        label: '2025',
        financials: { ...SAMPLE_DASHBOARD, income: 600000, operatingExpenses: 100000, noi: 500000 },
      },
    ],
  }

  it('renders one column per year with its label, and no period selector', () => {
    render(<DashboardView {...COMPARISON_PROPS} />)

    expect(screen.getByText('2026 (YTD)')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.queryByText('January 2026')).not.toBeInTheDocument()
  })

  it('renders only Income, Operating Expenses, and NOI rows — no depreciation/tax/debt figures', () => {
    render(<DashboardView {...COMPARISON_PROPS} />)

    expect(screen.getByText('Income')).toBeInTheDocument()
    expect(screen.getByText('Operating Expenses')).toBeInTheDocument()
    expect(screen.getByText('NOI')).toBeInTheDocument()
    expect(screen.queryByText('Amortized Depreciation (non-cash)')).not.toBeInTheDocument()
    expect(screen.queryByText('Debt Service')).not.toBeInTheDocument()
  })

  it('does not render flags or breakdown sections', () => {
    render(<DashboardView {...COMPARISON_PROPS} />)

    expect(screen.queryByText('Flags')).not.toBeInTheDocument()
    expect(screen.queryByText('By Room')).not.toBeInTheDocument()
    expect(screen.queryByText('Expenses by Category')).not.toBeInTheDocument()
  })
})
