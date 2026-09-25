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
          cx="40"
          cy="40"
          r={r}
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

function IndicatorTile({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' | 'neutral' | 'warn' }) {
  const toneClass =
    tone === 'bull'
      ? 'text-emerald-400'
      : tone === 'bear'
        ? 'text-red-400'
        : tone === 'warn'
          ? 'text-amber-400'
          : 'text-zinc-300'
  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn('num text-[11px] font-semibold leading-tight', toneClass)}>{value}</div>
    </div>
  )
}

export function SignalPanel({ analysis, analyzing, onReanalyze }: Props) {
  const symbol = useTerminal((s) => s.selectedSymbol)
  const timeframe = useTerminal((s) => s.timeframe)
  const meta = getSymbolMeta(symbol)

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

  // human-friendly validity: "~36h" → "1.5 days", "~8h" → "8h"
  const validLabel =
    ai.validHours === null
      ? null
      : ai.validHours >= 48
        ? `${(ai.validHours / 24).toFixed(ai.validHours % 24 === 0 ? 0 : 1)} days`
        : `${ai.validHours}h`

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
                <span className="num text-[10px] text-zinc-500">
                  {meta.displaySymbol} · {timeframe} · {ai.timeHorizon}
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <LevelTile
                label="Entry"
                value={ai.entryZone ? (ai.entryZone[0] + ai.entryZone[1]) / 2 : ai.entry}
                digits={meta.tickDigits}
                tone="entry"
                hint={ai.entryZone ? `zone ${formatPrice(ai.entryZone[0], meta.tickDigits)}–${formatPrice(ai.entryZone[1], meta.tickDigits)}` : undefined}
              />
              <LevelTile label="Stop loss" value={ai.stopLoss} digits={meta.tickDigits} tone="sl" />
              <LevelTile label="Target 1" value={ai.takeProfit1} digits={meta.tickDigits} tone="tp" />
              <LevelTile
                label="R:R"
                value={ai.riskReward}
                digits={2}
                tone="rr"
                hint={ai.riskReward ? `${ai.riskReward.toFixed(2)} : 1` : undefined}
              />
            </div>
            {ai.takeProfit2 !== null && (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <LevelTile label="Target 2" value={ai.takeProfit2} digits={meta.tickDigits} tone="tp" />
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
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            <IndicatorTile
              label="RSI 14"
              value={snapshot.momentum.rsi?.toFixed(1) ?? '—'}
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
              tone={(snapshot.momentum.macdHist ?? 0) > 0 ? 'bull' : 'bear'}
            />
            <IndicatorTile label="ATR %" value={snapshot.volatility.atrPct?.toFixed(2) ?? '—'} />
            <IndicatorTile
              label="Rel Vol"
              value={snapshot.volume.lastVsAvg ? `${snapshot.volume.lastVsAvg.toFixed(1)}x` : '—'}
              tone={(snapshot.volume.lastVsAvg ?? 1) > 1.3 ? 'warn' : 'neutral'}
            />
            <IndicatorTile
              label="BB pos"
              value={snapshot.volatility.bbPosition !== null ? `${Math.round(snapshot.volatility.bbPosition * 100)}%` : '—'}
              tone={
                snapshot.volatility.bbPosition !== null && snapshot.volatility.bbPosition > 0.8
                  ? 'warn'
                  : snapshot.volatility.bbPosition !== null && snapshot.volatility.bbPosition < 0.2
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
              tone={snapshot.trend.structure.startsWith('HH/HL') ? 'bull' : snapshot.trend.structure.startsWith('LH/LL') ? 'bear' : 'neutral'}
            />
          </div>
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
