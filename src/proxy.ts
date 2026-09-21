import { NextRequest, NextResponse } from 'next/server'

// ─── Optional password gate (HTTP Basic Auth) ─────────────────────────────────
// A deployed personal terminal is on the public internet by default. Set the
// APP_PASSWORD environment variable (Vercel → Settings → Environment Variables)
// and the whole site sits behind a native browser login prompt. Leave it unset
// and the site is open like before. The username can be anything — only the
// password is checked.

export default function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD
  if (!password) return NextResponse.next()

  const header = req.headers.get('authorization')
  if (header?.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6))
      const idx = decoded.indexOf(':')
      const supplied = idx >= 0 ? decoded.slice(idx + 1) : decoded
      if (supplied === password) return NextResponse.next()
    } catch { /* malformed basic-auth header */ }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="TradeOracle AI", charset="UTF-8"',
    },
  })
}

export const config = {
  // everything except Next internals and static assets
  matcher: '/((?!_next/static|_next/image|favicon.ico|oracle-icon.svg).*)',
}
