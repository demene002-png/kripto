const BINANCE_BASES = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
];

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const stdev=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};

async function getJson(path){
  const errors=[];
  for(const base of BINANCE_BASES){
    try{
      const r=await fetch(base+path,{headers:{'User-Agent':'kripto-profesyonel-lab/1.4.1'},signal:AbortSignal.timeout(7000)});
      const t=await r.text();
      const j=JSON.parse(t);
      if(!r.ok)throw new Error(j?.msg||`HTTP ${r.status}`);
      return j;
    }catch(e){errors.push(`${base}: ${e?.message||String(e)}`)}
  }
  throw new Error(`Binance verisi alınamadı. ${errors.join(' | ')}`);
}

async function getHistoricalKlines(symbol,interval,days){
  const msByInterval={ '5m':300000,'15m':900000,'1h':3600000,'4h':14400000 };
  const step=msByInterval[interval]||3600000;
  const end=Date.now();
  let start=end-days*86400000;
  const out=[];
  while(start<end && out.length<12000){
    const limit=Math.min(1000,Math.ceil((end-start)/step));
    const rows=await getJson(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${start}&endTime=${end}&limit=${Math.max(50,limit)}`);
    if(!Array.isArray(rows)||!rows.length)break;
    for(const x of rows){
      out.push({t:Number(x[0]),o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[5])});
    }
    const next=Number(rows.at(-1)?.[0]||0)+step;
    if(next<=start)break;
    start=next;
    if(rows.length<1000 && start>=end)break;
  }
  const uniq=[];let last=-1;
  for(const x of out){if(x.t!==last){uniq.push(x);last=x.t;}}
  return uniq.filter(x=>x.t<end-step);
}

function ema(values,p){let v=values[0];const k=2/(p+1);for(const x of values)v=x*k+v*(1-k);return v;}
function rsi(values){if(values.length<15)return 50;let g=0,l=0;for(let i=values.length-14;i<values.length;i++){const d=values[i]-values[i-1];if(d>0)g+=d;else l-=d;}return l?100-(100/(1+g/l)):70;}
function atrPct(rows){const w=rows.slice(-15);if(w.length<3)return 1;let s=0;for(let i=1;i<w.length;i++){const x=w[i],pc=w[i-1].c;s+=Math.max(x.h-x.l,Math.abs(x.h-pc),Math.abs(x.l-pc));}return (s/(w.length-1))/w.at(-1).c*100;}

function feature(rows){
  const closes=rows.map(x=>x.c), last=closes.at(-1), e9=ema(closes,9), e21=ema(closes,21), e50=ema(closes,50), R=rsi(closes);
  const mom5=(last/closes.at(-6)-1)*100;
  const recentHigh=Math.max(...rows.slice(-20,-1).map(x=>x.h));
  const recentLow=Math.min(...rows.slice(-20,-1).map(x=>x.l));
  const avgVol=mean(rows.slice(-21,-1).map(x=>x.v))||1;
  const vr=rows.at(-1).v/avgVol;
  const atr=atrPct(rows);
  const trend=e9>e21&&e21>e50;
  const breakout=last>recentHigh*0.999;
  const momentum=mom5>0.25&&R>=52&&R<=72;
  const volume=vr>=1.10;
  const meanReversion=R<38&&last>recentLow*1.002;
  const pullback=trend&&R>=45&&R<=62&&last>=e21*0.995&&last<=e9*1.01;
  const votes={trend,momentum,breakout,volume,meanReversion,pullback};
  const voteCount=Object.values(votes).filter(Boolean).length;
  let score=45+voteCount*8+(trend?6:0)+(volume?4:0)-Math.max(0,R-75)*1.2-clamp(atr-5,0,10)*2;
  return {score:Math.round(clamp(score,0,100)),rsi:R,atr,vr,votes,voteCount,trend,e9,e21,e50};
}

function backtest(rows,p){
  const fee=p.feeRate, slip=p.slippageBps/10000;
  let cash=100, pos=null, peak=100, maxDd=0;
  const eq=[],trades=[],strategyStats={TREND:[0,0],MOMENTUM:[0,0],KIRILIM:[0,0],HACIM:[0,0],ORTALAMAYA_DONUS:[0,0],GERI_CEKILME:[0,0]};
  for(let i=60;i<rows.length;i++){
    const window=rows.slice(Math.max(0,i-80),i+1), bar=rows[i], f=feature(window);
    if(!pos){
      if(f.score>=p.minScore && f.voteCount>=p.minVotes && f.rsi<=p.maxRsi){
        const buy=bar.c*(1+slip), feeBuy=cash*fee, qty=(cash-feeBuy)/buy;
        const stopPct=clamp(f.atr*p.atrStopMult/100,0.012,0.06);
        const strategies=Object.entries(f.votes).filter(([,v])=>v).map(([k])=>k);
        pos={entry:buy,qty,entryCash:cash,feeBuy,stop:buy*(1-stopPct),tp:buy*(1+stopPct*p.rr),highest:buy,entryTime:bar.t,strategies,mae:0,mfe:0};
        cash=0;
      }
    }else{
      pos.highest=Math.max(pos.highest,bar.h);
      pos.mae=Math.min(pos.mae,(bar.l/pos.entry-1)*100);
      pos.mfe=Math.max(pos.mfe,(bar.h/pos.entry-1)*100);
      const trailing=pos.highest>=pos.entry*1.02?pos.highest*0.985:0;
      const exitStop=Math.max(pos.stop,trailing);
      let reason='', px=0;
      if(bar.l<=exitStop){reason=trailing>pos.stop?'IZ_SUREN_STOP':'ZARAR_DURDUR';px=exitStop*(1-slip);}
      else if(bar.h>=pos.tp){reason='KAR_AL';px=pos.tp*(1-slip);}
      if(reason){
        const gross=pos.qty*px, feeSell=gross*fee, final=gross-feeSell, pnl=final-pos.entryCash, ret=pnl/pos.entryCash*100;
        cash=final;
        trades.push({entryTime:pos.entryTime,exitTime:bar.t,entry:pos.entry,exit:px,pnl,ret,reason,mae:pos.mae,mfe:pos.mfe,strategies:pos.strategies,fees:pos.feeBuy+feeSell});
        for(const s of pos.strategies){const key=s==='trend'?'TREND':s==='momentum'?'MOMENTUM':s==='breakout'?'KIRILIM':s==='volume'?'HACIM':s==='meanReversion'?'ORTALAMAYA_DONUS':'GERI_CEKILME';strategyStats[key][0]+=pnl;strategyStats[key][1]+=1;}
        pos=null;
      }
    }
    const equity=pos?pos.qty*bar.c:cash;
    peak=Math.max(peak,equity);maxDd=Math.max(maxDd,(peak-equity)/peak*100);
    if(i%Math.max(1,Math.floor(rows.length/220))===0)eq.push({t:bar.t,v:Number(equity.toFixed(4))});
  }
  const final=pos?pos.qty*rows.at(-1).c:cash;
  const sells=trades, wins=sells.filter(x=>x.pnl>0), losses=sells.filter(x=>x.pnl<0);
  const grossWin=wins.reduce((s,x)=>s+x.pnl,0), grossLoss=Math.abs(losses.reduce((s,x)=>s+x.pnl,0));
  const returns=sells.map(x=>x.ret/100), sd=stdev(returns), sharpe=sd?mean(returns)/sd*Math.sqrt(Math.max(1,sells.length)):0;
  const benchmark=(rows.at(-1).c/rows[60].c-1)*100;
  return {
    netReturnPct:(final/100-1)*100,finalBalance:final,trades:sells.length,winRate:sells.length?wins.length/sells.length*100:0,
    profitFactor:grossLoss?grossWin/grossLoss:(grossWin>0?99:0),maxDrawdownPct:maxDd,expectancy:sells.length?sells.reduce((s,x)=>s+x.pnl,0)/sells.length:0,
    sharpe,fees:sells.reduce((s,x)=>s+x.fees,0),benchmarkPct:benchmark,avgMaePct:mean(sells.map(x=>x.mae)),avgMfePct:mean(sells.map(x=>x.mfe)),
    equity:eq, strategyAttribution:Object.entries(strategyStats).map(([name,[pnl,count]])=>({name,pnl,count})).filter(x=>x.count>0), tradesDetail:sells.slice(-50).reverse()
  };
}

function walkForward(rows,p){
  const split=Math.floor(rows.length*0.7);
  const train=rows.slice(0,split), test=rows.slice(Math.max(0,split-60));
  return {egitim:backtest(train,p),dogrulama:backtest(test,p),egitimOrani:70,dogrulamaOrani:30};
}

function optimize(rows,base){
  const grid=[];
  for(const minScore of [75,80,85])for(const atrStopMult of [1.2,1.6,2.0])for(const rr of [1.6,2.0,2.5])for(const minVotes of [3,4]){
    const p={...base,minScore,atrStopMult,rr,minVotes};
    const r=backtest(rows,p);
    const objective=r.netReturnPct-r.maxDrawdownPct*0.7+Math.min(5,r.profitFactor)*2+(r.trades>=8?2:-4);
    grid.push({p,r,objective});
  }
  grid.sort((a,b)=>b.objective-a.objective);
  return grid.slice(0,5).map(x=>({parametreler:x.p,sonuc:{netReturnPct:x.r.netReturnPct,maxDrawdownPct:x.r.maxDrawdownPct,profitFactor:x.r.profitFactor,winRate:x.r.winRate,trades:x.r.trades},puan:x.objective}));
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Yalnızca POST desteklenir.'});
  try{
    const symbol=String(req.body?.symbol||'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const interval=['5m','15m','1h','4h'].includes(req.body?.interval)?req.body.interval:'1h';
    const days=clamp(Number(req.body?.days||30),7,180);
    const rows=await getHistoricalKlines(symbol,interval,days);
    if(rows.length<200)throw new Error('Backtest için yeterli mum verisi alınamadı.');
    const base={minScore:80,minVotes:4,maxRsi:72,atrStopMult:1.6,rr:2.0,feeRate:0.001,slippageBps:5};
    const normal=backtest(rows,base), wf=walkForward(rows,base), optimizasyon=optimize(rows,base);
    return res.status(200).json({ok:true,symbol,interval,days,candleCount:rows.length,parametreler:base,backtest:normal,walkForward:wf,optimizasyon,not:'Tüm sonuçlar Binance public mum verisi, %0,10 komisyon ve 5 baz puan varsayımsal kayma ile hesaplanır.'});
  }catch(e){return res.status(500).json({error:e?.message||String(e)});}
}
