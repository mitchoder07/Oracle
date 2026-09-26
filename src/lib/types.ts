// ─── Shared types for TradeOracle AI ──────────────────────────────────────────

export type MarketCategory = 'CRYPTO' | 'FOREX' | 'METAL'

export interface SymbolMeta {
  symbol: string          // e.g. BTCUSDT / GBPUSD / XAUUSD
  base: string            // e.g. BTC
  quote: string           // e.g. USDT
  name: string            // e.g. Bitcoin
  market: MarketCategory
  displaySymbol: string   // e.g. BTC/USDT or EUR/USD or XAU/USD
  tickDigits: number      // decimals for price display
  source: 'binance' | 'kraken' | 'gold'
  krakenWs?: string       // Kraken WS v2 symbol, e.g. "GBP/USD"
}

export interface Candle {
  time: number   // unix seconds (open time)
  open: number
  high: number
  low: number
  close: number
  volume: number
  closed: boolean
}

export interface Ticker {
  symbol: string
  price: number
  open: number
  high: number
  low: number
  changePct: number
  volume: number
  quoteVolume: number
  eventTime: number
  /** Feed health metadata (gold spot feed): where the quote came from and how old it is. */
  meta?: { source: string; asOf: number; stale: boolean; marketOpen: boolean }
}

export type SignalType = 'LONG' | 'SHORT' | 'KEEP_OFF'

export interface KeyLevels {
  support: number[]
  resistance: number[]
}

export interface TechnicalSnapshot {
  symbol: string
  timeframe: string
  price: number
  change24h: number
  high24h: number
  low24h: number
  volume24h: number
  trend: {
    ema20: number | null
    ema50: number | null
    ema200: number | null
    priceVsEma50: number | null      // % distance
    ema20Above50: boolean | null
    ema50Above200: boolean | null
    structure: string                 // 'HH/HL' | 'LH/LL' | 'range'
    htfTrend: string | null           // 4h/daily trend bias for confluence
  }
  momentum: {
    rsi: number | null
    rsiPrev: number | null
    rsiZone: string                   // overbought | oversold | bullish | bearish | neutral
    rsiDivergence: string | null      // 'bullish' | 'bearish' | null
    macd: number | null
    macdSignal: number | null
    macdHist: number | null
    macdHistPrev: number | null
    macdCross: string | null          // 'bullish' | 'bearish' | null
    stochastic: number | null
    stochK: number | null
    stochD: number | null
  }
  volatility: {
    atr: number | null
    atrPct: number | null             // ATR as % of price
    bbUpper: number | null
    bbLower: number | null
    bbMid: number | null
    bbPosition: number | null         // 0 = lower band, 1 = upper band
    bbSqueeze: boolean
  }
  volume: {
    lastVsAvg: number | null          // relative volume (x)
    trend: string                     // rising | falling | flat
    obvSlope: number | null
  }
  patterns: string[]                  // detected candlestick patterns
  keyLevels: KeyLevels
  recentCandles: Array<{
    time: number
    o: number
    h: number
    l: number
    c: number
    v: number
  }>
  btcContext: {                       // market beta proxy
    change24h: number | null
  } | null
}

export interface AISignal {
  signal: SignalType
  confidence: number                  // 0-100
  bias: string                        // bullish | bearish | neutral
  entry: number | null
  entryZone: [number, number] | null
  stopLoss: number | null
  takeProfit1: number | null
  takeProfit2: number | null
  riskReward: number | null
  timeHorizon: string                 // intraday | swing | position
  validHours: number | null           // how long the setup stays valid (hours)
  tradeWindow: string                 // human note: when to cut if TP1 isn't hit
  mtfView: string                     // how this timeframe fits the higher timeframe
  experienceNote: string              // veteran pattern/experience behind the call
  summary: string
  rationale: string[]
  keyLevels: KeyLevels
  invalidation: string
  newsImpact: string
  riskWarning: string
}

export interface AnalysisResult {
  symbol: string
  displaySymbol: string
  timeframe: string
  price: number
  snapshot: TechnicalSnapshot
  ai: AISignal
  source: 'llm' | 'rules' | 'llm-repaired'
  newsHeadlines: string[]
  analyzedAt: string
}

export interface NewsArticle {
  title: string
  url: string
  snippet: string
  source: string
  date: string
}

export interface NewsSentiment {
  overall: 'bullish' | 'bearish' | 'mixed' | 'neutral'
  score: number
  drivers: string[]
}

export interface NotificationItem {
  id: string
  type: string
  symbol: string | null
  title: string
  body: string | null
  signal: string | null
  confidence: number | null
  link: string | null
  read: boolean
  createdAt: string
}

export interface ScannerSettings {
  autoScan: boolean
  scanIntervalMin: number
  minConfidence: number
  soundAlerts: boolean
  browserPush: boolean
  notifyOnSignalChange: boolean
  notifyAllSignals: boolean
}

export interface WatchItemDTO {
  id: string
  symbol: string
  market: string
  timeframe: string
  active: boolean
  lastSignal: string | null
  lastConfidence: number | null
  lastSignalAt: string | null
}
