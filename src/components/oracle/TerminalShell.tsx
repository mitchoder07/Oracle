'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Brain, LayoutDashboard, Newspaper, BellRing } from 'lucide-react'
import { useTerminal, type View } from './store'
import { useOracleSocket } from './useSocket'
import { Header } from './Header'
import { TickerTape } from './TickerTape'
import { Watchlist } from './Watchlist'
import { ChartPanel } from './ChartPanel'
import { SignalPanel } from './SignalPanel'
import { NewsFeed } from './NewsFeed'
import { AlertsCenter } from './AlertsCenter'
import { ChatPanel } from './ChatPanel'
import type { AnalysisResult } from '@/lib/types'
import { cn } from '@/lib/utils'

// ─── Terminal shell — view switching + data bootstrap + analysis flow ────────

const NAV_ITEMS: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: 'terminal', label: 'Terminal', icon: LayoutDashboard },
  { view: 'news', label: 'News', icon: Newspaper },
  { view: 'alerts', label: 'Alerts', icon: BellRing },
  { view: 'chat', label: 'Ask ORACLE', icon: Brain },
]

export function TerminalShell() {
  useOracleSocket()

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 5 * 60 * 1000,
          },
        },
      })
  )

  const view = useTerminal((s) => s.view)
  const setView = useTerminal((s) => s.setView)
  const selectedSymbol = useTerminal((s) => s.selectedSymbol)
  const timeframe = useTerminal((s) => s.timeframe)
  const unread = useTerminal((s) => s.unread)
  const setUniverse = useTerminal((s) => s.setUniverse)
  const setWatchlist = useTerminal((s) => s.setWatchlist)
  const setNotifications = useTerminal((s) => s.setNotifications)
  const setSettings = useTerminal((s) => s.setSettings)
  const applyTicks = useTerminal((s) => s.applyTicks)

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const analysisKeyRef = useRef('')

  // ── bootstrap ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/market/symbols')
        const data = await res.json()
        if (!cancelled && data?.symbols) setUniverse(data.symbols)
      } catch { /* best-effort */ }

      try {
        const res = await fetch('/api/watchlist')
        const data = await res.json()
        if (!cancelled && data?.items) setWatchlist(data.items)
      } catch { /* best-effort */ }

      try {
        const res = await fetch('/api/notifications?limit=50')
        const data = await res.json()
        if (!cancelled && data?.notifications)
          setNotifications(data.notifications, data.unread ?? 0)
      } catch { /* best-effort */ }

      try {
        const res = await fetch('/api/settings')
        const data = await res.json()
        if (!cancelled && data?.settings) setSettings(data.settings)
      } catch { /* best-effort */ }

      // hydrate tickers (WS takes over within a second)
      try {
        const res = await fetch('/api/market/tickers')
        const data = await res.json()
        if (!cancelled && Array.isArray(data?.tickers)) {
          applyTicks(
            data.tickers.map((t: any) => ({
              symbol: t.symbol,
              price: t.price,
              open: t.open ?? t.price,
              high: t.high ?? t.price,
              low: t.low ?? t.price,
              changePct: t.changePct ?? 0,
              volume: t.volume ?? 0,
              ts: Date.now(),
            }))
          )
        }
      } catch { /* best-effort */ }
    })()
    return () => {
      cancelled = true
    }
  }, [applyTicks, setNotifications, setSettings, setUniverse, setWatchlist])

  // ── keep watchlist badges fresh (scanner updates them every cycle) ──
  useEffect(() => {
    const id = setInterval(() => {
      fetch('/api/watchlist')
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d?.items)) setWatchlist(d.items)
        })
        .catch(() => {})
    }, 60_000)
    return () => clearInterval(id)
  }, [setWatchlist])

  // ── analysis flow ──
  const runAnalysis = useCallback(
    async (force: boolean) => {
      setAnalyzing(true)
      try {
        const res = await fetch('/api/analysis', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symbol: selectedSymbol, timeframe, source: 'manual', force }),
        })
        const data = await res.json()
        if (data?.result) setAnalysis(data.result)
      } catch { /* UI keeps previous analysis */ } finally {
        setAnalyzing(false)
      }
    },
    [selectedSymbol, timeframe]
  )

  useEffect(() => {
    const key = `${selectedSymbol}:${timeframe}`
    if (analysisKeyRef.current === key) return
    analysisKeyRef.current = key
    setAnalysis(null)
    runAnalysis(false)
  }, [selectedSymbol, timeframe, runAnalysis])

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col">
        <Header />
        <TickerTape />

      {/* nav */}
      <nav
        className="sticky top-14 z-30 border-b border-zinc-800/70 bg-zinc-950/85 backdrop-blur-md"
        aria-label="Main navigation"
      >
        <div className="relative mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-2 py-1.5 sm:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = view === item.view
            return (
              <button
                key={item.view}
                onClick={() => setView(item.view)}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3',
                  active
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-300'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {item.view === 'chat' ? (
                  <span>
                    <span className="hidden sm:inline">Ask </span>ORACLE
                  </span>
                ) : (
                  item.label
                )}
                {item.view === 'alerts' && unread > 0 && (
                  <span className="num ml-0.5 rounded-full bg-emerald-500 px-1.5 text-[9px] font-bold text-zinc-950">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            )
          })}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-zinc-950 to-transparent sm:hidden" aria-hidden="true" />
        </div>
      </nav>

      {/* main */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-4">
        {view === 'terminal' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* mobile watchlist comes after chart+signal; desktop: left rail */}
            <div className="order-3 max-h-[480px] lg:order-1 lg:col-span-3 xl:col-span-3">
              <Watchlist />
            </div>
            <div className="order-1 min-h-[440px] lg:order-2 lg:col-span-5 xl:col-span-6">
              <ChartPanel analysis={analysis} analyzing={analyzing} />
            </div>
            <div className="order-2 min-h-[440px] lg:order-3 lg:col-span-4 xl:col-span-3">
              <SignalPanel
                analysis={analysis}
                analyzing={analyzing}
                onReanalyze={() => runAnalysis(true)}
              />
            </div>
          </div>
        )}

        {view === 'news' && (
          <div className="mx-auto h-[calc(100vh-190px)] min-h-[560px] max-w-3xl">
            <NewsFeed />
          </div>
        )}

        {view === 'alerts' && <AlertsCenter />}

        {view === 'chat' && (
          <div className="mx-auto h-[calc(100vh-190px)] min-h-[560px] max-w-3xl">
            <ChatPanel />
          </div>
        )}
      </main>

      {/* footer */}
      <footer className="mt-auto border-t border-zinc-800/70 bg-zinc-950/70">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-1.5 px-4 py-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-[10px] leading-relaxed text-zinc-600">
            ⚠️ TradeOracle AI produces AI-generated analysis for educational purposes. It is not financial advice. Markets
            carry risk; never trade blind.
          </p>
          <p className="num shrink-0 text-[10px] text-zinc-600">
            Data: Binance · Kraken live feeds · ORACLE analysis engine
          </p>
        </div>
          </footer>
      </div>
    </QueryClientProvider>
  )
}
