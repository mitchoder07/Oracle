import type { Candle, Ticker } from './types'
import { fetchKlines as fetchKlinesBinance, fetchTicker as fetchTickerBinance } from './binance'
import { isMetalClosed } from './sessions'

// ─── Real spot gold (XAU/USD) market data ────────────────────────────────────
// Gold on this terminal is the REAL spot forex metal, not a crypto token.
//   • Live spot price, multi-source with automatic failover (a single dead
//     provider must never freeze the price silently):
//       1. gold-api.com (keyless, true XAU/USD spot, CORS-open)
//       2. COMEX gold futures (Yahoo, keyless) shifted by the tracked
//          spot-minus-futures basis: moves tick for tick with spot
//       3. PAXG token (Binance, keyless): real traded gold, 24/7
//     Every quote carries its age (asOf) and a stale flag so the UI can show
//     DELAYED instead of pretending a frozen number is live.
//   • Candle history, in order of preference:
//       1. Twelve Data XAU/USD (true spot candles) when TWELVE_DATA_API_KEY is
//          set (free key, 800 calls/day)
//       2. COMEX gold futures (Yahoo chart API, keyless) re-anchored to the
//          live spot price. Intraday the futures track spot tick for tick, so
//          the chart shape is exactly what a broker XAU/USD chart shows and
//          the levels sit at true spot because every candle is shifted by the
//          live spot-minus-futures basis.
//       3. PAXG token candles (Binance, keyless) re-anchored to spot. Only used
//          when both candle sources above fail, so a chart never dies.
//   • Session: spot gold closes Friday 17:00 ET and reopens Sunday 18:00 ET.
//     While closed, prices are frozen at Friday's close (like any broker).

const SPOT_API = 'https://api.gold-api.com/price/XAU'
const YAHOO_HOSTS = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com']
const TWELVE_API = 'https://api.twelvedata.com/time_series'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// a quote older than this while the market is open is treated as DELAYED
const STALE_AFTER_MS = 3 * 60_000
// typical spot-minus-front-month-futures carry, used until a real basis is learned
const DEFAULT_BASIS = -35

const INTERVAL_CFG: Record<string, { yahoo: string; range: string; sec: number; twelve: string }> = {
  '1m': { yahoo: '1m', range: '2d', sec: 60, twelve: '1min' },
  '5m': { yahoo: '5m', range: '15d', sec: 300, twelve: '5min' },
  '15m': { yahoo: '15m', range: '30d', sec: 900, twelve: '15min' },
  '30m': { yahoo: '30m', range: '60d', sec: 1800, twelve: '30min' },
  '1h': { yahoo: '60m', range: '120d', sec: 3600, twelve: '1h' },
  '4h': { yahoo: '60m', range: '240d', sec: 14400, twelve: '4h' }, // aggregated from 1h candles
  '1d': { yahoo: '1d', range: '2y', sec: 86400, twelve: '1day' },
  '1w': { yahoo: '1wk', range: '5y', sec: 604800, twelve: '1week' },
  '1M': { yahoo: '1mo', range: '10y', sec: 0, twelve: '1month' }, // month buckets handled separately
}

// ── spot price state: multi-source, failover, freshness-tracked ──
export interface GoldSpotState {
  price: number
  source: 'gold-api' | 'twelve-data' | 'comex-anchored' | 'paxg-anchored'
  asOf: number // epoch ms when the underlying quote was made
  marketOpen: boolean
  stale: boolean // old data while the market is open (UI shows DELAYED)
}

let spotState: GoldSpotState | null = null // last good state, any age
let spotFetchedAt = 0 // when the network was last consulted
const SPOT_TTL_MS = 8_000
// last known basis (spot - futures last close) so a failing spot API never
// shifts the whole chart to futures levels
let lastKnownBasis: number | null = null

// fallback quote caches (30s) so a down primary never hammers the fallbacks
let comexCache: { price: number; asOf: number; at: number } | null = null
let paxgCache: { price: number; asOf: number; at: number } | null = null
let twelveCache: { price: number; asOf: number; at: number } | null = null

async function fetchGoldApiSpot(timeoutMs: number): Promise<GoldSpotState | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(SPOT_API, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json()
    const price = Number(json?.price)
    if (!Number.isFinite(price) || price <= 0 || price < 500 || price > 20_000) return null
    const asOf = Date.parse(String(json?.updatedAt ?? ''))
    return {
      price,
      source: 'gold-api',
      asOf: Number.isFinite(asOf) ? asOf : Date.now(),
      marketOpen: !isMetalClosed(),
      stale: false,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Twelve Data XAU/USD spot (true spot; free key, limited quota). Cached 30s. */
async function fetchTwelveSpot(): Promise<{ price: number; asOf: number } | null> {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) return null
  if (twelveCache && Date.now() - twelveCache.at < 30_000) return twelveCache
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 7000)
  try {
    const res = await fetch(`${TWELVE_API.replace('time_series', 'price')}?symbol=XAU/USD&apikey=${key}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (res.ok) {
      const j = await res.json()
      const price = Number(j?.price)
      if (Number.isFinite(price) && price > 0) {
        const fresh = { price, asOf: Date.now(), at: Date.now() }
        twelveCache = fresh
        return fresh
      }
    }
  } catch { /* fall through */ } finally {
    clearTimeout(timer)
  }
  return twelveCache
}

/** Live COMEX front-month futures quote (Yahoo). Cached 30s. */
async function fetchComexFutures(): Promise<{ price: number; asOf: number } | null> {
  if (comexCache && Date.now() - comexCache.at < 30_000) return comexCache
  try {
    const r = await yahooChart('1m', '1d', 7000)
    const m = r?.meta ?? {}
    const price = Number(m.regularMarketPrice)
    const asOfSec = Number(m.regularMarketTime)
    if (Number.isFinite(price) && price > 0) {
      const fresh = { price, asOf: asOfSec > 0 ? asOfSec * 1000 : Date.now(), at: Date.now() }
      comexCache = fresh
      return fresh
    }
  } catch { /* fall through */ }
  return comexCache // serve the last quote we have rather than nothing
}

/** Live PAXG token price (Binance). Real traded gold, tracks spot closely. */
async function fetchPaxgSpot(): Promise<{ price: number; asOf: number } | null> {
  if (paxgCache && Date.now() - paxgCache.at < 30_000) return paxgCache
  try {
    const t = await fetchTickerBinance('PAXGUSDT')
    const price = Number(t?.price)
    if (Number.isFinite(price) && price > 0) {
      const fresh = { price, asOf: t?.eventTime || Date.now(), at: Date.now() }
      paxgCache = fresh
      return fresh
    }
  } catch { /* fall through */ }
  return paxgCache
}

/**
 * True spot XAU/USD with source + freshness. Tries gold-api first; if it is
 * unreachable (or serving an old quote while the market is open) it derives a
 * live price from COMEX futures minus the tracked basis, and finally from the
 * PAXG token. Never throws; returns null only when every source is dark.
 */
export async function fetchGoldSpotState(timeoutMs = 8000): Promise<GoldSpotState | null> {
  const now = Date.now()
  const marketOpen = !isMetalClosed()

  // small TTL so klines + ticker + spot route calls within one request
  // do not hit the upstream more than once
  if (spotState && now - spotFetchedAt < SPOT_TTL_MS) return spotState
  spotFetchedAt = now

  const primary = await fetchGoldApiSpot(timeoutMs)
  const primaryAge = primary ? now - primary.asOf : Infinity

  // 1) gold-api while fresh, or any time the market is closed (Friday's close
  //    is the freshest data that exists anywhere on a weekend)
  if (primary && (!marketOpen || primaryAge < STALE_AFTER_MS)) {
    primary.marketOpen = marketOpen
    primary.stale = marketOpen && primaryAge > 90_000
    spotState = primary
    return primary
  }

  // 1.5) Twelve Data true spot when a key is configured (spares its quota:
  //      only used while gold-api is dark)
  if (!(primary && (!marketOpen || primaryAge < STALE_AFTER_MS))) {
    const twelve = await fetchTwelveSpot()
    if (twelve && (!marketOpen || now - twelve.asOf < STALE_AFTER_MS)) {
      const state: GoldSpotState = {
        price: twelve.price,
        source: 'twelve-data',
        asOf: twelve.asOf,
        marketOpen,
        stale: marketOpen && now - twelve.asOf > 90_000,
      }
      spotState = state
      return state
    }
  }

  // 2) COMEX futures minus the tracked basis: still moves tick for tick with
  //    spot, so the price keeps updating while gold-api is dark
  const comex = await fetchComexFutures()
  if (comex) {
    let basis = lastKnownBasis
    if (primary) basis = primary.price - comex.price // freshest truth wins
    if (basis == null) {
      // PAXG teaches us the basis: token price sits at spot levels
      const paxg = await fetchPaxgSpot()
      if (paxg) basis = paxg.price - comex.price
    }
    const price = comex.price + (basis ?? DEFAULT_BASIS)
    const age = now - comex.asOf
    const state: GoldSpotState = {
      price,
      source: 'comex-anchored',
      asOf: comex.asOf,
      marketOpen,
      stale: marketOpen && age > STALE_AFTER_MS,
    }
    spotState = state
    return state
  }

  // 3) PAXG token directly (24/7 real traded gold)
  const paxg = await fetchPaxgSpot()
  if (paxg) {
    const age = now - paxg.asOf
    const state: GoldSpotState = {
      price: paxg.price,
      source: 'paxg-anchored',
      asOf: paxg.asOf,
      marketOpen,
      stale: marketOpen && age > STALE_AFTER_MS,
    }
    spotState = state
    return state
  }

  // 4) a stale gold-api quote beats no data at all, but it must be labelled
  if (primary) {
    primary.marketOpen = marketOpen
    primary.stale = true
    spotState = primary
    return primary
  }

  // 5) last known state for up to 12h (weekend freeze is handled by the
  //    market-closed flag, so this is a true outage case)
  if (spotState && now - spotState.asOf < 12 * 3_600_000) {
    spotState.marketOpen = marketOpen
    spotState.stale = marketOpen
    return spotState
  }
  return null
}

/** True spot price (number convenience wrapper). Throws when all sources are dark. */
export async function fetchGoldSpot(timeoutMs = 8000): Promise<number> {
  const s = await fetchGoldSpotState(timeoutMs)
  if (!s) throw new Error('gold spot unavailable (all sources failed)')
  return s.price
}

// ── candle cache: fresh hit, then stale-serve on upstream failure ──
const klineCache = new Map<string, { candles: Candle[]; at: number; provenance: string }>()
// generous TTLs: the browser keeps the last candle alive with live spot ticks,
// so server candles only need periodic refresh (also keeps Yahoo usage low)
const FRESH_MS: Record<string, number> = {
  '1m': 90_000, '5m': 150_000, '15m': 240_000, '30m': 300_000, '1h': 360_000,
  '4h': 600_000, '1d': 1_800_000, '1w': 3_600_000, '1M': 3_600_000,
}
const STALE_SERVE_MS = 12 * 3_600_000 // on failure, serve cache up to 12h old

async function yahooChart(interval: string, range: string, timeoutMs = 10_000): Promise<any> {
  let lastErr: unknown = null
  for (const host of YAHOO_HOSTS) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(
        `${host}/v8/finance/chart/GC%3DF?interval=${interval}&range=${range}`,
        { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' }, cache: 'no-store' }
      )
      if (!res.ok) throw new Error(`Yahoo ${host.includes('query2') ? 'query2' : 'query1'} HTTP ${res.status}`)
      const json = await res.json()
      const r = json?.chart?.result?.[0]
      if (!r || !Array.isArray(r.timestamp)) throw new Error('Yahoo returned no chart data')
      return r
    } catch (e) {
      lastErr = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Yahoo unreachable')
}

function snapToBucket(ts: number, sec: number): number {
  return sec > 0 ? Math.floor(ts / sec) * sec : ts
}

function monthStart(ts: number): number {
  const d = new Date(ts * 1000)
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000)
}

function weekStart(ts: number): number {
  // weeks start Monday 00:00 UTC (same convention as the crypto pairs)
  const DAY = 86400
  const WEEK = 7 * DAY
  const MON = 4 * DAY // epoch (Thu) + 4 days = first Monday
  return Math.floor((ts - MON) / WEEK) * WEEK + MON
}

/** Yahoo chart response → clean UTC-bucketed candles. */
function parseYahooCandles(r: any, interval: string): Candle[] {
  const ts: number[] = r.timestamp
  const q = r.indicators?.quote?.[0] ?? {}
  const o: (number | null)[] = q.open ?? []
  const h: (number | null)[] = q.high ?? []
  const l: (number | null)[] = q.low ?? []
  const c: (number | null)[] = q.close ?? []
  const v: (number | null)[] = q.volume ?? []

  const cfg = INTERVAL_CFG[interval]
  const raw: Candle[] = []
  for (let i = 0; i < ts.length; i++) {
    if (o[i] == null || h[i] == null || l[i] == null || c[i] == null) continue // session break
    raw.push({
      time: Math.floor(ts[i]),
      open: Number(o[i]),
      high: Number(h[i]),
      low: Number(l[i]),
      close: Number(c[i]),
      volume: v[i] != null ? Number(v[i]) : 0,
      closed: true,
    })
  }
  if (raw.length === 0) return raw

  // 4h candles: aggregate the 1h candles into UTC [0,4,8,12,16,20] buckets
  if (interval === '4h') {
    const agg: Candle[] = []
    for (const k of raw) {
      const bt = snapToBucket(k.time, 14400)
      const last = agg[agg.length - 1]
      if (!last || last.time !== bt) {
        agg.push({ time: bt, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, closed: true })
      } else {
        last.high = Math.max(last.high, k.high)
        last.low = Math.min(last.low, k.low)
        last.close = k.close
        last.volume += k.volume
      }
    }
    return agg
  }

  // snap timestamps onto clean UTC buckets (1w → Monday, 1M → month start)
  for (const k of raw) {
    k.time = interval === '1M' ? monthStart(k.time) : interval === '1w' ? weekStart(k.time) : snapToBucket(k.time, cfg.sec)
  }
  // de-dup after snapping (Yahoo sometimes repeats a bucket)
  const out: Candle[] = []
  for (const k of raw) {
    const last = out[out.length - 1]
    if (last && last.time === k.time) {
      last.high = Math.max(last.high, k.high)
      last.low = Math.min(last.low, k.low)
      last.close = k.close
      last.volume += k.volume
    } else {
      out.push(k)
    }
  }
  return out
}

/** Twelve Data XAU/USD (true spot candles, needs a free API key). */
async function fetchTwelveCandles(interval: string, limit: number): Promise<Candle[]> {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) throw new Error('no TWELVE_DATA_API_KEY')
  const cfg = INTERVAL_CFG[interval]
  const url = `${TWELVE_API}?symbol=XAU/USD&interval=${cfg.twelve}&outputsize=${Math.min(500, Math.max(100, limit))}&apikey=${key}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`)
    const json = await res.json()
    if (json?.status !== 'ok' || !Array.isArray(json?.values)) throw new Error(String(json?.message ?? 'Twelve Data error'))
    const out: Candle[] = []
    for (const row of json.values) {
      // datetimes are UTC; "2026-09-25 15:00:00" or with ISO T separator
      const m = String(row.datetime ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/)
      if (!m) continue
      const time = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000)
      const open = Number(row.open), high = Number(row.high), low = Number(row.low), close = Number(row.close)
      if (![open, high, low, close].every(Number.isFinite)) continue
      out.push({ time, open, high, low, close, volume: Number(row.volume) || 0, closed: true })
    }
    if (out.length < 5) throw new Error('Twelve Data series too short')
    out.sort((a, b) => a.time - b.time)
    return out
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Spot-anchored gold candles. The fetched series is shifted by the live
 * (spot - last close) basis so the whole chart sits at true spot levels and
 * the last candle's close IS the live spot price.
 */
export async function fetchGoldKlines(_symbol: string, interval: string, limit = 300): Promise<Candle[]> {
  const cfg = INTERVAL_CFG[interval]
  if (!cfg) throw new Error(`Unsupported gold timeframe ${interval}`)

  const freshMs = FRESH_MS[interval] ?? 60_000
  const hit = klineCache.get(interval)
  if (hit && Date.now() - hit.at < freshMs) return hit.candles.slice(-limit)
  // stale-serve guard: while the metals market is closed for the weekend,
  // Friday's close is the freshest data that exists anywhere
  const marketClosed = isMetalClosed()
  if (hit && marketClosed && Date.now() - hit.at < STALE_SERVE_MS) return hit.candles.slice(-limit)

  const spot = await fetchGoldSpot().catch(() => null)

  const finish = (candles: Candle[], provenance: string): Candle[] => {
    const futuresLast = candles[candles.length - 1].close
    if (spot !== null) lastKnownBasis = spot - futuresLast
    const basis = lastKnownBasis ?? DEFAULT_BASIS
    if (basis !== 0) {
      for (const k of candles) {
        k.open += basis
        k.high += basis
        k.low += basis
        k.close += basis
      }
    }
    // the last candle must quote the live spot exactly
    if (spot !== null) candles[candles.length - 1].close = spot
    if (candles.length > 400) candles = candles.slice(-400)
    for (let i = 0; i < candles.length; i++) candles[i].closed = i < candles.length - 1
    klineCache.set(interval, { candles, at: Date.now(), provenance })
    return candles.slice(-limit)
  }

  // 1) Twelve Data (true spot candles) when a key is configured
  if (process.env.TWELVE_DATA_API_KEY) {
    try {
      const candles = await fetchTwelveCandles(interval, limit)
      if (candles.length >= 5) return finish(candles, 'twelve-data spot')
    } catch (e) {
      console.error('[gold] Twelve Data failed:', (e as Error).message)
    }
  }

  // 2) COMEX futures via Yahoo, re-anchored to spot
  try {
    const r = await yahooChart(cfg.yahoo, cfg.range)
    const candles = parseYahooCandles(r, interval)
    if (candles.length >= 5) return finish(candles, 'COMEX-anchored')
  } catch (e) {
    console.error('[gold] Yahoo COMEX failed:', (e as Error).message)
  }

  // 3) last-resort: PAXG token candles re-anchored to live spot (keeps the
  //    chart alive with real traded data at spot levels when Yahoo is down)
  try {
    const candles = await fetchKlinesBinance('PAXGUSDT', interval, Math.max(limit, 300))
    if (candles.length >= 5) {
      console.warn('[gold] using PAXG-anchored fallback candles for', interval)
      return finish(candles, 'PAXG-anchored fallback')
    }
  } catch (e) {
    console.error('[gold] PAXG fallback failed:', (e as Error).message)
  }

  // 4) stale-serve whatever we have
  if (hit && Date.now() - hit.at < STALE_SERVE_MS) return hit.candles.slice(-limit)
  throw new Error('Spot gold data unavailable (all candle sources failed)')
}

/** Which source produced the current candle cache (for logging/telemetry). */
export function goldProvenance(interval: string): string | null {
  return klineCache.get(interval)?.provenance ?? null
}

/** Gold ticker for tape/watchlist: live spot price + daily stats + feed health. */
export async function fetchGoldTicker(): Promise<Ticker | null> {
  try {
    const state = await fetchGoldSpotState()
    if (!state) return null
    const spot = state.price
    const day = await fetchGoldKlines('XAUUSD', '1d', 2)
    const today = day[day.length - 1]
    const open = today?.open ?? spot
    const high = Math.max(today?.high ?? spot, spot)
    const low = Math.min(today?.low ?? spot, spot)
    return {
      symbol: 'XAUUSD',
      price: spot,
      open,
      high,
      low,
      changePct: open > 0 ? ((spot - open) / open) * 100 : 0,
      volume: today?.volume ?? 0,
      quoteVolume: 0,
      eventTime: Date.now(),
      meta: { source: state.source, asOf: state.asOf, stale: state.stale, marketOpen: state.marketOpen },
    }
  } catch {
    return null
  }
}
