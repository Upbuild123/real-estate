import { db } from './db'
import { extractRoomToken, extractRoomTokenFromKnown } from './roomToken'

export type RentCollectionStatus = 'normal' | 'vacant' | 'arrears' | 'additional'

export interface RoomBreakdownEntry {
  room: string
  accountItem: string
  category: 'income' | 'expense'
  amount: number
  status?: RentCollectionStatus
}

// Groups income/expense line items by room and accountItem, summed across the given months.
// Room is determined first against the property's actual known unit labels (from
// RentRollEntry — this is what lets a label like "roof top" match even though it doesn't fit
// the digit/letter room-number shape), falling back to the pattern-based extractRoomToken for
// properties/months with no rent-roll data yet. Only line items with a stored `note` are
// attributable to a room — older records synced before that field existed, or building-wide
// costs with no per-unit note, are excluded rather than guessed at.
export async function getRoomBreakdown(propertyId: string, months: string[]): Promise<RoomBreakdownEntry[]> {
  const [records, allRentRoll] = await Promise.all([
    db.financialRecord.findMany({ where: { propertyId, month: { in: months }, note: { not: null } } }),
    db.rentRollEntry.findMany({ where: { propertyId } }),
  ])

  const knownTokens = Array.from(new Set(allRentRoll.map((r) => r.roomNumber)))

  const grouped = new Map<string, RoomBreakdownEntry>()

  for (const record of records) {
    const note = record.note as string
    const room = extractRoomTokenFromKnown(note, knownTokens) ?? extractRoomToken(note)
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

  // Rent-roll snapshot per room, most recent month within the selected period — used both to
  // fill in a "Rent" row for rooms with zero income line items this period (a fully vacant or
  // fully-missed-payment room might not generate any FinancialRecord at all) and to compute
  // each room's collection status.
  const rentRollInPeriod = allRentRoll.filter((r) => months.includes(r.month))
  const latestByRoom = new Map<string, (typeof rentRollInPeriod)[number]>()
  for (const entry of [...rentRollInPeriod].sort((a, b) => b.month.localeCompare(a.month))) {
    if (!latestByRoom.has(entry.roomNumber)) latestByRoom.set(entry.roomNumber, entry)
  }

  for (const [room, snapshot] of latestByRoom) {
    const key = `${room}|Rent|income`
    if (!grouped.has(key)) {
      grouped.set(key, { room, accountItem: 'Rent', category: 'income', amount: 0 })
    }
  }

  for (const entry of grouped.values()) {
    if (entry.accountItem !== 'Rent' || entry.category !== 'income') continue
    const snapshot = latestByRoom.get(entry.room)
    if (!snapshot) continue

    if (snapshot.lessee.trim().toLowerCase() === 'vacant') {
      entry.status = 'vacant'
      continue
    }

    const expectedTotal = snapshot.monthlyCharge * months.length
    if (entry.amount === expectedTotal) entry.status = 'normal'
    else if (entry.amount > expectedTotal) entry.status = 'additional'
    else entry.status = 'arrears'
  }

  // Order rooms the way the source statement lists them (sortOrder, captured at extraction
  // time) rather than alphabetically — a PDF/xlsx's natural room-then-parking-spot ordering
  // often isn't lexicographic (e.g. parking slots named "1区画".."5区画" sort correctly, but a
  // room like "roof top" wouldn't sort anywhere near the numbered rooms around it in the
  // source). Uses each room's most recent known rent-roll snapshot across all time (not just
  // the selected months), so a room absent from the period still has a stable position.
  const canonicalOrderByRoom = new Map<string, number>()
  for (const entry of [...allRentRoll].sort((a, b) => b.month.localeCompare(a.month))) {
    if (!canonicalOrderByRoom.has(entry.roomNumber)) {
      canonicalOrderByRoom.set(entry.roomNumber, entry.sortOrder)
    }
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const orderA = canonicalOrderByRoom.get(a.room)
    const orderB = canonicalOrderByRoom.get(b.room)
    if (orderA !== undefined && orderB !== undefined && orderA !== orderB) return orderA - orderB
    if (orderA !== undefined && orderB === undefined) return -1
    if (orderA === undefined && orderB !== undefined) return 1
    return a.room.localeCompare(b.room) || b.amount - a.amount
  })
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
