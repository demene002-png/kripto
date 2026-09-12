import type { CoinData } from '../types';

const BASE = 'https://api.binance.com';
const EXCLUDED_BASES = new Set(['USDT','USDC','FDUSD','TUSD','USDP','DAI','BUSD','USD1','USDE','USDS','PYUSD','GUSD','USDD','FRAX','LUSD','USD0','USTC','EUR','TRY','BRL','GBP']);
const LEVERAGED_SUFFIXES = ['UP','DOWN','BULL','BEAR'];

function baseAsset(symbol:string){ return symbol.endsWith('USDT') ? symbol.slice(0,-4) : symbol; }
function eligible(symbol:string){
  if(!symbol.endsWith('USDT')) return false;
  const base=baseAsset(symbol);
  if(EXCLUDED_BASES.has(base)) return false;
  if(LEVERAGED_SUFFIXES.some(s=>base.endsWith(s))) return false;
  return true;
}
function formatVolume(v:number){
  if(v>=1e9) return `${(v/1e9).toFixed(1)}B`;
  if(v>=1e6) return `${(v/1e6).toFixed(1)}M`;
  if(v>=1e3) return `${(v/1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export async function fetchTopUsdtMarkets(limit=50):Promise<CoinData[]> {
  const [tickerRes, bookRes] = await Promise.all([
    fetch(`${BASE}/api/v3/ticker/24hr`, { cache:'no-store' }),
    fetch(`${BASE}/api/v3/ticker/bookTicker`, { cache:'no-store' }),
  ]);
  if(!tickerRes.ok || !bookRes.ok) throw new Error('Binance genel piyasa verisine ulaşılamıyor');
  const tickers:any[] = await tickerRes.json();
  const books:any[] = await bookRes.json();
  const bookMap=new Map(books.map(b=>[String(b.symbol),b]));
  return tickers
    .filter(t=>eligible(String(t.symbol)))
    .map(t=>{
      const b=bookMap.get(String(t.symbol))||{};
      const bid=Number(b.bidPrice||0), ask=Number(b.askPrice||0), price=Number(t.lastPrice||0);
      const spread=bid>0&&ask>0?((ask-bid)/((ask+bid)/2))*100:0;
      return {
        symbol: baseAsset(String(t.symbol)), pair:String(t.symbol), name:baseAsset(String(t.symbol)), price,
        change24h:Number(t.priceChangePercent||0), volume:formatVolume(Number(t.quoteVolume||0)),
        quoteVolume:Number(t.quoteVolume||0), bidPrice:bid, askPrice:ask, spreadPercent:spread,
      } as CoinData;
    })
    .filter(x=>x.price>0 && x.quoteVolume!>0)
    .sort((a,b)=>(b.quoteVolume||0)-(a.quoteVolume||0))
    .slice(0,Math.max(1,Math.min(100,limit)));
}

export async function fetchKlines(symbol:string, interval='1h', limit=48){
  const pair=symbol.endsWith('USDT')?symbol:`${symbol}USDT`;
  const r=await fetch(`${BASE}/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(interval)}&limit=${Math.min(500,limit)}`,{cache:'no-store'});
  if(!r.ok) throw new Error(`Binance klines HTTP ${r.status}`);
  const rows:any[]=await r.json();
  return rows.map(x=>({time:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5])}));
}

const PRICE_BASES = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
];

async function fetchJsonWithFallback(path:string){
  let lastError:unknown=null;
  for(const base of PRICE_BASES){
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),4000);
      const r=await fetch(`${base}${path}`,{cache:'no-store',signal:controller.signal});
      clearTimeout(timer);
      if(!r.ok){lastError=new Error(`HTTP ${r.status}`);continue;}
      return await r.json();
    }catch(e){lastError=e;}
  }
  throw lastError instanceof Error?lastError:new Error('Binance fiyat verisine ulaşılamıyor');
}

/**
 * Returns a live public Binance Spot quote for any existing position pair.
 * This deliberately does NOT apply the auto-scan eligibility/stablecoin filter,
 * because risk-reducing manual exits must remain possible for legacy positions.
 */
export async function fetchSpotTicker(symbol:string):Promise<CoinData>{
  const pair=symbol.endsWith('USDT')?symbol:`${symbol}USDT`;
  const base=baseAsset(pair);
  const [book,ticker]=await Promise.all([
    fetchJsonWithFallback(`/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(pair)}`),
    fetchJsonWithFallback(`/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`),
  ]);
  const bid=Number(book?.bidPrice||0), ask=Number(book?.askPrice||0), price=Number(ticker?.lastPrice||0);
  if(!(price>0)) throw new Error(`${pair} için güncel Binance fiyatı alınamadı`);
  const spread=bid>0&&ask>0?((ask-bid)/((ask+bid)/2))*100:0;
  return {
    symbol:base,pair,name:base,price,
    change24h:Number(ticker?.priceChangePercent||0),
    volume:formatVolume(Number(ticker?.quoteVolume||0)),
    quoteVolume:Number(ticker?.quoteVolume||0),
    bidPrice:bid,askPrice:ask,spreadPercent:spread,
  } as CoinData;
}
