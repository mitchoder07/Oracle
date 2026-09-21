// ─── Market session awareness ────────────────────────────────────────────────
// The FX market trades 24/5: opens Sunday 17:00 New York time, closes Friday
// 17:00 New York time (DST-safe because we read the actual America/New_York
// wall clock via Intl). Crypto trades 24/7.
// Spot gold (XAU/USD) also closes for the weekend: closes Friday 17:00 ET,
// reopens Sunday 18:00 ET (typical broker/metals-desk hours). Our XAU/USD feed
// is the PAXG token (24/7 on Binance), so weekend charts still work — but the
// SPOT market is closed and the scanner must not burn LLM calls on frozen data.
// Used by the UI (badges/banners), the analysis prompts (so ORACLE knows it's
// the weekend and prices are Friday's close), and the data layer (staleness
// rules relax while FX is closed so weekend charts keep working).

export interface MarketSession {
  open: boolean
  /** Short chip label, e.g. "OPEN" / "CLOSED" / "24/7" */
  label: string
  /** Human detail, e.g. "Weekend — reopens Sun 5:00 PM ET" */
  detail: string
  market: 'CRYPTO' | 'FOREX' | 'METAL'
}

const NY_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Parts of the current wall-clock time in New York (DST-safe). */
export function nyParts(now: Date = new Date()): { dayIdx: number; hour: number; minute: number; label: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return { dayIdx: NY_WEEKDAYS.indexOf(weekday), hour, minute, label: `${weekday} ${hour}:${String(minute).padStart(2, '0')} ET` }
}

/**
 * True while the FX market is closed for the weekend.
 * Closed from Friday 17:00 ET until Sunday 17:00 ET.
 */
export function isForexClosed(now: Date = new Date()): boolean {
  const { dayIdx, hour } = nyParts(now)
  if (dayIdx === 6) return true // Saturday — fully closed
  if (dayIdx === 5 && hour >= 17) return true // Friday after 5 PM ET
  if (dayIdx === 0 && hour < 17) return true // Sunday before 5 PM ET
  return false
}

/**
 * True while the spot metals market (XAU/USD gold) is closed for the weekend.
 * Spot gold closes Friday 17:00 ET and reopens Sunday 18:00 ET on most
 * brokers/metals desks (one hour after FX reopens).
 */
export function isMetalClosed(now: Date = new Date()): boolean {
  const { dayIdx, hour } = nyParts(now)
  if (dayIdx === 6) return true // Saturday — fully closed
  if (dayIdx === 5 && hour >= 17) return true // Friday after 5 PM ET
  if (dayIdx === 0 && hour < 18) return true // Sunday before 6 PM ET
  return false
}

export function getMarketSession(
  market: 'CRYPTO' | 'FOREX' | 'METAL',
  now: Date = new Date()
): MarketSession {
  if (market === 'FOREX') {
    if (isForexClosed(now)) {
      return {
        open: false,
        label: 'CLOSED',
        detail: 'Weekend — reopens Sun 5:00 PM ET',
        market,
      }
    }
    return {
      open: true,
      label: 'OPEN',
      detail: 'Closes Fri 5:00 PM ET',
      market,
    }
  }
  if (market === 'METAL') {
    if (isMetalClosed(now)) {
      return {
        open: false,
        label: 'XAU CLOSED',
        detail: 'Spot gold closed — reopens Sun 6:00 PM ET (chart shows the 24/7 PAXG token price)',
        market,
      }
    }
    return {
      open: true,
      label: 'OPEN',
      detail: 'Spot gold closes Fri 5:00 PM ET',
      market,
    }
  }
  // Crypto trades around the clock
  return { open: true, label: '24/7', detail: 'Always open', market }
}

/** Session line injected into AI prompts so ORACLE knows the real date/time. */
export function sessionPromptLine(now: Date = new Date()): string {
  const utc = now.toUTCString().replace('GMT', 'UTC')
  const ny = nyParts(now)
  const fx = isForexClosed(now)
    ? 'FX market: CLOSED for the weekend (prices are Friday\u2019s close; weekend gap risk applies; reopens Sunday 5:00 PM ET)'
    : 'FX market: OPEN (24/5 — closes Friday 5:00 PM ET)'
  const gold = isMetalClosed(now)
    ? 'GOLD (XAU/USD) spot market: CLOSED for the weekend (reopens Sunday 6:00 PM ET; any XAU price shown is the 24/7 PAXG token proxy, which can drift from spot and thins out on weekends)'
    : 'GOLD (XAU/USD) spot market: OPEN (closes Friday 5:00 PM ET)'
  return `CURRENT TIME: ${utc} (${ny.label}). CRYPTO market: OPEN 24/7. ${fx}. ${gold}.`
}
