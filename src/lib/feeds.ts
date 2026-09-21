// ─── OracleFeeds — browser-direct realtime market feeds + scanner client ──────
// Replaces the old socket.io hub for deployments where no long-running process
// exists (Vercel serverless). The browser connects DIRECTLY to the exchanges:
//   • Binance market-data WS (data-stream.binance.vision) → crypto + gold ticks
//     and dynamic kline streams (both allow browser connections, no auth)
//   • Kraken WS v2 → fiat forex ticks + live OHLC candles (+ month aggregation)
// The auto-scanner runs through /api/scanner/step: this client pings it every
// 60s while the terminal is open; the serverless route decides if a scan is due
// and returns any notifications it produced.
// Exposes a socket.io-shaped event surface (on/off/emit) so the UI components
// keep working unchanged: events 'ticks', 'kline', 'scanner:status',
// 'signal:new', 'connect', 'disconnect', 'hub:hello'; emits 'chart:subscribe',
// 'chart:unsubscribe', 'scan:run'.

import { SYMBOL_UNIVERSE } from './markets'
import type { NotificationItem } from './types'

type Handler = (payload: any) => void

const BINANCE_WS = 'wss://data-stream.binance.vision'
const KRAKEN_WS = 'wss://ws.kraken.com/v2'
const KRAKEN_REST = 'https://api.kraken.com'

const BINANCE_UNIVERSE = new Set(SYMBOL_UNIVERSE.filter((s) => s.source === 'binance').map((s) => s.symbol))
const KRAKEN_FOREX: Record<string, string> = Object.fromEntries(
  SYMBOL_UNIVERSE.filter((s) => s.source === 'kraken' && s.krakenWs).map((s) => [s.symbol, s.krakenWs as string])
)
const WS_SYMBOL_TO_INTERNAL: Map<string, string> = new Map(
  Object.entries(KRAKEN_FOREX).map(([internal, wsSym]) => [wsSym, internal] as [string, string])
)

const KRAKEN_INTERVAL: Record<string, number> = {
  '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080,
}
const INTERVAL_BY_MIN: Record<number, string> = {
  1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', 1440: '1d', 10080: '1w',
}
const ALLOWED_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M']

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class OracleFeeds {
  private handlers = new Map<string, Set<Handler>>()

  // ── Binance state ──
  private bws: WebSocket | null = null
  private binanceKlineSubs = new Map<string, number>() // "btcusdt@kline_1h" -> refcount
  private bwsBackoff = 1000
  private bwsReconnectTimer: any = null
  private bwsStreamChangeTimer: any = null

  // ── Kraken state ──
  private kws: WebSocket | null = null
  private krakenOhlcSubs = new Map<string, number>() // "EURUSD:1h" -> refcount
  private krakenMonthSubs = new Map<string, number>() // "EURUSD" -> refcount (1M charts)
  private kwsBackoff = 1000
  private kwsReconnectTimer: any = null
  private monthAgg = new Map<string, MonthAgg>()

  // ── tick throttle (Kraken) ──
  private forexTickState = new Map<string, any>()
  private forexEmitTimer: any = null

  // ── scanner client ──
  private scannerTimer: any = null
  private scanRunning = false
  private started = false
  private statusTimer: any = null

  // ══════ event surface (socket.io-shaped) ══════
  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler)
  }

  private dispatch(event: string, payload?: any) {
    const set = this.handlers.get(event)
    if (!set) return
    for (const h of set) {
      try { h(payload) } catch { /* handler errors must not kill the feed */ }
    }
  }

  emit(event: string, payload?: any) {
    if (event === 'chart:subscribe') return this.chartSubscribe(payload)
    if (event === 'chart:unsubscribe') return this.chartUnsubscribe(payload)
    if (event === 'scan:run') return this.triggerScan(true)
    // unknown/local echo — ignore
  }

  // ══════ lifecycle ══════
  start() {
    if (this.started) return
    this.started = true
    this.connectBinance()
    this.connectKraken()
    this.startScannerLoop()

    // mobile browsers suspend sockets in background — revive on focus
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('online', this.onOnline)
  }

  stop() {
    this.started = false
    try { this.bws?.close() } catch { /* noop */ }
    try { this.kws?.close() } catch { /* noop */ }
    if (this.bwsReconnectTimer) clearTimeout(this.bwsReconnectTimer)
    if (this.kwsReconnectTimer) clearTimeout(this.kwsReconnectTimer)
    if (this.bwsStreamChangeTimer) clearTimeout(this.bwsStreamChangeTimer)
    if (this.scannerTimer) clearInterval(this.scannerTimer)
    if (this.statusTimer) clearTimeout(this.statusTimer)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('online', this.onOnline)
  }

  private onVisibility = () => {
    if (document.visibilityState !== 'visible') return
    if (!this.started) return
    const bDead = !this.bws || this.bws.readyState === WebSocket.CLOSED
    const kDead = !this.kws || this.kws.readyState === WebSocket.CLOSED
    if (bDead) { this.bwsBackoff = 500; this.connectBinance() }
    if (kDead) { this.kwsBackoff = 500; this.connectKraken() }
  }

  private onOnline = () => this.onVisibility()

  // ══════ Binance: ticks + klines ══════
  private binanceStreams(): string[] {
    return ['!miniTicker@arr', ...this.binanceKlineSubs.keys()]
  }

  private connectBinance() {
    if (!this.started) return
    try { this.bws?.close() } catch { /* noop */ } // never two sockets
    const streams = this.binanceStreams()
    if (streams.length === 0) return
    const url = `${BINANCE_WS}/stream?streams=${streams.join('/')}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.scheduleBinanceReconnect()
      return
    }
    this.bws = ws

    ws.onopen = () => {
      this.bwsBackoff = 1000
      this.dispatch('connect', { source: 'binance' })
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string)
        const stream: string = msg.stream ?? ''
        const data = msg.data

        if (stream === '!miniTicker@arr' && Array.isArray(data)) {
          const ticks = data
            .filter((t: any) => BINANCE_UNIVERSE.has(t.s))
            .map((t: any) => ({
              symbol: t.s,
              price: +t.c,
              open: +t.o,
              high: +t.h,
              low: +t.l,
              changePct: t.o !== '0' ? ((+t.c - +t.o) / +t.o) * 100 : 0,
              volume: +t.v,
              quoteVolume: +t.q,
              eventTime: t.E,
            }))
          if (ticks.length > 0) this.dispatch('ticks', { ts: Date.now(), ticks })
          return
        }

        if (data && data.e === 'kline') {
          const k = data.k
          if (this.binanceKlineSubs.has(`${data.s.toLowerCase()}@kline_${k.i}`)) {
            this.dispatch('kline', {
              symbol: data.s,
              interval: k.i,
              candle: {
                time: Math.floor(k.t / 1000),
                open: +k.o,
                high: +k.h,
                low: +k.l,
                close: +k.c,
                volume: +k.v,
                closed: Boolean(k.x),
              },
            })
          }
        }
      } catch { /* malformed frame */ }
    }

    ws.onclose = () => {
      // only react if THIS socket is still the current one (a replaced socket
      // closing must not trigger a duplicate reconnect chain)
      if (this.bws === ws) {
        this.bws = null
        this.dispatch('disconnect', { source: 'binance' })
        this.scheduleBinanceReconnect()
      }
    }

    ws.onerror = () => {
      try { ws.close() } catch { /* noop */ }
    }
  }

  private scheduleBinanceReconnect() {
    if (this.bwsReconnectTimer || !this.started) return
    this.bwsReconnectTimer = setTimeout(() => {
      this.bwsReconnectTimer = null
      this.connectBinance()
    }, this.bwsBackoff)
    this.bwsBackoff = Math.min(this.bwsBackoff * 2, 30000)
  }

  private applyBinanceStreamChange() {
    if (this.bwsStreamChangeTimer) clearTimeout(this.bwsStreamChangeTimer)
    this.bwsStreamChangeTimer = setTimeout(() => {
      this.bwsStreamChangeTimer = null
      try { this.bws?.close() } catch { /* noop */ }
      if (!this.bws) this.scheduleBinanceReconnect()
    }, 1500)
  }

  // ══════ Kraken: forex ticks + OHLC + month aggregation ══════
  private connectKraken() {
    if (!this.started) return
    try { this.kws?.close() } catch { /* noop */ } // never two sockets
    let ws: WebSocket
    try {
      ws = new WebSocket(KRAKEN_WS)
    } catch {
      this.scheduleKrakenReconnect()
      return
    }
    this.kws = ws

    ws.onopen = () => {
      this.kwsBackoff = 1000
      this.dispatch('connect', { source: 'kraken' })
      for (const msg of this.krakenSubscribeMessages()) this.krakenSend(ws, JSON.parse(msg))
    }

    ws.onmessage = (ev) => {
      let msg: any
      try {
        msg = JSON.parse(ev.data as string)
      } catch { return }
      if (msg.channel === 'heartbeat') return

      if (msg.channel === 'ticker' && Array.isArray(msg.data)) {
        for (const d of msg.data) {
          const internal = WS_SYMBOL_TO_INTERNAL.get(d.symbol)
          if (!internal || typeof d.last !== 'number') continue
          this.queueForexTick({
            symbol: internal,
            price: d.last,
            open: d.change_pct !== undefined && d.last !== 0 ? d.last / (1 + d.change_pct / 100) : d.last,
            high: d.high ?? d.last,
            low: d.low ?? d.last,
            changePct: d.change_pct ?? 0,
            volume: d.volume ?? 0,
            quoteVolume: d.volume ?? 0,
            eventTime: Date.now(),
          })
        }
        return
      }

      if (msg.channel === 'ohlc' && Array.isArray(msg.data)) {
        for (const d of msg.data) {
          const internal = WS_SYMBOL_TO_INTERNAL.get(d.symbol)
          if (!internal) continue
          const interval = INTERVAL_BY_MIN[d.interval] ?? '1h'
          if (this.krakenOhlcSubs.has(`${internal}:${interval}`)) {
            const begin = d.interval_begin
              ? Math.floor(new Date(d.interval_begin).getTime() / 1000)
              : Math.floor(Date.now() / 1000)
            this.dispatch('kline', {
              symbol: internal,
              interval,
              candle: {
                time: begin,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume ?? 0,
                closed: false,
              },
            })
          }
          // daily candles drive the live monthly aggregation for 1M charts
          if (d.interval === 1440 && this.krakenMonthSubs.has(internal)) {
            const dayTime = d.interval_begin
              ? Math.floor(new Date(d.interval_begin).getTime() / 1000)
              : Math.floor(Date.now() / 86400) * 86400
            this.applyDailyToMonth(internal, dayTime, d.open, d.high, d.low, d.close, d.volume ?? 0)
            this.emitMonthCandle(internal)
          }
        }
      }
    }

    ws.onclose = () => {
      if (this.kws === ws) {
        this.kws = null
        this.dispatch('disconnect', { source: 'kraken' })
        this.scheduleKrakenReconnect()
      }
    }

    ws.onerror = () => {
      try { ws.close() } catch { /* noop */ }
    }
  }

  private scheduleKrakenReconnect() {
    if (this.kwsReconnectTimer || !this.started) return
    this.kwsReconnectTimer = setTimeout(() => {
      this.kwsReconnectTimer = null
      this.connectKraken()
    }, this.kwsBackoff)
    this.kwsBackoff = Math.min(this.kwsBackoff * 2, 30000)
  }

  private krakenSend(ws: WebSocket, obj: any) {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
    } catch { /* noop */ }
  }

  private krakenSubscribeMessages(): string[] {
    const msgs: string[] = []
    msgs.push(JSON.stringify({
      method: 'subscribe',
      params: { channel: 'ticker', symbol: Object.values(KRAKEN_FOREX) },
    }))
    const dailySymbols = new Set<string>()
    for (const [key] of this.krakenOhlcSubs) {
      const [symbol, interval] = key.split(':')
      if (interval === '1d') {
        dailySymbols.add(symbol)
        continue
      }
      const wsSym = KRAKEN_FOREX[symbol]
      const iv = KRAKEN_INTERVAL[interval]
      if (wsSym && iv) {
        msgs.push(JSON.stringify({ method: 'subscribe', params: { channel: 'ohlc', symbol: [wsSym], interval: iv } }))
      }
    }
    for (const symbol of this.krakenMonthSubs.keys()) dailySymbols.add(symbol)
    for (const symbol of dailySymbols) {
      const wsSym = KRAKEN_FOREX[symbol]
      if (wsSym) {
        msgs.push(JSON.stringify({ method: 'subscribe', params: { channel: 'ohlc', symbol: [wsSym], interval: 1440 } }))
      }
    }
    return msgs
  }

  private queueForexTick(tick: any) {
    this.forexTickState.set(tick.symbol, tick)
    if (!this.forexEmitTimer) {
      this.forexEmitTimer = setTimeout(() => {
        this.forexEmitTimer = null
        const ticks = [...this.forexTickState.values()]
        this.forexTickState.clear()
        if (ticks.length > 0) this.dispatch('ticks', { ts: Date.now(), ticks })
      }, 500)
    }
  }

  // ── monthly aggregation (Kraken has no 1M channel) ──
  private monthStartOf(tsSec: number): number {
    const d = new Date(tsSec * 1000)
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000)
  }

  private applyDailyToMonth(
    symbol: string, dayTime: number, open: number, high: number, low: number, close: number, volume: number
  ) {
    const ms = this.monthStartOf(dayTime)
    let agg = this.monthAgg.get(symbol)
    if (!agg || agg.time !== ms) {
      agg = { time: ms, open, high, low, close, volume, dayTime, dayVol: volume }
      this.monthAgg.set(symbol, agg)
    } else if (agg.dayTime === dayTime) {
      agg.volume += volume - agg.dayVol
      agg.dayVol = volume
      agg.high = Math.max(agg.high, high)
      agg.low = Math.min(agg.low, low)
      agg.close = close
    } else {
      agg.volume += volume
      agg.dayVol = volume
      agg.dayTime = dayTime
      agg.high = Math.max(agg.high, high)
      agg.low = Math.min(agg.low, low)
      agg.close = close
    }
  }

  private emitMonthCandle(symbol: string) {
    const agg = this.monthAgg.get(symbol)
    if (!agg || this.krakenMonthSubs.get(symbol) === 0) return
    this.dispatch('kline', {
      symbol,
      interval: '1M',
      candle: {
        time: agg.time,
        open: agg.open,
        high: agg.high,
        low: agg.low,
        close: agg.close,
        volume: agg.volume,
        closed: false,
      },
    })
  }

  private async seedMonthAgg(symbol: string) {
    try {
      const wsSym = KRAKEN_FOREX[symbol]
      if (!wsSym) return
      const res = await fetch(`${KRAKEN_REST}/0/public/OHLC?pair=${encodeURIComponent(wsSym)}&interval=1440`)
      const json = await res.json()
      const result = json?.result ?? {}
      const dataKey = Object.keys(result).find((k) => k !== 'last')
      const list = dataKey ? result[dataKey] : null
      if (!Array.isArray(list) || list.length === 0) return
      const currentMonth = this.monthStartOf(Math.floor(Number(list[list.length - 1][0])))
      let agg: MonthAgg | null = null
      for (const k of list) {
        const t = Math.floor(Number(k[0]))
        if (this.monthStartOf(t) !== currentMonth) continue
        const o = Number(k[1]), h = Number(k[2]), l = Number(k[3]), c = Number(k[4]), v = Number(k[6])
        if (!agg) {
          agg = { time: currentMonth, open: o, high: h, low: l, close: c, volume: v, dayTime: t, dayVol: v }
        } else {
          agg.high = Math.max(agg.high, h)
          agg.low = Math.min(agg.low, l)
          agg.close = c
          agg.volume += v
          agg.dayTime = t
          agg.dayVol = v
        }
      }
      if (agg) {
        this.monthAgg.set(symbol, agg)
        this.emitMonthCandle(symbol)
      }
    } catch { /* best-effort seed */ }
  }

  // ══════ chart subscriptions ══════
  private chartSubscribe(payload: any) {
    const symbol = String(payload?.symbol ?? '').toUpperCase()
    const interval = String(payload?.interval ?? '1h')
    if (!symbol || !ALLOWED_INTERVALS.includes(interval)) return

    if (KRAKEN_FOREX[symbol]) {
      if (interval === '1M') {
        const prev = this.krakenMonthSubs.get(symbol) ?? 0
        this.krakenMonthSubs.set(symbol, prev + 1)
        if (prev === 0) {
          if (!this.krakenOhlcSubs.has(`${symbol}:1d`)) {
            this.krakenSend(this.kws!, { method: 'subscribe', params: { channel: 'ohlc', symbol: [KRAKEN_FOREX[symbol]], interval: 1440 } })
          }
          this.seedMonthAgg(symbol).catch(() => {})
        }
      } else {
        const key = `${symbol}:${interval}`
        const prev = this.krakenOhlcSubs.get(key) ?? 0
        this.krakenOhlcSubs.set(key, prev + 1)
        if (prev === 0) {
          const iv = KRAKEN_INTERVAL[interval]
          if (iv) this.krakenSend(this.kws!, { method: 'subscribe', params: { channel: 'ohlc', symbol: [KRAKEN_FOREX[symbol]], interval: iv } })
        }
      }
      return
    }

    if (!/^[A-Z0-9]{5,15}$/.test(symbol)) return
    const key = `${symbol.toLowerCase()}@kline_${interval}`
    const prev = this.binanceKlineSubs.get(key) ?? 0
    this.binanceKlineSubs.set(key, prev + 1)
    if (prev === 0) this.applyBinanceStreamChange()
  }

  private chartUnsubscribe(payload: any) {
    const symbol = String(payload?.symbol ?? '').toUpperCase()
    const interval = String(payload?.interval ?? '1h')
    if (!symbol) return

    if (KRAKEN_FOREX[symbol]) {
      if (interval === '1M') {
        const prev = this.krakenMonthSubs.get(symbol) ?? 0
        if (prev <= 1) {
          this.krakenMonthSubs.delete(symbol)
          this.monthAgg.delete(symbol)
          if (!this.krakenOhlcSubs.has(`${symbol}:1d`)) {
            this.krakenSend(this.kws!, { method: 'unsubscribe', params: { channel: 'ohlc', symbol: [KRAKEN_FOREX[symbol]], interval: 1440 } })
          }
        } else {
          this.krakenMonthSubs.set(symbol, prev - 1)
        }
        return
      }
      const key = `${symbol}:${interval}`
      const prev = this.krakenOhlcSubs.get(key) ?? 0
      if (prev <= 1) {
        this.krakenOhlcSubs.delete(key)
        const iv = KRAKEN_INTERVAL[interval]
        if (iv) this.krakenSend(this.kws!, { method: 'unsubscribe', params: { channel: 'ohlc', symbol: [KRAKEN_FOREX[symbol]], interval: iv } })
      } else {
        this.krakenOhlcSubs.set(key, prev - 1)
      }
      return
    }

    const key = `${symbol.toLowerCase()}@kline_${interval}`
    const prev = this.binanceKlineSubs.get(key) ?? 0
    if (prev <= 1) {
      this.binanceKlineSubs.delete(key)
      this.applyBinanceStreamChange()
    } else {
      this.binanceKlineSubs.set(key, prev - 1)
    }
  }

  // ══════ scanner client (serverless-friendly) ══════
  private startScannerLoop() {
    const tick = async () => {
      try {
        await this.callScannerStep(false)
      } catch { /* network hiccup — next tick retries */ }
    }
    // first check shortly after boot (lets the first scan warm up)
    this.scannerTimer = setInterval(tick, 60_000)
    this.statusTimer = setTimeout(tick, 8_000)
  }

  async triggerScan(force = true) {
    if (this.scanRunning) return
    await this.callScannerStep(force)
  }

  private async callScannerStep(force: boolean) {
    if (this.scanRunning && force) return
    this.scanRunning = true
    this.dispatch('scanner:status', { running: true })
    try {
      const res = await fetch('/api/scanner/step', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-oracle-client': 'web' },
        body: JSON.stringify({ force }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data?.status) {
        this.dispatch('scanner:status', {
          ...data.status,
          running: Boolean(data.status.running),
        })
      }
      if (Array.isArray(data?.notifications)) {
        for (const n of data.notifications) {
          if (n?.title) this.dispatch('signal:new', n as NotificationItem)
        }
      }
    } catch {
      this.dispatch('scanner:status', { running: false })
    } finally {
      this.scanRunning = false
    }
  }
}

interface MonthAgg {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  dayTime: number
  dayVol: number
}

// singleton — the whole app shares one set of exchange sockets
let instance: OracleFeeds | null = null

export function getOracleFeeds(): OracleFeeds {
  if (!instance) instance = new OracleFeeds()
  return instance
}
