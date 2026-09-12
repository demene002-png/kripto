import crypto from 'crypto';

const BASE_URL=process.env.BINANCE_LIVE_BASE_URL||'https://api.binance.com';
const API_KEY=process.env.BINANCE_LIVE_API_KEY||'';
const API_SECRET=process.env.BINANCE_LIVE_API_SECRET||'';
let timeOffsetMs=0;

export function liveConfigured(){return Boolean(API_KEY&&API_SECRET);}
function sign(q:string){return crypto.createHmac('sha256',API_SECRET).update(q).digest('hex');}

async function publicJson(path:string){
  const r=await fetch(`${BASE_URL}${path}`,{signal:AbortSignal.timeout(8000)});
  const text=await r.text(); let data:any; try{data=JSON.parse(text)}catch{data=text}
  if(!r.ok) throw new Error(`Binance live ${r.status}: ${data?.msg||String(text).slice(0,160)}`);
  return data;
}
async function signed(path:string,method:'GET'|'POST'|'DELETE'='GET',params:Record<string,string|number>={}){
  if(!liveConfigured()) throw new Error('Canlı Binance API anahtarları yapılandırılmamış.');
  const body=new URLSearchParams();
  for(const [k,v] of Object.entries({...params,timestamp:Date.now()+timeOffsetMs,recvWindow:5000})) body.set(k,String(v));
  const raw=body.toString(); body.set('signature',sign(raw));
  const url=method==='GET'?`${BASE_URL}${path}?${body.toString()}`:`${BASE_URL}${path}`;
  const r=await fetch(url,{method,headers:{'X-MBX-APIKEY':API_KEY,'Content-Type':'application/x-www-form-urlencoded'},body:method==='GET'?undefined:body.toString(),signal:AbortSignal.timeout(10000)});
  const text=await r.text(); let data:any; try{data=JSON.parse(text)}catch{data=text}
  if(!r.ok) throw new Error(`Binance live ${data?.code||r.status}: ${data?.msg||String(text).slice(0,180)}`);
  return data;
}
export async function syncLiveTime(){const t=await publicJson('/api/v3/time');timeOffsetMs=Number(t.serverTime)-Date.now();return timeOffsetMs;}
export async function getLiveAccount(){await syncLiveTime();return signed('/api/v3/account');}
export async function getLiveAssetFree(asset:string){const a=await getLiveAccount();const b=(a.balances||[]).find((x:any)=>x.asset===asset);return Number(b?.free||0);}
export async function getLiveUsdtBalance(){return getLiveAssetFree('USDT');}

type LiveRules={symbol:string;baseAsset:string;quoteAsset:string;status:string;minQty:number;maxQty:number;stepSize:number;marketMinQty:number;marketMaxQty:number;marketStepSize:number;minNotional:number;maxNotional:number|null;tickSize:number;minPrice:number;maxPrice:number;quoteOrderQtyMarketAllowed:boolean};
let rulesCache=new Map<string,{expiresAt:number;rules:LiveRules}>();

function decimals(step:number){if(!Number.isFinite(step)||step<=0)return 8;const s=step.toFixed(16).replace(/0+$/,'');const i=s.indexOf('.');return i<0?0:s.length-i-1;}
function floorStep(v:number,step:number){if(!step||step<=0)return v;return Number((Math.floor((v+1e-12)/step)*step).toFixed(Math.min(16,decimals(step))));}
function floorTick(v:number,tick:number){return floorStep(v,tick);}

export async function getLiveSymbolRules(symbol:string):Promise<LiveRules>{
  const clean=String(symbol).toUpperCase().replace(/[^A-Z0-9]/g,'');
  const c=rulesCache.get(clean);if(c&&c.expiresAt>Date.now())return c.rules;
  const info:any=await publicJson(`/api/v3/exchangeInfo?symbol=${clean}`);
  const s=info?.symbols?.[0];if(!s)throw new Error(`Live symbol rules bulunamadı: ${clean}`);
  const f=(n:string)=>(s.filters||[]).find((x:any)=>x.filterType===n)||{};
  const lot=f('LOT_SIZE'),ml=f('MARKET_LOT_SIZE'),mn=f('MIN_NOTIONAL'),nt=f('NOTIONAL'),pf=f('PRICE_FILTER');
  const rules:LiveRules={
    symbol:clean,baseAsset:String(s.baseAsset),quoteAsset:String(s.quoteAsset),status:String(s.status),
    minQty:Number(lot.minQty||0),maxQty:Number(lot.maxQty||Infinity),stepSize:Number(lot.stepSize||0),
    marketMinQty:Number(ml.minQty||lot.minQty||0),marketMaxQty:Number(ml.maxQty||lot.maxQty||Infinity),marketStepSize:Number(ml.stepSize||lot.stepSize||0),
    minNotional:Number(nt.minNotional||mn.minNotional||0),maxNotional:nt.maxNotional?Number(nt.maxNotional):null,
    tickSize:Number(pf.tickSize||0),minPrice:Number(pf.minPrice||0),maxPrice:Number(pf.maxPrice||Infinity),
    quoteOrderQtyMarketAllowed:Boolean(s.quoteOrderQtyMarketAllowed)
  };
  rulesCache.set(clean,{expiresAt:Date.now()+15*60_000,rules});
  return rules;
}
export async function normalizeLiveMarketBuy(symbol:string,quoteOrderQty:number){
  const r=await getLiveSymbolRules(symbol);
  if(r.status!=='TRADING')throw new Error(`${r.symbol} TRADING değil.`);
  if(!r.quoteOrderQtyMarketAllowed)throw new Error(`${r.symbol} quoteOrderQty MARKET alışını desteklemiyor.`);
  if(quoteOrderQty<r.minNotional)throw new Error(`Minimum notional ${r.minNotional} ${r.quoteAsset}.`);
  if(r.maxNotional&&quoteOrderQty>r.maxNotional)throw new Error(`Maksimum notional ${r.maxNotional} ${r.quoteAsset}.`);
  return {quoteOrderQty:Number(quoteOrderQty.toFixed(8)),rules:r};
}
export async function normalizeLiveSellQty(symbol:string,quantity:number,referencePrice?:number){
  const r=await getLiveSymbolRules(symbol);const step=r.marketStepSize||r.stepSize;
  const qty=floorStep(Math.min(quantity,r.marketMaxQty||quantity),step);
  if(qty<r.marketMinQty)throw new Error(`Miktar minimum ${r.marketMinQty} ${r.baseAsset} altında.`);
  if(referencePrice&&qty*referencePrice<r.minNotional)throw new Error(`Notional minimum ${r.minNotional} ${r.quoteAsset} altında.`);
  return {quantity:qty,rules:r};
}
export async function placeLiveMarketBuy(symbol:string,quoteOrderQty:number,clientOrderId:string){
  const n=await normalizeLiveMarketBuy(symbol,quoteOrderQty);await syncLiveTime();
  return signed('/api/v3/order','POST',{symbol,side:'BUY',type:'MARKET',quoteOrderQty:n.quoteOrderQty,newOrderRespType:'FULL',newClientOrderId:clientOrderId});
}
export async function placeLiveMarketSell(symbol:string,quantity:number,referencePrice:number,clientOrderId:string){
  const n=await normalizeLiveSellQty(symbol,quantity,referencePrice);await syncLiveTime();
  return signed('/api/v3/order','POST',{symbol,side:'SELL',type:'MARKET',quantity:n.quantity,newOrderRespType:'FULL',newClientOrderId:clientOrderId});
}
export async function placeLiveProtectiveStop(symbol:string,quantity:number,stopPrice:number,clientOrderId:string){
  const q=await normalizeLiveSellQty(symbol,quantity,stopPrice);
  const price=floorTick(stopPrice,q.rules.tickSize);
  if(price<=0)throw new Error('Geçersiz STOP_LOSS stopPrice.');
  await syncLiveTime();
  return signed('/api/v3/order','POST',{symbol,side:'SELL',type:'STOP_LOSS',quantity:q.quantity,stopPrice:price,newOrderRespType:'RESULT',newClientOrderId:clientOrderId});
}
export async function cancelLiveOrder(symbol:string,orderId:string|number){
  await syncLiveTime();return signed('/api/v3/order','DELETE',{symbol,orderId});
}
export async function getLiveOrder(symbol:string,orderId:string|number){
  await syncLiveTime();return signed('/api/v3/order','GET',{symbol,orderId});
}
