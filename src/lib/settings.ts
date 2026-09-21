import { db } from '@/lib/db'
import type { ScannerSettings } from './types'

// ─── App settings persistence (key-value in SQLite) ──────────────────────────

const SETTINGS_KEY = 'scanner'

export const DEFAULT_SETTINGS: ScannerSettings = {
  autoScan: true,
  scanIntervalMin: 10,
  minConfidence: 60,
  soundAlerts: true,
  browserPush: false,
  notifyOnSignalChange: true,
  notifyAllSignals: false,
}

export async function getSettings(): Promise<ScannerSettings> {
  const row = await db.appSetting.findUnique({ where: { key: SETTINGS_KEY } })
  if (!row) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(row.value)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(patch: Partial<ScannerSettings>): Promise<ScannerSettings> {
  const current = await getSettings()
  const next: ScannerSettings = { ...current, ...patch }
  // clamp
  next.scanIntervalMin = Math.max(5, Math.min(60, Math.round(next.scanIntervalMin)))
  next.minConfidence = Math.max(0, Math.min(100, Math.round(next.minConfidence)))
  await db.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
  })
  return next
}
