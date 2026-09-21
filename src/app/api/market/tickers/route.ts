import { NextRequest, NextResponse } from 'next/server'
import { fetchTickers } from '@/lib/market-data'
import { SYMBOL_UNIVERSE, getSymbolMeta } from '@/lib/markets'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get('symbols')
  const symbols = symbolsParam
    ? symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 60)
    : SYMBOL_UNIVERSE.map((s) => s.symbol)

  try {
    const tickers = await fetchTickers(symbols)
    const out = symbols
      .filter((s) => tickers.has(s))
      .map((s) => {
        const t = tickers.get(s)!
        const meta = getSymbolMeta(s)
        return {
          symbol: s,
          displaySymbol: meta.displaySymbol,
          name: meta.name,
          market: meta.market,
          tickDigits: meta.tickDigits,
          price: t.price,
          changePct: t.changePct,
          high: t.high,
          low: t.low,
          quoteVolume: t.quoteVolume,
        }
      })
    return NextResponse.json({ tickers: out, ts: Date.now() })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
