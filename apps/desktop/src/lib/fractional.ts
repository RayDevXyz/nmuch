// Fractional indexing: string keys that sort lexicographically, so an item can be
// placed between two neighbours without renumbering anything else.
// Keys use base-62 digits in ASCII order and never end in '0'.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`fractional: ${a} >= ${b}`)
  if (b !== null) {
    let n = 0
    while ((a[n] || '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[da] + midpoint(a.slice(1), null)
}

export function keyBetween(a: string | null | undefined, b: string | null | undefined): string {
  return midpoint(a ?? '', b ?? null)
}

/** n evenly spread keys between a and b (keeps keys short for bulk inserts). */
export function keysBetween(a: string | null | undefined, b: string | null | undefined, n: number): string[] {
  if (n <= 0) return []
  if (n === 1) return [keyBetween(a, b)]
  const mid = Math.floor(n / 2)
  const c = keyBetween(a, b)
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)]
}
