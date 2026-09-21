import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/notifications?limit=50 — notification center history
export async function GET(req: NextRequest) {
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 50)))
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1'

  const notifications = await db.notification.findMany({
    where: unreadOnly ? { read: false } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  const unread = await db.notification.count({ where: { read: false } })

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      symbol: n.symbol,
      title: n.title,
      body: n.body,
      signal: n.signal,
      confidence: n.confidence,
      link: n.link,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })),
    unread,
  })
}

// POST { action: 'read-all' } | { action: 'read', ids: [...] }
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body?.action === 'read-all') {
    await db.notification.updateMany({ where: { read: false }, data: { read: true } })
    return NextResponse.json({ ok: true })
  }
  if (body?.action === 'read' && Array.isArray(body.ids)) {
    await db.notification.updateMany({
      where: { id: { in: body.ids.map(String).slice(0, 100) } },
      data: { read: true },
    })
    return NextResponse.json({ ok: true })
  }
  if (body?.action === 'clear') {
    await db.notification.deleteMany({})
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
