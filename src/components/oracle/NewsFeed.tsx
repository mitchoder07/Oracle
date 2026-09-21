'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Newspaper, RefreshCw, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// ─── News intelligence feed with AI sentiment ────────────────────────────────

interface NewsArticleDTO {
  title: string
  url: string
  snippet: string
  source: string
  date: string
}

interface NewsResponse {
  category: string
  articles: NewsArticleDTO[]
  sentiment: { overall: string; score: number; drivers: string[] } | null
  fetchedAt: string
  stale?: boolean
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const t = Date.parse(dateStr)
  if (Number.isNaN(t)) return dateStr
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function SentimentBanner({ sentiment }: { sentiment: NonNullable<NewsResponse['sentiment']> }) {
  const bullish = sentiment.overall === 'bullish'
  const bearish = sentiment.overall === 'bearish'
  const mixed = sentiment.overall === 'mixed'
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3',
        bullish && 'border-emerald-500/30 bg-emerald-500/[0.07]',
        bearish && 'border-red-500/30 bg-red-500/[0.07]',
        mixed && 'border-amber-500/30 bg-amber-500/[0.06]',
        !bullish && !bearish && !mixed && 'border-zinc-800 bg-zinc-900/40'
      )}
    >
      <div className="flex items-center gap-2">
        {bullish && <TrendingUp className="h-4 w-4 text-emerald-400" aria-hidden="true" />}
        {bearish && <TrendingDown className="h-4 w-4 text-red-400" aria-hidden="true" />}
        {mixed && <Minus className="h-4 w-4 text-amber-400" aria-hidden="true" />}
        <span className="text-xs font-bold uppercase tracking-wide text-zinc-200">
          News sentiment: {sentiment.overall}
        </span>
        <Badge variant="secondary" className="num h-5 text-[10px]">
          {sentiment.score > 0 ? '+' : ''}
          {sentiment.score}
        </Badge>
      </div>
      {sentiment.drivers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sentiment.drivers.map((d, i) => (
            <span
              key={i}
              className="rounded-full border border-zinc-700/70 bg-zinc-950/60 px-2 py-0.5 text-[10px] text-zinc-400"
            >
              {d}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function NewsFeed() {
  const [category, setCategory] = useState<'CRYPTO' | 'FOREX'>('CRYPTO')

  const { data, isLoading, isError, refetch, isFetching } = useQuery<NewsResponse>({
    queryKey: ['news', category],
    queryFn: async () => {
      const res = await fetch(`/api/news?category=${category}`)
      if (!res.ok) throw new Error((await res.json())?.error ?? 'News unavailable')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  })

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50">
      <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Market News</h2>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
            {(['CRYPTO', 'FOREX'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  category === c ? 'bg-emerald-500/15 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
                )}
                aria-pressed={category === c}
              >
                {c === 'CRYPTO' ? 'Crypto' : 'Forex'}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-zinc-400 hover:text-emerald-400"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh news"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5 rounded-lg border border-zinc-800/60 p-3">
                <div className="shimmer h-4 w-3/4 rounded" />
                <div className="shimmer h-3 w-full rounded" />
                <div className="shimmer h-3 w-2/3 rounded" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-xs text-red-400">Failed to load news</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="text-[11px]">
              Try again
            </Button>
          </div>
        )}

        {data && (
          <div className="space-y-3">
            {data.sentiment && <SentimentBanner sentiment={data.sentiment} />}
            {data.articles.length === 0 && (
              <p className="py-8 text-center text-xs text-zinc-500">No articles found — try a refresh.</p>
            )}
            {data.articles.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3 transition-colors hover:border-emerald-500/30 hover:bg-zinc-900/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-semibold leading-snug text-zinc-200 group-hover:text-emerald-300">
                    {a.title}
                  </h3>
                  <ExternalLink
                    className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </div>
                {a.snippet && (
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{a.snippet}</p>
                )}
                <div className="num mt-2 flex items-center gap-2 text-[10px] text-zinc-600">
                  <span className="text-zinc-500">{a.source}</span>
                  {a.date && <span>· {timeAgo(a.date)}</span>}
                </div>
              </a>
            ))}
            <p className="num pt-1 text-center text-[9px] text-zinc-700">
              fetched {timeAgo(data.fetchedAt)} · aggregated via live web search
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
