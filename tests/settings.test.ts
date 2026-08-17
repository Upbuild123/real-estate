import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../lib/db'
import { getSetting, setSetting, getMarginalTaxRate } from '../lib/settings'

describe('settings', () => {
  it('defaults marginal tax rate to 0.43 when unset', async () => {
    expect(await getMarginalTaxRate()).toBe(0.43)
  })

  it('stores and retrieves an updated marginal tax rate', async () => {
    await setSetting('marginalTaxRate', '0.37')
    expect(await getMarginalTaxRate()).toBe(0.37)
  })

  afterAll(async () => {
    await db.setting.deleteMany({ where: { key: 'marginalTaxRate' } })
    await db.$disconnect()
  })
})
