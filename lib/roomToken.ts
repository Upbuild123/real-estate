// Notes on real statement line items lead with a room/unit token before a dash or a space,
// e.g. "402-二瓶　宙 更新事務手数料【更新時請求】", "5区画-伊藤　智子 更新料【更新時請求】", or
// "301 kitchen repair". The token itself is restricted to digits, a 1-2 letter building-wing
// prefix plus digits (e.g. "A203"), or digits plus "区画" (parking slot) — never a bare word —
// so an ordinary sentence like "common area power bill" is correctly not mistaken for a room.
// Plain digit tokens are capped at 3 digits: building-wide expense notes commonly lead with a
// "YYYY-MM " billing-period prefix (e.g. "2026-02 井手ビル 管理委託料支払い" for a property
// management fee), and a bare 4-digit year must never be mistaken for a room number.
export function extractRoomToken(note: string): string | null {
  const match = note.match(/^(\d{1,3}区画|[A-Za-z]{1,2}\d{1,3}|\d{1,3})[-\s]/)
  return match ? match[1] : null
}
