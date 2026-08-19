import { describe, it, expect } from 'vitest'
import { translateNote } from '../lib/translateNote'

describe('translateNote', () => {
  it('translates the "YYYY-MM分Item" rent/parking pattern, leaving the tenant name untouched', () => {
    expect(translateNote('101-ZHU JIAOJIAO 2026-08分Rent')).toBe('101-ZHU JIAOJIAO Rent for 2026-08')
    expect(translateNote('1区画-羽山　信子 2024-01分Parking')).toBe('1 space-羽山　信子 Parking for 2024-01')
  })

  it('translates a building-wide expense note, including the building name', () => {
    expect(translateNote('2026-02 井手ビル 管理委託料支払い')).toBe('2026-02 Ide Building management fee payment')
    expect(translateNote('2024-02 レジデンスＤＯ５ 管理委託料支払い')).toBe('2024-02 Residence DO5 management fee payment')
  })

  it('translates bracketed billing-context annotations into plain brackets, keeping the name outside untouched', () => {
    expect(translateNote('402-二瓶　宙 更新料【更新時請求】')).toBe('402-二瓶　宙 renewal fee[billed at renewal]')
    expect(translateNote('B202-Camat Jaymar 2024-01 敷金【契約金請求】')).toBe('B202-Camat Jaymar 2024-01 deposit[billed at contract]')
    expect(translateNote('101-ZHU　JIAOJIAO 敷金 【解約精算】')).toBe('101-ZHU　JIAOJIAO deposit [cancellation settlement]')
  })

  it('translates a restoration-work note with a tenant-borne-portion annotation', () => {
    expect(translateNote('101- NGUYENTHI VAN 原状回復工事費 【解約精算：貸主請求分】')).toBe(
      '101- NGUYENTHI VAN restoration work cost [cancellation settlement: landlord-billed portion]'
    )
  })

  it('translates a re-contract fee note', () => {
    expect(translateNote('A302-上廣　優吏 再契約事務手数料【再契約時請求】')).toBe(
      'A302-上廣　優吏 re-contract administrative fee[billed at re-contract]'
    )
  })

  it('leaves notes with no known Japanese vocabulary unchanged (e.g. already-English notes)', () => {
    expect(translateNote('Common area electric fee')).toBe('Common area electric fee')
    expect(translateNote('B202-Gas stove repair')).toBe('B202-Gas stove repair')
  })

  it('leaves a lone tenant/company name unchanged when there is no other Japanese text', () => {
    expect(translateNote('株式会社日本保育サービス')).toBe('株式会社日本保育サービス')
  })
})
