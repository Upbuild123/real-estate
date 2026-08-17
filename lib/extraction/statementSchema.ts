export interface RentRollEntry {
  unitType: 'Residence' | 'Parking'
  roomNumber: string
  lessee: string
  monthlyCharge: number
  rentCollected: number
  arrearsCurrentMonth: number
  arrearsTotal: number
  depositBalance: number
  leaseStart: string | null
  leaseEnd: string | null
}

export interface StatementLineItem {
  category: 'income' | 'expense'
  accountItem: string
  settlementDate: string
  amount: number
  tax: number
  total: number
  note: string
}

export interface StatementExtraction {
  propertyName: string
  activityMonth: string // "YYYY-MM"
  remittanceDate: string
  netRemittanceAmount: number
  rentRoll: RentRollEntry[]
  lineItems: StatementLineItem[]
}

const RECURRING_ACCOUNT_ITEMS = [
  'rent',
  'parking',
  'property management fee',
  'pm fee',
  'electricity charge',
  'water charge',
  'regular cleaning',
  'building management fee',
  'elevator maintenance fee',
]

export function isRecurringAccountItem(accountItem: string): boolean {
  const normalized = accountItem.trim().toLowerCase()
  return RECURRING_ACCOUNT_ITEMS.some((known) => normalized === known)
}

export const STATEMENT_SCHEMA_DESCRIPTION = `
{
  "propertyName": string,
  "activityMonth": string (YYYY-MM, read from the statement's internal "Month" field, NOT the filename or remittance date),
  "remittanceDate": string (YYYY-MM-DD),
  "netRemittanceAmount": number,
  "rentRoll": [{
    "unitType": "Residence" | "Parking",
    "roomNumber": string,
    "lessee": string (use "vacant" if the unit is unoccupied),
    "monthlyCharge": number,
    "rentCollected": number,
    "arrearsCurrentMonth": number,
    "arrearsTotal": number,
    "depositBalance": number,
    "leaseStart": string | null (YYYY-MM-DD),
    "leaseEnd": string | null (YYYY-MM-DD)
  }],
  "lineItems": [{
    "category": "income" | "expense",
    "accountItem": string (e.g. "Rent", "Property management fee", "Electricity charge"),
    "settlementDate": string (YYYY-MM-DD),
    "amount": number (pre-tax),
    "tax": number,
    "total": number (amount + tax),
    "note": string
  }]
}
`
