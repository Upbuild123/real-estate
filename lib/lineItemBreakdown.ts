import { db } from './db'
import { extractRoomToken, extractRoomTokenFromKnown } from './roomToken'

export type RentCollectionStatus = 'normal' | 'vacant' | 'arrears' | 'additional'

export interface RoomBreakdownEntry {
  room: string
  accountItem: string
  category: 'income' | 'expense'
  amount: number
  status?: RentCollectionStatus
  notes: string[]
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
      if (!existing.notes.includes(note)) existing.notes.push(note)
    } else {
      grouped.set(key, {
        room,
        accountItem: record.accountItem,
        category: record.category as 'income' | 'expense',
        amount: record.amount,
        notes: [note],
      })
    }
  }

  // Rent-roll snapshot per room, most recent month within the selected period — used both to
  // fill in an income row for rooms with zero matching line items this period (a fully vacant
  // or fully-missed-payment room might not generate any FinancialRecord at all) and to compute
  // each room's collection status. A Parking unit's charge is billed under the "Parking"
  // accountItem, not "Rent" — using the wrong one here would both mismatch the real line item
  // (double-counting the room, once correctly and once as a phantom zero row) and always read
  // as a false "arrears".
  const rentRollInPeriod = allRentRoll.filter((r) => months.includes(r.month))
  const latestByRoom = new Map<string, (typeof rentRollInPeriod)[number]>()
  for (const entry of [...rentRollInPeriod].sort((a, b) => b.month.localeCompare(a.month))) {
    if (!latestByRoom.has(entry.roomNumber)) latestByRoom.set(entry.roomNumber, entry)
  }

  // Which accountItem a room's charge is billed under isn't consistent across properties —
  // e.g. Ide's roof antenna is typed "Parking" but billed as "Rent", while D05's actual
  // parking spots are billed as "Parking" — so infer each room's convention from its own
  // real income history (across all time, not just the selected period) rather than
  // guessing from unitType.
  const canonicalIncomeRecords = await db.financialRecord.findMany({
    where: { propertyId, category: 'income', note: { not: null }, accountItem: { in: ['Rent', 'Parking'] } },
    select: { note: true, accountItem: true },
  })
  const canonicalAccountItemByRoom = new Map<string, string>()
  for (const record of canonicalIncomeRecords) {
    const note = record.note as string
    const room = extractRoomTokenFromKnown(note, knownTokens) ?? extractRoomToken(note)
    if (!room || canonicalAccountItemByRoom.has(room)) continue
    canonicalAccountItemByRoom.set(room, record.accountItem)
  }

  function chargeAccountItem(room: string, unitType: string): string {
    return canonicalAccountItemByRoom.get(room) ?? (unitType === 'Parking' ? 'Parking' : 'Rent')
  }

  for (const [room, snapshot] of latestByRoom) {
    const accountItem = chargeAccountItem(room, snapshot.unitType)
    const key = `${room}|${accountItem}|income`
    if (!grouped.has(key)) {
      grouped.set(key, { room, accountItem, category: 'income', amount: 0, notes: [] })
    }
  }

  for (const entry of grouped.values()) {
    if (entry.category !== 'income') continue
    const snapshot = latestByRoom.get(entry.room)
    if (!snapshot || entry.accountItem !== chargeAccountItem(entry.room, snapshot.unitType)) continue

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
  notes: string[]
}

// Groups expense line items by accountItem, summed across the given months. `recurring`
// reflects the deterministic lookup table (lib/extraction/statementSchema.ts) — the same
// "normal" classification the non_recurring_item anomaly rule uses. `notes` collects the
// distinct source line-item notes, so a flagged/non-recurring category can show why it's
// there (e.g. what the building maintenance charge was actually for).
export async function getExpenseBreakdown(propertyId: string, months: string[]): Promise<ExpenseBreakdownEntry[]> {
  const records = await db.financialRecord.findMany({
    where: { propertyId, month: { in: months }, category: 'expense' },
  })

  const grouped = new Map<string, ExpenseBreakdownEntry>()

  for (const record of records) {
    const note = record.note ?? ''
    const existing = grouped.get(record.accountItem)
    if (existing) {
      existing.amount += record.amount
      if (note && !existing.notes.includes(note)) existing.notes.push(note)
    } else {
      grouped.set(record.accountItem, {
        accountItem: record.accountItem,
        amount: record.amount,
        recurring: record.recurring,
        notes: note ? [note] : [],
      })
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.amount - a.amount)
}
