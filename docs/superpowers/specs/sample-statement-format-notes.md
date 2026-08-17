# Axios Management Statement Format — Reference Notes

Based on Ide building (Jan-2026 through Jun-2026 activity) and Residence
DO5 (Jan-2026 through Jun-2026 activity) monthly statements.

## Document structure

- Bilingual (Japanese/English), issued by Axios Management Inc.
- 2 pages for Ide (single rent-roll table fits one page), 4 pages for
  Residence DO5 (larger unit count spills the rent roll onto page 1, a
  blank "new tenant" template appears as page 2 and should be skipped,
  detail ledger spans pages 3-4).
- Page 1: header (Month, Remittance Date, Property Name, Address, Bank,
  Amount) + Income/Expense category summary + per-unit rent roll table.
- Last page(s): itemized transaction ledger (Type, Account Item,
  Settlement Date, Amount, Tax, Total, Note).

## Key fields

- **Month**: the activity month the statement covers (e.g. "Jan-2026").
  This is the authoritative period for the statement — NOT the filename
  or remittance date.
- **Remittance Date**: ~15th of the month following the activity month
  (the date Michael actually receives the money).
- **Filename convention**: `{internal_id}_{report YYYY-MM}_report.pdf`
  where the report YYYY-MM in the filename matches the remittance
  month, i.e. one month after the internal "Month" field.
- **Amount** (header): net remittance to owner = Income Total − Expense
  Total.

## Rent roll (page 1)

Per unit: Type (Residence/Parking), Room #, Lessee name, Monthly Charge
(Rent + Common Fee, Others, Total), Rent Collected, Others Collected,
Total Remittance, Current Month in Arrears, Total Amount in Arrears,
Deposit Balance, Lease Start, Lease End.

- Vacant units show "-" or "Vacant" as lessee — treat as $0 income and a
  vacancy flag candidate.
- Arrears columns are the primary anomaly-detection signal for
  delinquent tenants.
- Deposit Balance and Lease dates are useful for lease-expiration
  tracking (not in v1 scope, could be a later feature).
- Residence DO5 additionally has a `Parking` type alongside `Residence`
  — same columns, separate line items.

## Transaction ledger (detail pages)

Each row: Type (Rent / Parking / Other Income / Expenses), Account Item
(e.g. "Property management fee", "Electricity charge", "Renewal fee"),
Settlement Date, Amount, Tax, Total, Note (often includes unit # and
tenant name in Japanese/English mixed text).

### Recurring categories (expect every month)
- Income: Rent (per unit), Parking (per unit, DO5 only)
- Expenses: Property management fee (PM Fee), Electricity charge,
  Regular/Building cleaning fee, Elevator maintenance fee (DO5 only)

### One-time / irregular categories (do NOT treat as anomalies by default)
- Income: Renewal fee income, Deposit, Restoration cost received,
  Cancellation penalty income, Miscellaneous income (e.g. "rental
  bike"/"rental cycle"), Antenna joint-use fee
- Expenses: Renewal fee (admin), Restoration/Building maintenance fee
  (repairs, replacements), Repair expense, Water charge (appears some
  months, not others), Brokerage/Agent fee, Co-agent fee, New contract
  fee, Deposit refund

### Tax handling
Every line has Amount (pre-tax), Tax (consumption tax, ~10%), and Total
(Amount + Tax). Some lines show Tax = 0 (e.g. base rent in most cases;
a few tenants show tax on rent — inconsistent, extract as given rather
than assuming a rule).

## Schema implications for `pdf-extraction` (statement type)

```
StatementExtraction {
  propertyName: string          // "Ide building" | "ResidenceDO5"
  activityMonth: string         // from "Month" field, e.g. "2026-01"
  remittanceDate: date
  netRemittanceAmount: number
  rentRoll: [{
    unitType: "Residence" | "Parking"
    roomNumber: string
    lessee: string | "vacant"
    monthlyCharge: number
    rentCollected: number
    arrearsCurrentMonth: number
    arrearsTotal: number
    depositBalance: number
    leaseStart: date | null
    leaseEnd: date | null
  }]
  lineItems: [{
    category: "income" | "expense"
    accountItem: string         // e.g. "Property management fee"
    recurring: boolean          // derived via category lookup table
    settlementDate: date
    amount: number
    tax: number
    total: number
    note: string
  }]
}
```

`recurring` is derived at extraction/normalization time from a lookup
table (see lists above), not asked of the model — keeps anomaly
detection deterministic and independent of the LLM's judgment call.
