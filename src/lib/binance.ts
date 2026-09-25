import type { Candle, Ticker } from './types'
import { isForexClosed } from './sessions'

// ─── Market data client (multi-source, ban-resilient) ────────────────────────
// Primary:  Binance public market-data mirror (data-api.binance.vision).
//           The sandbox's shared IP gets intermittently rate-limit banned by
//           Binance REST, so we parse the "banned until" timestamp and fail
//           over to other venues during the ban window. WebSockets are never
//           affected — charts stay live regardless.
// Fallbacks: Kraken (crypto USDT pairs + real fiat forex + gold) → Bybit → OKX.

const BINANCE_HOST = 'https://data-api.binance.vision'
const KRAKEN_HOST = 'https://api.kraken.com'
const BYBIT_HOST = 'https://api.bybit.com'
const OKX_HOST = 'https://www.okx.com'

const INTERVAL_MAP: Record<string, { binance: string; bybit: string; okx: string; kraken: number }> = {
  '1m': { binance: '1m', bybit: '1', okx: '1m', kraken: 1 },
  '5m': { binance: '5m', bybit: '5', okx: '5m', kraken: 5 },
  '15m': { binance: '15m', bybit: '15', okx: '15m', kraken: 15 },
  '1h': { binance: '1h', bybit: '60', okx: '1H', kraken: 60 },
  '4h': { binance: '4h', bybit: '240', okx: '4H', kraken: 240 },
  '1d': { binance: '1d', bybit: 'D', okx: '1D', kraken: 1440 },
  '1w': { binance: '1w', bybit: 'W', okx: '1W', kraken: 10080 },
  // Kraken has no native monthly OHLC — we aggregate daily candles (1440)
  '1M': { binance: '1M', bybit: 'M', okx: '1M', kraken: 1440 },
}

// Binance symbol → Kraken pair (fiat forex pairs have dedicated mappings)
const KRAKEN_PAIR_MAP: Record<string, string> = {
  EURUSDT: 'EURUSD',
  EURUSDC: 'EURUSD',
  GBPUSDT: 'GBPUSD',
  AUDUSDT: 'AUDUSD',
}

// ── ban tracking ──
let binanceBannedUntil = 0

function binanceOk(): boolean {
  return Date.now() > binanceBannedUntil
}

function noteBanned(body: string) {
  const m = /until (\d{13})/.exec(body)
  const until = m ? Number(m[1]) + 3000 : Date.now() + 3 * 60_000
  if (until > binanceBannedUntil) binanceBannedUntil = until
}

// ── tiny fetch wrapper with timeout + retry ──
async function fetchText(url: string, timeoutMs = 9000, retries = 1): Promise<string> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`)
      return text
    } catch (e) {
      lastErr = e
      if (i < retries) await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function fetchJson(url: string, timeoutMs = 9000, retries = 1): Promise<any> {
  return JSON.parse(await fetchText(url, timeoutMs, retries))
}

// ── in-memory cache ──
interface CacheEntry<T> {
  data: T
  expires: number
}
const cache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): T | null {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data as T
  if (hit) cache.delete(key)
  return null
}

function setCached<T>(key: string, data: T, ttlMs: number) {
  cache.set(key, { data, expires: Date.now() + ttlMs })
  if (cache.size > 800) {
    const now = Date.now()
    for (const [k, v] of cache) if (v.expires < now) cache.delete(k)
  }
}

// REST history staleness is fine — the WS kline stream keeps charts live.
function klineTtl(interval: string): number {
  switch (interval) {
    case '1m': return 15_000
    case '5m': return 60_000
    case '15m': return 3 * 60_000
    case '1h': return 5 * 60_000
    case '4h': return 15 * 60_000
    case '1d': return 30 * 60_000
    case '1w': return 2 * 3_600_000
    case '1M': return 6 * 3_600_000
    default: return 60_000
  }
}

// ── normalizers ──
function fromBinanceKlines(raw: any[]): Candle[] {
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
    closed: true,
  }))
}

function fromBybitKlines(raw: any[]): Candle[] {
  return raw
    .map((k: any[]) => ({
      time: Math.floor(+k[0] / 1000),
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
      closed: true,
    }))
    .sort((a, b) => a.time - b.time)
}

function fromOkxCandles(raw: any[][]): Candle[] {
  return raw
    .map((k) => ({
      time: Math.floor(+k[0] / 1000),
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
      closed: String(k[8]) === '1',
    }))
    .sort((a, b) => a.time - b.time)
}

function fromKrakenOhlc(raw: any[][]): Candle[] {
  const n = raw.length
  return raw.map((k, idx) => ({
    time: Math.floor(+k[0]),
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[6],
    closed: idx < n - 1, // last candle is still forming
  }))
}

// ── staleness guard: delisted pairs return ancient candles — reject them ──
// While the FX market is closed for the weekend, Friday's close is the freshest
// possible data, so the guard relaxes to ~3.6 days instead of 2 intervals.
const INTERVAL_SEC: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
  '1M': 2592000,
}

function isFresh(candles: Candle[], interval: string, maxAgeOverride?: number): boolean {
  if (candles.length === 0) return false
  const intervalSec = INTERVAL_SEC[interval] ?? 3600
  const maxAge = maxAgeOverride ?? intervalSec * 2 + 600
  const lastAge = Date.now() / 1000 - candles[candles.length - 1].time
  return lastAge < maxAge
}

// ── aggregate daily candles into calendar-month candles (Kraken 1M) ──
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

// ── klines: Binance mirror → Kraken → Bybit → OKX ──
export async function fetchKlines(symbol: string, interval: string, limit = 300): Promise<Candle[]> {
  const key = `kl:${symbol}:${interval}:${limit}`
  const hit = getCached<Candle[]>(key)
  if (hit) return hit

  const iv = INTERVAL_MAP[interval] ?? INTERVAL_MAP['1h']
  const sym = symbol.toUpperCase()
  let lastError = 'no source attempted'

  // 1) Binance market-data mirror (skipped while the shared IP is banned)
  if (binanceOk()) {
    try {
      const raw = await fetchJson(
        `${BINANCE_HOST}/api/v3/klines?symbol=${sym}&interval=${iv.binance}&limit=${limit}`
      )
      if (Array.isArray(raw) && raw.length > 0) {
        const candles = fromBinanceKlines(raw)
        if (isFresh(candles, interval)) {
          setCached(key, candles, klineTtl(interval))
          return candles
        }
        lastError = 'binance: stale data (delisted pair?)'
      }
    } catch (e: any) {
      lastError = `binance: ${e.message}`
      if (String(e.message).includes('-1003') || String(e.message).toLowerCase().includes('banned')) {
        try {
          noteBanned(String(e.message))
        } catch { /* noop */ }
      }
    }
  } else {
    lastError = `binance banned until ${new Date(binanceBannedUntil).toISOString()}`
  }

  // 2) Kraken — crypto USDT pairs, real fiat forex (EURUSD/GBPUSD/AUDUSD), gold.
  //    No native monthly OHLC: fetch daily and aggregate into calendar months.
  try {
    const krakenPair = KRAKEN_PAIR_MAP[sym] ?? sym
    const raw = await fetchJson(`${KRAKEN_HOST}/0/public/OHLC?pair=${krakenPair}&interval=${iv.kraken}`)
    const result = raw?.result ?? {}
    const dataKey = Object.keys(result).find((k) => k !== 'last')
    const list = dataKey ? result[dataKey] : null
    if (Array.isArray(list) && list.length > 5) {
      let candles = fromKrakenOhlc(list)
      // staleness on the RAW candles (monthly aggregation shifts the timestamp
      // to the month start, which would false-positive as stale); forex weekend:
      // Friday's close is the freshest data that exists
      const rawInterval = interval === '1M' ? '1d' : interval
      const maxAge = isForexClosed() ? 3.6 * 86400 : undefined
      if (isFresh(candles, rawInterval, maxAge)) {
        if (interval === '1M') candles = aggregateMonthly(candles)
        if (candles.length > limit) candles = candles.slice(-limit)
        setCached(key, candles, klineTtl(interval))
        return candles
      }
      lastError = 'kraken: stale data'
    }
  } catch (e: any) {
    lastError = `kraken: ${e.message}`
  }

  // 3) Bybit spot
  try {
    const raw = await fetchJson(
      `${BYBIT_HOST}/v5/market/kline?category=spot&symbol=${sym}&interval=${iv.bybit}&limit=${Math.min(limit, 1000)}`
    )
    const list = raw?.result?.list
    if (Array.isArray(list) && list.length > 0) {
      const candles = fromBybitKlines(list)
      if (isFresh(candles, interval)) {
        setCached(key, candles, klineTtl(interval))
        return candles
      }
      lastError = 'bybit: stale data'
    }
  } catch (e: any) {
    lastError = `bybit: ${e.message}`
  }

  // 4) OKX spot (base-quote with dash)
  try {
    const base = sym.replace(/USDT$|USDC$/, '')
    const quote = sym.endsWith('USDC') ? 'USDC' : 'USDT'
    const raw = await fetchJson(
      `${OKX_HOST}/api/v5/market/candles?instId=${base}-${quote}&bar=${iv.okx}&limit=${Math.min(limit, 300)}`
    )
    if (Array.isArray(raw?.data) && raw.data.length > 0) {
      const candles = fromOkxCandles(raw.data)
      if (isFresh(candles, interval)) {
        setCached(key, candles, klineTtl(interval))
        return candles
      }
      lastError = 'okx: stale data'
    }
  } catch (e: any) {
    lastError = `okx: ${e.message}`
  }

  throw new Error(`No data source could serve ${sym} ${interval} (${lastError})`)
}

// ── tickers ──
export async function fetchTickers(symbols: string[]): Promise<Map<string, Ticker>> {
  const out = new Map<string, Ticker>()
  if (symbols.length === 0) return out
  const upper = symbols.map((s) => s.toUpperCase())

  const cacheKey = `tk:${upper.slice().sort().join(',')}`
  const hit = getCached<Map<string, Ticker>>(cacheKey)
  if (hit) return hit

  if (binanceOk()) {
    try {
      const query = encodeURIComponent(JSON.stringify(upper))
      const raw = await fetchJson(`${BINANCE_HOST}/api/v3/ticker/24hr?symbols=${query}`)
      if (Array.isArray(raw)) {
        for (const t of raw) {
          out.set(t.symbol, {
            symbol: t.symbol,
            price: +t.lastPrice,
            open: +t.openPrice,
            high: +t.highPrice,
            low: +t.lowPrice,
            changePct: +t.priceChangePercent,
            volume: +t.volume,
            quoteVolume: +t.quoteVolume,
            eventTime: Date.now(),
          })
        }
      }
    } catch (e: any) {
      if (String(e.message).includes('-1003') || String(e.message).toLowerCase().includes('banned')) {
        noteBanned(String(e.message))
      }
    }
  }

  // Kraken fallback for anything Binance didn't serve (per-symbol: Kraken
  // result keys use canonical names that don't always match the request)
  const missing = upper.filter((s) => !out.has(s))
  await Promise.all(
    missing.map(async (sym) => {
      try {
        const krakenPair = KRAKEN_PAIR_MAP[sym] ?? sym
        const raw = await fetchJson(`${KRAKEN_HOST}/0/public/Ticker?pair=${krakenPair}`, 8000, 0)
        const result = raw?.result ?? {}
        const dataKey = Object.keys(result).find((k) => k !== 'last')
        const entry = dataKey ? result[dataKey] : null
        if (entry?.c?.[0]) {
          const price = +entry.c[0]
          const open = +entry.o
          out.set(sym, {
            symbol: sym,
            price,
            open,
            high: +entry.h?.[1],
            low: +entry.l?.[1],
            changePct: open > 0 ? ((price - open) / open) * 100 : 0,
            volume: +entry.v?.[1],
            quoteVolume: 0,
            eventTime: Date.now(),
          })
        }
      } catch { /* best-effort per symbol */ }
    })
  )

  if (out.size > 0) setCached(cacheKey, out, 10_000)
  return out
}

export async function fetchTicker(symbol: string): Promise<Ticker | null> {
  const m = await fetchTickers([symbol])
  return m.get(symbol.toUpperCase()) ?? null
}
