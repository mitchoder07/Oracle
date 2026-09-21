import { NextRequest, NextResponse } from 'next/server'
import { runScannerStep } from '@/lib/scanner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ─── Serverless auto-scanner step ─────────────────────────────────────────────
// POST /api/scanner/step  { force?: boolean } — called by the open terminal
//   every 60s (cheap no-op unless a scan is due) and by the "Scan now" button.
// GET /api/scanner/step   — invoked by the Vercel cron (daily backup scan while
//   the terminal is closed). If CRON_SECRET is set, the cron Authorization
//   header is verified.
// The scanner skips forex pairs while the FX market is closed and gold while
// the spot metals market is closed (weekend freeze — no LLM calls burned).

function authorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // no secret configured — open (add APP_PASSWORD/middleware for full protection)
  const header = req.headers.get('authorization') ?? ''
  return header === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  // basic client check: our frontend always sends this header; blocks casual
  // drive-by force-scans that would burn LLM credits
  if (req.headers.get('x-oracle-client') !== 'web') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: any = {}
  try {
    body = await req.json()
  } catch { /* empty body → force=false */ }
  const force = Boolean(body?.force)

  try {
    const result = await runScannerStep(force)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/scanner/step] failed:', e)
    return NextResponse.json({ error: `Scanner step failed: ${(e as Error).message}` }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!authorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runScannerStep(false)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/scanner/step] cron failed:', e)
    return NextResponse.json({ error: `Scanner step failed: ${(e as Error).message}` }, { status: 500 })
  }
}
