'use client'

import { useEffect, useRef } from 'react'
import { useTerminal, playAlertSound, showBrowserNotification } from './store'
import { oracleSocket, type FeedLike } from './socket-ref'
import { getOracleFeeds } from '@/lib/feeds'
import type { NotificationItem } from '@/lib/types'

// ─── Realtime feeds hook — browser-direct exchange WebSockets ────────────────
// Connects straight to Binance + Kraken (no hub process needed — this is what
// makes the app deployable on serverless hosts like Vercel) and drives the
// auto-scanner via /api/scanner/step while the terminal is open.

export function useOracleSocket() {
  const socketRef = useRef<FeedLike | null>(null)
  const setSocketStatus = useTerminal((s) => s.setSocketStatus)
  const applyTicks = useTerminal((s) => s.applyTicks)
  const setScanner = useTerminal((s) => s.setScanner)
  const pushNotification = useTerminal((s) => s.pushNotification)

  useEffect(() => {
    const feeds = getOracleFeeds()
    socketRef.current = feeds
    oracleSocket.current = feeds

    const onConnect = () => setSocketStatus('live')
    const onDisconnect = () => setSocketStatus('connecting') // auto-reconnect in progress

    const onTicks = (payload: { ts: number; ticks: any[] }) => {
      if (Array.isArray(payload?.ticks)) applyTicks(payload.ticks)
    }

    const onScannerStatus = (status: any) => {
      if (status && typeof status === 'object') setScanner(status)
    }

    const onSignalNew = (notification: NotificationItem) => {
      if (!notification?.title) return
      pushNotification(notification)

      const settings = useTerminal.getState().settings
      const isTrade = notification.signal === 'LONG' || notification.signal === 'SHORT'
      const highConfidence = (notification.confidence ?? 0) >= (settings?.minConfidence ?? 60)

      if (settings?.soundAlerts) playAlertSound()
      if (settings?.browserPush && isTrade && highConfidence) {
        showBrowserNotification(notification.title, notification.body ?? undefined)
      }
    }

    feeds.on('connect', onConnect)
    feeds.on('disconnect', onDisconnect)
    feeds.on('ticks', onTicks)
    feeds.on('scanner:status', onScannerStatus)
    feeds.on('signal:new', onSignalNew)

    feeds.start()

    return () => {
      feeds.off('connect', onConnect)
      feeds.off('disconnect', onDisconnect)
      feeds.off('ticks', onTicks)
      feeds.off('scanner:status', onScannerStatus)
      feeds.off('signal:new', onSignalNew)
      feeds.stop()
      oracleSocket.current = null
    }
  }, [applyTicks, pushNotification, setScanner, setSocketStatus])

  return socketRef
}
