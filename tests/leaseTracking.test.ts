import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { createProperty } from '../lib/properties'
import { getUpcomingLeaseExpirations, getPortfolioUpcomingLeaseExpirations } from '../lib/leaseTracking'

describe('getUpcomingLeaseExpirations', () => {
  it('returns rooms whose most recent lease ends within the next 90 days', async () => {
    const property = await createProperty({ name: 'Lease Test', address: 'x' })
    const now = new Date('2026-01-01')

    await db.rentRollEntry.createMany({
      data: [
        // Room 101: lease ends in 30 days — within window
        { propertyId: property.id, month: '2025-12', roomNumber: '101', unitType: 'Residence', lessee: 'Tenant A', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-01-31' },
        // Room 102: lease ends in 200 days — outside window
        { propertyId: property.id, month: '2025-12', roomNumber: '102', unitType: 'Residence', lessee: 'Tenant B', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-07-20' },
        // Room 103: lease already ended — outside window (in the past)
        { propertyId: property.id, month: '2025-12', roomNumber: '103', unitType: 'Residence', lessee: 'Tenant C', monthlyCharge: 100000, leaseStart: '2023-01-01', leaseEnd: '2025-12-01' },
        // Room 104: no lease end date — excluded
        { propertyId: property.id, month: '2025-12', roomNumber: '104', unitType: 'Residence', lessee: 'vacant', monthlyCharge: 0, leaseStart: null, leaseEnd: null },
      ],
    })

    const result = await getUpcomingLeaseExpirations(property.id, now)

    expect(result).toEqual([{ roomNumber: '101', lessee: 'Tenant A', leaseEnd: '2026-01-31', month: '2025-12' }])

    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('uses only the most recent month\'s snapshot per room, ignoring stale older leaseEnd values', async () => {
    const property = await createProperty({ name: 'Lease Test Stale', address: 'x' })
    const now = new Date('2026-01-01')

    await db.rentRollEntry.createMany({
      data: [
        // Older snapshot said this lease ended soon — but a newer snapshot shows it was renewed
        { propertyId: property.id, month: '2025-11', roomNumber: '201', unitType: 'Residence', lessee: 'Tenant D', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-01-15' },
        { propertyId: property.id, month: '2025-12', roomNumber: '201', unitType: 'Residence', lessee: 'Tenant D', monthlyCharge: 100000, leaseStart: '2026-01-15', leaseEnd: '2028-01-14' },
      ],
    })

    const result = await getUpcomingLeaseExpirations(property.id, now)

    expect(result).toEqual([])

    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('when a mid-month turnover leaves two rows for the same room/month, prefers the incoming tenant (latest leaseStart)', async () => {
    const property = await createProperty({ name: 'Lease Test Turnover', address: 'x' })
    const now = new Date('2026-01-01')

    await db.rentRollEntry.createMany({
      data: [
        // Outgoing tenant's lease ends in 10 days — would be "upcoming" if picked
        { propertyId: property.id, month: '2025-12', roomNumber: '301', unitType: 'Residence', lessee: 'Outgoing Tenant', monthlyCharge: 100000, leaseStart: '2020-01-01', leaseEnd: '2026-01-11' },
        // Incoming tenant's lease starts later in the same month, ends far in the future
        { propertyId: property.id, month: '2025-12', roomNumber: '301', unitType: 'Residence', lessee: 'Incoming Tenant', monthlyCharge: 100000, leaseStart: '2025-12-20', leaseEnd: '2028-12-19' },
      ],
    })

    const result = await getUpcomingLeaseExpirations(property.id, now)

    expect(result).toEqual([])

    await db.rentRollEntry.deleteMany({ where: { propertyId: property.id } })
    await db.property.delete({ where: { id: property.id } })
  })

  it('combines upcoming expirations across every active property, tagged with property name, sorted by lease end', async () => {
    const propertyA = await createProperty({ name: 'Lease Portfolio Test A', address: 'x' })
    const propertyB = await createProperty({ name: 'Lease Portfolio Test B', address: 'x' })
    const now = new Date('2026-01-01')

    await db.rentRollEntry.createMany({
      data: [
        { propertyId: propertyA.id, month: '2025-12', roomNumber: '101', unitType: 'Residence', lessee: 'Tenant A', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-02-15' },
        { propertyId: propertyB.id, month: '2025-12', roomNumber: '201', unitType: 'Residence', lessee: 'Tenant B', monthlyCharge: 100000, leaseStart: '2024-01-01', leaseEnd: '2026-01-20' },
      ],
    })

    const result = await getPortfolioUpcomingLeaseExpirations(now)
    const relevant = result.filter((r) => r.propertyId === propertyA.id || r.propertyId === propertyB.id)

    expect(relevant).toEqual([
      { propertyId: propertyB.id, propertyName: 'Lease Portfolio Test B', roomNumber: '201', lessee: 'Tenant B', leaseEnd: '2026-01-20', month: '2025-12' },
      { propertyId: propertyA.id, propertyName: 'Lease Portfolio Test A', roomNumber: '101', lessee: 'Tenant A', leaseEnd: '2026-02-15', month: '2025-12' },
    ])

    await db.rentRollEntry.deleteMany({ where: { propertyId: { in: [propertyA.id, propertyB.id] } } })
    await db.property.deleteMany({ where: { id: { in: [propertyA.id, propertyB.id] } } })
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
