import type { Candle, Ticker } from './types'
import { canonicalSymbol, getSymbolMeta, KRAKEN_FOREX_SYMBOLS } from './markets'
import { fetchKlines as fetchKlinesBinance, fetchTickers as fetchTickersBinance } from './binance'
import { fetchGoldKlines, fetchGoldTicker } from './gold'
import { isForexClosed } from './sessions'

// ─── Source-routing market data façade ───────────────────────────────────────
// Kraken-native forex symbols (GBPUSD…) → Kraken REST directly.
// Everything else → Binance mirror client (which has its own fallback chain).

const KRAKEN_HOST = 'https://api.kraken.com'

const KRAKEN_INTERVAL: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
  '1M': 1440, // no native monthly OHLC — daily candles aggregated into calendar months
}

const tickerCache = new Map<string, { map: Map<string, Ticker>; expires: number }>()

async function krakenJson(url: string, timeoutMs = 9000): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' }, cache: 'no-store' })
    const json = await res.json()
    if (json?.error && json.error.length > 0) throw new Error(String(json.error[0]))
    return json
  } finally {
    clearTimeout(timer)
  }
}

function krakenCandles(list: any[][]): Candle[] {
  const n = list.length
  return list.map((k, idx) => ({
    time: Math.floor(Number(k[0])),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[6]),
    closed: idx < n - 1,
  }))
}

// aggregate daily candles into calendar-month candles (for the 1M timeframe)
function aggregateMonthly(candles: Candle[]): Candle[] {
  const months = new Map<number, Candle>()
  for (const c of candles) {
    const d = new Date(c.time * 1000)
    const monthStart = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000)
    const cur = months.get(monthStart)
    if (!cur) {
      months.set(monthStart, {
        time: monthStart,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        closed: false,
      })
    } else {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volume += c.volume
    }
  }
  return [...months.values()].sort((a, b) => a.time - b.time)
}

async function fetchKrakenKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const iv = KRAKEN_INTERVAL[interval] ?? 60
  const json = await krakenJson(`${KRAKEN_HOST}/0/public/OHLC?pair=${symbol}&interval=${iv}`)
  const result = json?.result ?? {}
  const dataKey = Object.keys(result).find((k) => k !== 'last')
  const list = dataKey ? result[dataKey] : null
  if (!Array.isArray(list) || list.length < 5) throw new Error(`Kraken has no OHLC for ${symbol}`)
  let candles = krakenCandles(list)
  // staleness guard on the RAW candles (a month candle's timestamp is the month
  // start, not its last update — so check before aggregating). While the FX
  // market is closed for the weekend, Friday's close is the freshest data that
  // exists anywhere, so accept it.
  const rawInterval = interval === '1M' ? '1d' : interval
  const intervalSec = (KRAKEN_INTERVAL[rawInterval] ?? 60) * 60
  const maxAge = isForexClosed() ? 3.6 * 86400 : intervalSec * 2 + 600
  const lastAge = Date.now() / 1000 - candles[candles.length - 1].time
  if (lastAge > maxAge) throw new Error(`Kraken data stale for ${symbol}`)
  if (interval === '1M') candles = aggregateMonthly(candles)
  if (candles.length > limit) candles = candles.slice(-limit)
  return candles
}

async function fetchKrakenTicker(symbol: string): Promise<Ticker | null> {
  try {
    const json = await krakenJson(`${KRAKEN_HOST}/0/public/Ticker?pair=${symbol}`)
    const result = json?.result ?? {}
    const dataKey = Object.keys(result).find((k) => k !== 'last')
    const entry = dataKey ? result[dataKey] : null
    if (!entry?.c?.[0]) return null
    const price = Number(entry.c[0])
    const open = Number(entry.o)
    return {
      symbol,
      price,
      open,
      high: Number(entry.h?.[1] ?? price),
      low: Number(entry.l?.[1] ?? price),
      changePct: open > 0 ? ((price - open) / open) * 100 : 0,
      volume: Number(entry.v?.[1] ?? 0),
      quoteVolume: 0,
      eventTime: Date.now(),
    }
  } catch {
    return null
  }
}

// ── public façade used across the app ──

export async function fetchKlines(symbolInput: string, interval: string, limit = 300): Promise<Candle[]> {
  const symbol = canonicalSymbol(symbolInput)
  const meta = getSymbolMeta(symbol)
  if (meta.source === 'kraken') {
    return fetchKrakenKlines(symbol, interval, limit)
  }
  if (meta.source === 'gold') {
    return fetchGoldKlines(symbol, interval, limit)
  }
  return fetchKlinesBinance(symbol, interval, limit)
}

export async function fetchTickers(symbols: string[]): Promise<Map<string, Ticker>> {
  if (symbols.length === 0) return new Map()
  const upper = symbols.map((s) => canonicalSymbol(s))
  const cacheKey = upper.slice().sort().join(',')
  const hit = tickerCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.map

  const krakenSyms = upper.filter((s) => getSymbolMeta(s).source === 'kraken')
  const goldSyms = upper.filter((s) => getSymbolMeta(s).source === 'gold')
  const binanceSyms = upper.filter((s) => {
    const src = getSymbolMeta(s).source
    return src !== 'kraken' && src !== 'gold'
  })

  const [binanceMap, krakenMaps, goldTickers] = await Promise.all([
    binanceSyms.length > 0 ? fetchTickersBinance(binanceSyms) : Promise.resolve(new Map<string, Ticker>()),
    Promise.all(krakenSyms.map((s) => fetchKrakenTicker(s))),
    Promise.all(goldSyms.map(() => fetchGoldTicker())),
  ])

  const out = new Map(binanceMap)
  for (const t of krakenMaps) if (t) out.set(t.symbol, t)
  for (const t of goldTickers) if (t) out.set(t.symbol, t)

  if (out.size > 0) tickerCache.set(cacheKey, { map: out, expires: Date.now() + 10_000 })
  return out
}

export async function fetchTicker(symbol: string): Promise<Ticker | null> {
  const m = await fetchTickers([symbol])
  return m.get(canonicalSymbol(symbol)) ?? null
}

// all forex symbols (used by the hub to subscribe Kraken WS tickers)
export const FOREX_FOR_KRAKEN_WS = KRAKEN_FOREX_SYMBOLS
