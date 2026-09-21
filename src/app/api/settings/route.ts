import { NextRequest, NextResponse } from 'next/server'
import { getSettings, saveSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  const settings = await getSettings()
  return NextResponse.json({ settings })
}

export async function PUT(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const patch: any = {}
  for (const key of ['autoScan', 'soundAlerts', 'browserPush', 'notifyOnSignalChange', 'notifyAllSignals']) {
    if (typeof body?.[key] === 'boolean') patch[key] = body[key]
  }
  if (typeof body?.scanIntervalMin === 'number') patch.scanIntervalMin = body.scanIntervalMin
  if (typeof body?.minConfidence === 'number') patch.minConfidence = body.minConfidence

  const settings = await saveSettings(patch)
  return NextResponse.json({ settings })
}
