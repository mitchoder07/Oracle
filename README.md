# TradeOracle AI - Deploy on Vercel + Neon

> ## Already deployed? Apply this update (2 minutes)
>
> This package includes the **gold feed hardening update** (Sep 25, 2026, third batch, on top of the real-spot-gold + smarter-predictions update):
> - **The gold price can never silently freeze again.** What happened: the free spot-gold provider changed their API today and the price froze at the last quote. This build fixes that at the root. The live quote now runs through your own server with a failover chain (gold-api -> COMEX-anchored -> PAXG) and every quote carries its age. If data ever falls behind while the market is open, the app tells you honestly: the chart badge, tape and watchlist show **DELAYED** (amber) instead of pretending a frozen number is live. When spot gold closes for the weekend they show **CLOSED**, because Friday's close is the truth then.
> - **Gold is now REAL spot XAU/USD**, the metal your broker quotes. It is no longer the PAXG crypto token. The live price comes from a real spot-gold feed and the candle history is COMEX gold re-anchored to that spot price, so the chart levels match what you see on your broker's XAU/USD chart. Existing watchlists migrate automatically (PAXGUSDT rows become XAUUSD).
> - **Predictions got a memory and a clock.** Every verdict now tells you: why (technicals + the actual news headline + the recurring pattern 20 years of trading says this setup rhymes with), how it fits the **higher timeframe** trend (so a 15m call no longer looks like it randomly contradicts the 1h call, it explains itself), and a **trade window**: how long the setup stays valid and when to cut the trade if TP1 is not hit.
>
> To update your existing GitHub + Vercel deployment:
> 1. Unzip this package **over your existing project folder** (keep your `.git` folder and `.env` file, they are not inside the zip).
> 2. In VSCode's terminal:
>    ```bash
>    git add .
>    git commit -m "gold feed hardening: multi-source failover, delayed/closed badges"
>    git push
>    ```
> 3. Vercel redeploys automatically (watch it under Deployments). Done.

Your personal AI trading intelligence terminal: live crypto / forex / gold charts, LONG / SHORT / KEEP_OFF signals with entry/SL/TP, AI chat that reads chart screenshots, news intelligence, and an auto-scanner that notifies you the moment a verdict flips.

This package is **built for Vercel + Neon**. Everything the old sandbox version needed a background process for now runs serverless:

- **Live prices & candles** - your browser connects *directly* to Binance and Kraken WebSockets (no relay server, no hub process, zero extra cost, real-time on every plan)
- **Auto-scanner** - driven by `/api/scanner/step`: your open terminal pings it every 60s, plus a daily Vercel cron as backup
- **Database** - Neon serverless Postgres (free tier is plenty)
- **AI brain** - your own Z.ai API key via standard OpenAI-compatible env vars

---

## 0. What you need (15 min total)

| Account | Link | Free tier |
|---|---|---|
| GitHub | https://github.com | yes |
| Vercel | https://vercel.com | Hobby (free) |
| Neon (Postgres) | https://neon.com | yes - generous free tier |
| Z.ai (AI models) | https://z.ai | free credits / cheap GLM models |

Plus on your machine: **Node.js 20+** (https://nodejs.org), **VSCode** (https://code.visualstudio.com), and Git (https://git-scm.com).

---

## 1. Get your Z.ai API key (the AI brain)

1. Go to **https://z.ai** and sign up / log in.
2. Open **API Keys**: https://z.ai/manage-apikey/apikey-list
3. Create a new API key and copy it.
4. You will use:
   - `AI_BASE_URL` = `https://api.z.ai/api/paas/v4`
   - `AI_API_KEY` = your key
   - `AI_CHAT_MODEL` = `glm-4.6` (flagship) or `glm-4-flash` (very cheap/free tier)
   - `AI_VISION_MODEL` = `glm-4.5v` (reads your chart screenshots)

> **China / BigModel users:** use `AI_BASE_URL = https://open.bigmodel.cn/api/paas/v4` instead.
> **Any OpenAI-compatible provider works too** (OpenRouter, etc.) - the app only needs a `{baseUrl}/chat/completions` endpoint.

---

## 2. Create the Neon database

1. Go to **https://neon.com** → sign up.
2. **Create project** → name it `tradeoracle` → pick the region closest to you.
3. On the project dashboard, open **Connect** / **Connection Details**.
4. You'll see two connection strings - you need BOTH:
   - **Pooled** (host contains `-pooler`) → this is your `DATABASE_URL` (right for serverless: many short-lived connections)
   - **Direct / unpooled** → this is `DATABASE_URL_UNPOOLED` (Prisma CLI needs this for creating tables)

They look like:

```
postgresql://USER:PASSWORD@ep-cool-name-pooler-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require   ← pooled
postgresql://USER:PASSWORD@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require             ← direct
```

---

## 3. Set up the project in VSCode

1. **Unzip** this package (e.g. to `~/projects/tradeoracle-ai`).
2. Open the folder in **VSCode** (`File → Open Folder`).
3. Open the integrated terminal (`Ctrl+` ` or Terminal → New Terminal) and install:

```bash
npm install
```

> The `postinstall` script auto-generates the Prisma client. If it doesn't run (Windows quirk), do `npx prisma generate` manually.

4. Create your env file:

```bash
cp .env.example .env
```

5. **Edit `.env`** in VSCode and fill in:

```env
DATABASE_URL="your-POOLED-neon-connection-string"
DATABASE_URL_UNPOOLED="your-DIRECT-neon-connection-string"
AI_BASE_URL="https://api.z.ai/api/paas/v4"
AI_API_KEY="your-z-ai-key"
AI_CHAT_MODEL="glm-4.6"
AI_VISION_MODEL="glm-4.5v"
```

6. **Create the tables** (uses the direct connection - DDL doesn't like poolers):

```bash
npx prisma db push
```

You should see `Your database is now in sync with your schema.` The default watchlist seeds itself on first page load.

7. **Run it locally:**

```bash
npm run dev
```

Open **http://localhost:3000** - you should see live prices streaming within a second or two, and ORACLE will give its first analysis.

---

## 4. Push to GitHub (from VSCode)

In the terminal:

```bash
git init
git add .
git commit -m "TradeOracle AI - initial deploy"
```

1. Create a new **empty** repo on https://github.com (name it `tradeoracle-ai`, do NOT add a README).
2. Copy the repo URL and run (GitHub will show you these exact commands):

```bash
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/tradeoracle-ai.git
git push -u origin main
```

> `.gitignore` already excludes `.env` - your keys will never be committed. Double-check with `git status` that `.env` is not listed.

---

## 5. Deploy to Vercel

### Path A - Dashboard import (easiest)

1. Go to **https://vercel.com** → **Add New → Project**.
2. **Import** your `tradeoracle-ai` GitHub repo.
3. Framework preset auto-detects **Next.js** - leave build settings untouched.
4. Open **Environment Variables** and add these (for all environments - Production + Preview + Development):

| Key | Value | Required |
|---|---|---|
| `DATABASE_URL` | your **pooled** Neon string | ✅ |
| `AI_BASE_URL` | `https://api.z.ai/api/paas/v4` | ✅ |
| `AI_API_KEY` | your Z.ai key | ✅ |
| `AI_CHAT_MODEL` | `glm-4.6` (or `glm-4-flash`) | optional |
| `AI_VISION_MODEL` | `glm-4.5v` | optional |
| `TWELVE_DATA_API_KEY` | free key from https://twelvedata.com - upgrades gold candles to Twelve Data's true spot XAU/USD history | optional |
| `APP_PASSWORD` | any strong password - puts the whole site behind a login prompt | recommended |
| `CRON_SECRET` | random string - locks the cron endpoint | recommended |

5. Click **Deploy**. First build takes ~1–2 minutes.
6. Open the live URL 🎉

### Path B - Vercel CLI (from VSCode terminal)

```bash
npm i -g vercel
vercel login
vercel                    # preview deploy
vercel --prod             # production deploy
# then set env vars:
vercel env add DATABASE_URL production
vercel env add AI_BASE_URL production
vercel env add AI_API_KEY production
vercel env add APP_PASSWORD production
vercel --prod             # redeploy so the vars take effect
```

> **Never used the CLI env prompt?** It reads the value from stdin - paste the string and press Enter.

---

## 6. After deploy: 2-minute health check

1. **Prices moving?** → the ticker tape and watchlist should show live prices (browser-direct WS).
2. **Chart alive?** → pick BTC/USDT, the last candle should pulse/update every second.
3. **Ask ORACLE** → send a chat message (e.g. "Should I long BTC right now?"). If you get a real answer, your Z.ai key works.
4. **Attach a screenshot** → click the 📎 / paste a chart image; the vision model reads it.
5. **Scan now** → Alerts tab → "Scan now" - watch it analyze your whole watchlist and push notifications.
6. **Weekend awareness** → on weekends (or Fri after 5 PM ET) forex pairs show **CLOSED**, gold shows **XAU CLOSED**, and the scanner skips them.

---

## How it works on serverless (why your terminal must be open for auto-scanning)

| Feature | Mechanism |
|---|---|
| Live ticks / candles | Browser → Binance `data-stream.binance.vision` + Kraken `ws.kraken.com/v2` directly |
| REST data (history, tickers) | `/api/market/*` routes with multi-venue fallback (Binance → Kraken → Bybit → OKX) |
| Auto-scanner | Your open terminal POSTs `/api/scanner/step` every 60s; the route decides if a scan is due (state in Neon). "Scan now" = force |
| Backup scan while you're away | `vercel.json` cron hits `/api/scanner/step` daily at 06:00 UTC |
| Notifications | Created by scanner runs, stored in Neon, polled by the UI |

> **Vercel Hobby limits the cron to once per day.** While the terminal is open, scanning runs at your configured interval (5–60 min) regardless of plan. If you want scans every 10 min while the tab is closed, upgrade to Pro and change the schedule in `vercel.json` to `*/10 * * * *`.

---

## Market hours logic (the weekend rules)

| Market | Open | Closed |
|---|---|---|
| Crypto | 24/7 | never |
| Forex | Sun 5:00 PM ET → Fri 5:00 PM ET | weekend |
| **Gold XAU/USD (spot)** | **Sun 6:00 PM ET → Fri 5:00 PM ET** | **weekend** |

- While FX is closed: forex pairs are flagged CLOSED, charts freeze at Friday's close (data accepted as fresh), the scanner skips them, and the AI is explicitly told the market is closed so it never says "it's moving right now".
- While gold is closed: XAU/USD shows **XAU CLOSED** + a "spot closed" tag. Prices are frozen at Friday's close, exactly like a broker's gold chart on a weekend. The AI is told this explicitly too.
- All times are DST-safe (computed from the real `America/New_York` wall clock, not fixed UTC offsets).

### Where the gold numbers come from (all real market data)

- **Live price**: a real spot-gold feed (gold-api.com, keyless, updated every few seconds). Your browser polls it directly, the same way it holds the Binance/Kraken WebSocket connections.
- **Candle history**: COMEX gold futures re-anchored to that live spot price. Intraday, COMEX tracks spot tick for tick; shifting the whole series by the live spot-minus-futures basis puts every candle at true spot levels, and the newest candle closes exactly on the live spot price. The chart shape and levels match what you'd see on your broker's XAU/USD chart.
- **Optional upgrade**: set `TWELVE_DATA_API_KEY` (free at twelvedata.com, 800 calls/day) and gold candles come straight from Twelve Data's true spot XAU/USD history instead.
- **Emergency fallback**: if the candle sources are unreachable, PAXG token candles re-anchored to live spot keep the chart alive (real traded data, correct levels) rather than showing an error.
- Gold candles are cached server-side per timeframe, so the data sources see very little traffic and never rate-limit a normal user.

---

## Mistakes you might not see (found during research - all fixed in this build)

1. **The AI endpoint inside the sandbox doesn't exist on the internet.** The dev sandbox used an internal gateway (`internal-api.z.ai`). This build reads `AI_BASE_URL` + `AI_API_KEY` from env vars instead and talks to the public Z.ai API. Without this fix every AI feature would 401/404 after deploy.
2. **SQLite would wipe itself on Vercel.** Serverless filesystems are ephemeral - anything written at runtime disappears. The database is now Neon Postgres (schema included; run `npx prisma db push` once).
3. **The old realtime hub couldn't run on Vercel** (a separate Node process on port 3003 - Vercel only runs HTTP functions). Replaced with browser-direct exchange WebSockets + a serverless scanner step. This also killed the previous first-load bug where live candles only started after you switched pairs once.
4. **Vercel request bodies cap at 4.5 MB.** Chart screenshots you attach in chat are now downscaled and re-encoded in your browser (max 1400px JPEG) before being sent - a 5 MB PNG becomes ~200 KB, well under the limit.
5. **Binance geo-blocking.** Vercel's default region is US East (iad1). If crypto charts ever fail there, the app fails over to Kraken/Bybit/OKX automatically; if it's still unhappy, set a different function region (Vercel → Settings → Functions → Region → Frankfurt `fra1` or Singapore `sin1`).
6. **Vercel function duration limits.** Routes are capped deliberately: chat 120s, analysis 120s, scanner 300s (the Hobby-plan maximum with fluid compute). A scan of 10 pairs comfortably fits; the scanner state self-heals if an invocation dies.
7. **Cron frequency on Hobby is once per day** - that's why client-driven scanning is the primary loop, not the cron.
8. **Your deployed site is public by default** - anyone who finds the URL could burn your AI credits. Set `APP_PASSWORD` (whole-site basic auth) and `CRON_SECRET` (locks the cron endpoint).
9. **Gold ≠ a token.** XAU/USD used the PAXG crypto token as a proxy, which trades at a premium to spot and follows crypto-market swings. Gold is now real spot XAU/USD: live spot price + spot-anchored COMEX candles (see the gold data section above), and the spot market correctly closes Fri 5 PM → Sun 6 PM ET everywhere: badges, banners, scanner skips, and AI prompts.
10. **Model names differ between sandbox and public API.** The public Z.ai API needs an explicit model per call - this build sends `glm-4.6` / `glm-4.5v` (configurable via env). `glm-4-flash` is the budget option.
11. **News without a gateway.** The sandbox web-search function doesn't exist on the public API either. News now falls back to keyless public RSS feeds (CoinDesk, Cointelegraph, Investing.com forex & commodities, WSJ) - verified reachable from datacenter IPs, so it works on Vercel. LLM sentiment classification runs on top; if the LLM is unavailable, a keyword heuristic keeps the sentiment banner alive.
12. **Prisma + Neon pooler.** The app connects through the pooled endpoint (correct for serverless), while `prisma db push` uses the direct one - mixing them up is the #1 cause of weird `prepared statement` errors. Both strings are in `.env.example` and documented above.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `PrismaClientInitializationError` on Vercel | `DATABASE_URL` missing/wrong in Vercel env vars, or you used the unpooled string - use the `-pooler` one |
| `Error code 401` from Z.ai | Wrong `AI_API_KEY`, or key has no credit - check https://z.ai/manage-apikey |
| Chat/analysis always says "rules engine" | The LLM is unreachable - check `AI_BASE_URL` (must be exactly `https://api.z.ai/api/paas/v4`, no trailing slash needed, no `/chat/completions`) |
| Crypto charts "No data source could serve" | Regional Binance block - switch Vercel function region (see #5 above); forex still works via Kraken |
| Forex prices frozen on weekend | That's correct behavior - market's closed; it reopens Sunday 5 PM ET |
| Prices frozen on a WEEKDAY | Refresh the page; the WS reconnects automatically, but a hard refresh clears stuck state |
| "Prepared statement does not exist" | You pointed Prisma at the pooler for `db push` - use `DATABASE_URL_UNPOOLED` |
| Cron never fires | Hobby runs it once daily at most; check Vercel → Settings → Cron Jobs; also ensure `CRON_SECRET` (if set) matches what Vercel sends |
| Site asks for a password | You set `APP_PASSWORD` - enter any username + that password |
| 429s from the AI | Model quota/rate limit - wait, or switch `AI_CHAT_MODEL` to `glm-4-flash` |

---

## Daily driver tips

- **Keep a pinned tab open** - that's what drives the auto-scanner at full frequency and gives you instant sound/push alerts.
- **Browser push**: Alerts tab → enable "Browser push" (needs Chrome/Edge with notifications allowed for the site).
- **Watchlist** = what the scanner monitors. Trim it to what you actually trade - every pair costs an AI call per scan.
- **Scan interval** is configurable in the Alerts tab (5–60 min).
- Everything AI-generated is analysis, not financial advice - manage risk accordingly.

---

## Project structure (quick map)

```
src/
  app/
    api/
      analysis/        POST run ORACLE analysis · GET signal history
      chat/            AI chat (text + chart-image vision)
      market/          symbols · klines · tickers (multi-venue fallback)
      news/            RSS + search news with AI sentiment
      notifications/   alert feed actions
      scanner/step/    serverless auto-scanner (client + cron driven)
      settings/        scanner config persistence
      watchlist/       watchlist CRUD + default seeding
  components/oracle/   terminal UI (chart, signal panel, watchlist, chat, alerts…)
  lib/
    feeds.ts           browser-direct Binance + Kraken WebSocket manager
    analyst.ts         ORACLE prompt pipeline + rules fallback
    scanner.ts         scan step logic + DB-persisted scanner state
    zai.ts             env-driven AI client (public API / sandbox)
    sessions.ts        DST-safe market-hours engine (FX + gold weekends)
    binance.ts         multi-venue REST klines/tickers with fallbacks
    markets.ts         48-symbol universe + timeframes 1m→1M
    news.ts            RSS fallback news engine
prisma/schema.prisma   Neon Postgres schema
vercel.json            daily cron (scanner backup run)
```
