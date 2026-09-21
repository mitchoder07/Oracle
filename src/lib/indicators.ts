import type { Candle, KeyLevels, TechnicalSnapshot } from './types'

// ─── Technical indicator engine (pure functions) ─────────────────────────────
// Feeds the AI analyst a dense, quantitative snapshot of any chart.

// ── moving averages ──
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  if (values.length < period) return values.map(() => null)
  const k = 2 / (period + 1)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = 0; i < period - 1; i++) out[i] = null
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

// ── RSI ──
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null]
  if (values.length <= period) return values.map(() => null)
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    const g = d > 0 ? d : 0
    const l = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

// ── MACD ──
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast)
  const emaSlow = ema(values, slow)
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  )
  const defined = macdLine.map((v) => (v === null ? 0 : v))
  const firstIdx = macdLine.findIndex((v) => v !== null)
  const signalRaw = ema(defined.slice(firstIdx), signalPeriod)
  const signalLine: (number | null)[] = values.map(() => null)
  for (let i = 0; i < signalRaw.length; i++) signalLine[firstIdx + i] = signalRaw[i]
  const hist = values.map((_, i) =>
    macdLine[i] !== null && signalLine[i] !== null
      ? (macdLine[i] as number) - (signalLine[i] as number)
      : null
  )
  return { macdLine, signalLine, hist }
}

// ── Bollinger Bands ──
export function bollinger(values: number[], period = 20, mult = 2) {
  const upper: (number | null)[] = []
  const mid: (number | null)[] = []
  const lower: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      upper.push(null); mid.push(null); lower.push(null)
      continue
    }
    const slice = values.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
    const sd = Math.sqrt(variance)
    mid.push(mean)
    upper.push(mean + mult * sd)
    lower.push(mean - mult * sd)
  }
  return { upper, mid, lower }
}

// ── ATR ──
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const trs: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low)
      continue
    }
    const prev = candles[i - 1].close
    trs.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prev),
        Math.abs(candles[i].low - prev)
      )
    )
  }
  const out: (number | null)[] = candles.map(() => null)
  if (candles.length < period) return out
  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period
    out[i] = prev
  }
  return out
}

// ── Stochastic ──
export function stochastic(candles: Candle[], kPeriod = 14, dPeriod = 3) {
  const k: (number | null)[] = candles.map(() => null)
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1)
    const hh = Math.max(...slice.map((c) => c.high))
    const ll = Math.min(...slice.map((c) => c.low))
    k[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100
  }
  const d: (number | null)[] = candles.map(() => null)
  for (let i = 0; i < candles.length; i++) {
    const slice = k.slice(Math.max(0, i - dPeriod + 1), i + 1).filter((v): v is number => v !== null)
    if (slice.length === dPeriod) d[i] = slice.reduce((a, b) => a + b, 0) / dPeriod
  }
  return { k, d }
}

// ── OBV slope (normalized) ──
export function obvSlope(candles: Candle[], lookback = 30): number | null {
  if (candles.length < lookback + 1) return null
  const slice = candles.slice(-lookback - 1)
  let obv = 0
  const series: number[] = [0]
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].close > slice[i - 1].close) obv += slice[i].volume
    else if (slice[i].close < slice[i - 1].close) obv -= slice[i].volume
    series.push(obv)
  }
  // linear regression slope
  const n = series.length
  const xs = series.map((_, i) => i)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = series.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (series[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  if (den === 0) return 0
  const avgVol = slice.reduce((a, c) => a + c.volume, 0) / slice.length || 1
  return num / den / avgVol // volume-normalized slope
}

// ── swing points → structure + S/R levels ──
interface Swing {
  index: number
  price: number
  type: 'high' | 'low'
}

export function findSwings(candles: Candle[], strength = 3): Swing[] {
  const swings: Swing[] = []
  for (let i = strength; i < candles.length - strength; i++) {
    const window = candles.slice(i - strength, i + strength + 1)
    const isHigh = candles[i].high === Math.max(...window.map((c) => c.high))
    const isLow = candles[i].low === Math.min(...window.map((c) => c.low))
    if (isHigh) swings.push({ index: i, price: candles[i].high, type: 'high' })
    else if (isLow) swings.push({ index: i, price: candles[i].low, type: 'low' })
  }
  return swings
}

export function marketStructure(candles: Candle[]): string {
  const swings = findSwings(candles).slice(-6)
  const highs = swings.filter((s) => s.type === 'high').slice(-3)
  const lows = swings.filter((s) => s.type === 'low').slice(-3)
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1].price > highs[highs.length - 2].price
    const hl = lows[lows.length - 1].price > lows[lows.length - 2].price
    const lh = highs[highs.length - 1].price < highs[highs.length - 2].price
    const ll = lows[lows.length - 1].price < lows[lows.length - 2].price
    if (hh && hl) return 'HH/HL (uptrend structure)'
    if (lh && ll) return 'LH/LL (downtrend structure)'
    if (hh && ll) return 'expanding range'
    return 'range / consolidation'
  }
  return 'insufficient data'
}

export function keyLevels(candles: Candle[], price: number): KeyLevels {
  const swings = findSwings(candles)
  const recent = swings.filter((s) => s.index > candles.length - 120)
  const support = recent
    .filter((s) => s.type === 'low' && s.price < price)
    .map((s) => s.price)
    .sort((a, b) => b - a)
    .slice(0, 3)
  const resistance = recent
    .filter((s) => s.type === 'high' && s.price > price)
    .map((s) => s.price)
    .sort((a, b) => a - b)
    .slice(0, 3)
  return { support, resistance }
}

// ── RSI divergence over last N swings ──
export function rsiDivergence(candles: Candle[], rsiSeries: (number | null)[]): string | null {
  const n = candles.length
  if (n < 30) return null
  const window = 40
  const swings = findSwings(candles.slice(-window), 2)
  if (swings.length < 2) return null
  const offset = n - window
  const lows = swings.filter((s) => s.type === 'low').slice(-2)
  const highs = swings.filter((s) => s.type === 'high').slice(-2)

  if (lows.length === 2) {
    const [a, b] = lows
    const ra = rsiSeries[offset + a.index]
    const rb = rsiSeries[offset + b.index]
    if (ra !== null && rb !== null && b.price < a.price && rb > ra + 1.5) return 'bullish (price LL, RSI HL)'
  }
  if (highs.length === 2) {
    const [a, b] = highs
    const ra = rsiSeries[offset + a.index]
    const rb = rsiSeries[offset + b.index]
    if (ra !== null && rb !== null && b.price > a.price && rb < ra - 1.5) return 'bearish (price HH, RSI LH)'
  }
  return null
}

// ── candlestick pattern detection (last 4 candles) ──
export function detectPatterns(candles: Candle[]): string[] {
  const found: string[] = []
  const n = candles.length
  if (n < 4) return found
  const c = candles[n - 1]
  const p = candles[n - 2]
  const p2 = candles[n - 3]
  const body = Math.abs(c.close - c.open)
  const range = c.high - c.low || 1e-12
  const bodyPct = body / range
  const upperWick = c.high - Math.max(c.open, c.close)
  const lowerWick = Math.min(c.open, c.close) - c.low
  const pBody = Math.abs(p.close - p.open)

  if (bodyPct < 0.1) found.push('doji (indecision)')
  if (lowerWick > body * 2 && upperWick < body * 0.8 && bodyPct < 0.4) found.push('hammer (bullish rejection)')
  if (upperWick > body * 2 && lowerWick < body * 0.8 && bodyPct < 0.4) found.push('shooting star (bearish rejection)')
  if (c.close > c.open && p.close < p.open && c.close > p.open && c.open < p.close && body > pBody)
    found.push('bullish engulfing')
  if (c.close < c.open && p.close > p.open && c.close < p.open && c.open > p.close && body > pBody)
    found.push('bearish engulfing')
  if (
    p2.close < p2.open && // first red
    Math.abs(p.close - p.open) < pBody * 0.4 && // middle small body
    c.close > c.open && // last green
    c.close > (p2.open + p2.close) / 2
  )
    found.push('morning star (bullish reversal)')
  if (
    p2.close > p2.open &&
    Math.abs(p.close - p.open) < Math.abs(p2.close - p2.open) * 0.4 &&
    c.close < c.open &&
    c.close < (p2.open + p2.close) / 2
  )
    found.push('evening star (bearish reversal)')

  const last3 = candles.slice(-3)
  if (last3.every((x) => x.close > x.open) && last3[2].close > last3[1].close && last3[1].close > last3[0].close)
    found.push('three consecutive green candles')
  if (last3.every((x) => x.close < x.open) && last3[2].close < last3[1].close && last3[1].close < last3[0].close)
    found.push('three consecutive red candles')

  return found
}

// ── trend bias from candles (used for HTF confluence) ──
export function trendBias(candles: Candle[]): string | null {
  if (candles.length < 50) return null
  const closes = candles.map((c) => c.close)
  const e20 = ema(closes, 20)
  const e50 = ema(closes, 50)
  const i = closes.length - 1
  if (e20[i] === null || e50[i] === null) return null
  const price = closes[i]
  if (price > (e20[i] as number) && (e20[i] as number) > (e50[i] as number)) return 'bullish'
  if (price < (e20[i] as number) && (e20[i] as number) < (e50[i] as number)) return 'bearish'
  return 'mixed'
}

// ─── Master snapshot builder ─────────────────────────────────────────────────
export function buildSnapshot(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  ticker: { changePct: number; high: number; low: number; quoteVolume: number } | null,
  htfCandles: Candle[] | null,
  btcChange: number | null
): TechnicalSnapshot {
  const closes = candles.map((c) => c.close)
  const vols = candles.map((c) => c.volume)
  const n = closes.length
  const price = closes[n - 1] ?? 0

  const e20 = ema(closes, 20)
  const e50 = ema(closes, 50)
  const e200 = ema(closes, 200)
  const rsiSeries = rsi(closes, 14)
  const { macdLine, signalLine, hist } = macd(closes)
  const bb = bollinger(closes, 20, 2)
  const atrSeries = atr(candles, 14)
  const stoch = stochastic(candles)
  const i = n - 1

  const ema50 = e50[i]
  const rsiNow = rsiSeries[i]
  const rsiPrev = rsiSeries[i - 1]
  const macdNow = macdLine[i]
  const macdSig = signalLine[i]
  const histNow = hist[i]
  const histPrev = hist[i - 1] ?? null
  const bbU = bb.upper[i]
  const bbL = bb.lower[i]
  const bbM = bb.mid[i]
  const atrNow = atrSeries[i]

  const avgVol20 = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 || 1
  const relVol = vols[i] / avgVol20
  const volTrend =
    vols.slice(-5).reduce((a, b) => a + b, 0) / 5 > vols.slice(-15, -5).reduce((a, b) => a + b, 0) / 10
      ? 'rising'
      : 'falling'

  // squeeze: current bandwidth in bottom 20% of last 100 bandwidths
  let bbSqueeze = false
  let bbPosition: number | null = null
  if (bbU !== null && bbL !== null && bbM !== null) {
    const band = bbU - bbL || 1e-12
    bbPosition = (price - bbL) / band
    const widths: number[] = []
    for (let j = Math.max(0, i - 100); j <= i; j++) {
      if (bb.upper[j] !== null && bb.lower[j] !== null)
        widths.push((bb.upper[j] as number) - (bb.lower[j] as number))
    }
    if (widths.length > 20) {
      widths.sort((a, b) => a - b)
      const pct20 = widths[Math.floor(widths.length * 0.2)]
      bbSqueeze = band <= pct20
    }
  }

  let macdCross: string | null = null
  if (histNow !== null && histPrev !== null) {
    if (histPrev <= 0 && histNow > 0) macdCross = 'bullish crossover'
    else if (histPrev >= 0 && histNow < 0) macdCross = 'bearish crossover'
  }

  const rsiZone =
    rsiNow === null
      ? 'n/a'
      : rsiNow > 70
        ? 'overbought'
        : rsiNow < 30
          ? 'oversold'
          : rsiNow > 55
            ? 'bullish'
            : rsiNow < 45
              ? 'bearish'
              : 'neutral'

  return {
    symbol,
    timeframe,
    price,
    change24h: ticker?.changePct ?? 0,
    high24h: ticker?.high ?? 0,
    low24h: ticker?.low ?? 0,
    volume24h: ticker?.quoteVolume ?? 0,
    trend: {
      ema20: e20[i],
      ema50,
      ema200: e200[i],
      priceVsEma50: ema50 ? ((price - ema50) / ema50) * 100 : null,
      ema20Above50: e20[i] !== null && ema50 !== null ? (e20[i] as number) > ema50 : null,
      ema50Above200: e50[i] !== null && e200[i] !== null ? (e50[i] as number) > (e200[i] as number) : null,
      structure: marketStructure(candles),
      htfTrend: htfCandles ? trendBias(htfCandles) : null,
    },
    momentum: {
      rsi: rsiNow,
      rsiPrev,
      rsiZone,
      rsiDivergence: rsiDivergence(candles, rsiSeries),
      macd: macdNow,
      macdSignal: macdSig,
      macdHist: histNow,
      macdHistPrev: histPrev,
      macdCross,
      stochastic: stoch.k[i],
      stochK: stoch.k[i],
      stochD: stoch.d[i],
    },
    volatility: {
      atr: atrNow,
      atrPct: atrNow ? (atrNow / price) * 100 : null,
      bbUpper: bbU,
      bbLower: bbL,
      bbMid: bbM,
      bbPosition,
      bbSqueeze,
    },
    volume: {
      lastVsAvg: Number.isFinite(relVol) ? relVol : null,
      trend: volTrend,
      obvSlope: obvSlope(candles),
    },
    patterns: detectPatterns(candles),
    keyLevels: keyLevels(candles, price),
    recentCandles: candles.slice(-24).map((c) => ({
      time: c.time,
      o: +c.open.toFixed(6),
      h: +c.high.toFixed(6),
      l: +c.low.toFixed(6),
      c: +c.close.toFixed(6),
      v: +c.volume.toFixed(2),
    })),
    btcContext: btcChange === null ? null : { change24h: btcChange },
  }
}

// ─── Rules-based fallback signal (used if the LLM is unreachable) ────────────
export function rulesSignal(snap: TechnicalSnapshot): {
  signal: 'LONG' | 'SHORT' | 'KEEP_OFF'
  confidence: number
  rationale: string[]
} {
  let score = 0
  const why: string[] = []

  if (snap.trend.ema20Above50) { score += 2; why.push('EMA20 above EMA50 (short-term uptrend)') }
  else if (snap.trend.ema20Above50 === false) { score -= 2; why.push('EMA20 below EMA50 (short-term downtrend)') }

  if (snap.trend.ema50Above200) { score += 2; why.push('EMA50 above EMA200 (long-term uptrend)') }
  else if (snap.trend.ema50Above200 === false) { score -= 2; why.push('EMA50 below EMA200 (long-term downtrend)') }

  if (snap.trend.structure.startsWith('HH/HL')) { score += 2; why.push(snap.trend.structure) }
  else if (snap.trend.structure.startsWith('LH/LL')) { score -= 2; why.push(snap.trend.structure) }

  if (snap.trend.htfTrend === 'bullish') { score += 1; why.push('Higher-timeframe trend is bullish') }
  else if (snap.trend.htfTrend === 'bearish') { score -= 1; why.push('Higher-timeframe trend is bearish') }

  if (snap.momentum.rsi !== null) {
    if (snap.momentum.rsiZone === 'oversold') { score += 2; why.push(`RSI ${snap.momentum.rsi.toFixed(1)} oversold`) }
    else if (snap.momentum.rsiZone === 'overbought') { score -= 2; why.push(`RSI ${snap.momentum.rsi.toFixed(1)} overbought`) }
    else if (snap.momentum.rsiZone === 'bullish') { score += 1; why.push(`RSI ${snap.momentum.rsi.toFixed(1)} in bullish zone`) }
    else if (snap.momentum.rsiZone === 'bearish') { score -= 1; why.push(`RSI ${snap.momentum.rsi.toFixed(1)} in bearish zone`) }
  }

  if (snap.momentum.macdCross === 'bullish crossover') { score += 2; why.push('MACD bullish crossover') }
  else if (snap.momentum.macdCross === 'bearish crossover') { score -= 2; why.push('MACD bearish crossover') }
  else if ((snap.momentum.macdHist ?? 0) > 0) { score += 1; why.push('MACD histogram positive') }
  else if ((snap.momentum.macdHist ?? 0) < 0) { score -= 1; why.push('MACD histogram negative') }

  if (snap.momentum.rsiDivergence?.startsWith('bullish')) { score += 2; why.push(`RSI divergence ${snap.momentum.rsiDivergence}`) }
  if (snap.momentum.rsiDivergence?.startsWith('bearish')) { score -= 2; why.push(`RSI divergence ${snap.momentum.rsiDivergence}`) }

  if (snap.volume.lastVsAvg !== null && snap.volume.lastVsAvg > 1.5 && score > 0)
    why.push(`Volume ${snap.volume.lastVsAvg.toFixed(1)}x above average confirms momentum`)

  const signal = score >= 3 ? 'LONG' : score <= -3 ? 'SHORT' : 'KEEP_OFF'
  const confidence = Math.min(85, Math.max(20, Math.round(40 + Math.abs(score) * 6)))
  if (signal === 'KEEP_OFF')
    why.push('Mixed or conflicting signals — rules engine recommends standing aside')
  return { signal, confidence, rationale: why }
}
