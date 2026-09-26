import { NextResponse } from 'next/server'
import { fetchGoldSpotState, fetchGoldKlines } from '@/lib/gold'

export const dynamic = 'force-dynamic'

/**
 * Live spot gold quote with feed health metadata. The browser polls this
 * instead of hitting gold-api.com directly, so the failover chain
 * (gold-api -> COMEX-anchored -> PAXG) lives server-side and a single dead
 * provider can never freeze the UI silently. Day stats ride along so one poll
 * covers tape, watchlist and chart.
 */
export async function GET() {
  try {
    const spot = await fetchGoldSpotState()
    if (!spot) {
      return NextResponse.json({ error: 'gold spot unavailable (all sources failed)' }, { status: 503 })
    }

    // day stats from the cached 1d candle series (usually warm, cheap)
    let day: { open: number; high: number; low: number } | null = null
    try {
      const candles = await fetchGoldKlines('XAUUSD', '1d', 2)
      const today = candles[candles.length - 1]
      if (today) {
        day = {
          open: today.open,
          high: Math.max(today.high, spot.price),
          low: Math.min(today.low, spot.price),
        }
      }
    } catch {
      /* day stats are optional */
    }

    const res = NextResponse.json({
      price: spot.price,
      source: spot.source,
      asOf: spot.asOf,
      ageSec: Math.max(0, Math.round((Date.now() - spot.asOf) / 1000)),
      marketOpen: spot.marketOpen,
      stale: spot.stale,
      open: day?.open ?? null,
      high: day?.high ?? null,
      low: day?.low ?? null,
      ts: Date.now(),
    })
    // let the edge serve this for a few seconds: many clients, one upstream poll
    res.headers.set('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=10')
    return res
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
