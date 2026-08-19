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

  it('matches a unit label that only exists in the rent roll (e.g. "roof top"), not a digit/letter pattern', async () => {
    const property = await createProperty({ name: 'Room Breakdown Antenna Test', address: 'x' })
    await db.rentRollEntry.create({
      data: { propertyId: property.id, month: '2026-08', roomNumber: 'roof top', unitType: 'Parking', lessee: 'Antenna', monthlyCharge: 66000, leaseStart: '2019-12-01', leaseEnd: null },
    })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-08', category: 'income', accountItem: 'Rent', amount: 66000, recurring: true, lineItemKey: 'rb-antenna', source: 'extracted', note: 'roof top-Antenna 2026-08分Rent' },
    })

    const result = await getRoomBreakdown(property.id, ['2026-08'])

    const antenna = result.find((r) => r.room === 'roof top')
    expect(antenna?.amount).toBe(66000)
    expect(antenna?.status).toBe('normal')

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('tags each room\'s Rent entry with a collection status: normal, vacant, arrears, or additional', async () => {
    const property = await createProperty({ name: 'Room Breakdown Status Test', address: 'x' })
    await db.rentRollEntry.createMany({
      data: [
        { propertyId: property.id, month: '2026-08', roomNumber: '101', unitType: 'Residence', lessee: 'Tenant A', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-12-31' },
        { propertyId: property.id, month: '2026-08', roomNumber: '102', unitType: 'Residence', lessee: 'vacant', monthlyCharge: 90000, leaseStart: null, leaseEnd: null },
        { propertyId: property.id, month: '2026-08', roomNumber: '103', unitType: 'Residence', lessee: 'Tenant C', monthlyCharge: 80000, leaseStart: '2024-01-01', leaseEnd: '2026-12-31' },
        { propertyId: property.id, month: '2026-08', roomNumber: '104', unitType: 'Residence', lessee: 'Tenant D', monthlyCharge: 70000, leaseStart: '2024-01-01', leaseEnd: '2026-12-31' },
      ],
    })
    await db.financialRecord.createMany({
      data: [
        // 101: paid exactly the expected amount
        { propertyId: property.id, month: '2026-08', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, lineItemKey: 'rb-s1', source: 'extracted', note: '101-Tenant A 2026-08分Rent' },
        // 102: vacant, no income line item at all
        // 103: occupied but underpaid (partial arrears)
        { propertyId: property.id, month: '2026-08', category: 'income', accountItem: 'Rent', amount: 30000, recurring: true, lineItemKey: 'rb-s3', source: 'extracted', note: '103-Tenant C 2026-08分Rent' },
        // 104: paid more than expected (e.g. two months collected at once)
        { propertyId: property.id, month: '2026-08', category: 'income', accountItem: 'Rent', amount: 140000, recurring: true, lineItemKey: 'rb-s4', source: 'extracted', note: '104-Tenant D 2026-08分Rent' },
      ],
    })

    const result = await getRoomBreakdown(property.id, ['2026-08'])

    expect(result.find((r) => r.room === '101')?.status).toBe('normal')
    expect(result.find((r) => r.room === '102')?.status).toBe('vacant')
    expect(result.find((r) => r.room === '102')?.amount).toBe(0)
    expect(result.find((r) => r.room === '103')?.status).toBe('arrears')
    expect(result.find((r) => r.room === '104')?.status).toBe('additional')

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('when occupied with zero rent collected, tags status as arrears (not silently omitted)', async () => {
    const property = await createProperty({ name: 'Room Breakdown Full Arrears Test', address: 'x' })
    await db.rentRollEntry.create({
      data: { propertyId: property.id, month: '2026-08', roomNumber: '201', unitType: 'Residence', lessee: 'Tenant E', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-12-31' },
    })
    // No FinancialRecord at all for room 201 this month — nothing was collected.

    const result = await getRoomBreakdown(property.id, ['2026-08'])

    const room201 = result.find((r) => r.room === '201')
    expect(room201?.amount).toBe(0)
    expect(room201?.status).toBe('arrears')

    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('multiplies expected rent by the number of selected months for a multi-month period', async () => {
    const property = await createProperty({ name: 'Room Breakdown Multi Month Test', address: 'x' })
    await db.rentRollEntry.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', roomNumber: '301', unitType: 'Residence', lessee: 'Tenant F', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-12-31' },
        { propertyId: property.id, month: '2026-02', roomNumber: '301', unitType: 'Residence', lessee: 'Tenant F', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-12-31' },
      ],
    })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, lineItemKey: 'rb-mm1', source: 'extracted', note: '301-Tenant F 2026-01分Rent' },
        { propertyId: property.id, month: '2026-02', category: 'income', accountItem: 'Rent', amount: 100000, recurring: true, lineItemKey: 'rb-mm2', source: 'extracted', note: '301-Tenant F 2026-02分Rent' },
      ],
    })

    const result = await getRoomBreakdown(property.id, ['2026-01', '2026-02'])

    const room301 = result.find((r) => r.room === '301')
    expect(room301?.amount).toBe(200000)
    expect(room301?.status).toBe('normal') // 200000 collected == 100000 * 2 months expected

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('collects the distinct source notes for a room/item, so an unusual amount can be explained', async () => {
    const property = await createProperty({ name: 'Room Breakdown Notes Test', address: 'x' })
    await db.rentRollEntry.create({
      data: { propertyId: property.id, month: '2026-05', roomNumber: '101', unitType: 'Residence', lessee: 'ZHU JIAOJIAO', monthlyCharge: 125000, leaseStart: '2024-01-01', leaseEnd: '2026-12-31' },
    })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-05', category: 'income', accountItem: 'Rent', amount: 125000, recurring: true, lineItemKey: 'rb-n1', source: 'extracted', note: '101-ZHU JIAOJIAO 2026-05分Rent' },
        { propertyId: property.id, month: '2026-05', category: 'income', accountItem: 'Rent', amount: 125000, recurring: true, lineItemKey: 'rb-n2', source: 'extracted', note: '101-ZHU JIAOJIAO 2026-06分Rent' },
      ],
    })

    const result = await getRoomBreakdown(property.id, ['2026-05'])
    const room101 = result.find((r) => r.room === '101')

    expect(room101?.status).toBe('additional')
    expect(room101?.notes).toEqual(['101-ZHU JIAOJIAO 2026-05分Rent', '101-ZHU JIAOJIAO 2026-06分Rent'])

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('does not add a phantom zero "Rent" row for a Parking unit billed under the "Parking" accountItem', async () => {
    const property = await createProperty({ name: 'Room Breakdown Parking Test', address: 'x' })
    await db.rentRollEntry.create({
      data: { propertyId: property.id, month: '2026-04', roomNumber: '1区画', unitType: 'Parking', lessee: 'Tenant P', monthlyCharge: 14300 },
    })
    await db.financialRecord.create({
      data: { propertyId: property.id, month: '2026-04', category: 'income', accountItem: 'Parking', amount: 14300, recurring: true, lineItemKey: 'rb-park-1', source: 'extracted', note: '1区画-Tenant P 2026-04分Parking' },
    })

    const result = await getRoomBreakdown(property.id, ['2026-04'])
    const parkingEntries = result.filter((r) => r.room === '1区画')

    expect(parkingEntries).toHaveLength(1)
    expect(parkingEntries[0]).toMatchObject({ accountItem: 'Parking', amount: 14300, status: 'normal' })

    await db.financialRecord.deleteMany({ where: { propertyId: property.id } })
    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('orders rooms by their source-statement listing position (sortOrder), not alphabetically', async () => {
    const property = await createProperty({ name: 'Room Breakdown Order Test', address: 'x' })
    await db.rentRollEntry.createMany({
      data: [
        // Deliberately out of alphabetical order to prove sortOrder wins
        { propertyId: property.id, month: '2026-08', roomNumber: '502', unitType: 'Residence', lessee: 'Tenant A', monthlyCharge: 100000, sortOrder: 0 },
        { propertyId: property.id, month: '2026-08', roomNumber: '101', unitType: 'Residence', lessee: 'Tenant B', monthlyCharge: 100000, sortOrder: 1 },
        { propertyId: property.id, month: '2026-08', roomNumber: 'roof top', unitType: 'Parking', lessee: 'Antenna', monthlyCharge: 5000, sortOrder: 2 },
      ],
    })

    const result = await getRoomBreakdown(property.id, ['2026-08'])

    expect(result.map((r) => r.room)).toEqual(['502', '101', 'roof top'])

    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
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

  it('collects the distinct source notes for an accountItem, so an unusual expense can be explained', async () => {
    const property = await createProperty({ name: 'Expense Breakdown Notes Test', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: property.id, month: '2026-01', category: 'expense', accountItem: 'Building Management fee', amount: 30000, recurring: false, lineItemKey: 'eb-n1', source: 'extracted', note: 'B301,B201-Water leak investigation' },
        { propertyId: property.id, month: '2026-02', category: 'expense', accountItem: 'Building Management fee', amount: 74000, recurring: false, lineItemKey: 'eb-n2', source: 'extracted', note: 'B102-Restoration from water leak' },
      ],
    })

    const result = await getExpenseBreakdown(property.id, ['2026-01', '2026-02'])
    const buildingFee = result.find((r) => r.accountItem === 'Building Management fee')

    expect(buildingFee?.notes).toEqual(['B301,B201-Water leak investigation', 'B102-Restoration from water leak'])

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
