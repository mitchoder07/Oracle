import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { canonicalSymbol, DEFAULT_WATCHLIST, getSymbolMeta, isValidSymbol, LEGACY_SYMBOL_MAP } from '@/lib/markets'
import type { WatchItemDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

function toDTO(item: any): WatchItemDTO {
  return {
    id: item.id,
    symbol: item.symbol,
    market: item.market,
    timeframe: item.timeframe,
    active: item.active,
    lastSignal: item.lastSignal,
    lastConfidence: item.lastConfidence,
    lastSignalAt: item.lastSignalAt ? item.lastSignalAt.toISOString() : null,
  }
}

// GET — seeds defaults on first run, migrates legacy symbols, returns the watchlist
export async function GET() {
  let count = await db.watchItem.count()
  if (count === 0) {
    await db.watchItem.createMany({
      data: DEFAULT_WATCHLIST.map((symbol) => ({
        symbol,
        market: getSymbolMeta(symbol).market,
        timeframe: '1h',
        active: true,
      })),
    })
    count = await db.watchItem.count()
  }

  // migrate legacy rows (PAXGUSDT from when gold was the token; gold is now
  // real spot XAUUSD) so existing deployments keep working after the change
  for (const [legacy, current] of Object.entries(LEGACY_SYMBOL_MAP)) {
    const row = await db.watchItem.findUnique({ where: { symbol: legacy } })
    if (!row) continue
    const target = await db.watchItem.findUnique({ where: { symbol: current } })
    if (target) {
      await db.watchItem.delete({ where: { symbol: legacy } })
    } else {
      await db.watchItem.update({
        where: { symbol: legacy },
        data: { symbol: current, market: getSymbolMeta(current).market },
      })
    }
  }

  const items = await db.watchItem.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ items: items.map(toDTO) })
}

// POST { symbol } — add a pair
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const symbol = canonicalSymbol(String(body?.symbol ?? ''))
  if (!symbol) return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  if (!isValidSymbol(symbol)) {
    return NextResponse.json({ error: `Unknown symbol ${symbol}` }, { status: 400 })
  }

  const meta = getSymbolMeta(symbol)
  const existing = await db.watchItem.findUnique({ where: { symbol } })
  if (existing) return NextResponse.json({ item: toDTO(existing), duplicate: true })

  const item = await db.watchItem.create({
    data: {
      symbol,
      market: meta.market,
      timeframe: String(body?.timeframe ?? '1h'),
      active: true,
    },
  })
  return NextResponse.json({ item: toDTO(item) })
}

// PATCH { symbol, active?, timeframe? } — update
export async function PATCH(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const symbol = String(body?.symbol ?? '').toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'symbol is required' }, { status: 400 })

  const data: any = {}
  if (typeof body.active === 'boolean') data.active = body.active
  if (typeof body.timeframe === 'string') data.timeframe = body.timeframe

  const item = await db.watchItem.update({ where: { symbol }, data })
  return NextResponse.json({ item: toDTO(item) })
}

// DELETE ?symbol=BTCUSDT — remove a pair
export async function DELETE(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  try {
    await db.watchItem.delete({ where: { symbol } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Watch item not found' }, { status: 404 })
  }
}
