// Formats a yen amount as a compact, rounded string for display: thousands as "643K",
// millions (>= 1,000,000) as "5.4M". Rounds to the nearest thousand first (matching the
// requested display precision), so anything under 500 yen rounds to "0".
export function formatYenCompact(amount: number): string {
  const roundedToThousand = Math.round(amount / 1000) * 1000
  const sign = roundedToThousand < 0 ? '-' : ''
  const abs = Math.abs(roundedToThousand)

  if (abs === 0) return '0'
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  }
  return `${sign}${abs / 1000}K`
}
