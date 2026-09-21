'use client'

import { useState } from 'react'
import {
  BellRing,
  CheckCheck,
  Radar,
  RefreshCcw,
  ScanSearch,
  Trash2,
  Volume2,
} from 'lucide-react'
import { useTerminal, signalBg, signalColor } from './store'
import { getOracleFeeds } from '@/lib/feeds'
import { getSymbolMeta } from '@/lib/markets'
import type { ScannerSettings } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'

// ─── Alerts center — notifications + auto-scanner control ────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function AlertsCenter() {
  const notifications = useTerminal((s) => s.notifications)
  const unread = useTerminal((s) => s.unread)
  const markAllReadLocal = useTerminal((s) => s.markAllReadLocal)
  const scanner = useTerminal((s) => s.scanner)
  const settings = useTerminal((s) => s.settings)
  const setSettings = useTerminal((s) => s.setSettings)
  const selectSymbol = useTerminal((s) => s.selectSymbol)
  const setView = useTerminal((s) => s.setView)
  const [saving, setSaving] = useState(false)

  async function patchSettings(patch: Partial<ScannerSettings>) {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (data?.settings) setSettings(data.settings)
    } finally {
      setSaving(false)
    }
  }

  async function requestPushPermission(enabled: boolean) {
    if (enabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      try {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') {
          patchSettings({ browserPush: false })
          return
        }
      } catch {
        patchSettings({ browserPush: false })
        return
      }
    }
    patchSettings({ browserPush: enabled })
  }

  async function markAllRead() {
    markAllReadLocal()
    fetch('/api/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'read-all' }),
    }).catch(() => {})
  }

  async function clearAll() {
    useTerminal.getState().setNotifications([], 0)
    fetch('/api/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    }).catch(() => {})
  }

  async function runScanNow() {
    try {
      await getOracleFeeds().emit('scan:run')
    } catch { /* network hiccup — scanner status stays honest */ }
  }

  const s = settings

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* notifications */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50 lg:col-span-2">
        <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Signal Alerts</h2>
            {unread > 0 && (
              <Badge className="h-4 bg-emerald-500 px-1.5 text-[9px] font-bold text-zinc-950">{unread} new</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-zinc-400 hover:text-emerald-400"
              onClick={markAllRead}
              disabled={unread === 0}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark read
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
              onClick={clearAll}
              disabled={notifications.length === 0}
              aria-label="Clear all notifications"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="max-h-[520px] flex-1 overflow-y-auto">
          {notifications.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Radar className="h-8 w-8 text-zinc-700" aria-hidden="true" />
              <p className="text-xs text-zinc-500">No alerts yet.</p>
              <p className="max-w-xs text-[11px] text-zinc-600">
                The auto-scanner watches your watchlist around the clock and pushes a notification the moment an AI
                verdict changes. Keep this terminal open.
              </p>
            </div>
          )}
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (n.symbol) {
                  selectSymbol(n.symbol)
                  setView('terminal')
                }
              }}
              className={cn(
                'flex w-full items-start gap-3 border-b border-zinc-800/40 px-3 py-3 text-left transition-colors hover:bg-zinc-900/50',
                !n.read && 'bg-emerald-500/[0.04]'
              )}
            >
              <span
                className={cn(
                  'num mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold',
                  signalBg(n.signal)
                )}
              >
                {n.signal === 'LONG' ? 'LONG' : n.signal === 'SHORT' ? 'SHORT' : 'OFF'}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('num text-xs font-semibold', !n.read ? 'text-zinc-100' : 'text-zinc-400')}>
                  {n.title}
                </p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{n.body}</p>}
                <p className="num mt-1 text-[9px] text-zinc-600">
                  {n.symbol ? `${getSymbolMeta(n.symbol).displaySymbol} · ` : ''}
                  {timeAgo(n.createdAt)}
                </p>
              </div>
              {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />}
            </button>
          ))}
        </div>
      </div>

      {/* scanner settings */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50">
        <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Auto-Scanner</h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 border-emerald-500/30 px-2 text-[11px] text-emerald-400 hover:bg-emerald-500/10"
            onClick={runScanNow}
            disabled={scanner?.running}
          >
            <RefreshCcw className={cn('h-3 w-3', scanner?.running && 'animate-spin')} />
            {scanner?.running ? 'Scanning…' : 'Scan now'}
          </Button>
        </div>

        <div className="flex-1 space-y-4 p-3.5">
          {/* status readout */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
            <div className="num space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-500">Status</span>
                <span className={scanner?.running ? 'text-emerald-400' : s?.autoScan ? 'text-zinc-300' : 'text-zinc-500'}>
                  {scanner?.running ? 'Scanning markets…' : s?.autoScan ? 'Armed · watching' : 'Paused'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Interval</span>
                <span className="text-zinc-300">every {s?.scanIntervalMin ?? 10} min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Next scan</span>
                <span className="text-zinc-300">
                  {scanner?.nextScanAt
                    ? `in ${Math.max(0, Math.round((scanner.nextScanAt - Date.now()) / 60000))}m`
                    : '—'}
                </span>
              </div>
              {scanner?.lastScan && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Last scan</span>
                  <span className="text-zinc-300">
                    {scanner.lastScan.scanned} pairs · {scanner.lastScan.notifications} alerts
                  </span>
                </div>
              )}
            </div>
          </div>

          {!s ? (
            <div className="shimmer h-40 rounded-lg" />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-zinc-200">Auto-scan watchlist</p>
                  <p className="text-[10px] text-zinc-500">Periodically run AI analysis on all watchlist pairs</p>
                </div>
                <Switch
                  checked={s.autoScan}
                  onCheckedChange={(v) => patchSettings({ autoScan: v })}
                  disabled={saving}
                  aria-label="Toggle auto-scan"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-zinc-200">Scan interval</p>
                  <p className="text-[10px] text-zinc-500">How often the scanner re-analyzes</p>
                </div>
                <Select
                  value={String(s.scanIntervalMin)}
                  onValueChange={(v) => patchSettings({ scanIntervalMin: Number(v) })}
                  disabled={saving}
                >
                  <SelectTrigger className="num h-8 w-24 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 10, 15, 30, 60].map((m) => (
                      <SelectItem key={m} value={String(m)} className="num text-[11px]">
                        {m} min
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-zinc-200">Push notification threshold</p>
                    <p className="text-[10px] text-zinc-500">Browser alerts only fire above this confidence</p>
                  </div>
                  <span className="num text-xs font-bold text-emerald-400">{s.minConfidence}%</span>
                </div>
                <Slider
                  value={[s.minConfidence]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={([v]) => patchSettings({ minConfidence: v })}
                  disabled={saving}
                  aria-label="Minimum confidence for push notifications"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-medium text-zinc-200">Sound alerts</p>
                    <p className="text-[10px] text-zinc-500">Play a tone on new signals</p>
                  </div>
                </div>
                <Switch
                  checked={s.soundAlerts}
                  onCheckedChange={(v) => patchSettings({ soundAlerts: v })}
                  disabled={saving}
                  aria-label="Toggle sound alerts"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-zinc-200">Browser push</p>
                  <p className="text-[10px] text-zinc-500">Desktop notifications for high-confidence trades</p>
                </div>
                <Switch
                  checked={s.browserPush}
                  onCheckedChange={requestPushPermission}
                  disabled={saving}
                  aria-label="Toggle browser push notifications"
                />
              </div>

              <p className="border-t border-zinc-800/60 pt-3 text-[10px] leading-relaxed text-zinc-600">
                Notifications are triggered when an AI verdict <em>changes</em> (e.g. LONG → SHORT, or a new KEEP_OFF
                after a trade call) or when confidence shifts by 15+ points — no spam, only meaningful flips.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
