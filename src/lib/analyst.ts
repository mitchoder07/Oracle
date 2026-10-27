import type { AISignal, AnalysisResult, TechnicalSnapshot, TfLadderEntry } from './types'
import { fetchKlines, fetchTickers } from './market-data'
import { buildSnapshot, rulesSignal, quantTfRead } from './indicators'
import { canonicalSymbol, getSymbolMeta, HTF_MAP, TF_LADDER } from './markets'
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
- MULTI-TIMEFRAME COHERENCE: the prompt contains a TIMEFRAME LADDER: the deterministic quantitative trend read of every timeframe (1m through 1d), computed from the same live candles. Read it the way a professional does: the rungs above your trading timeframe set the bias you trade WITH, the rungs below only time your entry. If your verdict fights the dominant bias of the higher rungs, you must say so in mtfView, cap confidence at 45, and frame it as a counter-trend play with reduced size and a faster target. If the higher rungs are mixed, that itself is information: lean KEEP_OFF or frame it as a range play. Different timeframes may honestly show different pictures (a 5m bounce inside a 1h downtrend is normal), but every verdict must explicitly state where it sits in the ladder, so your verdicts across timeframes read as one coherent story, never as independent opinions. The engine independently checks your verdict against the ladder and will cap and label anything that fights it, so respect the check.
- experienceNote must name a concrete recurring pattern (for example: pullback-to-EMA continuation, failed breakout retest, RSI divergence at range extremes, news-spike fade) and why it applies here. No vague "experience says".
- validHours must match the timeframe's realistic play-out speed: roughly 2-6h for 1m/5m charts, 6-24h for 15m/30m, 12-48h for 1h, 2-7 days for 4h, 1-4 weeks for 1d, and several weeks/months for 1w/1M.
- tradeWindow must give the trader a hard cut rule, for example: "Enter on the retest; if TP1 isn't hit within 8 hours, close at market and reassess." Never leave a trade open-ended.
- For LONG: stopLoss < entry < takeProfit1 < takeProfit2. For SHORT: reverse. All levels must be within 10% of current price and consistent with ATR and the key levels provided. For KEEP_OFF: entry/stopLoss/takeProfits/riskReward/validHours must be null, and tradeWindow should still tell the trader when to look again.
- confidence reflects the conviction in your call: >70 only for strong multi-factor confluence; 40-70 for decent setups; <40 for weak/categorical no-trade zones. For KEEP_OFF, confidence = how strongly you urge the trader to stay out (a high-confidence KEEP_OFF is a very loud "do not trade").
- Numbers must be plausible to the given price scale (no typo-level absurdities).`

// short-lived cache so repeated UI calls don't re-bill the LLM
const resultCache = new Map<string, { result: AnalysisResult; until: number }>()

// ── multi-timeframe ladder ──────────────────────────────────────────────
// Every timeframe of a symbol read TOGETHER with deterministic indicator
// math (EMA stack + market structure + RSI on the same live candles). This
// is ground truth, not an LLM opinion: the verdict is checked against it,
// and the UI shows it so verdicts across timeframes read as one story
// instead of feeling like random flip-flopping when you switch charts.
const ladderCache = new Map<string, { ladder: TfLadderEntry[]; at: number }>()
const LADDER_TTL_MS = 60_000

export async function buildTfLadder(symbol: string): Promise<TfLadderEntry[]> {
  const hit = ladderCache.get(symbol)
  if (hit && Date.now() - hit.at < LADDER_TTL_MS) return hit.ladder
  const results = await Promise.allSettled(TF_LADDER.map((tf) => fetchKlines(symbol, tf, 160)))
  const ladder: TfLadderEntry[] = TF_LADDER.map((tf, i) => {
    const r = results[i]
    if (r.status !== 'fulfilled' || !Array.isArray(r.value) || r.value.length < 55) {
      return { tf, bias: null, structure: 'insufficient data', rsi: null }
    }
    return { tf, ...quantTfRead(r.value) }
  })
  ladderCache.set(symbol, { ladder, at: Date.now() })
  return ladder
}

/** How a directional signal relates to the rungs strictly above the trading timeframe. */
function ladderRelation(
  signal: 'LONG' | 'SHORT',
  ladder: TfLadderEntry[],
  timeframe: string
): { higher: TfLadderEntry[]; fights: number; aligns: number; oppositeTfs: string[] } {
  const idx = TF_LADDER.indexOf(timeframe)
  const higher = idx >= 0 ? ladder.filter((e) => TF_LADDER.indexOf(e.tf) > idx) : []
  const opposite = signal === 'LONG' ? 'bearish' : 'bullish'
  const side = signal === 'LONG' ? 'bullish' : 'bearish'
  const oppositeTfs = higher.filter((e) => e.bias === opposite).map((e) => e.tf)
  const aligns = higher.filter((e) => e.bias === side).length
  return { higher, fights: oppositeTfs.length, aligns, oppositeTfs }
}

/** Dominant bias of a set of ladder rungs (60% of directional votes wins). */
function dominantOf(entries: TfLadderEntry[]): 'bullish' | 'bearish' | 'mixed' {
  const bulls = entries.filter((e) => e.bias === 'bullish').length
  const bears = entries.filter((e) => e.bias === 'bearish').length
  const d = bulls + bears
  if (d === 0) return 'mixed'
  if (bulls / d >= 0.6) return 'bullish'
  if (bears / d >= 0.6) return 'bearish'
  return 'mixed'
}

/** Ladder as prompt lines (reused by the chat context builder). */
export function ladderPromptLines(ladder: TfLadderEntry[], timeframe?: string): string {
  const rows = ladder.map((e) => {
    const bias = e.bias ?? 'n/a'
    const extras = [
      e.structure.split(' (')[0],
      e.rsi !== null ? `RSI ${e.rsi}` : null,
    ]
      .filter(Boolean)
      .join(', ')
    return `- ${e.tf}: ${bias}${extras ? ` (${extras})` : ''}`
  })
  let out = rows.join('\n')
  if (timeframe) {
    const idx = TF_LADDER.indexOf(timeframe)
    const higher = idx >= 0 ? ladder.filter((e) => TF_LADDER.indexOf(e.tf) > idx) : []
    if (higher.length > 0) {
      out += `\nDOMINANT BIAS of the ${higher.length} rungs above your ${timeframe} trading timeframe: ${dominantOf(higher)}.`
    } else {
      out += `\nYour ${timeframe} trading timeframe sits at the top of the ladder; there are no higher rungs.`
    }
  }
  return out
}

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
  const [candles, htfCandles, tickers, ladder] = await Promise.all([
    fetchKlines(symbol, timeframe, 300),
    htfTf !== timeframe ? fetchKlines(symbol, htfTf, 200).catch(() => null) : Promise.resolve(null),
    fetchTickers([symbol, 'BTCUSDT']),
    buildTfLadder(symbol).catch(() => [] as TfLadderEntry[]),
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

  // 4) deterministic ladder context: how the higher rungs stack right now
  const ladderIdx = TF_LADDER.indexOf(timeframe)
  const higherLadder = ladderIdx >= 0 ? ladder.filter((e) => TF_LADDER.indexOf(e.tf) > ladderIdx) : []
  const dominant = dominantOf(higherLadder)

  // 5) LLM verdict (with rules-engine fallback), checked against the ladder
  const { ai, source, counterTrend } = await callOracle(snapshot, newsHeadlines, htfTf, ladder, dominant)

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
    tfLadder: ladder,
    dominantBias: dominant,
    counterTrend,
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
  htfTf: string,
  ladder: TfLadderEntry[],
  dominant: 'bullish' | 'bearish' | 'mixed'
): Promise<{ ai: AISignal; source: 'llm' | 'rules' | 'llm-repaired'; counterTrend: boolean }> {
  const userPrompt = `CURRENT TIME & MARKET SESSION:
${sessionPromptLine()}
${sessionNoteFor(snapshot.symbol)}

CHART SNAPSHOT (${snapshot.symbol}, ${snapshot.timeframe} timeframe):
${JSON.stringify(snapshot, null, 1)}

TIMEFRAME LADDER (deterministic quantitative read of every timeframe, computed from the same live candles; ground truth, not opinion):
${ladderPromptLines(ladder, snapshot.timeframe)}

HIGHER-TIMEFRAME CONTEXT: the trend.htfTrend field above is the ${htfTf} trend, and the ladder above shows every timeframe side by side. Your ${snapshot.timeframe} verdict must state how it fits the ladder in mtfView, and follow the multi-timeframe coherence rule. The engine independently checks your verdict against the ladder: a signal fighting 2 or more of the higher rungs gets its confidence capped and is labeled counter-trend no matter what you write.

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
      const sane = sanitizeSignal(parsed, snapshot, { ladder, dominant })
      if (sane) return { ai: sane.ai, source: attempt === 0 ? 'llm' : 'llm-repaired', counterTrend: sane.counterTrend }
    } catch (e) {
      console.error(`[oracle] LLM attempt ${attempt + 1} failed:`, (e as Error).message)
    }
  }

  // deterministic fallback — app never breaks
  const fb = rulesSignal(snapshot)
  const meta = getSymbolMeta(snapshot.symbol)
  const validHours = fb.signal === 'KEEP_OFF' ? null : (FALLBACK_VALID_HOURS[snapshot.timeframe] ?? 24)
  const htf = snapshot.trend.htfTrend ?? 'unknown'
  const rel =
    fb.signal === 'LONG' || fb.signal === 'SHORT' ? ladderRelation(fb.signal, ladder, snapshot.timeframe) : null
  const counterTrend = !!rel && rel.fights >= 2
  if (counterTrend && fb.confidence > 45) fb.confidence = 45
  const aligns =
    (fb.signal === 'LONG' && htf === 'bullish') || (fb.signal === 'SHORT' && htf === 'bearish')
  const fights =
    (fb.signal === 'LONG' && htf === 'bearish') || (fb.signal === 'SHORT' && htf === 'bullish')
  // plan levels: entry at market, stop beyond structure, targets at R multiples.
  // The displayed R:R is computed from these exact numbers (never a constant),
  // so the plan's math always checks out against the chart.
  const fbEntry = fb.signal === 'KEEP_OFF' ? null : snapshot.price
  const fbStop = fb.signal === 'KEEP_OFF' ? null : computeFallbackStop(fb.signal, snapshot)
  const fbTp1 = fb.signal === 'KEEP_OFF' ? null : computeFallbackTp(fb.signal, snapshot, 1.5)
  const fbTp2 = fb.signal === 'KEEP_OFF' ? null : computeFallbackTp(fb.signal, snapshot, 2.5)
  const fbRisk = fbEntry !== null && fbStop !== null ? Math.abs(fbEntry - fbStop) : 0
  const fbRr =
    fbEntry !== null && fbTp1 !== null && fbRisk > 0
      ? Math.round((Math.abs(fbTp1 - fbEntry) / fbRisk) * 100) / 100
      : null
  return {
    ai: {
      signal: fb.signal,
      confidence: fb.confidence,
      bias: fb.signal === 'LONG' ? 'bullish' : fb.signal === 'SHORT' ? 'bearish' : 'neutral',
      entry: fbEntry,
      entryZone: null,
      stopLoss: fbStop,
      takeProfit1: fbTp1,
      takeProfit2: fbTp2,
      riskReward: fbRr,
      timeHorizon: 'swing',
      validHours,
      tradeWindow:
        fb.signal === 'KEEP_OFF'
          ? `Conditions are mixed. Re-check this pair after the next few ${snapshot.timeframe} candles close.`
          : `Treat the setup as live for the next ${validHours}h. If TP1 is not reached within ${Math.round((validHours ?? 24) * 0.75)}h, close the position at market and wait for a cleaner setup.`,
      mtfView:
        rel && rel.fights >= 2
          ? `Heads up: this ${snapshot.timeframe} ${fb.signal} fights ${rel.fights} of the ${rel.higher.length} higher timeframes (${rel.oppositeTfs.join(', ')}). Treat it as a counter-trend scalp with half size, or skip it.`
          : fb.signal === 'KEEP_OFF'
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
      } (${fb.rationale.slice(0, 3).map((s) => s.replace(/\s*\(.*$/, '')).join('; ')}). (AI model offline, deterministic engine verdict.)`,
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
    counterTrend,
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

// validate + repair the LLM's JSON into a safe AISignal (exported for tests)
interface LadderGuard {
  ladder: TfLadderEntry[]
  dominant: 'bullish' | 'bearish' | 'mixed'
}

export function sanitizeSignal(
  parsed: any,
  snap: TechnicalSnapshot,
  guard?: LadderGuard
): { ai: AISignal; counterTrend: boolean } | null {
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

  // HARD LADDER GUARD (deterministic, cannot be argued away by the LLM):
  // a signal that fights 2+ of the higher rungs is capped and loudly labeled
  // counter-trend, so the same symbol can never again show a confident 5m
  // LONG next to a 1h SHORT without the relationship being spelled out.
  let counterTrend = false
  let guardNote = ''
  if (guard && (signal === 'LONG' || signal === 'SHORT')) {
    const rel = ladderRelation(signal, guard.ladder, snap.timeframe)
    if (rel.fights >= 2) {
      counterTrend = true
      const cap = rel.fights >= 3 ? 38 : 45
      if (confidence > cap) confidence = cap
      guardNote = `Ladder check: this ${snap.timeframe} ${signal} fights ${rel.fights} of ${rel.higher.length} higher timeframes (${rel.oppositeTfs.join(', ')}). It is a counter-trend trade: half size, faster target, or skip.`
    }
  }

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

  // R:R is ALWAYS recomputed from the final plan levels and never trusted from
  // the model or the fallback: a self-reported number that disagrees with the
  // plan's own entry/stop/target math is exactly the kind of inconsistency a
  // professional eye catches immediately (the displayed R:R must equal the
  // distance math you can verify on the chart).
  let riskReward: number | null = null
  if (entry !== null && stopLoss !== null && takeProfit1 !== null) {
    const risk = Math.abs(entry - stopLoss)
    if (risk > 0) riskReward = Math.round((Math.abs(takeProfit1 - entry) / risk) * 100) / 100
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
  const mtfViewFinal = guardNote
    ? `${guardNote} ${mtfView}`.slice(0, 420)
    : mtfView.slice(0, 300) || 'Higher-timeframe context was not provided for this scan.'

  const levels = {
    support: Array.isArray(parsed.keyLevels?.support)
      ? parsed.keyLevels.support.map(Number).filter(Number.isFinite).slice(0, 3)
      : snap.keyLevels.support,
    resistance: Array.isArray(parsed.keyLevels?.resistance)
      ? parsed.keyLevels.resistance.map(Number).filter(Number.isFinite).slice(0, 3)
      : snap.keyLevels.resistance,
  }

  const ai: AISignal = {
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
    mtfView: mtfViewFinal,
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
  return { ai, counterTrend }
}
