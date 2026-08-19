import { describe, it, expect } from 'vitest'
import { extractRoomToken, extractRoomTokenFromKnown } from '../lib/roomToken'

describe('extractRoomToken', () => {
  it('extracts a numeric unit token before the dash', () => {
    expect(extractRoomToken('402-二瓶　宙 更新事務手数料【更新時請求】')).toBe('402')
  })

  it('extracts an alphanumeric unit token (e.g. building A/B wings)', () => {
    expect(extractRoomToken('A203-坂野 景瑛 2026-02分Rent')).toBe('A203')
  })

  it('extracts a parking slot token', () => {
    expect(extractRoomToken('5区画-伊藤　智子 更新事務手数料【更新時請求】')).toBe('5区画')
  })

  it('extracts a space-separated unit token (repair-note style, e.g. "301 kitchen repair")', () => {
    expect(extractRoomToken('301 kitchen repair')).toBe('301')
  })

  it('returns null when the note has no leading room token', () => {
    expect(extractRoomToken('common area power bill')).toBeNull()
    expect(extractRoomToken('water leakage repair in common area')).toBeNull()
  })

  it('does not mistake a leading billing-period year (e.g. "2026-02 ...") for a room number', () => {
    expect(extractRoomToken('2026-02 井手ビル 管理委託料支払い')).toBeNull()
    expect(extractRoomToken('2026-05 レジデンスDO5 Regular Cleaning')).toBeNull()
  })
})

describe('extractRoomTokenFromKnown', () => {
  it('matches a known unit label that does not fit the digit/letter pattern (e.g. "roof top")', () => {
    expect(extractRoomTokenFromKnown('roof top-Antenna 2026-08分Rent', ['101', 'roof top'])).toBe('roof top')
  })

  it('prefers the longest matching known token', () => {
    expect(extractRoomTokenFromKnown('101A-extra unit', ['101', '101A'])).toBe('101A')
  })

  it('returns null when no known token matches', () => {
    expect(extractRoomTokenFromKnown('common area power bill', ['101', '102'])).toBeNull()
  })

  it('requires a boundary (dash, space, or end of string) after the token, not a partial match', () => {
    expect(extractRoomTokenFromKnown('1015-something', ['101'])).toBeNull()
  })
})
