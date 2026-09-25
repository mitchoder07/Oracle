'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Star, X } from 'lucide-react'
import { useTerminal, changeColor, signalBg } from './store'
import { formatPrice, getSymbolMeta } from '@/lib/markets'
import { getMarketSession } from '@/lib/sessions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { MarketCategory } from '@/lib/types'

// ─── Watchlist panel — live prices + AI signal badges ────────────────────────

const MARKET_LABEL: Record<string, string> = { CRYPTO: 'Crypto', FOREX: 'Forex', METAL: 'Gold' }

export function Watchlist() {
  const watchlist = useTerminal((s) => s.watchlist)
  const ticks = useTerminal((s) => s.ticks)
  const universe = useTerminal((s) => s.universe)
  const selectedSymbol = useTerminal((s) => s.selectedSymbol)
  const selectSymbol = useTerminal((s) => s.selectSymbol)
  const upsertWatchItem = useTerminal((s) => s.upsertWatchItem)
  const removeWatchItemLocal = useTerminal((s) => s.removeWatchItemLocal)
  const setView = useTerminal((s) => s.setView)

  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setClockTick] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  // keep market open/closed state fresh
  useEffect(() => {
    const t = setInterval(() => setClockTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const fxSession = getMarketSession('FOREX')
  const goldSession = getMarketSession('METAL')

  const available = useMemo(() => {
    const inList = new Set(watchlist.map((w) => w.symbol))
    return universe
      .filter((u) => !inList.has(u.symbol))
      .filter((u) => {
        if (!query.trim()) return true
        const q = query.trim().toLowerCase()
        return (
          u.displaySymbol.toLowerCase().includes(q) ||
          u.name.toLowerCase().includes(q) ||
          u.symbol.toLowerCase().includes(q)
        )
      })
      .slice(0, 40)
  }, [universe, watchlist, query])

  async function addSymbol(symbol: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
      const data = await res.json()
      if (data?.item) upsertWatchItem(data.item)
      setQuery('')
    } finally {
      setBusy(false)
    }
  }

  async function removeSymbol(symbol: string) {
    removeWatchItemLocal(symbol)
    fetch(`/api/watchlist?symbol=${symbol}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50">
      <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Star className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Watchlist</h2>
          <Badge variant="secondary" className="num h-4 px-1.5 text-[9px]">
            {watchlist.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-zinc-400 hover:text-emerald-400"
          onClick={() => setAdding((v) => !v)}
          aria-label="Add pair to watchlist"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {adding && (
        <div className="border-b border-zinc-800/70 bg-zinc-900/50 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search crypto / forex pairs…"
              className="num h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
              autoFocus
            />
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto">
            {available.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-zinc-500">No pairs found</p>
            )}
            {available.map((u) => (
              <button
                key={u.symbol}
                disabled={busy}
                onClick={() => addSymbol(u.symbol)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/70 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <span className="num text-xs font-semibold text-zinc-200">{u.displaySymbol}</span>
                  <span className="max-w-28 truncate text-[10px] text-zinc-500">{u.name}</span>
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    'h-4 px-1.5 text-[8px] font-semibold uppercase',
                    u.market === 'FOREX' && 'border-amber-500/30 text-amber-400',
                    u.market === 'METAL' && 'border-yellow-500/30 text-yellow-500',
                    u.market === 'CRYPTO' && 'border-zinc-600 text-zinc-400'
                  )}
                >
                  {MARKET_LABEL[u.market] ?? u.market}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {watchlist.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-zinc-500">
            Watchlist is empty. Add a pair to start getting AI signal alerts.
          </p>
        )}
        {watchlist.map((item) => {
          const t = ticks[item.symbol]
          const meta = getSymbolMeta(item.symbol)
          const active = item.symbol === selectedSymbol
          return (
            <div
              key={item.symbol}
              className={cn(
                'group relative flex cursor-pointer items-center gap-2 border-b border-zinc-800/40 px-3 py-2.5 transition-colors',
                active ? 'bg-emerald-500/[0.07]' : 'hover:bg-zinc-900/60'
              )}
              onClick={() => {
                selectSymbol(item.symbol)
                setView('terminal')
              }}
              role="button"
              aria-label={`Select ${meta.displaySymbol}`}
            >
              {active && <span className="absolute left-0 top-0 h-full w-0.5 bg-emerald-400" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="num truncate text-xs font-semibold text-zinc-100">{meta.displaySymbol}</span>
                  <span
                    className={cn(
                      'h-1 w-1 shrink-0 rounded-full',
                      item.market === 'FOREX'
                        ? fxSession.open
                          ? 'bg-amber-400'
                          : 'bg-red-400/70'
                        : item.market === 'METAL'
                          ? goldSession.open
                            ? 'bg-yellow-400'
                            : 'bg-red-400/70'
                          : 'bg-zinc-500'
                    )}
                    title={
                      item.market === 'FOREX'
                        ? `Forex · ${fxSession.open ? 'market open' : `market closed (${fxSession.detail})`}`
                        : item.market === 'METAL'
                          ? `Gold · ${goldSession.open ? 'spot market open' : `spot closed (${goldSession.detail})`}`
                          : MARKET_LABEL[item.market] ?? item.market
                    }
                  />
                  {item.market === 'FOREX' && !fxSession.open && (
                    <span className="shrink-0 rounded border border-red-400/30 px-1 text-[8px] font-semibold uppercase text-red-400/90">
                      closed
                    </span>
                  )}
                  {item.market === 'METAL' && !goldSession.open && (
                    <span className="shrink-0 rounded border border-red-400/30 px-1 text-[8px] font-semibold uppercase text-red-400/90">
                      spot closed
                    </span>
                  )}
                </div>
                <span className="block max-w-32 truncate text-[10px] text-zinc-500">{meta.name}</span>
              </div>
              <div className={cn('text-right', (item.market === 'FOREX' && !fxSession.open) || (item.market === 'METAL' && !goldSession.open) ? 'opacity-60' : '')}>
                <div
                  className={cn(
                    'num text-xs font-semibold',
                    t?.dir === 'up' && 'flash-up',
                    t?.dir === 'down' && 'flash-down'
                  )}
                >
                  {t ? formatPrice(t.price, meta.tickDigits) : '—'}
                </div>
                <div className={cn('num text-[10px] font-semibold', changeColor(t?.changePct ?? 0))}>
                  {t ? `${t.changePct > 0 ? '+' : ''}${t.changePct.toFixed(2)}%` : '—'}
                </div>
              </div>
              {item.lastSignal && (
                <span
                  className={cn(
                    'num w-9 shrink-0 rounded border px-1 py-0.5 text-center text-[9px] font-bold',
                    signalBg(item.lastSignal)
                  )}
                  title={`Last AI verdict: ${item.lastSignal} ${item.lastConfidence ?? ''}%`}
                >
                  {item.lastSignal === 'LONG' ? 'LONG' : item.lastSignal === 'SHORT' ? 'SHORT' : 'OFF'}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeSymbol(item.symbol)
                }}
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-red-400 group-hover:flex"
                aria-label={`Remove ${meta.displaySymbol} from watchlist`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>
      {/* weekend footnote */}
      {((watchlist.some((i) => i.market === 'FOREX') && !fxSession.open) ||
        (watchlist.some((i) => i.market === 'METAL') && !goldSession.open)) && (
        <div className="border-t border-amber-500/20 bg-amber-500/[0.06] px-3 py-1.5 text-[10px] text-amber-300/90">
          {watchlist.some((i) => i.market === 'FOREX') && !fxSession.open && (
            <span>Forex is closed right now ({fxSession.detail}). Prices are frozen at Friday’s close.</span>
          )}
          {watchlist.some((i) => i.market === 'METAL') && !goldSession.open && (
            <span> Gold spot is closed right now ({goldSession.detail}).</span>
          )}
        </div>
      )}
    </div>
  )
}
