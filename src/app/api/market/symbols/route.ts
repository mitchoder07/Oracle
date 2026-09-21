import { NextResponse } from 'next/server'
import { SYMBOL_UNIVERSE, DEFAULT_WATCHLIST, TIMEFRAMES } from '@/lib/markets'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    symbols: SYMBOL_UNIVERSE,
    defaults: DEFAULT_WATCHLIST,
    timeframes: TIMEFRAMES,
  })
}
