import { NextRequest, NextResponse } from 'next/server'
import { analyzeSymbol } from '@/lib/analyst'
import { recordSignal } from '@/lib/scanner'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST { symbol, timeframe, source: 'manual' | 'scanner', force? }
// Runs the full ORACLE analysis pipeline and records the signal (notifications
// are only created for scanner-driven scans — manual deep-analyzes never
// notify, they're intentionally requested by the user).
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const symbol = String(body?.symbol ?? '').toUpperCase()
  const timeframe = String(body?.timeframe ?? '1h')
  const source = body?.source === 'scanner' ? 'scanner' : 'manual'
  const force = Boolean(body?.force) || source === 'scanner'
  if (!symbol) return NextResponse.json({ error: 'symbol is required' }, { status: 400 })

  try {
    const result = await analyzeSymbol(symbol, timeframe, { force })
    const { notification } = await recordSignal(result, source)
    return NextResponse.json({ result, notification })
  } catch (e) {
    console.error('[api/analysis] failed:', e)
    return NextResponse.json({ error: `Analysis failed: ${(e as Error).message}` }, { status: 500 })
  }
}

// GET /api/analysis?symbol=BTCUSDT&limit=20 — signal history
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase()
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 15)))
  const { db } = await import('@/lib/db')

  const records = await db.signalRecord.findMany({
    where: symbol ? { symbol } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    records: records.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      timeframe: r.timeframe,
      signal: r.signal,
      confidence: r.confidence,
      price: r.price,
      entry: r.entry,
      stopLoss: r.stopLoss,
      takeProfit1: r.takeProfit1,
      takeProfit2: r.takeProfit2,
      summary: r.summary,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    })),
  })
}
