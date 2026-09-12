import crypto from 'crypto';
import { getDb } from './db';
import { getResearchAnalytics } from './research';
import { getExecutionSafety, engageKillSwitch } from './safety';

const BASE_URL=process.env.BINANCE_LIVE_BASE_URL||'https://api.binance.com';
const API_KEY=process.env.BINANCE_LIVE_API_KEY||'';
const API_SECRET=process.env.BINANCE_LIVE_API_SECRET||'';

function configured(){ return Boolean(API_KEY&&API_SECRET); }
function sign(q:string){ return crypto.createHmac('sha256',API_SECRET).update(q).digest('hex'); }

async function signedGet(path:string, params:Record<string,string|number>={}){
  if(!configured()) throw new Error('Live API preflight anahtarları yapılandırılmamış.');
  const qs=new URLSearchParams({...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)])),timestamp:String(Date.now()),recvWindow:'5000'});
  qs.set('signature',sign(qs.toString()));
  const r=await fetch(`${BASE_URL}${path}?${qs.toString()}`,{headers:{'X-MBX-APIKEY':API_KEY},signal:AbortSignal.timeout(8000)});
  const text=await r.text(); let data:any; try{data=JSON.parse(text)}catch{data=text}
  if(!r.ok) throw new Error(`Binance live preflight ${data?.code||r.status}: ${data?.msg||String(text).slice(0,160)}`);
  return data;
}

export async function getLiveApiPermissionPreflight(){
  if(!configured()) return {configured:false,checked:false,pass:false,reason:'BINANCE_LIVE_API_KEY / BINANCE_LIVE_API_SECRET eksik',permissions:null};
  try{
    const p=await signedGet('/sapi/v1/account/apiRestrictions');
    const checks={
      reading:Boolean(p.enableReading),
      spotTrading:Boolean(p.enableSpotAndMarginTrading),
      withdrawalsDisabled:!Boolean(p.enableWithdrawals),
      futuresDisabled:!Boolean(p.enableFutures),
      marginDisabled:!Boolean(p.enableMargin),
      ipRestricted:Boolean(p.ipRestrict)
    };
    // IP restriction is strongly preferred but not an absolute blocker in V10 preflight.
    const pass=checks.reading&&checks.spotTrading&&checks.withdrawalsDisabled&&checks.futuresDisabled&&checks.marginDisabled;
    return {configured:true,checked:true,pass,checks,permissions:{
      enableReading:Boolean(p.enableReading),enableSpotAndMarginTrading:Boolean(p.enableSpotAndMarginTrading),
      enableWithdrawals:Boolean(p.enableWithdrawals),enableFutures:Boolean(p.enableFutures),
      enableMargin:Boolean(p.enableMargin),ipRestrict:Boolean(p.ipRestrict),createTime:Number(p.createTime||0)
    },reason:pass?'API izinleri V10 Spot güvenlik politikasına uyuyor.':'API izinleri güvenlik politikasını karşılamıyor.'};
  }catch(e:any){return {configured:true,checked:false,pass:false,reason:e.message,permissions:null};}
}

export async function getLiveReadiness(userId:number){
  const db=await getDb();
  const settings=await db.get('SELECT * FROM settings WHERE user_id=?',[userId]);
  const [api,research,safety]=await Promise.all([getLiveApiPermissionPreflight(),getResearchAnalytics(userId),getExecutionSafety(userId)]);
  const liveCapitalCapUsd=Math.max(0,Number(settings?.liveCapitalCapUsd||0));
  const hardCap=Math.max(10,Number(process.env.LIVE_HARD_CAP_USD||1000));
  const attestations={
    apiPermissionReview:Boolean(settings?.liveApiPermissionAttested),
    emergencyDrill:Boolean(settings?.emergencyDrillAttested),
    testnetReview:Boolean(settings?.testnetReviewAttested),
    newsRetestReview:Boolean(settings?.newsRetestAttested)
  };
  const checks=[
    {id:'live-env-gate',label:'Canlı emirler sunucu environment gate arkasında',pass:process.env.ENABLE_LIVE_MANUAL_TRADING==='true',critical:true},
    {id:'api-configured',label:'Canlı API preflight anahtarı tanımlı',pass:api.configured,critical:false},
    {id:'withdrawals-off',label:'Withdrawal yetkisi kapalı',pass:Boolean(api.checks?.withdrawalsDisabled),critical:true},
    {id:'spot-only',label:'Spot açık; Futures/Margin kapalı',pass:Boolean(api.checks?.spotTrading&&api.checks?.futuresDisabled&&api.checks?.marginDisabled),critical:true},
    {id:'ip-restrict',label:'API IP restriction aktif',pass:Boolean(api.checks?.ipRestricted),critical:true},
    {id:'shadow-50',label:'En az 50 çözülmüş shadow sinyali',pass:Boolean(research.testReadiness?.shadowSampleReady),critical:true},
    {id:'news-retest',label:'CryptoPanic / News A-B retest örneklem eşiği',pass:Boolean(research.testReadiness?.newsRetestReady),critical:true},
    {id:'walk-forward',label:'En az 3 walk-forward test ve en az 2 robust sonuç',pass:Number(research.testReadiness?.walkForwardRuns||0)>=3&&Number(research.testReadiness?.walkForwardRobustRuns||0)>=2,critical:true},
    {id:'testnet-sample',label:'En az 20 kapalı Testnet işlem',pass:Number(research.testReadiness?.testnetClosedTrades||0)>=20,critical:true},
    {id:'capital-cap',label:`Canlı sermaye üst limiti 0 < limit <= $${hardCap}`,pass:liveCapitalCapUsd>0&&liveCapitalCapUsd<=hardCap,critical:true},
    {id:'api-review',label:'API izinleri kullanıcı tarafından gözden geçirildi',pass:attestations.apiPermissionReview,critical:true},
    {id:'emergency-drill',label:'Emergency exit drill manuel olarak gözden geçirildi',pass:attestations.emergencyDrill,critical:true},
    {id:'testnet-review',label:'Testnet performans/reconciliation gözden geçirildi',pass:attestations.testnetReview,critical:true},
    {id:'news-review',label:'News Engine maliyet-fayda retest sonucu gözden geçirildi',pass:attestations.newsRetestReview,critical:true}
  ];
  const critical=checks.filter(x=>x.critical), criticalPass=critical.filter(x=>x.pass).length;
  return {
    liveTradingEnabled:process.env.ENABLE_LIVE_MANUAL_TRADING==='true',
    api,
    safety:{safeMode:safety.safeMode,runtimeKillSwitch:safety.runtimeKillSwitch,newEntriesAllowed:safety.newEntriesAllowed},
    liveCapitalCapUsd,hardCapUsd:hardCap,attestations,checks,
    score:{criticalPassed:criticalPass,criticalTotal:critical.length,optionalPassed:checks.filter(x=>!x.critical&&x.pass).length,optionalTotal:checks.filter(x=>!x.critical).length},
    readyForV11Review:criticalPass===critical.length,
    verdict:criticalPass===critical.length?'READY_FOR_MANUAL_V11_REVIEW':'NOT_READY',
    note:'V11 readiness geçilse bile canlı emir yalnızca MANUAL/SEMI_AUTO + kısa süreli arming ile mümkündür. FULL_AUTO LIVE yasaktır.'
  };
}

export async function runEmergencyExitDrill(userId:number){
  const db=await getDb();
  engageKillSwitch('V10 emergency exit drill');
  await db.run('UPDATE settings SET safeMode=1 WHERE user_id=?',[userId]);
  const paper=await db.all('SELECT symbol,amount,averageBuyPrice,stopLoss FROM portfolio_positions WHERE user_id=?',[userId]);
  const testnet=await db.all("SELECT symbol,quantity,average_entry,stop_loss FROM testnet_positions WHERE user_id=? AND status='OPEN'",[userId]);
  const live=await db.all("SELECT symbol,quantity,average_entry,stop_loss,stop_order_id FROM live_positions WHERE user_id=? AND status='OPEN'",[userId]);
  const plan={
    timestamp:Date.now(),killSwitchEngaged:true,safeModeEnabled:true,
    actions:[
      'Yeni girişleri durdur.',
      'Binance veri/API sağlığını doğrula.',
      'Exchange ile bot pozisyonlarını reconcile et.',
      'Koruyucu emir/stop durumunu doğrula.',
      'Gerekirse yalnızca açık pozisyonları azalt/kapat; yeni risk alma.',
      'API anahtarında anormal aktivite varsa anahtarı Binance üzerinden iptal et.'
    ],
    paperPositions:paper.map((p:any)=>({symbol:p.symbol,quantity:Number(p.amount),entry:Number(p.averageBuyPrice),stop:Number(p.stopLoss||0)})),
    testnetPositions:testnet.map((p:any)=>({symbol:p.symbol,quantity:Number(p.quantity),entry:Number(p.average_entry),stop:Number(p.stop_loss||0)})),
    livePositions:live.map((p:any)=>({symbol:p.symbol,quantity:Number(p.quantity),entry:Number(p.average_entry),stop:Number(p.stop_loss||0),protectiveStopOrderId:String(p.stop_order_id||'')})),
    realOrdersPlaced:false
  };
  await db.run('INSERT INTO system_health_log (id,component,severity,message,created_at) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(),'EMERGENCY_DRILL','INFO',JSON.stringify(plan),Date.now()]);
  return plan;
}
