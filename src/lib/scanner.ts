import { db } from './db'
import { analyzeSymbol } from './analyst'
import { getSymbolMeta } from './markets'
import { isForexClosed, isMetalClosed } from './sessions'
import { getSettings } from './settings'
import type { AnalysisResult } from './types'

// ─── Auto-scanner (serverless-safe) ───────────────────────────────────────────
// The old hub ran an in-process timer; on Vercel there is no long-lived process,
// so scanning is driven by /api/scanner/step — called every 60s by the open
// terminal and daily by a Vercel cron. State lives in the DB (AppSetting), so
// any invocation can decide cheaply whether a scan is due, and a stale lock
// (crashed invocation) self-heals after LOCK_TTL_MS.

const STATE_KEY = 'scannerState'

export interface ScannerState {
  running: boolean
  runningSince: number | null
  lastScan: { ts: number; scanned: number; notifications: number; durationMs: number } | null
  nextScanAt: number | null
}

const LOCK_TTL_MS = 5 * 60_000
const STAGGER_MS = 800

async function readState(): Promise<ScannerState> {
  const row = await db.appSetting.findUnique({ where: { key: STATE_KEY } })
  if (!row) return { running: false, runningSince: null, lastScan: null, nextScanAt: null }
  try {
    const parsed = JSON.parse(row.value)
    return {
      running: Boolean(parsed.running),
      runningSince: parsed.runningSince ?? null,
      lastScan: parsed.lastScan ?? null,
      nextScanAt: parsed.nextScanAt ?? null,
    }
  } catch {
    return { running: false, runningSince: null, lastScan: null, nextScanAt: null }
  }
}

async function writeState(state: ScannerState) {
  await db.appSetting.upsert({
    where: { key: STATE_KEY },
    update: { value: JSON.stringify(state) },
    create: { key: STATE_KEY, value: JSON.stringify(state) },
  })
}

/** Record a completed analysis; returns a notification when a scanner-driven verdict flip warrants one. */
export async function recordSignal(
  result: AnalysisResult,
  source: 'manual' | 'scanner'
): Promise<{ notification: any | null }> {
  const symbol = result.symbol
  const timeframe = result.timeframe

  await db.signalRecord.create({
    data: {
      symbol,
      timeframe,
      signal: result.ai.signal,
      confidence: result.ai.confidence,
      price: result.price,
      entry: result.ai.entry,
      entryLow: result.ai.entryZone?.[0] ?? null,
      entryHigh: result.ai.entryZone?.[1] ?? null,
      stopLoss: result.ai.stopLoss,
      takeProfit1: result.ai.takeProfit1,
      takeProfit2: result.ai.takeProfit2,
      riskReward: result.ai.riskReward,
      bias: result.ai.bias,
      timeHorizon: result.ai.timeHorizon,
      summary: result.ai.summary,
      rationale: JSON.stringify(result.ai.rationale),
      keyLevels: JSON.stringify(result.ai.keyLevels),
      invalidation: result.ai.invalidation,
      newsImpact: result.ai.newsImpact,
      indicators: JSON.stringify({
        rsi: result.snapshot.momentum.rsi,
        macdHist: result.snapshot.momentum.macdHist,
        structure: result.snapshot.trend.structure,
        atrPct: result.snapshot.volatility.atrPct,
        relVolume: result.snapshot.volume.lastVsAvg,
      }),
      source: result.source === 'rules' ? 'rules' : source,
    },
  })

  const watch = await db.watchItem.findUnique({ where: { symbol } })
  if (watch) {
    await db.watchItem.update({
      where: { symbol },
      data: {
        lastSignal: result.ai.signal,
        lastConfidence: result.ai.confidence,
        lastSignalAt: new Date(),
      },
    })
  }

  let notification: any = null
  if (source === 'scanner' && watch) {
    const changed = watch.lastSignal !== result.ai.signal
    const confDelta = Math.abs((watch.lastConfidence ?? 0) - result.ai.confidence)
    const firstScan = watch.lastSignal === null
    if (firstScan || changed || confDelta >= 15) {
      const meta = getSymbolMeta(symbol)
      const title =
        result.ai.signal === 'KEEP_OFF'
          ? `${meta.displaySymbol} ${timeframe}: Stand aside — no trade (conviction ${result.ai.confidence}%)`
          : result.ai.signal === 'LONG'
            ? `${meta.displaySymbol} ${timeframe}: GO LONG ${result.ai.confidence}%`
            : `${meta.displaySymbol} ${timeframe}: GO SHORT ${result.ai.confidence}%`
      notification = await db.notification.create({
        data: {
          type: 'SIGNAL',
          symbol,
          title,
          body: result.ai.summary,
          signal: result.ai.signal,
          confidence: result.ai.confidence,
        },
      })
    }
  }

  return { notification }
}

export interface ScanStepResult {
  ran: boolean
  reason?: 'busy' | 'paused' | 'not-due' | 'empty' | 'locked'
  scanned: number
  skipped: number
  notifications: any[]
  status: ScannerState & { autoScan: boolean; scanIntervalMin: number }
}

/**
 * One on-demand scanner step. Safe to call frequently — it no-ops unless a
 * scan is due (or force=true). Skips forex pairs while FX is closed and gold
 * while the spot metals market is closed (frozen weekend data would only burn
 * LLM calls re-analyzing Friday's close).
 */
export async function runScannerStep(force: boolean): Promise<ScanStepResult> {
  const settings = await getSettings()
  let state = await readState()

  const baseStatus = (s: ScannerState) => ({
    ...s,
    autoScan: settings.autoScan,
    scanIntervalMin: settings.scanIntervalMin,
  })

  // stale lock self-heal
  if (state.running && (state.runningSince ?? 0) < Date.now() - LOCK_TTL_MS) {
    state = { ...state, running: false, runningSince: null }
  }

  if (state.running) {
    return { ran: false, reason: 'busy', scanned: 0, skipped: 0, notifications: [], status: baseStatus(state) }
  }
  if (!force && !settings.autoScan) {
    return { ran: false, reason: 'paused', scanned: 0, skipped: 0, notifications: [], status: baseStatus(state) }
  }
  if (!force && state.nextScanAt && Date.now() < state.nextScanAt) {
    return { ran: false, reason: 'not-due', scanned: 0, skipped: 0, notifications: [], status: baseStatus(state) }
  }

  const items = await db.watchItem.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } })
  if (items.length === 0) {
    return { ran: false, reason: 'empty', scanned: 0, skipped: 0, notifications: [], status: baseStatus(state) }
  }

  // acquire lock
  await writeState({ ...state, running: true, runningSince: Date.now() })

  const t0 = Date.now()
  let scanned = 0
  let skipped = 0
  const notifications: any[] = []
  const fxOpen = !isForexClosed()
  const metalOpen = !isMetalClosed()

  for (const item of items) {
    const meta = getSymbolMeta(item.symbol)
    if (meta.market === 'FOREX' && !fxOpen) { skipped++; continue }
    if (meta.market === 'METAL' && !metalOpen) { skipped++; continue }
    try {
      const result = await analyzeSymbol(item.symbol, item.timeframe ?? '1h', { force: true })
      const { notification } = await recordSignal(result, 'scanner')
      scanned++
      if (notification) notifications.push(notification)
    } catch (e) {
      console.error(`[scanner] analysis failed for ${item.symbol}:`, (e as Error).message)
    }
    await new Promise((r) => setTimeout(r, STAGGER_MS))
  }

  const finalState: ScannerState = {
    running: false,
    runningSince: null,
    lastScan: { ts: Date.now(), scanned, notifications: notifications.length, durationMs: Date.now() - t0 },
    nextScanAt: Date.now() + Math.max(5, settings.scanIntervalMin) * 60_000,
  }
  await writeState(finalState)

  return {
    ran: true,
    scanned,
    skipped,
    notifications,
    status: baseStatus(finalState),
  }
}
