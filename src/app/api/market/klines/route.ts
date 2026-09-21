import { NextRequest, NextResponse } from 'next/server'
import { fetchKlines } from '@/lib/market-data'
import { getSymbolMeta } from '@/lib/markets'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase()
  const interval = req.nextUrl.searchParams.get('interval') ?? '1h'
  const limit = Math.min(500, Math.max(50, Number(req.nextUrl.searchParams.get('limit') ?? 200)))

  try {
    const candles = await fetchKlines(symbol, interval, limit)
    return NextResponse.json({
      symbol,
      interval,
      meta: getSymbolMeta(symbol),
      candles,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to load klines for ${symbol}: ${(e as Error).message}` },
      { status: 502 }
    )
  }
}
