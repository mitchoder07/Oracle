'use client'

import { create } from 'zustand'
import type { NotificationItem, ScannerSettings, SymbolMeta, WatchItemDTO } from '@/lib/types'

// ─── Terminal state (zustand) ────────────────────────────────────────────────

export interface LiveTick {
  symbol: string
  price: number
  open: number
  high: number
  low: number
  changePct: number
  volume: number
  ts: number
  dir?: 'up' | 'down'
  /** Feed health metadata (gold spot feed): source + age + stale flag. */
  meta?: { source: string; asOf: number; stale: boolean; marketOpen: boolean }
}

export interface ScannerStatus {
  running: boolean
  autoScan: boolean
  scanIntervalMin: number
  lastScan: { ts: number; scanned: number; notifications: number; durationMs: number } | null
  nextScanAt: number | null
}

export type View = 'terminal' | 'news' | 'alerts' | 'chat'

interface TerminalState {
  // view
  view: View
  setView: (v: View) => void

  // selection
  selectedSymbol: string
  timeframe: string
  selectSymbol: (s: string) => void
  setTimeframe: (tf: string) => void

  // universe
  universe: SymbolMeta[]
  setUniverse: (u: SymbolMeta[]) => void

  // live data
  ticks: Record<string, LiveTick>
  applyTicks: (batch: LiveTick[]) => void

  // socket
  socketStatus: 'connecting' | 'live' | 'offline'
  setSocketStatus: (s: 'connecting' | 'live' | 'offline') => void

  // watchlist
  watchlist: WatchItemDTO[]
  setWatchlist: (w: WatchItemDTO[]) => void
  upsertWatchItem: (w: WatchItemDTO) => void
  removeWatchItemLocal: (symbol: string) => void

  // notifications
  notifications: NotificationItem[]
  unread: number
  setNotifications: (n: NotificationItem[], unread: number) => void
  pushNotification: (n: NotificationItem) => void
  markAllReadLocal: () => void

  // scanner
  scanner: ScannerStatus | null
  setScanner: (s: ScannerStatus) => void

  // settings
  settings: ScannerSettings | null
  setSettings: (s: ScannerSettings) => void
}

export const useTerminal = create<TerminalState>((set) => ({
  view: 'terminal',
  setView: (v) => set({ view: v }),

  selectedSymbol: 'BTCUSDT',
  timeframe: '1h',
  selectSymbol: (s) => set({ selectedSymbol: s }),
  setTimeframe: (tf) => set({ timeframe: tf }),

  universe: [],
  setUniverse: (u) => set({ universe: u }),

  ticks: {},
  applyTicks: (batch) =>
    set((state) => {
      const next = { ...state.ticks }
      for (const t of batch) {
        const prev = next[t.symbol]
        const dir = prev && prev.price !== t.price ? (t.price > prev.price ? 'up' : 'down') : prev?.dir
        next[t.symbol] = { ...t, dir }
      }
      return { ticks: next }
    }),

  socketStatus: 'connecting',
  setSocketStatus: (s) => set({ socketStatus: s }),

  watchlist: [],
  setWatchlist: (w) => set({ watchlist: w }),
  upsertWatchItem: (w) =>
    set((state) => {
      const exists = state.watchlist.find((x) => x.symbol === w.symbol)
      return {
        watchlist: exists
          ? state.watchlist.map((x) => (x.symbol === w.symbol ? w : x))
          : [...state.watchlist, w],
      }
    }),
  removeWatchItemLocal: (symbol) =>
    set((state) => ({ watchlist: state.watchlist.filter((x) => x.symbol !== symbol) })),

  notifications: [],
  unread: 0,
  setNotifications: (n, unread) => set({ notifications: n, unread }),
  pushNotification: (n) =>
    set((state) => ({
      notifications: [n, ...state.notifications].slice(0, 100),
      unread: state.unread + 1,
    })),
  markAllReadLocal: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unread: 0,
    })),

  scanner: null,
  setScanner: (s) => set({ scanner: s }),

  settings: null,
  setSettings: (s) => set({ settings: s }),
}))

// ─── helpers ────────────────────────────────────────────────────────────────

export function signalColor(signal?: string | null): string {
  if (signal === 'LONG') return 'text-emerald-400'
  if (signal === 'SHORT') return 'text-red-400'
  if (signal === 'KEEP_OFF') return 'text-amber-400'
  return 'text-zinc-500'
}

export function signalBg(signal?: string | null): string {
  if (signal === 'LONG') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  if (signal === 'SHORT') return 'bg-red-500/15 text-red-400 border-red-500/30'
  if (signal === 'KEEP_OFF') return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  return 'bg-zinc-800 text-zinc-400 border-zinc-700'
}

export function changeColor(v: number): string {
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-zinc-400'
}

// ─── sound + browser notifications ───────────────────────────────────────────

let audioCtx: AudioContext | null = null

export function playAlertSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtx!
    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.setValueAtTime(660, now + 0.12)
    osc.connect(gain)
    osc.start(now)
    osc.stop(now + 0.5)
  } catch { /* audio unavailable */ }
}

export function showBrowserNotification(title: string, body?: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/oracle-icon.svg', tag: 'tradeoracle-signal' })
    }
  } catch { /* notifications unavailable */ }
}
