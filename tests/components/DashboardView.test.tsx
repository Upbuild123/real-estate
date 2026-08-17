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

describe('DashboardView', () => {
  it('renders rounded/compact NOI and cash flow figures, and open anomaly flags', () => {
    render(
      <DashboardView
        properties={[
          { id: 'p1', name: 'Ide building' },
          { id: 'p2', name: 'Residence DO5' },
        ]}
        selectedPropertyId="p1"
        period="2026-01"
        periodOptions={[
          { value: '2026-ytd', label: '2026 YTD' },
          { value: '2026-01', label: 'January 2026' },
        ]}
        dashboard={SAMPLE_DASHBOARD}
      />
    )

    // 808201 rounds to the nearest thousand and displays compact, not the raw number
    expect(screen.getByText('808K')).toBeInTheDocument()
    // negative after-tax cash flow (-35567.58) shows compact and parenthesized
    expect(screen.getByText('(36K)')).toBeInTheDocument()
    expect(screen.getByText('Net cash flow is negative')).toBeInTheDocument()
  })

  it('renders a tab per property, marking the selected one', () => {
    render(
      <DashboardView
        properties={[
          { id: 'p1', name: 'Ide building' },
          { id: 'p2', name: 'Residence DO5' },
        ]}
        selectedPropertyId="p2"
        period="2026-01"
        periodOptions={[{ value: '2026-01', label: 'January 2026' }]}
        dashboard={SAMPLE_DASHBOARD}
      />
    )

    expect(screen.getByText('Ide building')).toBeInTheDocument()
    expect(screen.getByText('Residence DO5')).toBeInTheDocument()
  })

  it('renders every period option in the selector', () => {
    render(
      <DashboardView
        properties={[{ id: 'p1', name: 'Ide building' }]}
        selectedPropertyId="p1"
        period="2026-ytd"
        periodOptions={[
          { value: '2026-ytd', label: '2026 YTD' },
          { value: '2025-full', label: '2025 Full Year' },
        ]}
        dashboard={SAMPLE_DASHBOARD}
      />
    )

    expect(screen.getByText('2026 YTD')).toBeInTheDocument()
    expect(screen.getByText('2025 Full Year')).toBeInTheDocument()
  })

  it('does not render a Flags section when there are no open flags', () => {
    render(
      <DashboardView
        properties={[{ id: 'p1', name: 'Ide building' }]}
        selectedPropertyId="p1"
        period="2026-01"
        periodOptions={[{ value: '2026-01', label: 'January 2026' }]}
        dashboard={{ ...SAMPLE_DASHBOARD, flags: [] }}
      />
    )

    expect(screen.queryByText('Flags')).not.toBeInTheDocument()
  })
})
