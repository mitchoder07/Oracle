'use client'

import { AlertTriangle, Brain, History, Info, Layers, RefreshCw, Shield, Target, Timer, Zap } from 'lucide-react'
import { useTerminal, signalBg } from './store'
import { formatPrice, getSymbolMeta } from '@/lib/markets'
import type { AnalysisResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// ─── ORACLE verdict panel — the AI trading decision card ─────────────────────

interface Props {
  analysis: AnalysisResult | null
  analyzing: boolean
  onReanalyze: () => void
}

function ConfidenceRing({ value, signal }: { value: number; signal: string }) {
  const r = 34
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, value))
  const offset = c - (clamped / 100) * c
  const stroke = signal === 'LONG' ? '#10b981' : signal === 'SHORT' ? '#ef4444' : '#f59e0b'
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#27272a" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-lg font-bold text-zinc-50">{clamped}</span>
        <span className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500">conf</span>
      </div>
    </div>
  )
}

function LevelTile({
  label,
  value,
  digits,
  tone,
  hint,
}: {
  label: string
  value: number | null | undefined
  digits: number
  tone: 'entry' | 'sl' | 'tp' | 'rr'
  hint?: string
}) {
  const toneClass =
    tone === 'entry'
      ? 'border-emerald-500/30 text-emerald-400'
      : tone === 'sl'
        ? 'border-red-500/30 text-red-400'
        : tone === 'tp'
          ? 'border-teal-500/30 text-teal-300'
          : 'border-zinc-700 text-zinc-300'
  return (
    <div className={cn('rounded-lg border bg-zinc-950/60 px-2.5 py-2', toneClass.split(' ')[0])}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn('num text-[13px] font-bold leading-tight', toneClass.split(' ')[1])}>
        {value !== null && value !== undefined ? formatPrice(value, digits) : '—'}
      </div>
      {hint && <div className="num mt-0.5 text-[9px] text-zinc-600">{hint}</div>}
    </div>
  )
}

function IndicatorTile({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: string
  tone?: 'bull' | 'bear' | 'neutral' | 'warn'
  title?: string
}) {
  const toneClass =
    tone === 'bull'
      ? 'text-emerald-400'
      : tone === 'bear'
        ? 'text-red-400'
        : tone === 'warn'
          ? 'text-amber-400'
          : 'text-zinc-300'
  return (
    <div
      className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2 py-1.5"
      title={title}
    >
      <div className="text-[9px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn('num text-[11px] font-semibold leading-tight', toneClass)}>{value}</div>
    </div>
  )
}

/** signed distance from entry to a level, e.g. "+1.04%" / "-0.65%" */
function pctFrom(entry: number, level: number): string {
  const pct = ((level - entry) / entry) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

export function SignalPanel({ analysis, analyzing, onReanalyze }: Props) {
  const symbol = useTerminal((s) => s.selectedSymbol)
  const timeframe = useTerminal((s) => s.timeframe)
  const ticks = useTerminal((s) => s.ticks)
  const meta = getSymbolMeta(symbol)
  const tick = ticks[symbol]

  if (!analysis) {
    return (
      <div className="flex h-full min-h-[340px] flex-col items-center justify-center gap-4 rounded-xl border border-zinc-800/70 bg-zinc-950/50 p-6 text-center">
        <div className="oracle-glow flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900">
          <Brain className={cn('h-7 w-7 text-emerald-400', analyzing && 'animate-pulse')} aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-200">
            {analyzing ? 'ORACLE is reading the chart…' : 'ORACLE AI Analysis'}
          </p>
          <p className="mt-1 max-w-xs text-xs text-zinc-500">
            {analyzing
              ? `Scanning ${meta.displaySymbol} ${timeframe}: indicators, structure, momentum, volume and news.`
              : `The AI trader will deliver a LONG / SHORT / KEEP-OFF verdict with entry, stop and targets for ${meta.displaySymbol}.`}
          </p>
        </div>
        {analyzing && (
          <div className="flex w-full max-w-xs gap-1.5">
            <div className="shimmer h-1.5 flex-1 rounded-full" />
            <div className="shimmer h-1.5 flex-1 rounded-full" style={{ animationDelay: '0.2s' }} />
            <div className="shimmer h-1.5 flex-1 rounded-full" style={{ animationDelay: '0.4s' }} />
          </div>
        )}
      </div>
    )
  }

  const { ai, snapshot } = analysis
  const isTrade = ai.signal === 'LONG' || ai.signal === 'SHORT'
  const verdictLabel = ai.signal === 'LONG' ? 'GO LONG' : ai.signal === 'SHORT' ? 'GO SHORT' : 'KEEP OFF'
  const timeAgo = Math.max(0, Math.round((Date.now() - new Date(analysis.analyzedAt).getTime()) / 60000))

  // ── timeframe ladder: how every timeframe stacks right now ──
  const LADDER_ORDER = ['1m', '5m', '15m', '1h', '4h', '1d']
  const ladder = analysis.tfLadder ?? []
  const tfIdx = LADDER_ORDER.indexOf(analysis.timeframe)
  const higher = tfIdx >= 0 ? ladder.filter((e) => LADDER_ORDER.indexOf(e.tf) > tfIdx) : []
  const side = ai.signal === 'LONG' ? 'bullish' : 'bearish'
  const fights = higher.filter((e) => e.bias === (ai.signal === 'LONG' ? 'bearish' : 'bullish')).length
  const aligns = higher.filter((e) => e.bias === side).length
  let ladderLine: string
  let ladderTone = 'text-zinc-500'
  if (tfIdx < 0 || higher.length === 0) {
    ladderLine = 'This timeframe sits above the ladder; judge it on its own structure.'
  } else if (!isTrade) {
    ladderLine = `Higher timeframes read ${analysis.dominantBias ?? 'mixed'}; no trade is on, so the ladder is context for when one appears.`
  } else if (fights >= 2) {
    ladderLine = `This ${analysis.timeframe} ${verdictLabel} fights ${fights} of ${higher.length} higher timeframes. Counter-trend scalp: half size, fast target, or skip.`
    ladderTone = 'text-amber-300/90'
  } else if (aligns >= 2) {
    ladderLine = `Trades with the dominant ${analysis.dominantBias ?? side} ladder (${aligns} of ${higher.length} higher timeframes agree).`
    ladderTone = 'text-emerald-300/80'
  } else {
    ladderLine = `Higher timeframes are mixed (${aligns} with, ${fights} against), so this is a range read, not a trend ride.`
  }

  // human-friendly validity: "~36h" → "1.5 days", "~8h" → "8h"
  const validLabel =
    ai.validHours === null
      ? null
      : ai.validHours >= 48
        ? `${(ai.validHours / 24).toFixed(ai.validHours % 24 === 0 ? 0 : 1)} days`
        : `${ai.validHours}h`

  // ── trade plan math, all derived from the plan's own levels so every number
  //    on screen can be verified against the chart (R multiples, % distances) ──
  const planEntry = ai.entryZone ? (ai.entryZone[0] + ai.entryZone[1]) / 2 : ai.entry
  const risk = planEntry !== null && planEntry !== undefined && ai.stopLoss !== null
    ? Math.abs(planEntry - ai.stopLoss)
    : null
  const r1 = risk && planEntry != null && ai.takeProfit1 !== null ? Math.abs(ai.takeProfit1 - planEntry) / risk : null
  const r2 = risk && planEntry != null && ai.takeProfit2 !== null ? Math.abs(ai.takeProfit2 - planEntry) / risk : null
  const entryKind =
    ai.entryZone
      ? 'zone'
      : planEntry != null && analysis.price > 0 && Math.abs(planEntry - analysis.price) / analysis.price < 0.002
        ? 'market'
        : 'limit'
  const slHint = planEntry != null && ai.stopLoss !== null ? pctFrom(planEntry, ai.stopLoss) : undefined
  const tp1Hint =
    planEntry != null && ai.takeProfit1 !== null
      ? `${pctFrom(planEntry, ai.takeProfit1)}${r1 !== null ? ` · ${r1.toFixed(1)}R` : ''}`
      : undefined
  const tp2Hint =
    planEntry != null && ai.takeProfit2 !== null
      ? `${pctFrom(planEntry, ai.takeProfit2)}${r2 !== null ? ` · ${r2.toFixed(1)}R` : ''}`
      : undefined
  const rrHint =
    r1 !== null || r2 !== null
      ? `TP1 ${r1 !== null ? `${r1.toFixed(1)}R` : '—'} · TP2 ${r2 !== null ? `${r2.toFixed(1)}R` : '—'}`
      : undefined

  // live drift: has price moved away from the analysis price since the scan?
  const livePrice = tick?.price ?? null
  const driftPct =
    livePrice !== null && analysis.price > 0 ? ((livePrice - analysis.price) / analysis.price) * 100 : null
  const driftStale = driftPct !== null && Math.abs(driftPct) > 0.5

  // 24h range position for the snapshot (same convention as TradingView's
  // "today's range" marker: where price sits between the 24h low and high)
  const rangePos =
    snapshot.high24h > 0 && snapshot.low24h > 0 && snapshot.high24h > snapshot.low24h
      ? (snapshot.price - snapshot.low24h) / (snapshot.high24h - snapshot.low24h)
      : null
  const emaStack = snapshot.trend.ema20Above50

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50">
      {/* header */}
      <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Oracle Verdict</h2>
          <Badge
            variant="outline"
            className={cn(
              'h-4 px-1.5 text-[8px] font-bold uppercase',
              analysis.source === 'llm' || analysis.source === 'llm-repaired'
                ? 'border-emerald-500/40 text-emerald-400'
                : 'border-amber-500/40 text-amber-400'
            )}
          >
            {analysis.source === 'llm' ? 'AI' : analysis.source === 'llm-repaired' ? 'AI' : 'Rules'}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-zinc-400 hover:text-emerald-400"
          onClick={onReanalyze}
          disabled={analyzing}
          aria-label="Run deep re-analysis"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', analyzing && 'animate-spin')} />
          {analyzing ? 'Analyzing…' : 'Re-analyze'}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* AI-offline notice: the deployed app runs the deterministic engine when
            the language model is not configured, and the trader deserves to know
            exactly how to switch the full ORACLE intelligence on */}
        {analysis.source === 'rules' && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
                Deterministic mode (AI model offline)
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                The ORACLE language model is not configured on this deployment, so verdicts come from the deterministic
                quant engine (real indicator math, honest levels). To enable full AI verdicts: on Vercel add the{' '}
                <span className="num text-zinc-300">AI_BASE_URL</span> and{' '}
                <span className="num text-zinc-300">AI_API_KEY</span> environment variables (any OpenAI-compatible
                endpoint, e.g. <span className="num">https://api.z.ai/api/paas/v4</span>), then redeploy.
              </p>
            </div>
          </div>
        )}

        {/* verdict */}
        <div className="border-b border-zinc-800/70 px-4 py-4">
          <div className="flex items-center gap-4">
            <ConfidenceRing value={ai.confidence} signal={ai.signal} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'num rounded-md border px-2.5 py-1 text-base font-extrabold tracking-wide',
                    signalBg(ai.signal)
                  )}
                >
                  {verdictLabel}
                </span>
                {analysis.counterTrend && (
                  <Badge
                    variant="outline"
                    className="h-4 border-amber-500/40 bg-amber-500/10 px-1.5 text-[8px] font-bold uppercase tracking-wide text-amber-400"
                  >
                    Counter-trend
                  </Badge>
                )}
                <span className="num text-[10px] text-zinc-500">
                  {meta.displaySymbol} · {analysis.timeframe} · {ai.timeHorizon}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-300">{ai.summary}</p>
              {/* multi-timeframe view: why this timeframe's call can differ from another */}
              {ai.mtfView && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5">
                  <Layers className="mt-0.5 h-3 w-3 shrink-0 text-sky-400/80" aria-hidden="true" />
                  <p className="text-[11px] leading-relaxed text-zinc-400">{ai.mtfView}</p>
                </div>
              )}
              {/* timeframe ladder: every timeframe side by side, so verdicts across
                  timeframes read as one story instead of feeling random */}
              {ladder.length > 0 && (
                <div className="mt-2 rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                      Timeframe ladder
                    </span>
                    {analysis.dominantBias && analysis.dominantBias !== 'mixed' && (
                      <span
                        className={cn(
                          'num rounded-full border px-1.5 py-0.5 text-[9px] font-bold',
                          analysis.dominantBias === 'bullish'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : 'border-red-500/30 bg-red-500/10 text-red-400'
                        )}
                      >
                        dominant {analysis.dominantBias}
                      </span>
                    )}
                    {analysis.counterTrend && (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-400">
                        counter-trend
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ladder.map((e) => {
                      const isCurrent = e.tf === analysis.timeframe
                      const arrow = e.bias === 'bullish' ? '▲' : e.bias === 'bearish' ? '▼' : '·'
                      return (
                        <span
                          key={e.tf}
                          title={`${e.tf}: ${e.bias ?? 'n/a'} · ${e.structure}${e.rsi !== null ? ` · RSI ${e.rsi}` : ''} (deterministic read of the live candles, same data as the chart)`}
                          className={cn(
                            'num rounded px-1.5 py-0.5 text-[10px] font-bold leading-none',
                            e.bias === 'bullish'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : e.bias === 'bearish'
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-zinc-800/60 text-zinc-500',
                            isCurrent && 'ring-1 ring-zinc-400/70'
                          )}
                        >
                          {e.tf} {arrow}
                        </span>
                      )
                    })}
                  </div>
                  <p className={cn('mt-1.5 text-[10px] leading-relaxed', ladderTone)}>{ladderLine}</p>
                  <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
                    Verdicts can honestly differ per timeframe (a 5m bounce inside a 1h downtrend is normal). The ladder shows how they stack, so read them together, not as contradictions.
                  </p>
                </div>
              )}
              {/* keep-off re-check hint */}
              {!isTrade && ai.tradeWindow && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5">
                  <Timer className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/80" aria-hidden="true" />
                  <p className="text-[11px] leading-relaxed text-zinc-400">{ai.tradeWindow}</p>
                </div>
              )}
              <p className="num mt-1.5 text-[9px] text-zinc-600">
                analyzed {timeAgo === 0 ? 'just now' : `${timeAgo}m ago`} · bias {ai.bias}
              </p>
            </div>
          </div>
        </div>

        {/* levels */}
        {isTrade && (
          <div className="border-b border-zinc-800/70 px-4 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <Target className="h-3 w-3" aria-hidden="true" /> Trade plan
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <LevelTile
                label="Entry"
                value={planEntry}
                digits={meta.tickDigits}
                tone="entry"
                hint={ai.entryZone ? `zone ${formatPrice(ai.entryZone[0], meta.tickDigits)}–${formatPrice(ai.entryZone[1], meta.tickDigits)}` : entryKind}
              />
              <LevelTile label="Stop loss" value={ai.stopLoss} digits={meta.tickDigits} tone="sl" hint={slHint} />
              <LevelTile label="Target 1" value={ai.takeProfit1} digits={meta.tickDigits} tone="tp" hint={tp1Hint} />
              <LevelTile label="Target 2" value={ai.takeProfit2} digits={meta.tickDigits} tone="tp" hint={tp2Hint} />
              <LevelTile
                label="R:R"
                value={ai.riskReward}
                digits={2}
                tone="rr"
                hint={rrHint}
              />
            </div>
            {/* live drift: is the plan still aligned with the live price? */}
            {driftPct !== null && (
              <div
                className={cn(
                  'mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-[10px]',
                  driftStale
                    ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200/90'
                    : 'border-zinc-800/80 bg-zinc-900/40 text-zinc-400'
                )}
              >
                <span className="num">
                  Live {formatPrice(livePrice, meta.tickDigits)} ·{' '}
                  {driftPct >= 0 ? '+' : ''}
                  {driftPct.toFixed(2)}% since analysis
                </span>
                <span className="text-zinc-500">
                  {driftStale
                    ? 'price has drifted away from the plan, consider re-analyzing'
                    : 'plan still aligned with the market'}
                </span>
              </div>
            )}
            {/* trade validity window: when to cut the trade if TP1 is not hit */}
            <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.05] px-2.5 py-2">
              <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-sky-300/80">Trade window</span>
                  {validLabel && (
                    <span className="num rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
                      valid ~{validLabel}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">{ai.tradeWindow}</p>
              </div>
            </div>
          </div>
        )}

        {/* rationale */}
        <div className="border-b border-zinc-800/70 px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <Info className="h-3 w-3" aria-hidden="true" /> Why
          </div>
          <ul className="space-y-1.5">
            {ai.rationale.map((r, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-zinc-300">
                <span className="num mt-0.5 shrink-0 text-[9px] font-bold text-emerald-500/70">{String(i + 1).padStart(2, '0')}</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* indicator tiles */}
        <div className="border-b border-zinc-800/70 px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <Brain className="h-3 w-3" aria-hidden="true" /> Snapshot
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            <IndicatorTile
              label="RSI 14"
              value={snapshot.momentum.rsi?.toFixed(1) ?? '—'}
              title="Wilder RSI 14 on this timeframe's closes, the same math TradingView uses"
              tone={
                snapshot.momentum.rsiZone === 'overbought'
                  ? 'bear'
                  : snapshot.momentum.rsiZone === 'oversold'
                    ? 'bull'
                    : snapshot.momentum.rsiZone === 'bullish'
                      ? 'bull'
                      : snapshot.momentum.rsiZone === 'bearish'
                        ? 'bear'
                        : 'neutral'
              }
            />
            <IndicatorTile
              label="MACD"
              value={(snapshot.momentum.macdHist ?? 0).toFixed(2)}
              title="MACD 12/26/9 histogram (macd line minus signal)"
              tone={(snapshot.momentum.macdHist ?? 0) > 0 ? 'bull' : 'bear'}
            />
            <IndicatorTile
              label="ATR %"
              value={snapshot.volatility.atrPct?.toFixed(2) ?? '—'}
              title="ATR 14 as a percentage of price (average true range)"
            />
            <IndicatorTile
              label="Rel Vol"
              value={snapshot.volume.lastVsAvg ? `${snapshot.volume.lastVsAvg.toFixed(1)}x` : '—'}
              title="Latest candle volume vs the 20-candle average"
              tone={(snapshot.volume.lastVsAvg ?? 1) > 1.3 ? 'warn' : 'neutral'}
            />
            <IndicatorTile
              label="BB pos"
              value={snapshot.volatility.bbPosition !== null ? `${Math.round(snapshot.volatility.bbPosition * 100)}%` : '—'}
              title="Where price sits inside the Bollinger 20/2 bands (0% = lower band, 100% = upper band)"
              tone={
                snapshot.volatility.bbPosition !== null && snapshot.volatility.bbPosition > 0.8
                  ? 'warn'
                  : snapshot.volatility.bbPosition !== null && snapshot.volatility.bbPosition < 0.2
                    ? 'warn'
                    : 'neutral'
              }
            />
            <IndicatorTile
              label="EMA 20/50"
              value={emaStack === null ? '—' : emaStack ? '20 > 50' : '20 < 50'}
              title="EMA stack on this timeframe: 20 above 50 = short-term uptrend, below = downtrend"
              tone={emaStack === null ? 'neutral' : emaStack ? 'bull' : 'bear'}
            />
            <IndicatorTile
              label="24h pos"
              value={rangePos !== null ? `${Math.round(rangePos * 100)}%` : '—'}
              title="Where price sits inside the 24h low-to-high range (0% = at the low, 100% = at the high)"
              tone={
                rangePos !== null && (rangePos > 0.85 || rangePos < 0.15)
                  ? 'warn'
                  : 'neutral'
              }
            />
            <IndicatorTile
              label="Structure"
              value={
                snapshot.trend.structure.startsWith('HH/HL')
                  ? 'HH/HL'
                  : snapshot.trend.structure.startsWith('LH/LL')
                    ? 'LH/LL'
                    : 'Range'
              }
              title="Swing structure from the live candles: higher highs/higher lows, lower highs/lower lows, or range"
              tone={snapshot.trend.structure.startsWith('HH/HL') ? 'bull' : snapshot.trend.structure.startsWith('LH/LL') ? 'bear' : 'neutral'}
            />
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-zinc-600">
            Deterministic read of the live candles, the same data the chart shows (RSI 14 Wilder, MACD 12/26/9, ATR 14,
            Bollinger 20/2, EMA 20/50). Nothing here is invented.
          </p>
        </div>

        {/* invalidation + experience + news + risk */}
        <div className="space-y-2.5 px-4 py-3">
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
              <Shield className="h-3 w-3" aria-hidden="true" /> Invalidation
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">{ai.invalidation}</p>
          </div>
          {ai.experienceNote && (
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                <History className="h-3 w-3" aria-hidden="true" /> 20 years of pattern memory
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400">{ai.experienceNote}</p>
            </div>
          )}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
              <Zap className="h-3 w-3" aria-hidden="true" /> News impact
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">{ai.newsImpact}</p>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-2.5">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" aria-hidden="true" />
            <p className="text-[10px] leading-relaxed text-amber-200/80">{ai.riskWarning}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
