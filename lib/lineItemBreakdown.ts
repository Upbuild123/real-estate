import { db } from './db'
import { extractRoomToken } from './roomToken'

export interface RoomBreakdownEntry {
  room: string
  accountItem: string
  category: 'income' | 'expense'
  amount: number
}

// Groups income/expense line items by room (parsed from the source statement's note) and
// accountItem, summed across the given months. Only line items new enough to have a stored
// `note` are attributable to a room — older records synced before that field existed, or
// building-wide costs with no per-unit note, are excluded rather than guessed at.
export async function getRoomBreakdown(propertyId: string, months: string[]): Promise<RoomBreakdownEntry[]> {
  const records = await db.financialRecord.findMany({
    where: { propertyId, month: { in: months }, note: { not: null } },
  })

  const grouped = new Map<string, RoomBreakdownEntry>()

  for (const record of records) {
    const room = extractRoomToken(record.note as string)
    if (!room) continue

    const key = `${room}|${record.accountItem}|${record.category}`
    const existing = grouped.get(key)
    if (existing) {
      existing.amount += record.amount
    } else {
      grouped.set(key, {
        room,
        accountItem: record.accountItem,
        category: record.category as 'income' | 'expense',
        amount: record.amount,
      })
    }
  }

  return Array.from(grouped.values()).sort((a, b) => a.room.localeCompare(b.room) || b.amount - a.amount)
}

export interface ExpenseBreakdownEntry {
  accountItem: string
  amount: number
  recurring: boolean
}

// Groups expense line items by accountItem, summed across the given months. `recurring`
// reflects the deterministic lookup table (lib/extraction/statementSchema.ts) — the same
// "normal" classification the non_recurring_item anomaly rule uses.
export async function getExpenseBreakdown(propertyId: string, months: string[]): Promise<ExpenseBreakdownEntry[]> {
  const records = await db.financialRecord.findMany({
    where: { propertyId, month: { in: months }, category: 'expense' },
  })

  const grouped = new Map<string, ExpenseBreakdownEntry>()

  for (const record of records) {
    const existing = grouped.get(record.accountItem)
    if (existing) {
      existing.amount += record.amount
    } else {
      grouped.set(record.accountItem, {
        accountItem: record.accountItem,
        amount: record.amount,
        recurring: record.recurring,
      })
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.amount - a.amount)
}
