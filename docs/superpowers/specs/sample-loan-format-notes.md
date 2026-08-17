# Kiraboshi Bank Loan Repayment Schedule — Reference Notes

Based on two loan repayment schedules (証書貸付ご返済予定表 — "certificate
loan repayment schedule") from 株式会社きらぼし銀行 (Kiraboshi Bank),
Shibuya Central Branch, for Michael's two properties. Both are variable
interest rate (変動金利型) loans.

## Known loans

| Property | Original amount | Origination | Maturity | Current rate | Rate change | New rate | Monthly principal |
|---|---|---|---|---|---|---|---|
| Residence DO5 | ¥221,800,000 | 2025-07-31 | 2045-07-31 | 1.825% | 2026-09-01 | 2.075% | ¥925,000 |
| Ide building | ¥110,500,000 | 2025-07-31 | 2045-07-31 | 1.825% | 2026-09-01 | 2.075% | ¥461,000 |

Both loans jumped +0.25% effective 2026-09-01, which is why this
particular schedule was reissued (作成日 = issue date 2026-07-06, i.e.
prior to the rate change taking effect). The bank reissues a new printed
schedule each time the base rate changes — so future rate changes will
arrive as new loan-document PDFs, not as data Michael re-enters by hand.

## Document structure

- Header: bank name, branch, borrower name/address, issue date (作成日),
  loan reference numbers.
- Terms box: origination date (ご融資日), repayment deadline/maturity
  (ご返済期限), loan amount (ご融資額), repayment day-of-month (返済日,
  here the 31st / month-end), disbursement account, current interest
  rate (現在の利率), rate change date (利率変更日), and the rate that
  takes effect on that date (変更後の利率).
- Table: one row per scheduled payment — date (ご返済予定日), total
  payment amount (ご返済金額), principal (元金), interest (利息),
  remaining balance after payment (ご返済後残高). Only ~11-12 rows are
  printed per document (roughly a year out); a new schedule is issued
  whenever the rate changes, which naturally keeps the printed schedule
  current.
- Principal is a fixed amount per payment (flat amortization on
  principal, not a level total-payment fixed schedule); interest is
  computed on the current balance at the current rate, so interest
  (and therefore total payment) drifts down slightly each month within
  a schedule, and jumps when the rate changes at the next reissue.

## Schema implications for `pdf-extraction` (loan type)

```
LoanExtraction {
  propertyName: string          // inferred from context / manual mapping at upload time
  lender: string                 // "Kiraboshi Bank"
  originationDate: date
  maturityDate: date
  originalLoanAmount: number
  currentInterestRate: number    // as of document issue date
  rateChangeDate: date | null
  newInterestRate: number | null
  monthlyPrincipal: number       // fixed amount per scheduled payment
  paymentSchedule: [{
    date: date
    totalPayment: number
    principal: number
    interest: number
    remainingBalance: number
  }]
}
```

Since the bank reissues a full new schedule on every rate change, the
`loans` data model should treat each upload as a new snapshot (new
`DropboxFile`/`Extraction`) rather than a diff — current loan state
(balance, rate) is simply read from the most recent extraction's first
row, and historical extractions remain for the interest-expense history
already recorded to date.
