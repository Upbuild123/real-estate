import { describe, it, expect, vi, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'

vi.mock('../lib/email', () => ({
  sendStatementsReadyEmail: vi.fn().mockResolvedValue(undefined),
}))

import { getLatestCommonMonth, hasNotifiedForMonth, recordNotification, checkAndNotify } from '../lib/notifications'
import { sendStatementsReadyEmail } from '../lib/email'

describe('getLatestCommonMonth', () => {
  it('returns the most recent month for which every active property has data', async () => {
    const propertyA = await createProperty({ name: 'Notif Property A', address: 'x' })
    const propertyB = await createProperty({ name: 'Notif Property B', address: 'x' })

    await db.financialRecord.createMany({
      data: [
        { propertyId: propertyA.id, month: '2026-05', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'n1', source: 'extracted' },
        { propertyId: propertyA.id, month: '2026-06', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'n2', source: 'extracted' },
        { propertyId: propertyB.id, month: '2026-05', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'n3', source: 'extracted' },
        // propertyB has no 2026-06 yet — so 2026-06 is not a common month
      ],
    })

    const result = await getLatestCommonMonth([propertyA.id, propertyB.id])
    expect(result).toBe('2026-05')

    await db.financialRecord.deleteMany({ where: { propertyId: { in: [propertyA.id, propertyB.id] } } })
    await db.property.deleteMany({ where: { id: { in: [propertyA.id, propertyB.id] } } })
  })

  it('returns null when no month is common to every property', async () => {
    const propertyA = await createProperty({ name: 'Notif Property C', address: 'x' })
    const propertyB = await createProperty({ name: 'Notif Property D', address: 'x' })

    await db.financialRecord.create({
      data: { propertyId: propertyA.id, month: '2026-01', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'n4', source: 'extracted' },
    })
    // propertyB has no records at all

    const result = await getLatestCommonMonth([propertyA.id, propertyB.id])
    expect(result).toBeNull()

    await db.financialRecord.deleteMany({ where: { propertyId: propertyA.id } })
    await db.property.deleteMany({ where: { id: { in: [propertyA.id, propertyB.id] } } })
  })

  it('returns null for an empty property list', async () => {
    expect(await getLatestCommonMonth([])).toBeNull()
  })
})

describe('hasNotifiedForMonth / recordNotification', () => {
  it('reports not-yet-notified until recordNotification is called for that month', async () => {
    expect(await hasNotifiedForMonth('2026-07')).toBe(false)
    await recordNotification('2026-07')
    expect(await hasNotifiedForMonth('2026-07')).toBe(true)
  })

  it('recordNotification is idempotent (calling it twice for the same month does not throw)', async () => {
    await recordNotification('2026-08')
    await expect(recordNotification('2026-08')).resolves.not.toThrow()
  })

  afterAll(async () => {
    await db.monthlyNotification.deleteMany({ where: { month: { in: ['2026-07', '2026-08'] } } })
    await db.$disconnect()
  })
})

describe('checkAndNotify', () => {
  it('sends an email and records the notification when a new common month is ready', async () => {
    const propertyA = await createProperty({ name: 'CAN Property A', address: 'x' })
    const propertyB = await createProperty({ name: 'CAN Property B', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: propertyA.id, month: '2026-09', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'can1', source: 'extracted' },
        { propertyId: propertyB.id, month: '2026-09', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'can2', source: 'extracted' },
      ],
    })
    ;(sendStatementsReadyEmail as any).mockClear()

    await checkAndNotify({ to: 'michael.sloyer@gmail.com', propertyIds: [propertyA.id, propertyB.id] })

    expect(sendStatementsReadyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'michael.sloyer@gmail.com', month: '2026-09' })
    )
    expect(await hasNotifiedForMonth('2026-09')).toBe(true)

    await db.financialRecord.deleteMany({ where: { propertyId: { in: [propertyA.id, propertyB.id] } } })
    await db.property.deleteMany({ where: { id: { in: [propertyA.id, propertyB.id] } } })
    await db.monthlyNotification.deleteMany({ where: { month: '2026-09' } })
  })

  it('does not send a second email for a month already notified', async () => {
    const propertyA = await createProperty({ name: 'CAN Property C', address: 'x' })
    const propertyB = await createProperty({ name: 'CAN Property F', address: 'x' })
    await db.financialRecord.createMany({
      data: [
        { propertyId: propertyA.id, month: '2026-10', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'can3', source: 'extracted' },
        { propertyId: propertyB.id, month: '2026-10', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'can3b', source: 'extracted' },
      ],
    })
    await recordNotification('2026-10')
    ;(sendStatementsReadyEmail as any).mockClear()

    await checkAndNotify({ to: 'michael.sloyer@gmail.com', propertyIds: [propertyA.id, propertyB.id] })

    expect(sendStatementsReadyEmail).not.toHaveBeenCalled()

    await db.financialRecord.deleteMany({ where: { propertyId: { in: [propertyA.id, propertyB.id] } } })
    await db.property.deleteMany({ where: { id: { in: [propertyA.id, propertyB.id] } } })
    await db.monthlyNotification.deleteMany({ where: { month: '2026-10' } })
  })

  it('does nothing when there is no common month yet', async () => {
    const propertyA = await createProperty({ name: 'CAN Property D', address: 'x' })
    const propertyB = await createProperty({ name: 'CAN Property E', address: 'x' })
    // propertyB has no records — no common month possible
    await db.financialRecord.create({
      data: { propertyId: propertyA.id, month: '2026-11', category: 'income', accountItem: 'Rent', amount: 1000, recurring: true, lineItemKey: 'can4', source: 'extracted' },
    })
    ;(sendStatementsReadyEmail as any).mockClear()

    await checkAndNotify({ to: 'michael.sloyer@gmail.com', propertyIds: [propertyA.id, propertyB.id] })

    expect(sendStatementsReadyEmail).not.toHaveBeenCalled()

    await db.financialRecord.deleteMany({ where: { propertyId: propertyA.id } })
    await db.property.deleteMany({ where: { id: { in: [propertyA.id, propertyB.id] } } })
  })
})
