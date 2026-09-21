import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { searchNews, classifySentiment } from '@/lib/news'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TTL_MS = 10 * 60 * 1000

// GET /api/news?category=CRYPTO|FOREX — cached news feed with AI sentiment
export async function GET(req: NextRequest) {
  const categoryParam = req.nextUrl.searchParams.get('category')?.toUpperCase() ?? 'CRYPTO'
  const category = categoryParam === 'FOREX' ? 'FOREX' : categoryParam === 'METAL' ? 'METAL' : 'CRYPTO'
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'

  const cached = await db.newsCache.findUnique({ where: { category } })
  const fresh = cached && Date.now() - cached.fetchedAt.getTime() < TTL_MS
  if (cached && fresh && !refresh) {
    return NextResponse.json({
      category,
      articles: JSON.parse(cached.articles),
      sentiment: cached.sentiment ? JSON.parse(cached.sentiment) : null,
      fetchedAt: cached.fetchedAt.toISOString(),
      cached: true,
    })
  }

  try {
    const articles = await searchNews(category as 'CRYPTO' | 'FOREX' | 'METAL')
    const sentiment = await classifySentiment(articles)

    const data = {
      category,
      articles,
      sentiment,
      fetchedAt: new Date().toISOString(),
      cached: false,
    }

    await db.newsCache.upsert({
      where: { category },
      update: {
        articles: JSON.stringify(articles),
        sentiment: JSON.stringify(sentiment),
        fetchedAt: new Date(),
      },
      create: {
        category,
        articles: JSON.stringify(articles),
        sentiment: JSON.stringify(sentiment),
      },
    })

    return NextResponse.json(data)
  } catch (e) {
    // degrade gracefully to stale cache if we have one
    if (cached) {
      return NextResponse.json({
        category,
        articles: JSON.parse(cached.articles),
        sentiment: cached.sentiment ? JSON.parse(cached.sentiment) : null,
        fetchedAt: cached.fetchedAt.toISOString(),
        cached: true,
        stale: true,
      })
    }
    return NextResponse.json({ error: `News unavailable: ${(e as Error).message}` }, { status: 502 })
  }
}
