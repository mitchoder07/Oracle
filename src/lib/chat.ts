import type { Candle, Ticker } from './types'
import { fetchKlines, fetchTickers } from './market-data'
import { buildSnapshot } from './indicators'
import { getSymbolMeta } from './markets'
import { getMarketSession, sessionPromptLine } from './sessions'
import { searchNews } from './news'
import { getZAI, visionModel } from './zai'

// ─── AI trader chat with live market context + chart-image vision ────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const TRADER_PERSONA = `You are ORACLE — the resident elite trading mind inside the TradeOracle AI terminal. You talk like a seasoned prop-desk trader: sharp, direct, generous with knowledge, zero fluff. You speak plainly and practically, using concrete numbers from the live data you are given.

You master:
- Crypto & forex technicals: structure, EMAs, RSI, MACD, Bollinger, ATR, volume, candlestick patterns, multi-timeframe confluence.
- Trading strategy & psychology: trend-following, mean-reversion, breakouts, risk sizing, drawdown control, journaling, entry/exit discipline, position sizing (fixed-fractional), R-multiples.
- Macro & news flow: how CPI/Fed/ETF flows/geopolitics move risk assets.

Chart image reading (when the user attaches a screenshot):
- First identify what you can see: symbol, timeframe, price scale, any visible indicator panes.
- Read the structure objectively: trend direction, HH/HL vs LH/LL, ranges, momentum, obvious S/R zones, notable candlestick patterns or divergences.
- Then give your view: LONG / SHORT / NO-TRADE lean with concrete levels (entry zone, invalidation, targets) and what would flip your read.
- If the image is too small, cropped or blurry to read reliably, say exactly what is unclear instead of guessing.

Market calendar awareness:
- You are given the current date/time and the FX + gold session status. Respect them: if the FX market is closed for the weekend, say so — forex prices shown are Friday's close, flag weekend gap risk, and note the market reopens Sunday 5:00 PM ET. Spot gold (XAU/USD) also closes on weekends and reopens Sunday 6:00 PM ET — any gold price shown while spot is closed is the 24/7 PAXG token proxy. Never describe a closed market as "moving right now".
- Crypto trades 24/7.

Style rules:
- Answer with substance first. Use short paragraphs and bullets. Numbers over adjectives.
- When live data for a pair is provided, reference its actual levels and readings.
- If asked "should I buy X right now", give a balanced view with concrete levels, scenarios and invalidation — and remind that it's analysis, not financial advice.
- Never invent fake live prices when none are provided in context; say what type of data you'd need or answer conceptually.
- Keep most answers under ~250 words unless asked to go deep.`

export async function chatWithTrader(
  messages: ChatMessage[],
  contextSymbol?: string,
  timeframe?: string,
  images?: string[]
): Promise<string> {
  // Build live market context for the focused pair
  let contextBlock = 'No specific pair is focused right now.'
  if (contextSymbol) {
    try {
      const symbol = contextSymbol.toUpperCase()
      const meta = getSymbolMeta(symbol)
      const [candles, tickers, news] = await Promise.all([
        fetchKlines(symbol, timeframe ?? '1h', 200),
        fetchTickers([symbol, 'BTCUSDT']),
        searchNews(meta.market === 'FOREX' ? 'FOREX' : 'CRYPTO').catch(() => []),
      ])
      const ticker: Ticker | undefined = tickers.get(symbol)
      const btc: Ticker | undefined = tickers.get('BTCUSDT')
      const snapshot = buildSnapshot(
        symbol,
        timeframe ?? '1h',
        candles,
        ticker ?? null,
        null,
        btc?.changePct ?? null
      )
      const session = getMarketSession(meta.market)
      const headlines = news.slice(0, 5).map((a) => `- ${a.title} (${a.source})`).join('\n')
      const sessionLine =
        meta.market === 'FOREX' && !session.open
          ? `Market session: FOREX is CLOSED (weekend) — prices below are Friday's close; weekend gap risk applies; reopens Sunday 5:00 PM ET.`
          : meta.market === 'METAL' && !session.open
            ? `Market session: SPOT GOLD is CLOSED (weekend — reopens Sunday 6:00 PM ET). The price below is the 24/7 PAXG token proxy for XAU/USD; it can drift from spot and thins out on weekends.`
            : meta.market === 'METAL'
              ? `Market session: Spot gold open (closes Friday 5:00 PM ET); price shown is the PAXG token tracking XAU/USD.`
              : `Market session: ${meta.market === 'FOREX' ? 'FOREX open (24/5)' : 'Crypto 24/7 — always open'}.`
      contextBlock = `${sessionPromptLine()}
${sessionLine}
LIVE CONTEXT for ${meta.displaySymbol} (${meta.name}), ${timeframe ?? '1h'} timeframe:
- Price: ${snapshot.price} | 24h: ${snapshot.change24h.toFixed(2)}% (high ${snapshot.high24h} / low ${snapshot.low24h})
- Trend: ${snapshot.trend.structure}; EMA20 ${snapshot.trend.ema20 ?? 'n/a'} / EMA50 ${snapshot.trend.ema50 ?? 'n/a'}; HTF bias: ${snapshot.trend.htfTrend ?? 'n/a'}
- RSI(14): ${snapshot.momentum.rsi?.toFixed(1) ?? 'n/a'} (${snapshot.momentum.rsiZone})${snapshot.momentum.rsiDivergence ? `, divergence ${snapshot.momentum.rsiDivergence}` : ''}
- MACD hist: ${snapshot.momentum.macdHist?.toFixed(4) ?? 'n/a'}${snapshot.momentum.macdCross ? ` (${snapshot.momentum.macdCross})` : ''}
- Bollinger position: ${snapshot.volatility.bbPosition !== null ? (snapshot.volatility.bbPosition * 100).toFixed(0) + '%' : 'n/a'}${snapshot.volatility.bbSqueeze ? ' [SQUEEZE]' : ''}
- ATR%: ${snapshot.volatility.atrPct?.toFixed(2) ?? 'n/a'} | Rel volume: ${snapshot.volume.lastVsAvg?.toFixed(2) ?? 'n/a'}x
- Patterns: ${snapshot.patterns.join(', ') || 'none notable'}
- Nearest support: ${snapshot.keyLevels.support[0] ?? 'n/a'} | resistance: ${snapshot.keyLevels.resistance[0] ?? 'n/a'}
- BTC 24h (market beta): ${btc?.changePct?.toFixed(2) ?? 'n/a'}%
Latest headlines:
${headlines || '(none)'}`
    } catch (e) {
      contextBlock = `${sessionPromptLine()}
Live data unavailable for ${contextSymbol}: ${(e as Error).message}`
    }
  } else {
    contextBlock = `${sessionPromptLine()}
${contextBlock}`
  }

  const history = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12) // keep context tight
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))

  if (history.length === 0) throw new Error('No message to send')

  const zai = await getZAI()

  // ── vision path: the last user message carries attached chart images ──
  const attached = (images ?? []).filter(
    (u) => typeof u === 'string' && u.startsWith('data:image/') && u.length < 6_000_000
  )
  if (attached.length > 0) {
    const lastUserIdx = findLastIndex(history, (m) => m.role === 'user')
    const rawText = lastUserIdx >= 0 ? history[lastUserIdx].content.trim() : ''
    const promptText =
      rawText && rawText !== '(image attached)'
        ? rawText
        : 'Read this chart and give me your full technical read — trend, structure, key levels, and whether you lean long, short or no-trade.'
    const visionHistory = lastUserIdx >= 0 ? history.slice(0, lastUserIdx) : history
    const completion = await zai.chat.completions.createVision({
      model: visionModel(),
      messages: [
        {
          role: 'assistant',
          content: `${TRADER_PERSONA}\n\n${contextBlock}\n\nRemember: substance first, numbers over adjectives, and always note this is analysis, not financial advice.`,
        },
        ...visionHistory,
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            ...attached.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    const reply = completion.choices[0]?.message?.content
    if (!reply || !reply.trim()) throw new Error('Empty response from the AI trader')
    return reply.trim()
  }

  // ── text-only path ──
  const completion = await zai.chat.completions.create({
    messages: [
      {
        role: 'assistant',
        content: `${TRADER_PERSONA}\n\n${contextBlock}\n\nRemember: substance first, numbers over adjectives, and always note this is analysis, not financial advice.`,
      },
      ...history,
    ],
    thinking: { type: 'disabled' },
  })

  const reply = completion.choices[0]?.message?.content
  if (!reply || !reply.trim()) throw new Error('Empty response from the AI trader')
  return reply.trim()
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i
  return -1
}
