import type { SymbolMeta } from './types'

// ─── Tradable universe ────────────────────────────────────────────────────────
// Crypto + gold → Binance market-data mirror (WS + REST)
// Fiat forex majors → Kraken (WS v2 + REST) — the real FX market
// (Binance delisted its GBPUSDT/AUDUSDT/USDTNGN fiat pairs, so Kraken serves
//  the fiat side natively.)

interface RawMeta {
  symbol: string          // internal symbol id, e.g. BTCUSDT / GBPUSD
  name: string
  market: 'CRYPTO' | 'FOREX' | 'METAL'
  display: string         // e.g. BTC/USDT or GBP/USD
  digits: number
  source: 'binance' | 'kraken'
  krakenWs?: string       // Kraken WS v2 symbol, e.g. "GBP/USD"
}

const RAW: RawMeta[] = [
  // ── Crypto majors (Binance) ──
  { symbol: 'BTCUSDT', name: 'Bitcoin', market: 'CRYPTO', display: 'BTC/USDT', digits: 2, source: 'binance' },
  { symbol: 'ETHUSDT', name: 'Ethereum', market: 'CRYPTO', display: 'ETH/USDT', digits: 2, source: 'binance' },
  { symbol: 'BNBUSDT', name: 'BNB', market: 'CRYPTO', display: 'BNB/USDT', digits: 2, source: 'binance' },
  { symbol: 'SOLUSDT', name: 'Solana', market: 'CRYPTO', display: 'SOL/USDT', digits: 2, source: 'binance' },
  { symbol: 'XRPUSDT', name: 'XRP', market: 'CRYPTO', display: 'XRP/USDT', digits: 4, source: 'binance' },
  { symbol: 'ADAUSDT', name: 'Cardano', market: 'CRYPTO', display: 'ADA/USDT', digits: 4, source: 'binance' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', market: 'CRYPTO', display: 'DOGE/USDT', digits: 5, source: 'binance' },
  { symbol: 'AVAXUSDT', name: 'Avalanche', market: 'CRYPTO', display: 'AVAX/USDT', digits: 2, source: 'binance' },
  { symbol: 'LINKUSDT', name: 'Chainlink', market: 'CRYPTO', display: 'LINK/USDT', digits: 3, source: 'binance' },
  { symbol: 'DOTUSDT', name: 'Polkadot', market: 'CRYPTO', display: 'DOT/USDT', digits: 3, source: 'binance' },
  { symbol: 'LTCUSDT', name: 'Litecoin', market: 'CRYPTO', display: 'LTC/USDT', digits: 2, source: 'binance' },
  { symbol: 'TRXUSDT', name: 'TRON', market: 'CRYPTO', display: 'TRX/USDT', digits: 5, source: 'binance' },
  { symbol: 'TONUSDT', name: 'Toncoin', market: 'CRYPTO', display: 'TON/USDT', digits: 3, source: 'binance' },
  { symbol: 'SUIUSDT', name: 'Sui', market: 'CRYPTO', display: 'SUI/USDT', digits: 4, source: 'binance' },
  { symbol: 'ATOMUSDT', name: 'Cosmos', market: 'CRYPTO', display: 'ATOM/USDT', digits: 3, source: 'binance' },
  { symbol: 'ETCUSDT', name: 'Ethereum Classic', market: 'CRYPTO', display: 'ETC/USDT', digits: 2, source: 'binance' },
  { symbol: 'BCHUSDT', name: 'Bitcoin Cash', market: 'CRYPTO', display: 'BCH/USDT', digits: 2, source: 'binance' },
  { symbol: 'ICPUSDT', name: 'Internet Computer', market: 'CRYPTO', display: 'ICP/USDT', digits: 3, source: 'binance' },
  { symbol: 'HBARUSDT', name: 'Hedera', market: 'CRYPTO', display: 'HBAR/USDT', digits: 5, source: 'binance' },
  // ── Crypto alts / memes / AI (Binance) ──
  { symbol: 'PEPEUSDT', name: 'Pepe', market: 'CRYPTO', display: 'PEPE/USDT', digits: 8, source: 'binance' },
  { symbol: 'SHIBUSDT', name: 'Shiba Inu', market: 'CRYPTO', display: 'SHIB/USDT', digits: 8, source: 'binance' },
  { symbol: 'WIFUSDT', name: 'dogwifhat', market: 'CRYPTO', display: 'WIF/USDT', digits: 5, source: 'binance' },
  { symbol: 'ARBUSDT', name: 'Arbitrum', market: 'CRYPTO', display: 'ARB/USDT', digits: 4, source: 'binance' },
  { symbol: 'OPUSDT', name: 'Optimism', market: 'CRYPTO', display: 'OP/USDT', digits: 4, source: 'binance' },
  { symbol: 'NEARUSDT', name: 'NEAR Protocol', market: 'CRYPTO', display: 'NEAR/USDT', digits: 3, source: 'binance' },
  { symbol: 'APTUSDT', name: 'Aptos', market: 'CRYPTO', display: 'APT/USDT', digits: 3, source: 'binance' },
  { symbol: 'FILUSDT', name: 'Filecoin', market: 'CRYPTO', display: 'FIL/USDT', digits: 3, source: 'binance' },
  { symbol: 'INJUSDT', name: 'Injective', market: 'CRYPTO', display: 'INJ/USDT', digits: 3, source: 'binance' },
  { symbol: 'SEIUSDT', name: 'Sei', market: 'CRYPTO', display: 'SEI/USDT', digits: 4, source: 'binance' },
  { symbol: 'TIAUSDT', name: 'Celestia', market: 'CRYPTO', display: 'TIA/USDT', digits: 3, source: 'binance' },
  { symbol: 'ENAUSDT', name: 'Ethena', market: 'CRYPTO', display: 'ENA/USDT', digits: 4, source: 'binance' },
  { symbol: 'RENDERUSDT', name: 'Render', market: 'CRYPTO', display: 'RENDER/USDT', digits: 3, source: 'binance' },
  { symbol: 'FETUSDT', name: 'Artificial SuperIntelligence', market: 'CRYPTO', display: 'FET/USDT', digits: 4, source: 'binance' },
  { symbol: 'AAVEUSDT', name: 'Aave', market: 'CRYPTO', display: 'AAVE/USDT', digits: 2, source: 'binance' },
  { symbol: 'UNIUSDT', name: 'Uniswap', market: 'CRYPTO', display: 'UNI/USDT', digits: 3, source: 'binance' },
  { symbol: 'ALGOUSDT', name: 'Algorand', market: 'CRYPTO', display: 'ALGO/USDT', digits: 4, source: 'binance' },
  { symbol: 'VETUSDT', name: 'VeChain', market: 'CRYPTO', display: 'VET/USDT', digits: 5, source: 'binance' },
  { symbol: 'FTMUSDT', name: 'Fantom', market: 'CRYPTO', display: 'FTM/USDT', digits: 4, source: 'binance' },
  // ── Fiat forex majors (Kraken — the real FX market) ──
  { symbol: 'EURUSD', name: 'Euro / US Dollar', market: 'FOREX', display: 'EUR/USD', digits: 5, source: 'kraken', krakenWs: 'EUR/USD' },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', market: 'FOREX', display: 'GBP/USD', digits: 5, source: 'kraken', krakenWs: 'GBP/USD' },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', market: 'FOREX', display: 'USD/JPY', digits: 3, source: 'kraken', krakenWs: 'USD/JPY' },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', market: 'FOREX', display: 'AUD/USD', digits: 5, source: 'kraken', krakenWs: 'AUD/USD' },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', market: 'FOREX', display: 'USD/CAD', digits: 5, source: 'kraken', krakenWs: 'USD/CAD' },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', market: 'FOREX', display: 'USD/CHF', digits: 5, source: 'kraken', krakenWs: 'USD/CHF' },
  { symbol: 'EURGBP', name: 'Euro / British Pound', market: 'FOREX', display: 'EUR/GBP', digits: 5, source: 'kraken', krakenWs: 'EUR/GBP' },
  { symbol: 'EURJPY', name: 'Euro / Japanese Yen', market: 'FOREX', display: 'EUR/JPY', digits: 3, source: 'kraken', krakenWs: 'EUR/JPY' },
  // ── Gold (Binance PAXG — tokenised XAU) ──
  { symbol: 'PAXGUSDT', name: 'Gold (PAXG)', market: 'METAL', display: 'XAU/USD', digits: 2, source: 'binance' },
]

export const SYMBOL_UNIVERSE: SymbolMeta[] = RAW.map((r) => {
  const [base, quote] = r.display.split('/')
  return {
    symbol: r.symbol,
    base,
    quote,
    name: r.name,
    market: r.market,
    displaySymbol: r.display,
    tickDigits: r.digits,
    source: r.source,
    krakenWs: r.krakenWs,
  }
})

const BY_SYMBOL = new Map(SYMBOL_UNIVERSE.map((s) => [s.symbol, s]))

export function getSymbolMeta(symbol: string): SymbolMeta {
  return (
    BY_SYMBOL.get(symbol.toUpperCase()) ?? {
      symbol: symbol.toUpperCase(),
      base: symbol.toUpperCase(),
      quote: '',
      name: symbol.toUpperCase(),
      market: 'CRYPTO',
      displaySymbol: symbol.toUpperCase(),
      tickDigits: 4,
      source: 'binance',
      krakenWs: undefined,
    }
  )
}

export const KRAKEN_FOREX_SYMBOLS = SYMBOL_UNIVERSE.filter((s) => s.source === 'kraken')

export const DEFAULT_WATCHLIST = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'PAXGUSDT',
]

export const TIMEFRAMES = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1M', label: '1M' },
]

// Timeframe → higher timeframe for confluence checks
export const HTF_MAP: Record<string, string> = {
  '1m': '15m',
  '5m': '1h',
  '15m': '4h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
  '1w': '1M',
  '1M': '1M', // no higher timeframe — callers must skip self-mapped
}

export function isValidSymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol.toUpperCase())
}

export function formatPrice(price: number | null | undefined, digits = 2): string {
  if (price === null || price === undefined || Number.isNaN(price)) return '—'
  return price.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatCompact(n: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}
