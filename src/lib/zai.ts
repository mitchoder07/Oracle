import ZAI from 'z-ai-web-dev-sdk'

// ─── ZAI client factory (sandbox + public API + any OpenAI-compatible host) ──
// Two modes:
//   1) PUBLIC MODE (production / Vercel): set AI_BASE_URL + AI_API_KEY env vars
//      and the SDK instance is constructed directly from env — no .z-ai-config
//      file needed (Vercel's filesystem is read-only). Works with:
//        • Z.ai open platform:  AI_BASE_URL=https://api.z.ai/api/paas/v4
//        • BigModel (CN):       AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
//        • any OpenAI-compatible endpoint that speaks {baseUrl}/chat/completions
//      Optional: AI_CHAT_MODEL (default glm-4.6), AI_VISION_MODEL (default
//      glm-4.5v). Tip: "glm-4-flash" is a free/cheap text model on Z.ai.
//   2) SANDBOX MODE (fallback): no env vars → classic ZAI.create(), which reads
//      /etc/.z-ai-config — the behavior inside the dev sandbox.

const PUBLIC_BASE = process.env.AI_BASE_URL?.replace(/\/+$/, '')
const PUBLIC_KEY = process.env.AI_API_KEY

export const PUBLIC_AI_MODE = Boolean(PUBLIC_BASE && PUBLIC_KEY)

export const CHAT_MODEL = process.env.AI_CHAT_MODEL || 'glm-4.6'
export const VISION_MODEL = process.env.AI_VISION_MODEL || 'glm-4.5v'

let cached: any = null

export async function getZAI(): Promise<any> {
  if (cached) return cached

  if (PUBLIC_AI_MODE) {
    // Construct directly — bypasses the config-file loader entirely.
    const zai = new (ZAI as any)({ baseUrl: PUBLIC_BASE, apiKey: PUBLIC_KEY })

    // The public API requires an explicit model on every call; the sandbox
    // gateway picks a default. Wrap both creators to inject the model.
    const origCreate = zai.chat.completions.create.bind(zai)
    const origVision = zai.chat.completions.createVision.bind(zai)
    zai.chat.completions.create = (body: any = {}) => origCreate({ model: CHAT_MODEL, ...body })
    zai.chat.completions.createVision = (body: any = {}) => origVision({ model: VISION_MODEL, ...body })

    cached = zai
    return zai
  }

  cached = await ZAI.create()
  return cached
}

/** Which vision model to request (sandbox defaults to its own glm-4.6v). */
export function visionModel(): string {
  return PUBLIC_AI_MODE ? VISION_MODEL : 'glm-4.6v'
}
