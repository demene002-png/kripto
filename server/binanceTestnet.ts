import crypto from 'crypto';

const BASE_URL = process.env.BINANCE_TESTNET_BASE_URL || 'https://testnet.binance.vision';
const API_KEY = process.env.BINANCE_TESTNET_API_KEY || '';
const API_SECRET = process.env.BINANCE_TESTNET_API_SECRET || '';
let timeOffsetMs = 0;

function configured(){ return Boolean(API_KEY && API_SECRET); }
function sign(query:string){ return crypto.createHmac('sha256', API_SECRET).update(query).digest('hex'); }

async function publicJson(path:string){
  const r=await fetch(`${BASE_URL}${path}`,{signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw new Error(`Binance Testnet HTTP ${r.status}: ${(await r.text()).slice(0,180)}`);
  return await r.json();
}
async function signedJson(path:string, method:'GET'|'POST'|'DELETE'='GET', params:Record<string,string|number>={}){
  if(!configured()) throw new Error('Binance Testnet API anahtarları yapılandırılmamış.');
  const body=new URLSearchParams();
  for(const [k,v] of Object.entries({...params,timestamp:Date.now()+timeOffsetMs,recvWindow:5000})) body.set(k,String(v));
  const query=body.toString();
  body.set('signature',sign(query));
  const url=method==='GET'?`${BASE_URL}${path}?${body.toString()}`:`${BASE_URL}${path}`;
  const r=await fetch(url,{method,headers:{'X-MBX-APIKEY':API_KEY,'Content-Type':'application/x-www-form-urlencoded'},body:method==='GET'?undefined:body.toString(),signal:AbortSignal.timeout(10000)});
  const text=await r.text(); let data:any; try{data=JSON.parse(text)}catch{data=text}
  if(!r.ok) throw new Error(`Binance Testnet ${data?.code||r.status}: ${data?.msg||String(text).slice(0,180)}`);
  return data;
}
export async function syncTestnetTime(){
  const t=await publicJson('/api/v3/time'); timeOffsetMs=Number(t.serverTime)-Date.now(); return timeOffsetMs;
}
export async function getTestnetStatus(){
  const base={configured:configured(),baseUrl:BASE_URL,environment:'TESTNET',withdrawalsSupported:false,fullAutoEnabled:false};
  if(!configured()) return {...base,connected:false,canTrade:false,accountType:null,reason:'BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_API_SECRET eksik'};
  try{ await syncTestnetTime(); const a=await signedJson('/api/v3/account'); return {...base,connected:true,canTrade:Boolean(a.canTrade),accountType:a.accountType||'SPOT'}; }
  catch(e:any){ return {...base,connected:false,canTrade:false,accountType:null,reason:e.message}; }
}
export async function getTestnetAccount(){ await syncTestnetTime(); return signedJson('/api/v3/account'); }
export async function getTestnetUsdtBalance(){
  const a=await getTestnetAccount(); const b=(a.balances||[]).find((x:any)=>x.asset==='USDT'); return Number(b?.free||0);
}
export async function placeTestnetMarketBuy(symbol:string,quoteOrderQty:number,clientOrderId?:string){
  if(!Number.isFinite(quoteOrderQty)||quoteOrderQty<=0) throw new Error('Geçersiz alış tutarı.');
  const n=await normalizeTestnetMarketBuy(symbol,quoteOrderQty);
  await syncTestnetTime();
  return signedJson('/api/v3/order','POST',{symbol,type:'MARKET',side:'BUY',quoteOrderQty:n.quoteOrderQty,newOrderRespType:'FULL',...(clientOrderId?{newClientOrderId:clientOrderId}:{})});
}
export async function placeTestnetMarketSell(symbol:string,quantity:number,referencePrice?:number,clientOrderId?:string){
  if(!Number.isFinite(quantity)||quantity<=0) throw new Error('Geçersiz satış miktarı.');
  const n=await normalizeTestnetMarketSell(symbol,quantity,referencePrice);
  await syncTestnetTime();
  return signedJson('/api/v3/order','POST',{symbol,type:'MARKET',side:'SELL',quantity:n.quantity,newOrderRespType:'FULL',...(clientOrderId?{newClientOrderId:clientOrderId}:{})});
}
export async function getTestnetAssetFree(asset:string){
  const a=await getTestnetAccount(); const b=(a.balances||[]).find((x:any)=>x.asset===asset); return Number(b?.free||0);
}


type SymbolRules = {
  symbol:string; baseAsset:string; quoteAsset:string; status:string;
  minQty:number; maxQty:number; stepSize:number; marketMinQty:number; marketMaxQty:number; marketStepSize:number;
  minNotional:number; maxNotional:number|null; quoteOrderQtyMarketAllowed:boolean;
};

let rulesCache = new Map<string,{expiresAt:number;rules:SymbolRules}>();

function floorToStep(value:number, step:number){
  if(!Number.isFinite(step)||step<=0) return value;
  const precision=Math.max(0,Math.ceil(-Math.log10(step))+2);
  return Number((Math.floor((value+1e-12)/step)*step).toFixed(precision));
}

export async function getTestnetSymbolRules(symbol:string):Promise<SymbolRules>{
  const clean=String(symbol).toUpperCase().replace(/[^A-Z0-9]/g,'');
  const cached=rulesCache.get(clean);
  if(cached&&cached.expiresAt>Date.now()) return cached.rules;
  const info:any=await publicJson(`/api/v3/exchangeInfo?symbol=${clean}`);
  const s=info?.symbols?.[0];
  if(!s) throw new Error(`Testnet symbol rules bulunamadı: ${clean}`);
  const filter=(name:string)=>(s.filters||[]).find((f:any)=>f.filterType===name)||{};
  const lot=filter('LOT_SIZE'), marketLot=filter('MARKET_LOT_SIZE'), minN=filter('MIN_NOTIONAL'), notional=filter('NOTIONAL');
  const rules:SymbolRules={
    symbol:clean,baseAsset:String(s.baseAsset),quoteAsset:String(s.quoteAsset),status:String(s.status),
    minQty:Number(lot.minQty||0),maxQty:Number(lot.maxQty||Infinity),stepSize:Number(lot.stepSize||0),
    marketMinQty:Number(marketLot.minQty||lot.minQty||0),marketMaxQty:Number(marketLot.maxQty||lot.maxQty||Infinity),marketStepSize:Number(marketLot.stepSize||lot.stepSize||0),
    minNotional:Number(notional.minNotional||minN.minNotional||0),maxNotional:notional.maxNotional?Number(notional.maxNotional):null,
    quoteOrderQtyMarketAllowed:Boolean(s.quoteOrderQtyMarketAllowed)
  };
  rulesCache.set(clean,{expiresAt:Date.now()+15*60_000,rules});
  return rules;
}

export async function normalizeTestnetMarketBuy(symbol:string,quoteOrderQty:number){
  const r=await getTestnetSymbolRules(symbol);
  if(r.status!=='TRADING') throw new Error(`${r.symbol} Testnet üzerinde TRADING değil.`);
  if(!r.quoteOrderQtyMarketAllowed) throw new Error(`${r.symbol} quoteOrderQty MARKET alışını desteklemiyor.`);
  if(quoteOrderQty<r.minNotional) throw new Error(`Minimum notional ${r.minNotional} ${r.quoteAsset}.`);
  if(r.maxNotional&&quoteOrderQty>r.maxNotional) throw new Error(`Maksimum notional ${r.maxNotional} ${r.quoteAsset}.`);
  return {quoteOrderQty:Number(quoteOrderQty.toFixed(8)),rules:r};
}

export async function normalizeTestnetMarketSell(symbol:string,quantity:number,referencePrice?:number){
  const r=await getTestnetSymbolRules(symbol);
  if(r.status!=='TRADING') throw new Error(`${r.symbol} Testnet üzerinde TRADING değil.`);
  const step=r.marketStepSize||r.stepSize;
  const qty=floorToStep(Math.min(quantity,r.marketMaxQty||quantity),step);
  if(qty<r.marketMinQty) throw new Error(`Satış miktarı minimum ${r.marketMinQty} ${r.baseAsset} altında.`);
  if(referencePrice&&qty*referencePrice<r.minNotional) throw new Error(`Satış notional değeri minimum ${r.minNotional} ${r.quoteAsset} altında.`);
  return {quantity:qty,rules:r};
}

export async function getTestnetOrder(symbol:string,orderId:string|number){
  await syncTestnetTime();
  return signedJson('/api/v3/order','GET',{symbol,orderId});
}

export async function getTestnetOpenOrders(symbol?:string){
  await syncTestnetTime();
  return signedJson('/api/v3/openOrders','GET',symbol?{symbol}:{});
}

export async function getTestnetBalances(){
  const a=await getTestnetAccount();
  return (a.balances||[]).map((b:any)=>({asset:String(b.asset),free:Number(b.free||0),locked:Number(b.locked||0)})).filter((b:any)=>b.free>0||b.locked>0);
}
