'use client'

import { useEffect, useState } from 'react'
import { Bell, MoonStar, Radio, ScanSearch, TrendingUp } from 'lucide-react'
import { useTerminal } from './store'
import { getMarketSession } from '@/lib/sessions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ─── Terminal header ─────────────────────────────────────────────────────────

export function Header() {
  const socketStatus = useTerminal((s) => s.socketStatus)
  const unread = useTerminal((s) => s.unread)
  const scanner = useTerminal((s) => s.scanner)
  const setView = useTerminal((s) => s.setView)
  const [, setClockTick] = useState(0)

  // keep the FX open/closed chip fresh
  useEffect(() => {
    const t = setInterval(() => setClockTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const fx = getMarketSession('FOREX')
  const gold = getMarketSession('METAL')

  const statusColor =
    socketStatus === 'live' ? 'bg-emerald-400' : socketStatus === 'connecting' ? 'bg-amber-400' : 'bg-red-400'
  const statusLabel = socketStatus === 'live' ? 'LIVE' : socketStatus === 'connecting' ? 'SYNCING' : 'OFFLINE'

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/70 bg-zinc-950/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-3 sm:px-4">
        {/* brand */}
        <div className="flex items-center gap-2.5">
          <div className="oracle-glow flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900">
            <svg viewBox="0 0 64 64" className="h-6 w-6" fill="none" aria-hidden="true">
              <path
                d="M32 14 C 44 14, 53 23, 55 32 C 53 41, 44 50, 32 50 C 20 50, 11 41, 9 32 C 11 23, 20 14, 32 14 Z"
                stroke="#10b981"
                strokeWidth="4"
              />
              <circle cx="32" cy="32" r="8" fill="#10b981" />
              <circle cx="32" cy="32" r="3.5" fill="#09090b" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold tracking-tight text-zinc-50">
                TradeOracle <span className="text-emerald-400">AI</span>
              </span>
            </div>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500 sm:block">
              AI Trading Intelligence
            </span>
          </div>
        </div>

        <div className="flex-1" />

        {/* FX market session chip */}
        <div
          className={cn(
            'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 sm:flex',
            fx.open
              ? 'border-zinc-800 bg-zinc-900/70'
              : 'border-amber-500/40 bg-amber-500/10'
          )}
          title={fx.market === 'FOREX' ? `Forex · ${fx.detail}` : fx.detail}
        >
          {fx.open ? (
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-amber-400" />
          ) : (
            <MoonStar className="h-3 w-3 text-amber-400" aria-hidden="true" />
          )}
          <span className={cn('text-[11px] font-semibold', fx.open ? 'text-zinc-400' : 'text-amber-400')}>
            FX {fx.open ? 'OPEN' : 'CLOSED'}
          </span>
        </div>

        {/* Gold market session chip */}
        <div
          className={cn(
            'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 md:flex',
            gold.open
              ? 'border-zinc-800 bg-zinc-900/70'
              : 'border-amber-500/40 bg-amber-500/10'
          )}
          title={`Gold · ${gold.detail}`}
        >
          {gold.open ? (
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-yellow-400" />
          ) : (
            <MoonStar className="h-3 w-3 text-amber-400" aria-hidden="true" />
          )}
          <span className={cn('text-[11px] font-semibold', gold.open ? 'text-zinc-400' : 'text-amber-400')}>
            XAU {gold.open ? 'OPEN' : 'CLOSED'}
          </span>
        </div>

        {/* live status */}
        <div className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 md:flex">
          <span className={cn('pulse-dot h-1.5 w-1.5 rounded-full', statusColor)} />
          <span className="num text-[11px] font-semibold tracking-wide text-zinc-300">{statusLabel}</span>
        </div>

        {/* scanner status */}
        {scanner && (
          <div className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 lg:flex">
            {scanner.running ? (
              <>
                <ScanSearch className="h-3.5 w-3.5 animate-pulse text-emerald-400" aria-hidden="true" />
                <span className="text-[11px] font-medium text-emerald-400">Scanning markets…</span>
              </>
            ) : scanner.autoScan ? (
              <>
                <Radio className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                <span className="num text-[11px] text-zinc-400">
                  Next scan{' '}
                  {scanner.nextScanAt
                    ? `in ${Math.max(0, Math.round((scanner.nextScanAt - Date.now()) / 60000))}m`
                    : 'soon'}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-zinc-500">Auto-scan off</span>
            )}
          </div>
        )}

        {/* market pulse hint */}
        <Button
          variant="ghost"
          size="sm"
          className="hidden gap-1.5 text-zinc-400 hover:text-emerald-400 xl:flex"
          onClick={() => setView('terminal')}
        >
          <TrendingUp className="h-4 w-4" aria-hidden="true" />
          Terminal
        </Button>

        {/* notification bell */}
        <button
          onClick={() => setView('alerts')}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-400"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread > 0 && (
            <Badge className="absolute -right-1.5 -top-1.5 h-4 min-w-4 animate-bounce rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-zinc-950">
              {unread > 99 ? '99+' : unread}
            </Badge>
          )}
        </button>
      </div>
    </header>
  )
}
