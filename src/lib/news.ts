import type { NewsArticle } from './types'
import { getZAI } from './zai'

// ─── News intelligence (web search + RSS fallback + caching) ──────────────────
// Primary:   SDK web_search function (works in the sandbox / when a gateway
//            with functions/invoke is configured).
// Fallback:  public RSS feeds fetched directly — no API key, works anywhere
//            (Vercel included). Sources verified keyless:
//              crypto:    CoinDesk, Cointelegraph
//              forex:     Investing.com (forex), WSJ Markets
//              gold/metal: Investing.com (commodities)
// The web_search availability is probed once per process; on failure the RSS
// path takes over permanently so we never burn latency on a 404 endpoint.

const QUERIES: Record<string, string[]> = {
  CRYPTO: [
    'cryptocurrency market news today bitcoin ethereum',
    'crypto market today price analysis',
  ],
  FOREX: [
    'forex market news today dollar euro',
    'currency markets today Fed rates inflation',
  ],
}

const RSS_SOURCES: Record<string, Array<{ url: string; source: string }>> = {
  CRYPTO: [
    { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
    { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph' },
  ],
  FOREX: [
    { url: 'https://www.investing.com/rss/news_1.rss', source: 'Investing.com' },
    { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', source: 'WSJ Markets' },
  ],
  METAL: [
    { url: 'https://www.investing.com/rss/news_11.rss', source: 'Investing.com' },
    { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', source: 'WSJ Markets' },
  ],
}

const inMemCache = new Map<string, { articles: NewsArticle[]; until: number }>()

// null = untested · true = SDK web_search works · false = use RSS only
let webSearchAvailable: boolean | null = null

async function sdkWebSearch(query: string, num: number, recencyDays: number): Promise<NewsArticle[]> {
  if (webSearchAvailable === false) return []
  let zai: any
  try {
    zai = await getZAI()
  } catch {
    webSearchAvailable = false
    return []
  }
  try {
    const results = await zai.functions.invoke('web_search', { query, num, recency_days: recencyDays })
    if (Array.isArray(results)) {
      if (webSearchAvailable === null) webSearchAvailable = true
      return results.map((r: any) => ({
        title: String(r.name ?? '').slice(0, 300),
        url: String(r.url ?? ''),
        snippet: String(r.snippet ?? '').slice(0, 400),
        source: String(r.host_name ?? ''),
        date: String(r.date ?? ''),
      }))
    }
    webSearchAvailable = false
    return []
  } catch {
    // 404 / not-implemented on public endpoints → RSS mode for this process
    webSearchAvailable = false
    return []
  }
}

// ── tiny RSS parser (no dependencies) ──
function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? decodeXmlEntities(m[1]).trim() : ''
}

async function fetchRss(url: string, source: string): Promise<NewsArticle[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 9000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TradeOracleAI/1.0)' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    const items = xml.split(/<item[\s>]/i).slice(1)
    return items.slice(0, 12).map((block) => {
      const link = tag(block, 'link')
      const date = tag(block, 'pubDate')
      return {
        title: tag(block, 'title').slice(0, 300),
        url: link,
        snippet: tag(block, 'description')
          .replace(/<[^>]+>/g, '')
          .slice(0, 400),
        source: tag(block, 'source') || source,
        date: date ? new Date(date).toISOString() : '',
      }
    })
  } finally {
    clearTimeout(timer)
  }
}

async function rssNews(category: 'CRYPTO' | 'FOREX' | 'METAL'): Promise<NewsArticle[]> {
  const sources = RSS_SOURCES[category] ?? RSS_SOURCES.CRYPTO
  const batches = await Promise.all(
    sources.map((s) => fetchRss(s.url, s.source).catch(() => [] as NewsArticle[]))
  )
  return batches.flat()
}

function dedupe(all: NewsArticle[], limit: number): NewsArticle[] {
  const seen = new Set<string>()
  return all
    .filter((a) => {
      const k = a.url || a.title
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit)
}

export async function searchNews(category: 'CRYPTO' | 'FOREX' | 'METAL'): Promise<NewsArticle[]> {
  const key = `news:${category}`
  const hit = inMemCache.get(key)
  if (hit && hit.until > Date.now()) return hit.articles

  let all: NewsArticle[] = []

  // 1) SDK web search (sandbox / gateway mode)
  const queries = QUERIES[category] ?? QUERIES.CRYPTO
  if (webSearchAvailable !== false) {
    const batches = await Promise.all(
      queries.map((q) => sdkWebSearch(q, 8, 2).catch(() => [] as NewsArticle[]))
    )
    all = all.concat(batches.flat())
  }

  // 2) RSS fallback — no key, works on any host (also tops up sparse results)
  if (all.length < 6) {
    const rss = await rssNews(category).catch(() => [] as NewsArticle[])
    all = all.concat(rss)
  }

  const articles = dedupe(all, 16)
  inMemCache.set(key, { articles, until: Date.now() + 10 * 60_000 })
  return articles
}

export async function searchSymbolNews(
  base: string,
  displaySymbol: string,
  market: string
): Promise<NewsArticle[]> {
  const key = `news:sym:${base}`
  const hit = inMemCache.get(key)
  if (hit && hit.until > Date.now()) return hit.articles

  const category: 'CRYPTO' | 'FOREX' | 'METAL' =
    market === 'FOREX' ? 'FOREX' : market === 'METAL' ? 'METAL' : 'CRYPTO'

  let all: NewsArticle[] = []

  // 1) SDK web search
  if (webSearchAvailable !== false) {
    const queries =
      category === 'FOREX'
        ? [`${displaySymbol.replace('/', ' ')} currency news today`]
        : category === 'METAL'
          ? ['gold XAU price news today', 'gold market analysis today']
          : [`${base} news today price`, `${base} latest analysis`]
    const batches = await Promise.all(
      queries.map((q) => sdkWebSearch(q, 5, 3).catch(() => [] as NewsArticle[]))
    )
    all = all.concat(batches.flat())
  }

  // 2) RSS fallback: keyword-filter the category feeds
  if (all.length < 3) {
    const feed = await searchNews(category).catch(() => [] as NewsArticle[])
    const keywords = symbolKeywords(base, displaySymbol, category)
    all = all.concat(
      feed.filter((a) => {
        const hay = `${a.title} ${a.snippet}`.toLowerCase()
        return keywords.some((k) => hay.includes(k))
      })
    )
  }

  const articles = dedupe(all, 6)
  inMemCache.set(key, { articles, until: Date.now() + 10 * 60_000 })
  return articles
}

function symbolKeywords(base: string, displaySymbol: string, category: string): string[] {
  if (category === 'METAL') return ['gold', 'xau', 'bullion']
  if (category === 'FOREX') {
    const [a, b] = displaySymbol.split('/')
    return [displaySymbol.toLowerCase(), `${a.toLowerCase()}/${b.toLowerCase()}`, `${a.toLowerCase()} ${b.toLowerCase()}`]
  }
  const b = base.toLowerCase()
  return b === 'btc' ? ['bitcoin', 'btc'] : [b]
}

const SENTIMENT_POS = ['surge', 'soar', 'rally', 'jump', 'gain', 'record high', 'bullish', 'upbeat', 'beats', 'optimism']
const SENTIMENT_NEG = ['plunge', 'slump', 'drop', 'fall', 'crash', 'selloff', 'bearish', 'fears', 'misses', 'warning', 'hack', 'liquidation']

export async function classifySentiment(articles: NewsArticle[]): Promise<{
  overall: 'bullish' | 'bearish' | 'mixed' | 'neutral'
  score: number
  drivers: string[]
}> {
  if (articles.length === 0) return { overall: 'neutral', score: 0, drivers: [] }
  try {
    const zai = await getZAI()
    const headlines = articles.slice(0, 10).map((a, i) => `${i + 1}. ${a.title}`).join('\n')
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content:
            'You are a market news sentiment analyst. Given headlines, respond ONLY with valid JSON: {"overall":"bullish|bearish|mixed|neutral","score":-100..100,"drivers":["short driver", "..."]}. Exactly 2-4 drivers.',
        },
        { role: 'user', content: `Headlines:\n${headlines}` },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    const json = extractJson(raw)
    const parsed = JSON.parse(json)
    return {
      overall: ['bullish', 'bearish', 'mixed', 'neutral'].includes(parsed.overall) ? parsed.overall : 'neutral',
      score: Math.max(-100, Math.min(100, Number(parsed.score) || 0)),
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 4).map(String) : [],
    }
  } catch {
    // keyword heuristic — keeps the sentiment banner alive without an LLM
    let score = 0
    const drivers: string[] = []
    for (const a of articles.slice(0, 10)) {
      const t = a.title.toLowerCase()
      if (SENTIMENT_POS.some((w) => t.includes(w))) { score += 12; drivers.push(a.title.slice(0, 80)) }
      else if (SENTIMENT_NEG.some((w) => t.includes(w))) { score -= 12; drivers.push(a.title.slice(0, 80)) }
    }
    const clamped = Math.max(-100, Math.min(100, score))
    return {
      overall: clamped > 15 ? 'bullish' : clamped < -15 ? 'bearish' : drivers.length > 0 ? 'mixed' : 'neutral',
      score: clamped,
      drivers: drivers.slice(0, 3),
    }
  }
}

export function extractJson(text: string): string {
  let t = text.trim()
  t = t.replace(/```json/gi, '```')
  const fence = t.indexOf('```')
  if (fence !== -1) {
    const end = t.indexOf('```', fence + 3)
    if (end !== -1) t = t.slice(fence + 3, end)
  }
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end > start) return t.slice(start, end + 1)
  return t
}
