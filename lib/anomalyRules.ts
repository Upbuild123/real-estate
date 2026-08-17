import { db } from './db'
import type { AnomalyFlag } from '@prisma/client'

const DEVIATION_THRESHOLD = 0.5 // 50%
const RENEWAL_FEE_RATIO_THRESHOLD = 0.525 // 52.5% — the property manager's contracted rate; occasional overcharges to 55% are the thing this rule catches

// Notes on real statement line items lead with a room/unit token before a dash,
// e.g. "402-二瓶　宙 更新事務手数料【更新時請求】" or "5区画-伊藤　智子 更新料【更新時請求】".
function extractRoomToken(note: string): string | null {
  const match = note.match(/^([^\s-]+)-/)
  return match ? match[1] : null
}

function previousMonths(month: string, count: number): string[] {
  const [year, mo] = month.split('-').map(Number)
  const result: string[] = []
  let y = year
  let m = mo
  for (let i = 0; i < count; i++) {
    m -= 1
    if (m === 0) {
      m = 12
      y -= 1
    }
    result.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return result
}

async function createFlagIfNew(
  propertyId: string,
  month: string,
  ruleType: string,
  description: string
): Promise<AnomalyFlag | null> {
  const existing = await db.anomalyFlag.findFirst({
    where: { propertyId, month, ruleType, status: 'open' },
  })
  if (existing) return null
  return db.anomalyFlag.create({ data: { propertyId, month, ruleType, description, status: 'open' } })
}

async function checkExpenseDeviation(propertyId: string, month: string): Promise<AnomalyFlag[]> {
  const descriptions: string[] = []
  const currentRecords = await db.financialRecord.findMany({
    where: { propertyId, month, category: 'expense', recurring: true },
  })

  const trailingMonths = previousMonths(month, 3)

  for (const record of currentRecords) {
    const trailingRecords = await db.financialRecord.findMany({
      where: { propertyId, month: { in: trailingMonths }, accountItem: record.accountItem, category: 'expense' },
    })
    if (trailingRecords.length === 0) continue

    const average = trailingRecords.reduce((sum, r) => sum + r.amount, 0) / trailingRecords.length
    if (average === 0) continue

    const deviation = Math.abs(record.amount - average) / average
    if (deviation > DEVIATION_THRESHOLD) {
      descriptions.push(
        `${record.accountItem} was ${record.amount} vs. trailing 3-month average of ${Math.round(average)} (${Math.round(deviation * 100)}% deviation)`
      )
    }
  }

  if (descriptions.length === 0) return []

  const flag = await createFlagIfNew(propertyId, month, 'expense_deviation', descriptions.join('; '))
  return flag ? [flag] : []
}

async function checkMissingStatement(propertyId: string, month: string, today: Date): Promise<AnomalyFlag[]> {
  const [year, mo] = month.split('-').map(Number)
  const dueDate = new Date(year, mo, 20) // 20th of the month AFTER the activity month

  if (today <= dueDate) return []

  const records = await db.financialRecord.findFirst({ where: { propertyId, month } })
  if (records) return []

  const flag = await createFlagIfNew(propertyId, month, 'missing_statement', `No statement received for ${month} as of ${today.toISOString().slice(0, 10)}`)
  return flag ? [flag] : []
}

async function checkNegativeCashFlow(propertyId: string, month: string): Promise<AnomalyFlag[]> {
  const records = await db.financialRecord.findMany({ where: { propertyId, month } })
  const income = records.filter((r) => r.category === 'income').reduce((sum, r) => sum + r.amount, 0)
  const expenses = records.filter((r) => r.category === 'expense').reduce((sum, r) => sum + r.amount, 0)

  if (income - expenses >= 0) return []

  const flag = await createFlagIfNew(propertyId, month, 'negative_cash_flow', `Net cash flow for ${month} is negative: ${income - expenses}`)
  return flag ? [flag] : []
}

// Renewal fee account-item naming has been observed to vary from the model ("Renewal Fee",
// "Renewal fee", "Renewal fee income") — matched case-insensitively rather than by exact
// string, with category as the authoritative income/expense signal.
async function checkRenewalFeeRatio(propertyId: string, month: string): Promise<AnomalyFlag[]> {
  const records = await db.financialRecord.findMany({
    where: {
      propertyId,
      month,
      accountItem: { contains: 'renewal', mode: 'insensitive' },
    },
  })

  const incomeByRoom = new Map<string, number>()
  const expenseByRoom = new Map<string, number>()

  for (const record of records) {
    if (!record.note) continue
    const room = extractRoomToken(record.note)
    if (!room) continue

    const target = record.category === 'income' ? incomeByRoom : record.category === 'expense' ? expenseByRoom : null
    if (!target) continue
    target.set(room, (target.get(room) ?? 0) + record.amount)
  }

  const descriptions: string[] = []
  for (const [room, income] of incomeByRoom) {
    const expense = expenseByRoom.get(room)
    if (expense === undefined || income === 0) continue

    const ratio = expense / income
    if (ratio > RENEWAL_FEE_RATIO_THRESHOLD) {
      descriptions.push(
        `Room ${room}: renewal fee expense ${expense} is ${(ratio * 100).toFixed(1)}% of renewal fee income ${income} (threshold ${RENEWAL_FEE_RATIO_THRESHOLD * 100}%)`
      )
    }
  }

  if (descriptions.length === 0) return []

  const flag = await createFlagIfNew(propertyId, month, 'renewal_fee_overcharge', descriptions.join('; '))
  return flag ? [flag] : []
}

export async function runAnomalyRules(
  propertyId: string,
  month: string,
  options: { today?: Date } = {}
): Promise<AnomalyFlag[]> {
  const today = options.today ?? new Date()

  const [deviationFlags, missingFlags, cashFlowFlags, renewalFeeFlags] = await Promise.all([
    checkExpenseDeviation(propertyId, month),
    checkMissingStatement(propertyId, month, today),
    checkNegativeCashFlow(propertyId, month),
    checkRenewalFeeRatio(propertyId, month),
  ])

  return [...deviationFlags, ...missingFlags, ...cashFlowFlags, ...renewalFeeFlags]
}
