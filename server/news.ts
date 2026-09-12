import crypto from 'crypto';

export type NewsLevel = 'NORMAL'|'INFO'|'CAUTION'|'HIGH_RISK'|'VETO';

export interface NewsItem {
  id:string;
  title:string;
  url?:string;
  source:string;
  domain:string;
  publishedAt:number;
  symbols:string[];
  reliability:number;
  sentiment:number; // -100..100
  impact:number; // 0..100
  category:string;
  stale:boolean;
  duplicateOf?:string;
  confirmations:number;
  provider:string;
}

export interface UpcomingEvent {
  id:string;
  title:string;
  symbols:string[];
  date:number;
  displayedDate:string;
  impact:number;
  category:string;
  sourceUrl?:string;
  estimated?:boolean;
  provider:string;
}

const TIER1 = new Set(['binance.com','sec.gov','federalreserve.gov','ecb.europa.eu','cftc.gov','justice.gov','github.com']);
const TIER2 = new Set(['reuters.com','bloomberg.com','coindesk.com','theblock.co','cointelegraph.com']);
const CRITICAL_NEG = ['hack','exploit','breach','stolen','drain','drained','delist','delisting','suspend withdrawals','withdrawal suspended','network outage','chain halt','halted','insolvency','bankruptcy','rug pull','security incident','compromised'];
const NEG = ['lawsuit','investigation','downtime','outage','delay','vulnerability','attack','ban','fine','charges','liquidation','selloff'];
const POS = ['approval','approved','launch','upgrade','integration','partnership','listing','listed','adoption','record inflow','mainnet'];

function clamp(v:number,min=0,max=100){ return Math.max(min,Math.min(max,v)); }
function domainOf(url=''){
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./,''); } catch { return ''; }
}
function sourceReliability(domain:string, source:string){
  if(TIER1.has(domain)) return 96;
  if(TIER2.has(domain)) return 86;
  if(/official|foundation|labs|protocol|team/i.test(source)) return 88;
  return 62;
}
function normalizeTitle(t:string){ return t.toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/[^a-z0-9çğıöşü\s]/gi,' ').replace(/\s+/g,' ').trim(); }
function words(t:string){ return new Set(normalizeTitle(t).split(' ').filter(x=>x.length>3)); }
function similarity(a:string,b:string){
  const A=words(a), B=words(b); if(!A.size||!B.size) return 0;
  let inter=0; for(const x of A) if(B.has(x)) inter++;
  return inter/Math.max(A.size,B.size);
}
function containsAny(text:string,list:string[]){ const x=text.toLowerCase(); return list.filter(k=>x.includes(k)); }
function inferCategory(title:string){
  const t=title.toLowerCase();
  if(containsAny(t,['hack','exploit','breach','security','stolen']).length) return 'SECURITY';
  if(containsAny(t,['delist','listing','listed']).length) return 'EXCHANGE';
  if(containsAny(t,['sec ','regulation','lawsuit','court','ban','cftc']).length) return 'REGULATION';
  if(containsAny(t,['outage','halt','network','mainnet','upgrade']).length) return 'NETWORK';
  if(containsAny(t,['fed ','fomc','cpi','inflation','rates','interest rate']).length) return 'MACRO';
  return 'GENERAL';
}
function scoreText(title:string){
  const critical=containsAny(title,CRITICAL_NEG).length;
  const neg=containsAny(title,NEG).length;
  const pos=containsAny(title,POS).length;
  const sentiment=clamp(50 + pos*14 - neg*16 - critical*28,0,100)*2-100;
  const impact=clamp(35 + pos*8 + neg*12 + critical*25,10,100);
  return {sentiment:Math.round(sentiment),impact:Math.round(impact),critical};
}
function parseDate(v:any){ const d=new Date(v||0).getTime(); return Number.isFinite(d)&&d>0?d:Date.now(); }
function symbolsFromAny(raw:any){
  const vals:any[] = raw?.currencies || raw?.coins || raw?.symbols || [];
  return vals.map((x:any)=>String(x?.code||x?.symbol||x?.ticker||x||'').toUpperCase()).filter(Boolean);
}
function hash(s:string){ return crypto.createHash('sha1').update(s).digest('hex').slice(0,16); }

async function fetchCryptoPanic(symbol?:string):Promise<NewsItem[]> {
  const token=process.env.CRYPTOPANIC_AUTH_TOKEN; if(!token) return [];
  const base=process.env.CRYPTOPANIC_API_URL || 'https://cryptopanic.com/api/developer/v2/posts/';
  const u=new URL(base); u.searchParams.set('auth_token',token); u.searchParams.set('kind','news');
  if(symbol) u.searchParams.set('currencies',symbol.toUpperCase());
  const r=await fetch(u,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)}); if(!r.ok) throw new Error(`CryptoPanic ${r.status}`);
  const j:any=await r.json(); const rows=j.results||j.data||j.items||[];
  return rows.slice(0,80).map((x:any)=>{
    const title=String(x.title||''); const url=String(x.url||x.original_url||'');
    const source=String(x.source?.title||x.source?.domain||x.source||'CryptoPanic feed'); const domain=domainOf(url||String(x.source?.url||''));
    const st=scoreText(title); const rel=sourceReliability(domain,source);
    const panic=Number(x.panic_score||x.panicScore||0);
    return {id:String(x.id||hash(title+url)),title,url,source,domain,publishedAt:parseDate(x.published_at||x.publishedAt||x.created_at),symbols:symbolsFromAny(x),reliability:rel,sentiment:st.sentiment,impact:Math.round(clamp(Math.max(st.impact,panic||0))),category:inferCategory(title),stale:false,confirmations:1,provider:'cryptopanic'};
  });
}

async function fetchGenericNews(symbol?:string):Promise<NewsItem[]> {
  const urls=(process.env.NEWS_JSON_URLS||'').split(';').map(x=>x.trim()).filter(Boolean); const out:NewsItem[]=[];
  for(const url of urls.slice(0,5)){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6000)}); if(!r.ok) continue;
      const j:any=await r.json(); const rows=Array.isArray(j)?j:(j.items||j.data||j.results||[]);
      for(const x of rows.slice(0,80)){
        const title=String(x.title||x.headline||''); if(!title) continue;
        const syms=symbolsFromAny(x); if(symbol&&syms.length&&!syms.includes(symbol.toUpperCase())) continue;
        const itemUrl=String(x.url||x.link||''); const source=String(x.source?.name||x.source||domainOf(itemUrl)||'JSON feed'); const domain=domainOf(itemUrl);
        const st=scoreText(title);
        out.push({id:String(x.id||hash(title+itemUrl)),title,url:itemUrl,source,domain,publishedAt:parseDate(x.publishedAt||x.published_at||x.date),symbols:syms,reliability:sourceReliability(domain,source),sentiment:st.sentiment,impact:st.impact,category:inferCategory(title),stale:false,confirmations:1,provider:'generic-json'});
      }
    }catch{}
  }
  return out;
}


const cmcSlugCache=new Map<string,{slug:string;expires:number}>();
async function resolveCoinMarketCalSlug(symbol:string,key:string){
  const upper=symbol.toUpperCase(); const hit=cmcSlugCache.get(upper); if(hit&&hit.expires>Date.now()) return hit.slug;
  const u=new URL('https://api.coinmarketcal.com/v2/coins'); u.searchParams.set('q',upper); u.searchParams.set('limit','20');
  const r=await fetch(u,{headers:{'x-api-key':key,Accept:'application/json'},signal:AbortSignal.timeout(7000)}); if(!r.ok) throw new Error(`CoinMarketCal coins ${r.status}`);
  const j:any=await r.json(); const rows:any[]=j.data||[];
  const exact=rows.filter(x=>String(x.symbol||'').toUpperCase()===upper).sort((a,b)=>Number(a.rank??999999)-Number(b.rank??999999))[0];
  const slug=String(exact?.slug||''); if(!slug) throw new Error(`CoinMarketCal slug bulunamadı: ${upper}`);
  cmcSlugCache.set(upper,{slug,expires:Date.now()+24*3600_000}); return slug;
}

async function fetchCoinMarketCal(symbol?:string):Promise<UpcomingEvent[]> {
  const key=process.env.COINMARKETCAL_API_KEY; if(!key) return [];
  const now=new Date(), to=new Date(Date.now()+7*24*3600_000);
  const u=new URL('https://api.coinmarketcal.com/v2/events'); u.searchParams.set('from',now.toISOString()); u.searchParams.set('to',to.toISOString()); u.searchParams.set('limit','50');
  if(symbol) u.searchParams.set('coins',await resolveCoinMarketCalSlug(symbol,key));
  const r=await fetch(u,{headers:{'x-api-key':key,Accept:'application/json'},signal:AbortSignal.timeout(7000)}); if(!r.ok) throw new Error(`CoinMarketCal ${r.status}`);
  const j:any=await r.json();
  return (j.data||[]).map((x:any)=>({id:String(x.id),title:String(x.title||''),symbols:(x.coins||[]).map((c:any)=>String(c.symbol||'').toUpperCase()).filter(Boolean),date:parseDate(x.date),displayedDate:String(x.displayedDate||x.date||''),impact:Math.round(clamp(Number(x.impact||5)*10)),category:String((x.categories||[])[0]||'EVENT'),sourceUrl:x.sourceUrl||undefined,estimated:!!x.isEstimated,provider:'coinmarketcal'}));
}

function parseMacroEvents():UpcomingEvent[]{
  try{
    const rows=JSON.parse(process.env.MACRO_EVENTS_JSON||'[]'); if(!Array.isArray(rows)) return [];
    return rows.map((x:any)=>({id:String(x.id||hash(String(x.title)+String(x.date))),title:String(x.title||''),symbols:(x.symbols||[]).map((s:any)=>String(s).toUpperCase()),date:parseDate(x.date),displayedDate:String(x.displayedDate||x.date||''),impact:Math.round(clamp(Number(x.impact||70))),category:String(x.category||'MACRO'),sourceUrl:x.sourceUrl,estimated:!!x.estimated,provider:'macro-config'}));
  }catch{return [];}
}

let cache=new Map<string,{expires:number,value:any}>();
export async function buildNewsIntelligence(symbol?:string){
  const key=(symbol||'MARKET').toUpperCase(); const hit=cache.get(key); if(hit&&hit.expires>Date.now()) return hit.value;
  const providerErrors:string[]=[];
  const newsSettled=await Promise.allSettled([fetchCryptoPanic(symbol),fetchGenericNews(symbol)]);
  const news:NewsItem[]=[];
  newsSettled.forEach((x,i)=>{ if(x.status==='fulfilled') news.push(...x.value); else providerErrors.push(`${i===0?'CryptoPanic':'GenericNews'}: ${x.reason?.message||'error'}`); });
  let events:UpcomingEvent[]=[];
  try{ events.push(...await fetchCoinMarketCal(symbol)); }catch(e:any){providerErrors.push(`CoinMarketCal: ${e.message}`);}
  events.push(...parseMacroEvents().filter(e=>!symbol||!e.symbols.length||e.symbols.includes(symbol.toUpperCase())));

  // recency + duplicates + cross-source confirmation
  const now=Date.now(); news.sort((a,b)=>b.publishedAt-a.publishedAt);
  for(let i=0;i<news.length;i++){
    news[i].stale=now-news[i].publishedAt>48*3600_000;
    for(let j=0;j<i;j++) if(similarity(news[i].title,news[j].title)>=0.62){ news[i].duplicateOf=news[j].id; news[j].confirmations++; break; }
  }
  const unique=news.filter(n=>!n.duplicateOf).slice(0,40);
  const recent=unique.filter(n=>!n.stale && now-n.publishedAt<24*3600_000);
  const critical=recent.filter(n=>containsAny(n.title,CRITICAL_NEG).length>0 && n.sentiment<0);
  const strongestNeg=[...recent].sort((a,b)=>(b.impact*b.reliability*Math.max(0,-b.sentiment))-(a.impact*a.reliability*Math.max(0,-a.sentiment)))[0];
  const strongestPos=[...recent].sort((a,b)=>(b.impact*b.reliability*Math.max(0,b.sentiment))-(a.impact*a.reliability*Math.max(0,a.sentiment)))[0];
  const soon=events.filter(e=>e.date>=now && e.date-now<=24*3600_000).sort((a,b)=>a.date-b.date);
  const imminent=soon.filter(e=>e.date-now<=30*60_000 && e.impact>=70);

  let level:NewsLevel='NORMAL', reason='Doğrulanmış kritik haber/olay yok.';
  const verifiedCritical=critical.find(n=>n.reliability>=90 || (n.confirmations>=2&&n.reliability>=78));
  if(verifiedCritical){ level='VETO'; reason=`Doğrulanmış kritik ${verifiedCritical.category.toLowerCase()} haberi: ${verifiedCritical.title}`; }
  else if(critical.some(n=>n.reliability>=75)){ const n=critical.find(n=>n.reliability>=75)!; level='HIGH_RISK'; reason=`Yüksek riskli haber teyit bekliyor: ${n.title}`; }
  else if(imminent.length){ level='HIGH_RISK'; reason=`Yüksek etkili olay çok yakın: ${imminent[0].title}`; }
  else if(strongestNeg && strongestNeg.impact>=65 && strongestNeg.reliability>=70){ level='CAUTION'; reason=`Negatif haber riski: ${strongestNeg.title}`; }
  else if(soon.some(e=>e.impact>=70)){ const e=soon.find(e=>e.impact>=70)!; level='CAUTION'; reason=`24 saat içinde yüksek etkili olay: ${e.title}`; }
  else if(recent.length){ level='INFO'; reason='Güncel haber akışı mevcut; sert risk sinyali yok.'; }

  const posWeight=recent.reduce((s,n)=>s+Math.max(0,n.sentiment)*n.impact*n.reliability/1_000_000,0);
  const negWeight=recent.reduce((s,n)=>s+Math.max(0,-n.sentiment)*n.impact*n.reliability/1_000_000,0);
  const netSentiment=clamp(50+(posWeight-negWeight)*35,0,100)*2-100;
  // Positive news gets only a small bonus; negative news can materially raise risk.
  const opportunityAdjustment=Math.round(clamp(netSentiment/25,-8,5));
  const riskAdjustment= level==='VETO'?35:level==='HIGH_RISK'?22:level==='CAUTION'?10:Math.round(Math.max(0,-netSentiment)/12);
  const confidenceAdjustment=providerErrors.length?-4:recent.some(n=>n.confirmations>=2)?4:0;
  const socialAnomaly=recent.length>=8 ? clamp((recent.filter(n=>now-n.publishedAt<2*3600_000).length/Math.max(1,recent.length))*120,0,100) : 0;

  const result={
    symbol:key, level, reason, veto:{active:level==='VETO',reason:level==='VETO'?reason:''},
    score:{sentiment:Math.round(netSentiment),opportunityAdjustment,riskAdjustment,confidenceAdjustment,socialAnomaly:Math.round(socialAnomaly)},
    news:unique.slice(0,12), upcomingEvents:events.sort((a,b)=>a.date-b.date).slice(0,12),
    providers:{cryptopanic:!!process.env.CRYPTOPANIC_AUTH_TOKEN,coinmarketcal:!!process.env.COINMARKETCAL_API_KEY,genericNews:!!process.env.NEWS_JSON_URLS,macroConfig:parseMacroEvents().length>0,errors:providerErrors},
    generatedAt:now
  };
  cache.set(key,{expires:now+30_000,value:result}); return result;
}
