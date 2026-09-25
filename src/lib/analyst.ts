import type { AISignal, AnalysisResult, TechnicalSnapshot } from './types'
import { fetchKlines, fetchTickers } from './market-data'
import { buildSnapshot, rulesSignal } from './indicators'
import { canonicalSymbol, getSymbolMeta, HTF_MAP } from './markets'
import { getMarketSession, sessionPromptLine } from './sessions'
import { searchSymbolNews } from './news'
import { extractJson } from './news'
import { getZAI } from './zai'

// ─── ORACLE: elite AI trading analyst ────────────────────────────────────────

const SYSTEM_PROMPT = `You are ORACLE, an elite institutional-grade trading analyst with 20+ years of experience across crypto and forex markets. You have digested every major market cycle, crash, mania and consolidation since the dot-com era and combine:

- Deep technical analysis: market structure (HH/HL vs LH/LL), EMA dynamics, RSI & divergences, MACD momentum, Bollinger volatility regimes, ATR-based risk sizing, volume/OBV confirmation, candlestick patterns.
- Multi-timeframe confluence: you always check that the trading timeframe agrees with the higher timeframe bias, and you say out loud how the two fit together.
- News & macro awareness: you weigh how headlines, sentiment and risk-on/risk-off flows affect the setup, and you cite the specific headline when you use it.
- Pattern memory from experience: you have seen thousands of similar setups (first pullback to a rising 20 EMA, failed breakout after a vertical run, liquidity sweep before a real move) and you reference that experience explicitly.
- Merciless risk management: every trade idea must have a logical invalidation point, stop placement beyond structure (not at round numbers), asymmetric R:R of at least 1.5, and a defined validity window after which the trade is cut.

Your personality: decisive, calm, honest and human. You sound like a veteran trader a friend can trust, not a corporate report. A sloppy chart gets called out. "KEEP_OFF" (no trade) is frequently the smartest and most professional call. You never force trades. You think like a senior portfolio manager protecting capital first, chasing alpha second.

WRITING STYLE (applies to every text field you write: summary, rationale, invalidation, newsImpact, experienceNote, mtfView, tradeWindow, riskWarning):
- NEVER use em dashes (—) or en dashes (–). Not once. Use a comma, a period or parentheses instead. This is a hard rule.
- Write the way a real human trader talks: natural, warm, plain English. Contractions are welcome ("don't", "it's", "you're"). Everyday words beat jargon when both work.
- No stiff AI phrasing, no hype words, no filler. Every sentence should earn its place and be grounded in the actual numbers from the snapshot.

TASK: You will receive a quantitative snapshot of a chart (indicators, structure, levels, recent candles), the higher-timeframe trend for confluence, plus recent news headlines. Give your professional verdict.

Respond with ONLY one valid JSON object. No markdown fences, no commentary before or after. Schema:
{
  "signal": "LONG" | "SHORT" | "KEEP_OFF",
  "confidence": <integer 0-100>,
  "bias": "bullish" | "bearish" | "neutral",
  "entry": <number or null>,
  "entryZone": [<min>, <max>] or null,
  "stopLoss": <number or null>,
  "takeProfit1": <number or null>,
  "takeProfit2": <number or null>,
  "riskReward": <number or null>,
  "timeHorizon": "intraday" | "swing" | "position",
  "validHours": <integer, how many hours the setup stays valid>,
  "tradeWindow": "<one sentence: when to enter and when to cut the trade if TP1 is not hit>",
  "mtfView": "<one sentence: how this timeframe's call fits the higher timeframe trend>",
  "experienceNote": "<one or two sentences: the pattern/experience from 20 years of trading that backs this call>",
  "summary": "<1-2 sentence verdict, direct and specific>",
  "rationale": ["<bullet>", "<bullet>", "<bullet>"],
  "invalidation": "<what would flip this view>",
  "newsImpact": "<how a specific current headline affects this setup, or 'neutral'>",
  "riskWarning": "<key risk to this trade>"
}
Rules:
- rationale must contain 4-6 specific bullets that reference actual numbers from the snapshot. At least one bullet must cite technical structure/levels, and when news headlines are provided at least one must tie to a headline.
- MULTI-TIMEFRAME COHERENCE: the snapshot's trend.htfTrend field is the higher-timeframe trend (its timeframe is stated in the prompt). If your call FIGHTS the higher-timeframe trend, you must say so in mtfView, cap confidence at 45, and frame the trade as a counter-trend play with reduced size. If the trading timeframe and higher timeframe agree, say so and let confidence reflect the confluence. A call that silently contradicts the bigger trend without acknowledging it is a failure.
- experienceNote must name a concrete recurring pattern (for example: pullback-to-EMA continuation, failed breakout retest, RSI divergence at range extremes, news-spike fade) and why it applies here. No vague "experience says".
- validHours must match the timeframe's realistic play-out speed: roughly 2-6h for 1m/5m charts, 6-24h for 15m/30m, 12-48h for 1h, 2-7 days for 4h, 1-4 weeks for 1d, and several weeks/months for 1w/1M.
- tradeWindow must give the trader a hard cut rule, for example: "Enter on the retest; if TP1 isn't hit within 8 hours, close at market and reassess." Never leave a trade open-ended.
- For LONG: stopLoss < entry < takeProfit1 < takeProfit2. For SHORT: reverse. All levels must be within 10% of current price and consistent with ATR and the key levels provided. For KEEP_OFF: entry/stopLoss/takeProfits/riskReward/validHours must be null, and tradeWindow should still tell the trader when to look again.
- confidence reflects the conviction in your call: >70 only for strong multi-factor confluence; 40-70 for decent setups; <40 for weak/categorical no-trade zones. For KEEP_OFF, confidence = how strongly you urge the trader to stay out (a high-confidence KEEP_OFF is a very loud "do not trade").
- Numbers must be plausible to the given price scale (no typo-level absurdities).`

// short-lived cache so repeated UI calls don't re-bill the LLM
const resultCache = new Map<string, { result: AnalysisResult; until: number }>()

export async function analyzeSymbol(
  symbolInput: string,
  timeframe: string,
  opts: { force?: boolean } = {}
): Promise<AnalysisResult> {
  const symbol = canonicalSymbol(symbolInput)
  const key = `an:${symbol}:${timeframe}`
  if (!opts.force) {
    const hit = resultCache.get(key)
    if (hit && hit.until > Date.now()) return hit.result
  }

  const meta = getSymbolMeta(symbol)

  // 1) data (skip HTF fetch when the timeframe has no higher timeframe, e.g. 1M)
  const htfTf = HTF_MAP[timeframe] ?? '4h'
  const [candles, htfCandles, tickers] = await Promise.all([
    fetchKlines(symbol, timeframe, 300),
    htfTf !== timeframe ? fetchKlines(symbol, htfTf, 200).catch(() => null) : Promise.resolve(null),
    fetchTickers([symbol, 'BTCUSDT']),
  ])
  const ticker = tickers.get(symbol) ?? null
  const btc = tickers.get('BTCUSDT') ?? null

  // 2) quantitative snapshot
  const snapshot = buildSnapshot(symbol, timeframe, candles, ticker, htfCandles, btc?.changePct ?? null)

  // 3) news headlines for this asset
  let newsHeadlines: string[] = []
  try {
    const articles = await searchSymbolNews(meta.base, meta.displaySymbol, meta.market)
    newsHeadlines = articles.map((a) => `${a.title} (${a.source})`)
  } catch { /* news is best-effort */ }

  // 4) LLM verdict (with rules-engine fallback)
  const { ai, source } = await callOracle(snapshot, newsHeadlines, htfTf)

  const result: AnalysisResult = {
    symbol,
    displaySymbol: meta.displaySymbol,
    timeframe,
    price: snapshot.price,
    snapshot,
    ai,
    source,
    newsHeadlines,
    analyzedAt: new Date().toISOString(),
  }

  resultCache.set(key, { result, until: Date.now() + 120_000 })
  return result
}

// Session-aware note so ORACLE reasons correctly about weekends / closed markets
function sessionNoteFor(symbol: string): string {
  const meta = getSymbolMeta(symbol)
  const session = getMarketSession(meta.market)
  if (meta.market === 'FOREX' && !session.open) {
    return 'SESSION NOTE: This is a forex pair and the FX market is CLOSED right now (weekend). The snapshot shows Friday\u2019s closing prices; nothing is trading. Factor weekend gap risk and headline risk into confidence. A KEEP_OFF with gap-risk rationale is often the most professional call, or present a plan conditional on the Sunday 17:00 ET reopen. Never describe the market as \u201cmoving right now\u201d.'
  }
  if (meta.market === 'FOREX') {
    return 'SESSION NOTE: FX market is currently open (24/5).'
  }
  if (meta.market === 'METAL' && !session.open) {
    return 'SESSION NOTE: This is gold (XAU/USD) and the SPOT metals market is CLOSED right now (weekend, reopens Sunday 18:00 ET). The prices shown are Friday\u2019s close, exactly like a broker\u2019s gold chart on a weekend. Nothing is moving. Weigh weekend gap risk and headline risk into confidence. A KEEP_OFF with gap-risk rationale is often the most professional call, or present a plan conditional on the Sunday 18:00 ET reopen. Never describe the market as \u201cmoving right now\u201d.'
  }
  if (meta.market === 'METAL') {
    return 'SESSION NOTE: Spot gold market is currently open (closes Friday 17:00 ET); the price is real spot XAU/USD, the same gold price a forex broker quotes.'
  }
  return 'SESSION NOTE: Crypto trades 24/7, so the market is open right now.'
}

// realistic validity windows per timeframe (rules fallback mirrors the LLM rule)
const FALLBACK_VALID_HOURS: Record<string, number> = {
  '1m': 3, '5m': 6, '15m': 12, '30m': 18, '1h': 24, '4h': 96, '1d': 336, '1w': 720, '1M': 720,
}

async function callOracle(
  snapshot: TechnicalSnapshot,
  newsHeadlines: string[],
  htfTf: string
): Promise<{ ai: AISignal; source: 'llm' | 'rules' | 'llm-repaired' }> {
  const userPrompt = `CURRENT TIME & MARKET SESSION:
${sessionPromptLine()}
${sessionNoteFor(snapshot.symbol)}

CHART SNAPSHOT (${snapshot.symbol}, ${snapshot.timeframe} timeframe):
${JSON.stringify(snapshot, null, 1)}

HIGHER-TIMEFRAME CONTEXT: the trend.htfTrend field above is the ${htfTf} trend. Your ${snapshot.timeframe} verdict must state how it fits that ${htfTf} bias in mtfView, and follow the multi-timeframe coherence rule.

RECENT NEWS HEADLINES:
${newsHeadlines.length ? newsHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n') : '(none available)'}

Give your professional verdict as the JSON object per the schema.`

  // two attempts at the LLM
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const zai = await getZAI()
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        thinking: { type: 'disabled' },
      })
      const raw = completion.choices[0]?.message?.content ?? ''
      const json = extractJson(raw)
      const parsed = JSON.parse(json)
      const ai = sanitizeSignal(parsed, snapshot)
      if (ai) return { ai, source: attempt === 0 ? 'llm' : 'llm-repaired' }
    } catch (e) {
      console.error(`[oracle] LLM attempt ${attempt + 1} failed:`, (e as Error).message)
    }
  }

  // deterministic fallback — app never breaks
  const fb = rulesSignal(snapshot)
  const meta = getSymbolMeta(snapshot.symbol)
  const validHours = fb.signal === 'KEEP_OFF' ? null : (FALLBACK_VALID_HOURS[snapshot.timeframe] ?? 24)
  const htf = snapshot.trend.htfTrend ?? 'unknown'
  const aligns =
    (fb.signal === 'LONG' && htf === 'bullish') || (fb.signal === 'SHORT' && htf === 'bearish')
  const fights =
    (fb.signal === 'LONG' && htf === 'bearish') || (fb.signal === 'SHORT' && htf === 'bullish')
  return {
    ai: {
      signal: fb.signal,
      confidence: fb.confidence,
      bias: fb.signal === 'LONG' ? 'bullish' : fb.signal === 'SHORT' ? 'bearish' : 'neutral',
      entry: fb.signal === 'KEEP_OFF' ? null : snapshot.price,
      entryZone: null,
      stopLoss: fb.signal === 'KEEP_OFF' ? null : computeFallbackStop(fb.signal, snapshot),
      takeProfit1: fb.signal === 'KEEP_OFF' ? null : computeFallbackTp(fb.signal, snapshot, 1.5),
      takeProfit2: fb.signal === 'KEEP_OFF' ? null : computeFallbackTp(fb.signal, snapshot, 2.5),
      riskReward: 1.8,
      timeHorizon: 'swing',
      validHours,
      tradeWindow:
        fb.signal === 'KEEP_OFF'
          ? `Conditions are mixed. Re-check this pair after the next few ${snapshot.timeframe} candles close.`
          : `Treat the setup as live for the next ${validHours}h. If TP1 is not reached within ${Math.round((validHours ?? 24) * 0.75)}h, close the position at market and wait for a cleaner setup.`,
      mtfView:
        fb.signal === 'KEEP_OFF'
          ? `The ${htfTf} trend reads ${htf}; the ${snapshot.timeframe} picture is mixed, so there is no edge either way right now.`
          : fights
            ? `Heads up: this ${snapshot.timeframe} ${fb.signal} fights the ${htfTf} trend (${htf}). Treat it as a counter-trend scalp with reduced size, or skip it.`
            : aligns
              ? `This ${snapshot.timeframe} ${fb.signal} trades with the ${htfTf} trend (${htf}), which is the side you want to be on.`
              : `The ${htfTf} trend reads ${htf}; this ${snapshot.timeframe} call is neutral to it.`,
      experienceNote:
        fb.signal === 'KEEP_OFF'
          ? 'Choppy, indicator-heavy conditions like this are where beginners bleed out. The veteran move is to wait for the range to resolve before committing money.'
          : 'The rules engine matched this setup to a classic trend-continuation template: momentum in the trade direction, structure intact, and volatility room to the first target. When any leg of that tripod breaks, the trade stops working.',
      summary: `${meta.displaySymbol} ${snapshot.timeframe}: rules engine reads ${
        fb.signal === 'KEEP_OFF' ? 'mixed conditions, so stand aside' : fb.signal === 'LONG' ? 'bullish confluence' : 'bearish confluence'
      }. (AI model unavailable, deterministic engine verdict.)`,
      rationale: fb.rationale,
      keyLevels: snapshot.keyLevels,
      invalidation:
        fb.signal === 'LONG'
          ? 'Losing the nearest support level would flip the bias neutral or bearish.'
          : fb.signal === 'SHORT'
            ? 'Reclaiming the nearest resistance level would flip the bias neutral or bullish.'
            : 'A breakout of the recent range with volume would create a tradeable setup.',
      newsImpact: 'News intelligence unavailable for this scan.',
      riskWarning: 'Signals are opinions, not guarantees. Size positions responsibly.',
    },
    source: 'rules',
  }
}

function computeFallbackStop(signal: 'LONG' | 'SHORT' | 'KEEP_OFF', snap: TechnicalSnapshot): number | null {
  const atr = snap.volatility.atr ?? snap.price * 0.01
  const support = snap.keyLevels.support[0]
  const resistance = snap.keyLevels.resistance[0]
  if (signal === 'LONG') {
    if (support && support < snap.price) return Math.min(support - atr * 0.5, snap.price - atr * 1.2)
    return snap.price - atr * 1.5
  }
  if (signal === 'SHORT') {
    if (resistance && resistance > snap.price) return Math.max(resistance + atr * 0.5, snap.price + atr * 1.2)
    return snap.price + atr * 1.5
  }
  return null
}

function computeFallbackTp(signal: 'LONG' | 'SHORT', snap: TechnicalSnapshot, rr: number): number | null {
  const entry = snap.price
  const stop = computeFallbackStop(signal, snap)
  if (stop === null) return null
  const risk = Math.abs(entry - stop)
  return signal === 'LONG' ? entry + risk * rr : entry - risk * rr
}

// validate + repair the LLM's JSON into a safe AISignal
function sanitizeSignal(parsed: any, snap: TechnicalSnapshot): AISignal | null {
  if (!parsed || typeof parsed !== 'object') return null
  const rawSignal = String(parsed.signal ?? '').toUpperCase()
  if (rawSignal !== 'LONG' && rawSignal !== 'SHORT' && rawSignal !== 'KEEP_OFF') return null
  const signal: 'LONG' | 'SHORT' | 'KEEP_OFF' = rawSignal

  const clampNum = (v: any): number | null => {
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    // reject absurd values (>50% away from price)
    if (Math.abs(n - snap.price) / snap.price > 0.5) return null
    return n
  }

  const price = snap.price
  let entry = clampNum(parsed.entry)
  let stopLoss = clampNum(parsed.stopLoss)
  let takeProfit1 = clampNum(parsed.takeProfit1)
  let takeProfit2 = clampNum(parsed.takeProfit2)
  let entryZone: [number, number] | null = null
  if (Array.isArray(parsed.entryZone) && parsed.entryZone.length === 2) {
    const a = clampNum(parsed.entryZone[0])
    const b = clampNum(parsed.entryZone[1])
    if (a !== null && b !== null) entryZone = [Math.min(a, b), Math.max(a, b)]
  }

  let confidence = Math.round(Number(parsed.confidence))
  if (!Number.isFinite(confidence)) confidence = 50
  confidence = Math.max(0, Math.min(100, confidence))

  if (signal === 'KEEP_OFF') {
    entry = null; stopLoss = null; takeProfit1 = null; takeProfit2 = null; entryZone = null
  } else {
    if (entry === null) entry = entryZone ? (entryZone[0] + entryZone[1]) / 2 : price
    // enforce directional consistency
    if (signal === 'LONG') {
      if (stopLoss !== null && stopLoss >= entry) stopLoss = null
      if (takeProfit1 !== null && takeProfit1 <= entry) takeProfit1 = null
      if (takeProfit2 !== null && (takeProfit1 === null || takeProfit2 <= takeProfit1)) takeProfit2 = null
      if (stopLoss === null) stopLoss = computeFallbackStop('LONG', snap)
      if (takeProfit1 === null) takeProfit1 = computeFallbackTp('LONG', snap, 1.5)
    } else {
      if (stopLoss !== null && stopLoss <= entry) stopLoss = null
      if (takeProfit1 !== null && takeProfit1 >= entry) takeProfit1 = null
      if (takeProfit2 !== null && (takeProfit1 === null || takeProfit2 >= takeProfit1)) takeProfit2 = null
      if (stopLoss === null) stopLoss = computeFallbackStop('SHORT', snap)
      if (takeProfit1 === null) takeProfit1 = computeFallbackTp('SHORT', snap, 1.5)
    }
  }

  let riskReward = Number(parsed.riskReward)
  if (!Number.isFinite(riskReward) || riskReward <= 0 || riskReward > 20) {
    if (entry !== null && stopLoss !== null && takeProfit1 !== null) {
      const risk = Math.abs(entry - stopLoss)
      riskReward = risk > 0 ? Math.abs(takeProfit1 - entry) / risk : null as any
      if (!Number.isFinite(riskReward)) riskReward = null as any
    } else {
      riskReward = null as any
    }
  }

  const rationale = Array.isArray(parsed.rationale)
    ? parsed.rationale.map(String).filter((s: string) => s.trim().length > 0).slice(0, 6)
    : []
  if (rationale.length === 0) rationale.push('Verdict based on the aggregate technical snapshot.')

  // validity window: keep the LLM's number when it is sane for the timeframe
  let validHours: number | null = null
  if (signal !== 'KEEP_OFF') {
    const v = Number(parsed.validHours)
    const floor = FALLBACK_VALID_HOURS[snap.timeframe] ? FALLBACK_VALID_HOURS[snap.timeframe] / 6 : 0.5
    const ceil = FALLBACK_VALID_HOURS[snap.timeframe] ? FALLBACK_VALID_HOURS[snap.timeframe] * 4 : 336
    validHours = Number.isFinite(v) && v > 0 ? Math.max(Math.round(v), Math.round(floor)) : FALLBACK_VALID_HOURS[snap.timeframe] ?? 24
    if (validHours > ceil * 4) validHours = Math.round(ceil)
  }
  const tradeWindow = String(parsed.tradeWindow ?? '').trim()
  const mtfView = String(parsed.mtfView ?? '').trim()
  const experienceNote = String(parsed.experienceNote ?? '').trim()

  const levels = {
    support: Array.isArray(parsed.keyLevels?.support)
      ? parsed.keyLevels.support.map(Number).filter(Number.isFinite).slice(0, 3)
      : snap.keyLevels.support,
    resistance: Array.isArray(parsed.keyLevels?.resistance)
      ? parsed.keyLevels.resistance.map(Number).filter(Number.isFinite).slice(0, 3)
      : snap.keyLevels.resistance,
  }

  return {
    signal,
    confidence,
    bias: ['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral',
    entry,
    entryZone,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskReward: riskReward ?? null,
    timeHorizon: ['intraday', 'swing', 'position'].includes(parsed.timeHorizon) ? parsed.timeHorizon : 'swing',
    validHours,
    tradeWindow:
      tradeWindow.slice(0, 300) ||
      (signal === 'KEEP_OFF'
        ? 'No trade. Re-check after the next few candles close.'
        : `Setup is live for the next ${validHours}h. If TP1 is not hit within ${Math.round((validHours ?? 24) * 0.75)}h, close at market.`),
    mtfView: mtfView.slice(0, 300) || 'Higher-timeframe context was not provided for this scan.',
    experienceNote:
      experienceNote.slice(0, 400) ||
      'No specific historical analogue was cited for this verdict; treat it as a fresh technical read.',
    summary: String(parsed.summary ?? '').slice(0, 400) || 'No summary provided.',
    rationale,
    keyLevels: levels,
    invalidation: String(parsed.invalidation ?? '').slice(0, 400) || 'Structure break invalidates the setup.',
    newsImpact: String(parsed.newsImpact ?? '').slice(0, 400) || 'neutral',
    riskWarning: String(parsed.riskWarning ?? '').slice(0, 400) || 'Manage risk; signals are probabilistic.',
  }
}
