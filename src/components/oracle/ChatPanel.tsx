'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Brain, ImagePlus, Send, Sparkles, User, X } from 'lucide-react'
import { useTerminal } from './store'
import { getSymbolMeta } from '@/lib/markets'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// ─── Chat with ORACLE — the resident AI trader (text + chart screenshots) ────

interface Msg {
  role: 'user' | 'assistant'
  content: string
  images?: string[] // data URLs shown as thumbnails
}

interface Attachment {
  id: string
  dataUrl: string
  name: string
}

const SUGGESTIONS = [
  'Should I long BTC right now?',
  'Explain the current setup on the chart',
  'How do you size positions and manage risk?',
  'What news is moving the market today?',
]

const MAX_ATTACHMENTS = 3
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // accept up to 8 MB raw — compressed before send
// Serverless gateways (Vercel) cap request bodies at 4.5 MB, so every image is
// downscaled + re-encoded client-side before it ever leaves the browser.
const TARGET_MAX_EDGE = 1400
const TARGET_JPEG_QUALITY = 0.82

/** Downscale + re-encode an image file to a compact JPEG data-URL. */
async function compressImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not decode the image'))
      el.src = dataUrl
    })
    const scale = Math.min(1, TARGET_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl // canvas unavailable — send original
    ctx.fillStyle = '#ffffff' // flatten transparency (PNG → JPEG)
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', TARGET_JPEG_QUALITY)
  } catch {
    return dataUrl // decode failed (e.g. SVG) — send original
  }
}

export function ChatPanel() {
  const selectedSymbol = useTerminal((s) => s.selectedSymbol)
  const timeframe = useTerminal((s) => s.timeframe)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const meta = getSymbolMeta(selectedSymbol)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, attachments])

  async function addFiles(files: FileList | File[] | null | undefined) {
    if (!files) return
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    for (const f of list) {
      if (f.size > MAX_IMAGE_BYTES) {
        setAttachError(`"${f.name}" is over 8 MB — please use a smaller screenshot.`)
        continue
      }
      if (attachments.length >= MAX_ATTACHMENTS) {
        setAttachError(`Max ${MAX_ATTACHMENTS} images per message.`)
        break
      }
      setAttachError(null)
      try {
        const dataUrl = await compressImage(f)
        setAttachments((a) =>
          a.length >= MAX_ATTACHMENTS ? a : [...a, { id: `${Date.now()}-${f.name}`, dataUrl, name: f.name }]
        )
      } catch {
        setAttachError(`Could not read "${f.name}".`)
      }
    }
  }

  async function send(text?: string, images?: string[]) {
    const content = (text ?? input).trim()
    const sentImages = images ?? attachments.map((a) => a.dataUrl)
    if ((!content && sentImages.length === 0) || busy) return
    setInput('')
    setAttachments([])
    setAttachError(null)
    const next: Msg[] = [...messages, { role: 'user', content, images: sentImages }]
    setMessages(next)
    setBusy(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: next
            .filter((m) => m.content.trim() || (m.role === 'user' && (m.images?.length ?? 0) > 0))
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content || '(image attached)' })),
          symbol: selectedSymbol,
          timeframe,
          images: sentImages,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.reply) throw new Error(data?.error ?? 'Chat failed')
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }])
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠️ Connection issue: ${e.message}. Try again in a moment.` },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50">
      {/* header */}
      <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="oracle-glow flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900">
            <Brain className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Ask ORACLE</h2>
            <p className="text-[10px] text-zinc-500">
              Elite AI trader · sees {meta.displaySymbol} {timeframe} live data · chart screenshots welcome
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-zinc-500 hover:text-red-400"
            onClick={() => setMessages([])}
          >
            Clear
          </Button>
        )}
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3.5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="oracle-glow flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900">
              <Sparkles className="h-6 w-6 text-emerald-400" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200">Talk strategy with your AI trader</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
                ORACLE answers with live market context — current indicators, structure and news for the pair you have
                open. Attach or paste a chart screenshot and it will read the chart for you.
              </p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-700/70 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('msg-in flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                m.role === 'user' ? 'bg-zinc-800' : 'oracle-glow bg-zinc-900'
              )}
            >
              {m.role === 'user' ? (
                <User className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              ) : (
                <Brain className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              )}
            </div>
            <div
              className={cn(
                'max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed',
                m.role === 'user'
                  ? 'rounded-tr-sm bg-emerald-500/15 text-zinc-100'
                  : 'rounded-tl-sm border border-zinc-800 bg-zinc-900/60 text-zinc-300'
              )}
            >
              {m.images && m.images.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {m.images.map((src, j) => (
                     
                    <img
                      key={j}
                      src={src}
                      alt={`Attached chart ${j + 1}`}
                      className="max-h-44 max-w-full rounded-lg border border-zinc-700 object-contain"
                    />
                  ))}
                </div>
              )}
              {m.role === 'assistant' ? (
                <div className="space-y-2 [&_p]:leading-relaxed [&_strong]:text-zinc-100 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-4 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[11px] [&_h1,&_h2,&_h3]:mb-1 [&_h1,&_h2,&_h3]:text-[13px] [&_h1,&_h2,&_h3]:font-bold">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="msg-in flex gap-2.5">
            <div className="oracle-glow flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900">
              <Brain className="h-3.5 w-3.5 animate-pulse text-emerald-400" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-1.5 rounded-xl rounded-tl-sm border border-zinc-800 bg-zinc-900/60 px-4 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <div className="border-t border-zinc-800/70 p-3">
        {/* attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="group relative">
                { }
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="h-16 w-24 rounded-lg border border-zinc-700 object-cover"
                />
                <button
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 shadow hover:bg-red-500/80 hover:text-white"
                  aria-label={`Remove ${a.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachError && <p className="mb-2 text-[10px] text-amber-400">{attachError}</p>}

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
            aria-label="Attach chart screenshot"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-400',
              attachments.length > 0 && 'border-emerald-500/40 text-emerald-400'
            )}
            title="Attach chart screenshot (or just paste it)"
            aria-label="Attach chart screenshot"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = e.clipboardData?.files
              if (files && files.length > 0 && Array.from(files).some((f) => f.type.startsWith('image/'))) {
                e.preventDefault()
                addFiles(files)
              }
            }}
            placeholder={`Ask about ${meta.displaySymbol}, or paste a chart screenshot…`}
            className="h-10 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
            disabled={busy}
            aria-label="Message ORACLE"
          />
          <Button
            type="submit"
            size="icon"
            className="h-10 w-10 shrink-0 bg-emerald-500/90 hover:bg-emerald-400"
            disabled={busy || (!input.trim() && attachments.length === 0)}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
        <p className="mt-2 text-center text-[9px] text-zinc-600">
          ORACLE references live data for the open pair · reads attached charts · analysis, not financial advice
        </p>
      </div>
    </div>
  )
}
