// @vitest-environment jsdom
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

    expect(screen.getAllByText(/808,201/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Net cash flow is negative/)).toBeInTheDocument()
    expect(screen.getAllByText(/-35,568/).length).toBeGreaterThan(0)
  })
})
