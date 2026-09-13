const BINANCE_BASE_URL = process.env.BINANCE_BASE_URL || 'https://api.binance.com';

export type MarketCoin = {
  symbol: string;
  pair: string;
  name: string;
  price: number;
  change24h: number;
  volume: string;
  quoteVolume: number;
  baseVolume: number;
  high24h: number;
  low24h: number;
  bidPrice: number;
  askPrice: number;
  spreadPercent: number;
};

const STABLE_BASES = new Set(['USDT','USDC','FDUSD','TUSD','DAI','USDP','BUSD','USD1','U','USDE','USDS','USDD','PYUSD','GUSD','FRAX','LUSD','USD0','AEUR','EURI','RLUSD','XUSD','AUSD','BFUSD','USDX','EUR','TRY','BRL','GBP','AUD','USTC']);
const EXCLUDED_SUFFIXES = ['UP','DOWN','BULL','BEAR'];
let cache: { expiresAt: number; data: MarketCoin[] } | null = null;
let lastMarketSuccessAt = 0;
let lastMarketError = '';
let healthProbeCache: { expiresAt:number; ok:boolean; latencyMs:number; serverTime?:number; error?:string } | null = null;

function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

async function fetchJson(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${BINANCE_BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'KriptoAI-Asistan/1.0' }
    });
    if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
    const data = await response.json();
    lastMarketSuccessAt = Date.now();
    lastMarketError = '';
    return data;
  } catch (e:any) {
    lastMarketError = e?.message || String(e);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getTopUsdtMarkets(limit = 50): Promise<MarketCoin[]> {
  if (cache && cache.expiresAt > Date.now() && cache.data.length >= Math.min(limit, 50)) {
    return cache.data.slice(0, limit);
  }

  const [exchangeInfo, tickers] = await Promise.all([
    fetchJson('/api/v3/exchangeInfo'),
    fetchJson('/api/v3/ticker/24hr')
  ]);

  const tradable = new Set<string>();
  for (const item of exchangeInfo.symbols || []) {
    if (item.status !== 'TRADING' || item.quoteAsset !== 'USDT' || !item.isSpotTradingAllowed) continue;
    const base = String(item.baseAsset || '');
    if (!/^[A-Z0-9]{2,10}$/.test(base)) continue;
    if (STABLE_BASES.has(base)) continue;
    if (EXCLUDED_SUFFIXES.some(s => base.endsWith(s))) continue;
    tradable.add(item.symbol);
  }

  const rows: MarketCoin[] = (tickers || [])
    .filter((t: any) => tradable.has(t.symbol))
    .map((t: any) => {
      const base = String(t.symbol).replace(/USDT$/, '');
      const bid = Number(t.bidPrice || 0);
      const ask = Number(t.askPrice || 0);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(t.lastPrice || 0);
      const spread = bid > 0 && ask > 0 && mid > 0 ? ((ask - bid) / mid) * 100 : 0;
      const quoteVolume = Number(t.quoteVolume || 0);
      return {
        symbol: base,
        pair: t.symbol,
        name: base,
        price: Number(t.lastPrice || 0),
        change24h: Number(t.priceChangePercent || 0),
        volume: formatVolume(quoteVolume),
        quoteVolume,
        baseVolume: Number(t.volume || 0),
        high24h: Number(t.highPrice || 0),
        low24h: Number(t.lowPrice || 0),
        bidPrice: bid,
        askPrice: ask,
        spreadPercent: spread
      };
    })
    .filter((x: MarketCoin) => Number.isFinite(x.price) && x.price > 0 && x.quoteVolume > 0)
    .sort((a: MarketCoin, b: MarketCoin) => b.quoteVolume - a.quoteVolume)
    .slice(0, 100);

  cache = { data: rows, expiresAt: Date.now() + 10_000 };
  return rows.slice(0, limit);
}

export async function getKlines(symbol: string, interval = '1h', limit = 48) {
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pair = clean.endsWith('USDT') ? clean : `${clean}USDT`;
  const safeLimit = Math.min(Math.max(limit, 10), 500);
  const allowed = new Set(['1m','5m','15m','1h','4h','1d']);
  const safeInterval = allowed.has(interval) ? interval : '1h';
  const data = await fetchJson(`/api/v3/klines?symbol=${pair}&interval=${safeInterval}&limit=${safeLimit}`);
  return (data || []).map((k: any[]) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5])
  }));
}

export async function getUsdtMarket(symbol: string): Promise<MarketCoin> {
  const base = symbol.toUpperCase().replace(/USDT$/,'').replace(/[^A-Z0-9]/g,'');
  if (!base) throw new Error('Geçersiz sembol.');
  const t:any = await fetchJson(`/api/v3/ticker/24hr?symbol=${base}USDT`);
  const bid=Number(t.bidPrice||0), ask=Number(t.askPrice||0), last=Number(t.lastPrice||0);
  const mid=bid>0&&ask>0?(bid+ask)/2:last;
  const quoteVolume=Number(t.quoteVolume||0);
  return { symbol:base, pair:`${base}USDT`, name:base, price:last, change24h:Number(t.priceChangePercent||0), volume:formatVolume(quoteVolume), quoteVolume, baseVolume:Number(t.volume||0), high24h:Number(t.highPrice||0), low24h:Number(t.lowPrice||0), bidPrice:bid, askPrice:ask, spreadPercent:bid>0&&ask>0&&mid>0?((ask-bid)/mid)*100:0 };
}


export function getMarketDataHealth() {
  const ageMs = lastMarketSuccessAt ? Date.now() - lastMarketSuccessAt : Infinity;
  return { lastSuccessAt:lastMarketSuccessAt, ageMs, stale:ageMs>20_000, lastError:lastMarketError };
}

export async function probeMarketDataHealth() {
  if (healthProbeCache && healthProbeCache.expiresAt > Date.now()) return healthProbeCache;
  const started=Date.now();
  try {
    const data:any=await fetchJson('/api/v3/time');
    healthProbeCache={expiresAt:Date.now()+5_000,ok:true,latencyMs:Date.now()-started,serverTime:Number(data.serverTime||0)};
  } catch(e:any) {
    healthProbeCache={expiresAt:Date.now()+5_000,ok:false,latencyMs:Date.now()-started,error:e?.message||String(e)};
  }
  return healthProbeCache;
}
