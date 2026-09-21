import { NextRequest, NextResponse } from 'next/server'
import { chatWithTrader, type ChatMessage } from '@/lib/chat'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST { messages: [{role, content}], symbol?, timeframe?, images?: [dataUrl…] }
// Images (chart screenshots etc.) are attached to the last user message and
// analyzed with the vision model.
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body?.messages
  if (!Array.isArray(raw) || raw.length === 0)
    return NextResponse.json({ error: 'messages array is required' }, { status: 400 })

  const messages: ChatMessage[] = raw
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-14)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }))

  if (messages.length === 0)
    return NextResponse.json({ error: 'No valid messages' }, { status: 400 })

  // image attachments: up to 3 data-URLs, each ≤ ~6MB of base64
  let images: string[] = []
  if (Array.isArray(body?.images)) {
    images = body.images
      .filter((u: any) => typeof u === 'string' && u.startsWith('data:image/'))
      .slice(0, 3)
      .map((u: string) => u.slice(0, 6_000_000))
  }
  if (images.length === 0 && !messages.some((m) => m.role === 'user' && m.content.trim()))
    return NextResponse.json({ error: 'Nothing to send — message or image required' }, { status: 400 })

  const symbol = typeof body?.symbol === 'string' ? body.symbol : undefined
  const timeframe = typeof body?.timeframe === 'string' ? body.timeframe : undefined

  try {
    const reply = await chatWithTrader(messages, symbol, timeframe, images.length > 0 ? images : undefined)
    return NextResponse.json({ reply })
  } catch (e) {
    console.error('[api/chat] failed:', e)
    return NextResponse.json({ error: `Chat failed: ${(e as Error).message}` }, { status: 500 })
  }
}
