'use client'

import { useMemo } from 'react'
import { useTerminal, changeColor } from './store'
import { getSymbolMeta, formatPrice } from '@/lib/markets'

// ─── Scrolling ticker tape ───────────────────────────────────────────────────

const TAPE_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'PAXGUSDT',
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF',
]

export function TickerTape() {
  const ticks = useTerminal((s) => s.ticks)
  const selectSymbol = useTerminal((s) => s.selectSymbol)
  const setView = useTerminal((s) => s.setView)

  const items = useMemo(() => {
    return TAPE_SYMBOLS.map((symbol) => {
      const t = ticks[symbol]
      const meta = getSymbolMeta(symbol)
      return {
        symbol,
        display: meta.displaySymbol,
        price: t?.price,
        changePct: t?.changePct,
        digits: meta.tickDigits,
      }
    })
  }, [ticks])

  const renderItem = (item: (typeof items)[number], key: string) => (
    <button
      key={key}
      onClick={() => {
        selectSymbol(item.symbol)
        setView('terminal')
      }}
      className="flex shrink-0 items-center gap-2 px-4 py-1.5 transition-colors hover:bg-zinc-900"
      aria-label={`View ${item.display} chart`}
    >
      <span className="text-[11px] font-semibold tracking-wide text-zinc-400">{item.display}</span>
      <span className="num text-[11px] font-medium text-zinc-100">
        {item.price !== undefined ? formatPrice(item.price, item.digits) : '—'}
      </span>
      {item.changePct !== undefined && (
        <span className={`num text-[11px] font-semibold ${changeColor(item.changePct)}`}>
          {item.changePct > 0 ? '▲' : item.changePct < 0 ? '▼' : ''} {Math.abs(item.changePct).toFixed(2)}%
        </span>
      )}
      <span className="text-zinc-700">|</span>
    </button>
  )

  return (
    <div
      className="overflow-hidden border-b border-zinc-800/70 bg-zinc-950/60"
      role="marquee"
      aria-label="Live market ticker"
    >
      <div className="tape-track">
        <div className="flex">{items.map((item) => renderItem(item, `a-${item.symbol}`))}</div>
        <div className="flex" aria-hidden="true">
          {items.map((item) => renderItem(item, `b-${item.symbol}`))}
        </div>
      </div>
    </div>
  )
}
