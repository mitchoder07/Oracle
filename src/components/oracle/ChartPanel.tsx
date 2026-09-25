'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from 'lightweight-charts'
import { Activity, BarChart3, MoonStar, TrendingUp } from 'lucide-react'
import { useTerminal, changeColor } from './store'
import { getOracleFeeds } from '@/lib/feeds'
import { ema } from '@/lib/indicators'
import { formatPrice, getSymbolMeta, TIMEFRAMES } from '@/lib/markets'
import { getMarketSession } from '@/lib/sessions'
import type { AnalysisResult, Candle } from '@/lib/types'
import { cn } from '@/lib/utils'

// ─── Live candlestick chart with EMA/volume overlays + AI signal levels ──────

interface Props {
  analysis: AnalysisResult | null
  analyzing: boolean
}

// ── local-time axis labels (the library defaults to UTC; users expect their
//    own wall-clock time, exactly like TradingView's local timezone setting) ──
const pad2 = (n: number) => String(n).padStart(2, '0')

function localTickMarkFormatter(time: UTCTimestamp, tickMarkType: TickMarkType, _locale: string): string {
  const d = new Date(time * 1000) // interpreted in the browser's local timezone
  switch (tickMarkType) {
    case TickMarkType.Year:
      return String(d.getFullYear())
    case TickMarkType.Month:
      return d.toLocaleString(undefined, { month: 'short' })
    case TickMarkType.DayOfMonth:
      return `${d.toLocaleString(undefined, { month: 'short' })} ${d.getDate()}`
    case TickMarkType.Time:
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    case TickMarkType.TimeWithSeconds:
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    default:
      return d.toLocaleString(undefined)
  }
}

function localTimeFormatter(time: UTCTimestamp): string {
  const d = new Date(time * 1000)
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Browser timezone label for the footer, e.g. "UTC+1" (Lagos) or "UTC-4". */
function browserTzLabel(): string {
  const off = -new Date().getTimezoneOffset() / 60
  const rounded = Math.round(off * 10) / 10
  return `UTC${rounded >= 0 ? '+' : '-'}${Math.abs(rounded)}`
}

export function ChartPanel({ analysis, analyzing }: Props) {
  const symbol = useTerminal((s) => s.selectedSymbol)
  const timeframe = useTerminal((s) => s.timeframe)
  const setTimeframe = useTerminal((s) => s.setTimeframe)
  const ticks = useTerminal((s) => s.ticks)
  const selectSymbol = useTerminal((s) => s.selectSymbol)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])
  const lastCandleRef = useRef<Candle | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showEma, setShowEma] = useState(true)
  const [showVol, setShowVol] = useState(true)
  const [tzLabel, setTzLabel] = useState<string | null>(null)
  const [, setClockTick] = useState(0)

  const meta = getSymbolMeta(symbol)
  const tick = ticks[symbol]

  // compute the browser timezone label client-side only (the server's timezone
  // would differ from the visitor's, which would break hydration)
  useEffect(() => {
    setTzLabel(browserTzLabel())
  }, [])

  // refresh market-session state (open/closed) every 30s
  useEffect(() => {
    const t = setInterval(() => setClockTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const session = getMarketSession(meta.market)

  // ── create chart once ──
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a1a1aa',
        fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(63, 63, 70, 0.25)' },
        horzLines: { color: 'rgba(63, 63, 70, 0.25)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#52525b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#09090b' },
        horzLine: { color: '#52525b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#09090b' },
      },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        tickMarkFormatter: localTickMarkFormatter,
      },
      localization: {
        timeFormatter: localTimeFormatter,
      },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    })
    chartRef.current = chart

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceLineVisible: false,
      lastValueVisible: true,
    })
    candleRef.current = candles

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      priceLineVisible: false,
      lastValueVisible: false,
    })
    volumeRef.current = volume
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    const ema20 = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    ema20Ref.current = ema20

    const ema50 = chart.addSeries(LineSeries, {
      color: '#a78bfa',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    ema50Ref.current = ema50

    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        chart.applyOptions({ width: Math.max(width, 100), height: Math.max(height, 200) })
      }
    })
    resize.observe(containerRef.current)

    return () => {
      resize.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      ema20Ref.current = null
      ema50Ref.current = null
      priceLinesRef.current = []
    }
  }, [])

  // ── load data when symbol / timeframe changes ──
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    // NOTE: use the feeds singleton directly — oracleSocket.current is not yet
    // populated during first mount (child effects run before the parent's
    // useOracleSocket effect), which would silently skip live-candle
    // subscriptions until the user switched pairs.
    const socket = getOracleFeeds()
    if (socket) {
      socket.emit('chart:unsubscribe', { symbol: prevSymbol.current, interval: prevTf.current })
      socket.emit('chart:subscribe', { symbol, interval: timeframe })
    }
    prevSymbol.current = symbol
    prevTf.current = timeframe

    ;(async () => {
      try {
        const res = await fetch(`/api/market/klines?symbol=${symbol}&interval=${timeframe}&limit=300`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || data?.error) throw new Error(data?.error ?? `HTTP ${res.status}`)
        const candles: Candle[] = data.candles
        if (!Array.isArray(candles) || candles.length === 0) throw new Error('No candle data')

        const series = candleRef.current!
        series.setData(
          candles.map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
        )
        volumeRef.current!.setData(
          candles.map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)',
          }))
        )

        // EMA overlays
        const closes = candles.map((c) => c.close)
        const e20 = ema(closes, 20)
        const e50 = ema(closes, 50)
        ema20Ref.current!.setData(
          candles.map((c, i) => ({ time: c.time as UTCTimestamp, value: e20[i] })).filter((p) => p.value !== null)
        )
        ema50Ref.current!.setData(
          candles.map((c, i) => ({ time: c.time as UTCTimestamp, value: e50[i] })).filter((p) => p.value !== null)
        )

        lastCandleRef.current = candles[candles.length - 1]
        chartRef.current?.timeScale().fitContent()
        setLoading(false)
      } catch (e: any) {
        if (cancelled) return
        setError(e.message ?? 'Failed to load chart')
        setLoading(false)
      }
    })()

    // live candle updates
    const soc = getOracleFeeds()
    const onKline = (payload: any) => {
      if (payload?.symbol !== symbol || payload?.interval !== timeframe) return
      const c = payload.candle
      if (!c || !candleRef.current || !volumeRef.current) return
      candleRef.current.update({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })
      volumeRef.current.update({
        time: c.time as UTCTimestamp,
        value: c.volume ?? 0,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)',
      })
      lastCandleRef.current = c
    }
    soc?.on('kline', onKline)

    return () => {
      cancelled = true
      soc?.off('kline', onKline)
      getOracleFeeds().emit('chart:unsubscribe', { symbol, interval: timeframe })
    }
  }, [symbol, timeframe])

  const prevSymbol = useRef(symbol)
  const prevTf = useRef(timeframe)

  // ── toggle EMA / volume visibility ──
  useEffect(() => {
    ema20Ref.current?.applyOptions({ visible: showEma })
    ema50Ref.current?.applyOptions({ visible: showEma })
    volumeRef.current?.applyOptions({ visible: showVol })
  }, [showEma, showVol, loading])

  // ── draw AI signal price lines ──
  useEffect(() => {
    const series = candleRef.current
    if (!series) return
    for (const line of priceLinesRef.current) {
      try { series.removePriceLine(line) } catch { /* noop */ }
    }
    priceLinesRef.current = []
    if (!analysis) return

    const add = (price: number | null | undefined, color: string, title: string, style: number) => {
      if (price === null || price === undefined || !Number.isFinite(price)) return
      priceLinesRef.current.push(
        series.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: style,
          axisLabelVisible: true,
          title,
        })
      )
    }

    if (analysis.ai.signal !== 'KEEP_OFF') {
      add(analysis.ai.entry, '#10b981', 'Entry', LineStyle.Solid)
      add(analysis.ai.stopLoss, '#ef4444', 'SL', LineStyle.Dashed)
      add(analysis.ai.takeProfit1, '#34d399', 'TP1', LineStyle.Dashed)
      add(analysis.ai.takeProfit2, '#6ee7b7', 'TP2', LineStyle.Dotted)
    }
    for (const s of analysis.ai.keyLevels.support.slice(0, 2)) add(s, '#52525b', 'S', LineStyle.Dotted)
    for (const r of analysis.ai.keyLevels.resistance.slice(0, 2)) add(r, '#71717a', 'R', LineStyle.Dotted)
  }, [analysis])

  const rangePct = useMemo(() => {
    if (!tick?.high || !tick?.low) return null
    return ((tick.high - tick.low) / tick.low) * 100
  }, [tick])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50">
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800/70 px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="num text-sm font-bold text-zinc-50">{meta.displaySymbol}</h2>
          <span className="hidden max-w-40 truncate text-[11px] text-zinc-500 sm:block">{meta.name}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'num text-lg font-bold tracking-tight',
              tick ? changeColor(tick.changePct) : 'text-zinc-200'
            )}
          >
            {tick ? formatPrice(tick.price, meta.tickDigits) : '—'}
          </span>
          {tick && (
            <span className={cn('num text-xs font-semibold', changeColor(tick.changePct))}>
              {tick.changePct > 0 ? '+' : ''}
              {tick.changePct.toFixed(2)}%
            </span>
          )}
          {analyzing && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <Activity className="h-3 w-3 animate-pulse" aria-hidden="true" /> ORACLE thinking…
            </span>
          )}
        </div>
        {tick && rangePct !== null && (
          <div className="num hidden text-[10px] text-zinc-500 md:block">
            24h H <span className="text-zinc-300">{formatPrice(tick.high, meta.tickDigits)}</span> · L{' '}
            <span className="text-zinc-300">{formatPrice(tick.low, meta.tickDigits)}</span> ·{' '}
            {rangePct.toFixed(2)}% range
          </div>
        )}
        {/* market session chip */}
        {(meta.market === 'FOREX' || meta.market === 'METAL') && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              session.open
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
            )}
            title={session.detail}
          >
            {!session.open && <MoonStar className="h-3 w-3" aria-hidden="true" />}
            {meta.market === 'FOREX' ? `FX ${session.label}` : session.label}
          </span>
        )}
        <div className="flex-1" />
        {/* timeframe buttons */}
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={cn(
                'num rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                tf.value === timeframe
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
              aria-pressed={tf.value === timeframe}
            >
              {tf.label}
            </button>
          ))}
        </div>
        {/* toggles */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowEma((v) => !v)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors',
              showEma ? 'bg-zinc-800 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
            )}
            title="Toggle EMA 20/50"
            aria-pressed={showEma}
          >
            <TrendingUp className="h-3 w-3" /> EMA
          </button>
          <button
            onClick={() => setShowVol((v) => !v)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors',
              showVol ? 'bg-zinc-800 text-emerald-400' : 'text-zinc-600 hover:text-zinc-400'
            )}
            title="Toggle volume"
            aria-pressed={showVol}
          >
            <BarChart3 className="h-3 w-3" /> VOL
          </button>
        </div>
      </div>

      {/* market-closed banner */}
      {!session.open && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.07] px-3 py-1.5 text-[11px] text-amber-300/90">
          <MoonStar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {meta.market === 'METAL'
              ? `Spot gold (XAU/USD) is closed for the weekend (${session.detail}). Prices are frozen at Friday's close, just like on a broker's gold chart. Weekend gap risk applies.`
              : `The FX market is closed for the weekend, so prices are Friday's close. ${session.detail}. Weekend gap risk applies.`}
          </span>
        </div>
      )}

      {/* chart area */}
      <div className="relative min-h-[340px] flex-1 sm:min-h-[420px]">
        <div ref={containerRef} className="absolute inset-0" aria-label={`${meta.displaySymbol} candlestick chart`} />
        {/* real-data provenance badge: every candle comes straight from the market */}
        <div
          className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-zinc-950/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 backdrop-blur-sm"
          title={
            meta.source === 'gold'
              ? 'Real spot gold. The live price is the true XAU/USD spot rate; candle history is COMEX gold re-anchored to spot, so levels match a broker gold chart. Nothing on this chart is simulated.'
              : meta.source === 'kraken'
                ? 'Real exchange data streamed live from Kraken. The same prices you would see on the exchange\u2019s own website. Nothing on this chart is simulated.'
                : 'Real exchange data streamed live from Binance. The same prices you would see on the exchange\u2019s own website. Nothing on this chart is simulated.'
          }
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          LIVE · {meta.source === 'gold' ? 'Spot XAU/USD' : meta.source === 'kraken' ? 'Kraken' : 'Binance'}
        </div>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              Loading {meta.displaySymbol} · {timeframe}…
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-xs text-red-400">{error}</p>
            <p className="max-w-sm text-[11px] text-zinc-500">
              Market data is temporarily unreachable from this region. Live WebSocket feeds may still be running. Try
              again shortly.
            </p>
            <button
              onClick={() => setTimeframe(timeframe === '1h' ? '4h' : '1h')}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-400"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* footer legend */}
      <div className="flex items-center gap-4 border-t border-zinc-800/70 px-3 py-1.5 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded bg-amber-400" /> EMA20
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded bg-purple-400" /> EMA50
        </span>
        <span className="hidden sm:inline">
          {session.open
            ? meta.source === 'gold'
              ? 'Real spot gold, updating in realtime'
              : 'Real exchange data, updating in realtime'
            : meta.market === 'METAL'
              ? 'Spot market closed. Prices are frozen at Friday\u2019s close'
              : 'Market closed. Candles are frozen at Friday\u2019s close'}
        </span>
        {tzLabel && <span className="hidden md:inline text-zinc-600">· Times shown in your timezone ({tzLabel})</span>}
        <div className="flex-1" />
        <span className="num">{symbol} · {timeframe}</span>
      </div>
    </div>
  )
}
