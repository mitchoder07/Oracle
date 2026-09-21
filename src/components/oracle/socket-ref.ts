'use client'

// ─── Shared feeds ref (set by useOracleFeeds, read anywhere) ──────────────────
// Typed as a minimal socket.io-shaped surface so ChartPanel / AlertsCenter can
// keep using .emit() / .on() / .off() unchanged.

export interface FeedLike {
  on(event: string, handler: (payload: any) => void): void
  off(event: string, handler: (payload: any) => void): void
  emit(event: string, payload?: any): void | Promise<void>
}

export const oracleSocket: { current: FeedLike | null } = { current: null }
