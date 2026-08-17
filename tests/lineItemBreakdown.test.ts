import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { getRoomBreakdown, getExpenseBreakdown } from '../lib/lineItemBreakdown'

describe('getRoomBreakdown', () => {
  it('groups income and expense line items by room, summing across the given months', async () => {
    const property = await createProperty({ name: 'Room Breakdown Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 125000, recurring: true, lineItemKey: 'rb-1', source: 'extracted', note: '101-ZHU JIAOJIAO 2026-01分Rent' },
        { propertyId: property.id, month: '2026-02', category: 'income', accountItem: 'Rent', amount: 125000, recurring: true, lineItemKey: 'rb-2', source: 'extracted', note: '101-ZHU JIAOJIAO 2026-02分Rent' },
        { propertyId: property.id, month: '2026-02', category: 'expense', accountItem: 'Repair expense', amount: 20000, recurring: false, lineItemKey: 'rb-3', source: 'extracted', note: '101 kitchen repair' },
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 71500, recurring: true, lineItemKey: 'rb-4', source: 'extracted', note: '102-株式会社CUD 2026-01分Rent' },
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Electricity charge', amount: 9000, recurring: true, lineItemKey: 'rb-5', source: 'extracted', note: null }, // no room, excluded from room breakdown
      ],
    })

    const result = await getRoomBreakdown(property.id, ['2026-01', '2026-02'])

    const room101Rent = result.find((r) => r.room === '101' && r.accountItem === 'Rent')
    expect(room101Rent?.amount).toBe(250000) // 125000 + 125000 across both months
    expect(room101Rent?.category).toBe('income')

    const room101Repair = result.find((r) => r.room === '101' && r.accountItem === 'Repair expense')
    expect(room101Repair?.amount).toBe(20000)

    const room102Rent = result.find((r) => r.room === '102' && r.accountItem === 'Rent')
    expect(room102Rent?.amount).toBe(71500)

    // no-note line item never appears (can't attribute it to a room)
    expect(result.some((r) => r.accountItem === 'Electricity charge')).toBe(false)

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })
})

describe('getExpenseBreakdown', () => {
  it('groups expense line items by accountItem, summing across months, tagging recurring/normal', async () => {
    const property = await createProperty({ name: 'Expense Breakdown Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Property management fee', amount: 40000, recurring: true, lineItemKey: 'eb-1', source: 'extracted' },
        { propertyId: property.id, month: '2026-02', category: 'expense', accountItem: 'Property management fee', amount: 42000, recurring: true, lineItemKey: 'eb-2', source: 'extracted' },
        { propertyId: property.id, month: '2026-02', category: 'expense', accountItem: 'Repair expense', amount: 20000, recurring: false, lineItemKey: 'eb-3', source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, lineItemKey: 'eb-4', source: 'extracted' }, // income, excluded
      ],
    })

    const result = await getExpenseBreakdown(property.id, ['2026-01', '2026-02'])

    const pmFee = result.find((r) => r.accountItem === 'Property management fee')
    expect(pmFee?.amount).toBe(82000)
    expect(pmFee?.recurring).toBe(true)

    const repair = result.find((r) => r.accountItem === 'Repair expense')
    expect(repair?.amount).toBe(20000)
    expect(repair?.recurring).toBe(false)

    expect(result.some((r) => r.accountItem === 'Rent')).toBe(false)

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('sorts by amount descending', async () => {
    const property = await createProperty({ name: 'Expense Sort Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Small Fee', amount: 1000, recurring: true, lineItemKey: 'es-1', source: 'extracted' },
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Big Fee', amount: 100000, recurring: true, lineItemKey: 'es-2', source: 'extracted' },
      ],
    })

    const result = await getExpenseBreakdown(property.id, ['2026-01'])
    expect(result[0].accountItem).toBe('Big Fee')

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
