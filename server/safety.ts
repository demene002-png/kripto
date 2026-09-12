import { getDb } from './db';
import { getTestnetStatus } from './binanceTestnet';
import { probeMarketDataHealth } from './market';

export type ExecutionMode='PAPER'|'TESTNET'|'LIVE';
export type AutomationMode='MANUAL'|'SEMI_AUTO'|'FULL_AUTO';

let runtimeKillSwitch=false;
let runtimeKillReason='';

export function engageKillSwitch(reason='Kullanıcı tarafından durduruldu'){ runtimeKillSwitch=true; runtimeKillReason=reason; }
export function releaseKillSwitch(){ runtimeKillSwitch=false; runtimeKillReason=''; }

export async function getExecutionSafety(userId:number){
  const db=await getDb();
  const s=await db.get('SELECT * FROM settings WHERE user_id = ?',[userId]);
  const executionMode:ExecutionMode=s?.executionMode==='LIVE'?'LIVE':s?.executionMode==='TESTNET'?'TESTNET':'PAPER';
  const automationMode:AutomationMode=['MANUAL','SEMI_AUTO','FULL_AUTO'].includes(s?.automationMode)?s.automationMode:'MANUAL';
  const [testnet,marketHealth]=await Promise.all([getTestnetStatus(),probeMarketDataHealth()]);
  const safeMode=Boolean(s?.safeMode);
  const reasons:string[]=[];
  if(!marketHealth.ok) reasons.push(`MARKET DATA CIRCUIT BREAKER: ${marketHealth.error||'public Binance bağlantısı yok'}`);
  if(marketHealth.latencyMs>5000) reasons.push(`MARKET DATA CIRCUIT BREAKER: gecikme ${marketHealth.latencyMs}ms.`);
  if(runtimeKillSwitch) reasons.push(`KILL SWITCH: ${runtimeKillReason}`);
  if(safeMode) reasons.push('SAFE MODE aktif.');
  if(executionMode==='TESTNET'&&!testnet.connected) reasons.push('Testnet bağlantısı hazır değil.');
  if(executionMode==='TESTNET'&&automationMode==='FULL_AUTO') reasons.push('TESTNET FULL_AUTO kilitli.');
  if(executionMode==='LIVE'&&process.env.ENABLE_LIVE_MANUAL_TRADING!=='true') reasons.push('LIVE ortam sunucu tarafında devre dışı.');
  if(executionMode==='LIVE'&&automationMode==='FULL_AUTO') reasons.push('LIVE FULL_AUTO V11 içinde yasak.');
  return {executionMode,automationMode,safeMode,runtimeKillSwitch,runtimeKillReason,testnet,marketHealth,newEntriesAllowed:reasons.length===0,reasons};
}
export async function assertNewEntryAllowed(userId:number){
  const s=await getExecutionSafety(userId);
  if(!s.newEntriesAllowed) throw new Error(`Safety Gate işlemi engelledi: ${s.reasons.join(' ')}`);
  return s;
}
