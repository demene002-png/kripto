import { supabase } from './supabase';
import type { AppState, PortfolioItem, TradeSignal } from '../types';

export async function currentUserId(){
  const {data:{user},error}=await supabase.auth.getUser();
  if(error) throw error;
  if(!user) throw new Error('Oturum bulunamadı');
  return user.id;
}

export async function loadPaperState(){
  const uid=await currentUserId();
  const [{data:account,error:aerr},{data:settings,error:serr},{data:positions,error:perr},{data:signals,error:sigerr}] = await Promise.all([
    supabase.from('paper_accounts').select('*').eq('user_id',uid).single(),
    supabase.from('trading_settings').select('*').eq('user_id',uid).single(),
    supabase.from('paper_positions').select('*').eq('user_id',uid).order('opened_at',{ascending:true}),
    supabase.from('signals').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(100),
  ]);
  if(aerr) throw aerr; if(serr) throw serr; if(perr) throw perr; if(sigerr) throw sigerr;
  const portfolio:PortfolioItem[]=(positions||[]).map((p:any)=>({
    symbol:String(p.symbol),amount:Number(p.quantity||0),averageBuyPrice:Number(p.average_entry||0),
    stopLoss:p.stop_loss==null?undefined:Number(p.stop_loss),takeProfit1:p.take_profit_1==null?undefined:Number(p.take_profit_1),takeProfit2:p.take_profit_2==null?undefined:Number(p.take_profit_2),
    trailingActivation:p.trailing_activation==null?undefined:Number(p.trailing_activation),trailingDistancePct:p.trailing_distance_percent==null?undefined:Number(p.trailing_distance_percent),highestPrice:p.highest_price==null?undefined:Number(p.highest_price),riskAmount:Number(p.risk_amount||0),tp1Hit:p.tp1_hit?1:0,tp2Hit:p.tp2_hit?1:0,
  }));
  const mappedSignals:TradeSignal[]=(signals||[]).map((s:any)=>({
    id:String(s.id),symbol:String(s.symbol),type:s.signal_type==='SELL'?'SELL':'BUY',price:Number(s.price||0),aiScore:Number(s.opportunity||0),analysis:String(s.analysis||''),timestamp:new Date(s.created_at).getTime(),status:s.status,source:s.source||'supabase',opportunity:Number(s.opportunity||0),risk:Number(s.risk||0),confidence:Number(s.confidence||0),
  }));
  return {uid,account,settings,portfolio,signals:mappedSignals};
}

export function mapSettingsToState(s:any):Partial<AppState>{
  const riskPerTradePercent=Number(s?.risk_per_trade_percent??0.5);
  const maxDailyLossPercent=Number(s?.max_daily_loss_percent??2);
  const maxOpenRiskPercent=Number(s?.max_open_risk_percent??1.75);
  const maxPositions=Number(s?.max_positions??3);
  const storedProfile=String(s?.risk_profile||'BALANCED') as AppState['riskProfile'];
  const presets:any={
    CONSERVATIVE:{riskPerTradePercent:.35,maxDailyLossPercent:1.25,maxOpenRiskPercent:1,maxPositions:2},
    BALANCED:{riskPerTradePercent:.5,maxDailyLossPercent:2,maxOpenRiskPercent:1.75,maxPositions:3},
    AGGRESSIVE:{riskPerTradePercent:.85,maxDailyLossPercent:3,maxOpenRiskPercent:3,maxPositions:5}
  };
  const preset=presets[storedProfile];
  const matchesPreset=!preset || (
    Math.abs(riskPerTradePercent-preset.riskPerTradePercent)<0.0001 &&
    Math.abs(maxDailyLossPercent-preset.maxDailyLossPercent)<0.0001 &&
    Math.abs(maxOpenRiskPercent-preset.maxOpenRiskPercent)<0.0001 &&
    maxPositions===preset.maxPositions
  );
  const riskProfile:AppState['riskProfile']=storedProfile==='CUSTOM'||matchesPreset?storedProfile:'CUSTOM';
  return {
    dailyTargetPercent:Number(s?.daily_target_percent??3),positionSizePercent:Number(s?.position_size_percent??25),riskProfile,riskPerTradePercent,maxDailyLossPercent,maxOpenRiskPercent,maxPositions,executionMode:'PAPER',automationMode:s?.automation_mode||'MANUAL',safeMode:Boolean(s?.safe_mode),autoPilot:s?.automation_mode==='FULL_AUTO',autoPilotAmount:Number(s?.position_size_percent??25),autoPilotBudget:100,
  };
}

export async function saveSettings(values:Partial<AppState>){
  const uid=await currentUserId();
  const payload:any={updated_at:new Date().toISOString()};
  if(values.dailyTargetPercent!=null)payload.daily_target_percent=values.dailyTargetPercent;
  if(values.positionSizePercent!=null)payload.position_size_percent=Math.max(5,Math.min(50,values.positionSizePercent));
  if(values.riskProfile!=null)payload.risk_profile=values.riskProfile;
  if(values.riskPerTradePercent!=null)payload.risk_per_trade_percent=values.riskPerTradePercent;
  if(values.maxDailyLossPercent!=null)payload.max_daily_loss_percent=values.maxDailyLossPercent;
  if(values.maxOpenRiskPercent!=null)payload.max_open_risk_percent=values.maxOpenRiskPercent;
  if(values.maxPositions!=null)payload.max_positions=values.maxPositions;
  if(values.automationMode!=null)payload.automation_mode=values.automationMode;
  if(values.safeMode!=null)payload.safe_mode=values.safeMode;
  if(values.autoPilot!=null && values.automationMode==null)payload.automation_mode=values.autoPilot?'FULL_AUTO':'MANUAL';
  const {error}=await supabase.from('trading_settings').update(payload).eq('user_id',uid); if(error)throw error;
}

export async function insertSignal(input:{symbol:string;price:number;opportunity:number;risk?:number;confidence?:number;analysis:string;status:'PENDING'|'REJECTED';source?:string}){
  const uid=await currentUserId();
  const {error}=await supabase.from('signals').insert({user_id:uid,symbol:input.symbol,signal_type:'BUY',price:input.price,opportunity:input.opportunity,risk:input.risk??null,confidence:input.confidence??null,analysis:input.analysis,status:input.status,source:input.source||'manual-analysis'}); if(error)throw error;
}

export async function paperBuy(symbol:string,price:number,spend:number){
  const {data,error}=await supabase.rpc('paper_buy',{p_symbol:symbol,p_price:price,p_spend_usdt:spend,p_fee_rate:0.001}); if(error)throw error; return data;
}
export async function paperSellAll(symbol:string,price:number){
  const {data,error}=await supabase.rpc('paper_sell_all',{p_symbol:symbol,p_price:price,p_fee_rate:0.001,p_reason:'MANUAL_CLOSE'}); if(error)throw error; return data;
}
export async function resetPaper100(){const {error}=await supabase.rpc('reset_my_paper100');if(error)throw error;}
