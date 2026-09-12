import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import jwt from 'jsonwebtoken';
import { getDb, verifyPassword, hashPassword } from './server/db';
import { executeSpotBuy, closeSpotPosition, managePositionTick } from './server/engine';
import { getKlines, getTopUsdtMarkets, getUsdtMarket } from './server/market';
import { buildMarketRegime } from './server/analysis';
import { buildStrategyDecision } from './server/strategy';
import { buildRiskPlan, getDailyRiskState, getRiskSettings } from './server/risk';
import { buildNewsIntelligence } from './server/news';
import { getTestnetStatus, getTestnetSymbolRules } from './server/binanceTestnet';
import { getExecutionSafety, assertNewEntryAllowed, engageKillSwitch, releaseKillSwitch } from './server/safety';
import { executeManagedTestnetBuy, sellManagedTestnetPosition, reconcileAllTestnetPositions, validateTestnetProtection, manageTestnetPositionTick } from './server/testnetExecution';
import { getLiveReadiness, getLiveApiPermissionPreflight, runEmergencyExitDrill } from './server/livePreflight';
import { armLiveSession, disarmLiveSession, liveArmingStatus, executeControlledLiveBuy, closeControlledLivePosition, reconcileAllLivePositions } from './server/liveExecution';
import { recordShadowSignal, runShadowScan, resolveMatureShadowSignals, runBacktest, runMultiBacktest, getBacktestProgress, getResearchAnalytics } from './server/research';
import { combinedThresholds, PAPER100_TEST_MODE } from './server/tradingConfig';

const PAPER_ONLY_DEMO = true;
const PAPER_START_BALANCE = 100;

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.JWT_SECRET) console.warn('[SECURITY] JWT_SECRET is not set. A temporary secret was generated for this process.');

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf('=');
    return i < 0 ? [x, ''] : [decodeURIComponent(x.slice(0, i)), decodeURIComponent(x.slice(i + 1))];
  }));
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function avg(values: number[]) { return values.length ? values.reduce((a,b) => a+b, 0) / values.length : 0; }

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  await getDb();

  let autoScanCursor=0;
  const autoDiagnostics=new Map<number, any>();

  let ai: GoogleGenAI | null = null;
  if (process.env.GEMINI_API_KEY) {
    try { ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); } catch (e) { console.error('Gemini init error', e); }
  }

  const requireAuth = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      token = parseCookies(req.headers.cookie || '').token;
    }
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.userId = decoded.id;
        return next();
      } catch {
        // invalid token, will check fallback below
      }
    }
    // In paper demo mode, allow fallback to default admin user so preview works without iframe cookie blocking
    if (PAPER_ONLY_DEMO) {
      const db = await getDb();
      const admin = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);
      if (admin) {
        req.userId = admin.id;
        return next();
      }
    }
    return res.status(401).json({ error: 'Unauthorized' });
  };

  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  app.post('/api/login', async (req, res) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.resetAt > now && attempt.count >= 8) return res.status(429).json({ error: 'Çok fazla giriş denemesi. Daha sonra tekrar deneyin.' });
    const { username, password } = req.body || {};
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE username = ?', [String(username || '')]);
    if (user && verifyPassword(String(password || ''), String(user.password))) {
      loginAttempts.delete(ip);
      if (!String(user.password).startsWith('scrypt:')) await db.run('UPDATE users SET password = ? WHERE id = ?', [hashPassword(String(password)), user.id]);
      const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '12h' });
      res.cookie('token', token, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 12 * 60 * 60 * 1000 });
      return res.json({ success: true, token, user: { id: user.id, username: user.username, balance: user.balance } });
    }
    const next = attempt && attempt.resetAt > now ? { count: attempt.count + 1, resetAt: attempt.resetAt } : { count: 1, resetAt: now + 15 * 60_000 };
    loginAttempts.set(ip, next);
    return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
  });

  app.post('/api/logout', (_req, res) => { res.clearCookie('token', { sameSite: 'strict' }); res.json({ success: true }); });
  app.get('/api/me', requireAuth, async (req: any, res) => { const db = await getDb(); res.json(await db.get('SELECT id, username, balance FROM users WHERE id = ?', [req.userId])); });

  app.get('/api/portfolio', requireAuth, async (req: any, res) => {
    const db = await getDb();
    const user = await db.get('SELECT balance FROM users WHERE id = ?', [req.userId]);
    const portfolio = await db.all('SELECT * FROM portfolio_positions WHERE user_id = ?', [req.userId]);
    const settings = await db.get('SELECT * FROM settings WHERE user_id = ?', [req.userId]);
    const signals = await db.all('SELECT * FROM signals_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50', [req.userId]);
    res.json({ balance: user?.balance || 0, portfolio, settings, signals });
  });

  app.post('/api/settings', requireAuth, async (req: any, res) => {
    const { autoPilot, autoPilotAmount, autoPilotBudget, dailyTargetPercent, riskProfile, riskPerTradePercent, maxDailyLossPercent, maxOpenRiskPercent, maxPositions, executionMode, automationMode, safeMode, liveCapitalCapUsd, liveApiPermissionAttested, emergencyDrillAttested, testnetReviewAttested, newsRetestAttested, positionSizePercent } = req.body || {};
    const db = await getDb();
    const validProfile = ['CONSERVATIVE','BALANCED','AGGRESSIVE','CUSTOM'].includes(String(riskProfile)) ? String(riskProfile) : 'BALANCED';
    const validExecution = 'PAPER'; // V11-P100 demo is hard-locked to paper execution.
    const validAutomation = ['MANUAL','SEMI_AUTO','FULL_AUTO'].includes(String(automationMode)) ? String(automationMode) : 'MANUAL';
    const posSize = clamp(Number(positionSizePercent) || 25, 5, 50);
    await db.run(`UPDATE settings SET autoPilot = ?, autoPilotAmount = ?, autoPilotBudget = ?, dailyTargetPercent = ?, riskProfile = ?, riskPerTradePercent = ?, maxDailyLossPercent = ?, maxOpenRiskPercent = ?, maxPositions = ?, executionMode = ?, automationMode = ?, safeMode = ?, liveCapitalCapUsd = ?, liveApiPermissionAttested = ?, emergencyDrillAttested = ?, testnetReviewAttested = ?, newsRetestAttested = ?, positionSizePercent = ? WHERE user_id = ?`, [autoPilot ? 1 : 0, clamp(Number(autoPilotAmount) || 25, 10, PAPER_START_BALANCE), clamp(Number(autoPilotBudget) || PAPER_START_BALANCE, 10, PAPER_START_BALANCE), clamp(Number(dailyTargetPercent) || 3, 0.1, 25), validProfile, clamp(Number(riskPerTradePercent)||0.5,0.1,2), clamp(Number(maxDailyLossPercent)||2,0.5,8), clamp(Number(maxOpenRiskPercent)||1.75,0.5,8), Math.round(clamp(Number(maxPositions)||3,1,8)), validExecution, validAutomation, safeMode ? 1 : 0, clamp(Number(liveCapitalCapUsd)||0,0,1000000), liveApiPermissionAttested?1:0, emergencyDrillAttested?1:0, testnetReviewAttested?1:0, newsRetestAttested?1:0, posSize, req.userId]);
    res.json({ success: true, positionSizePercent: posSize });
  });

  app.get('/api/live/status', requireAuth, async (req:any,res) => {
    try { res.json({arming:liveArmingStatus(req.userId),reconciliation:await reconcileAllLivePositions(req.userId)}); } catch(e:any){ res.status(500).json({error:e.message}); }
  });
  app.post('/api/live/arm', requireAuth, async (req:any,res) => {
    try { res.json(await armLiveSession(req.userId,String(req.body?.phrase||''))); } catch(e:any){ res.status(400).json({error:e.message}); }
  });
  app.post('/api/live/disarm', requireAuth, async (req:any,res) => {
    try { res.json(disarmLiveSession(req.userId)); } catch(e:any){ res.status(400).json({error:e.message}); }
  });
  app.get('/api/live/reconcile', requireAuth, async (req:any,res) => {
    try { res.json(await reconcileAllLivePositions(req.userId)); } catch(e:any){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/live-readiness', requireAuth, async (req:any,res) => {
    try { res.json(await getLiveReadiness(req.userId)); } catch(e:any){ res.status(500).json({error:e.message}); }
  });
  app.get('/api/live-readiness/api-permissions', requireAuth, async (_req:any,res) => {
    try { res.json(await getLiveApiPermissionPreflight()); } catch(e:any){ res.status(500).json({error:e.message}); }
  });
  app.post('/api/live-readiness/emergency-drill', requireAuth, async (req:any,res) => {
    try { res.json(await runEmergencyExitDrill(req.userId)); } catch(e:any){ res.status(500).json({error:e.message}); }
  });

  app.post('/api/paper/reset', requireAuth, async (req:any,res) => {
    try {
      const db=await getDb();
      await db.run('BEGIN TRANSACTION');
      try {
        await db.run('DELETE FROM portfolio_positions WHERE user_id=?',[req.userId]);
        await db.run('DELETE FROM trade_history WHERE user_id=?',[req.userId]);
        await db.run('DELETE FROM signals_log WHERE user_id=?',[req.userId]);
        await db.run('UPDATE users SET balance=? WHERE id=?',[PAPER_START_BALANCE,req.userId]);
        await db.run("UPDATE settings SET executionMode='PAPER', automationMode='MANUAL', safeMode=0, autoPilot=0, autoPilotAmount=25, autoPilotBudget=?, positionSizePercent=25 WHERE user_id=?",[PAPER_START_BALANCE,req.userId]);
        await db.run('COMMIT');
      } catch(e) { await db.run('ROLLBACK'); throw e; }
      return res.json({success:true,balance:PAPER_START_BALANCE,executionMode:'PAPER'});
    } catch(e:any) { return res.status(500).json({error:e.message}); }
  });

  app.get('/api/execution/status', requireAuth, async (req:any,res) => {
    try { res.json(await getExecutionSafety(req.userId)); } catch(e:any){ res.status(500).json({error:e.message}); }
  });
  app.get('/api/execution/reconcile', requireAuth, async (req:any,res) => {
    try { res.json(await reconcileAllTestnetPositions(req.userId)); } catch(e:any){ res.status(500).json({error:e.message}); }
  });
  app.get('/api/execution/protection', requireAuth, async (req:any,res) => {
    try { res.json(await validateTestnetProtection(req.userId)); } catch(e:any){ res.status(500).json({error:e.message}); }
  });
  app.get('/api/execution/rules/:symbol', requireAuth, async (req:any,res) => {
    try { res.json(await getTestnetSymbolRules(String(req.params.symbol||'').toUpperCase().replace(/USDT$/,'')+'USDT')); } catch(e:any){ res.status(400).json({error:e.message}); }
  });
  app.post('/api/execution/kill', requireAuth, async (req:any,res) => {
    engageKillSwitch(String(req.body?.reason||'Kullanıcı tarafından acil durdurma')); res.json({success:true, ...(await getExecutionSafety(req.userId))});
  });
  app.post('/api/execution/release', requireAuth, async (req:any,res) => {
    releaseKillSwitch(); res.json({success:true, ...(await getExecutionSafety(req.userId))});
  });

  app.get('/api/autopilot/diagnostics', requireAuth, async (req:any,res) => {
    const th=combinedThresholds();
    res.json(autoDiagnostics.get(Number(req.userId)) || {
      generatedAt:0, universeSize:50, batchSize:Number(process.env.AUTO_SCAN_BATCH_SIZE||12),
      thresholds:{...th,mode:PAPER100_TEST_MODE?'PAPER100_TEST':'PRODUCTION'},
      scanned:0,buyCandidates:0,riskAllowed:0,executed:0,blocked:0,rows:[]
    });
  });

  app.get('/api/market', async (req, res) => {
    try { res.json(await getTopUsdtMarkets(clamp(Number(req.query.limit) || 50, 10, 100))); }
    catch (e: any) { res.status(503).json({ error: 'Binance piyasa verisi alınamadı', detail: e.message }); }
  });

  app.get('/api/risk/status', requireAuth, async (req:any, res) => {
    try { res.json({ settings: await getRiskSettings(req.userId), daily: await getDailyRiskState(req.userId) }); }
    catch (e:any) { res.status(400).json({ error:e.message }); }
  });

  app.get('/api/risk/plan/:symbol', requireAuth, async (req:any, res) => {
    try { res.json(await buildRiskPlan(req.userId, String(req.params.symbol||'').toUpperCase())); }
    catch (e:any) { res.status(400).json({ error:e.message }); }
  });

  app.get('/api/strategy/:symbol', requireAuth, async (req:any, res) => {
    try { res.json(await buildStrategyDecision(String(req.params.symbol||'').toUpperCase())); }
    catch (e:any) { res.status(400).json({ error:e.message }); }
  });

  app.get('/api/news', requireAuth, async (_req:any, res) => {
    try { res.json(await buildNewsIntelligence()); }
    catch (e:any) { res.status(503).json({ error:'Haber motoru çalıştırılamadı', detail:e.message }); }
  });

  app.get('/api/news/:symbol', requireAuth, async (req:any, res) => {
    try { res.json(await buildNewsIntelligence(String(req.params.symbol||'').toUpperCase())); }
    catch (e:any) { res.status(503).json({ error:'Coin haber analizi çalıştırılamadı', detail:e.message }); }
  });

  app.get('/api/research/analytics', requireAuth, async (req:any, res) => {
    try { res.json(await getResearchAnalytics(req.userId)); }
    catch (e:any) { res.status(500).json({ error:'Research analytics oluşturulamadı', detail:e.message }); }
  });

  app.post('/api/research/shadow/scan', requireAuth, async (req:any, res) => {
    try { res.json(await runShadowScan(req.userId, Number(req.body?.limit||8))); }
    catch (e:any) { res.status(500).json({ error:'Shadow scan çalıştırılamadı', detail:e.message }); }
  });

  app.post('/api/research/shadow/resolve', requireAuth, async (req:any, res) => {
    try { res.json(await resolveMatureShadowSignals(req.userId)); }
    catch (e:any) { res.status(500).json({ error:'Shadow sonuçları çözümlenemedi', detail:e.message }); }
  });

  app.get('/api/research/backtest/progress', requireAuth, (_req, res) => {
    res.json(getBacktestProgress());
  });

  app.post('/api/research/backtest', requireAuth, async (req:any, res) => {
    try {
      if (req.body?.mode === 'SINGLE' && req.body?.symbol && req.body?.symbol !== 'MULTI') {
        const symbol=String(req.body?.symbol||'BTC').toUpperCase();
        const interval=String(req.body?.interval||'1h');
        res.json(await runBacktest(req.userId,symbol,interval));
      } else {
        res.json(await runMultiBacktest(req.userId));
      }
    } catch (e:any) { res.status(400).json({ error:'Backtest başarısız', detail:e.message }); }
  });

  app.get('/api/regime', async (_req, res) => {
    try { res.json(await buildMarketRegime()); }
    catch (e: any) { res.status(503).json({ error: 'Piyasa rejimi hesaplanamadı', detail: e.message }); }
  });

  app.get('/api/market/:symbol/klines', async (req, res) => {
    try { res.json(await getKlines(req.params.symbol, String(req.query.interval || '1h'), Number(req.query.limit || 48))); }
    catch (e: any) { res.status(503).json({ error: 'Mum verisi alınamadı', detail: e.message }); }
  });

  app.post('/api/analyze', requireAuth, async (req, res) => {
    try {
      const result = await buildStrategyDecision(String(req.body?.symbol || '').toUpperCase());
      const shadow = await recordShadowSignal((req as any).userId, result.symbol, result).catch(()=>null);
      let commentary = `V6 Strategy Manager: birincil motor ${result.primaryStrategy}, teyit ${result.consensusCount}/3, rejim ${result.regime.label}. Opportunity ${result.opportunity}/100, Risk ${result.risk}/100, Confidence ${result.confidence}/100. Haber ${result.news.level}: ${result.news.reason}. ${result.veto.active ? 'VETO: '+result.veto.reason : `Sonuç: ${result.action === 'BUY_CANDIDATE' ? 'işlem adayı' : 'NO TRADE'}.`}`;
      if (ai) {
        try {
          const prompt = `Aşağıdaki deterministik V6 kripto strateji + haber analizini Türkçe, en fazla 2 cümlede açıkla. Al/sat emri verme ve skoru değiştirme. Veri: ${JSON.stringify(result)}`;
          const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
          if (response.text) commentary = response.text.trim();
        } catch { /* AI commentary is optional; never fabricate scores */ }
      }
      res.json({ score: result.opportunity, opportunity: result.opportunity, risk: result.risk, confidence: result.confidence, action: result.action, analysis: commentary, regime: result.regime, timeframes: result.timeframes, veto: result.veto, primaryStrategy: result.primaryStrategy, consensusCount: result.consensusCount, engines: result.engines, news: result.news, shadow, source: ai ? 'rules-v6+ai-commentary' : 'rules-v6' });
    } catch (e: any) { res.status(400).json({ error: e.message, action: 'NO_TRADE', source: 'rules' }); }
  });

  app.post('/api/signals', requireAuth, async (req: any, res) => {
    const { symbol, type, price, aiScore, analysis, status, source } = req.body || {};
    if (!['BUY','SELL'].includes(type)) return res.status(400).json({ error: 'Spot V10 yalnızca BUY/SELL sinyallerini kabul eder.' });
    const db = await getDb();
    await db.run('INSERT INTO signals_log (id, user_id, symbol, type, price, aiScore, analysis, status, source, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.userId, symbol, type, price, aiScore, analysis, status, source, Date.now()]);
    res.json({ success: true });
  });

  app.post('/api/trades/execute', requireAuth, async (req: any, res) => {
    try {
      const type = String(req.body?.type || '');
      const symbol = String(req.body?.symbol || '').toUpperCase();
      const safety = await getExecutionSafety(req.userId);
      const origin=String(req.body?.origin||'MANUAL');
      if(safety.automationMode==='MANUAL' && origin!=='MANUAL') throw new Error('MANUAL mod yalnızca kullanıcı tarafından başlatılan işlemlere izin verir.');
      if(safety.automationMode==='SEMI_AUTO' && !['MANUAL','SIGNAL_APPROVAL'].includes(origin)) throw new Error('SEMI_AUTO mod otomatik emre izin vermez; sinyal onayı gerekir.');
      if(type==='BUY') await assertNewEntryAllowed(req.userId);
      const db=await getDb();
      const settings=await db.get('SELECT * FROM settings WHERE user_id = ?',[req.userId]);
      const environment='PAPER'; // hard lock: no Binance order endpoint is reachable from trade execution in this demo.

      if(environment==='PAPER'){
        const market = await getUsdtMarket(symbol);
        if (type === 'BUY') await executeSpotBuy(req.userId, symbol, Number(req.body?.marginUSD), market.askPrice || market.price, true);
        else if (type === 'SELL' || type === 'CLOSE') await closeSpotPosition(req.userId, symbol, market.bidPrice || market.price);
        else throw new Error('Spot V10 için geçersiz emir tipi..');
        return res.json({ success: true, environment:'PAPER' });
      }

      if(environment==='LIVE'){
        if(type==='BUY'){
          const result=await executeControlledLiveBuy(req.userId,symbol,Number(req.body?.marginUSD||0),origin);
          return res.json({success:true,environment:'LIVE',result});
        }
        if(type==='SELL'||type==='CLOSE'){
          const result=await closeControlledLivePosition(req.userId,symbol,origin);
          return res.json({success:true,environment:'LIVE',result});
        }
        throw new Error('Spot V11 LIVE için geçersiz emir tipi.');
      }

      if(!safety.testnet.connected || !safety.testnet.canTrade) throw new Error('Binance Spot Testnet işlem bağlantısı hazır değil.');
      let result:any;
      if(type==='BUY'){
        result=await executeManagedTestnetBuy(req.userId,symbol,Number(req.body?.marginUSD||0),safety.automationMode);
      }else if(type==='SELL'||type==='CLOSE'){
        result=await sellManagedTestnetPosition(req.userId,symbol,'MANUAL_CLOSE',1);
      }else throw new Error('Spot V10 için geçersiz emir tipi..');
      res.json({success:true,environment:'TESTNET',result});
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/trades/history', requireAuth, async (req: any, res) => { const db = await getDb(); res.json(await db.all('SELECT * FROM trade_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 100', [req.userId])); });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: 'paper100-live-data-no-exchange-orders', exchange: 'binance-global-public-data', liveTrading: false, testnetTrading: false, paperOnly: true, paperStartBalance: PAPER_START_BALANCE }));

  let managerBusy=false;
  setInterval(async()=>{
    if(managerBusy) return; managerBusy=true;
    try{
      const db=await getDb();
      const positions=await db.all('SELECT user_id, symbol FROM portfolio_positions WHERE managed = 1');
      if(!positions.length) return;
      const quotes=await Promise.all(positions.map(async(p:any)=>({p,m:await getUsdtMarket(String(p.symbol))})));
      for(const {p,m} of quotes) await managePositionTick(Number(p.user_id),String(p.symbol),m.bidPrice||m.price);
    }catch(e){ console.error('V10 position manager error',e); }
    finally{ managerBusy=false; }
  },10_000);

  let researchBusy=false;
  setInterval(async()=>{
    if(researchBusy) return; researchBusy=true;
    try { await resolveMatureShadowSignals(); }
    catch(e){ console.error('V10 shadow resolver error',e); }
    finally { researchBusy=false; }
  },60_000);

  let liveManagerBusy=false;
  setInterval(async()=>{
    if(liveManagerBusy) return; liveManagerBusy=true;
    try{
      const db=await getDb();
      const users=PAPER_ONLY_DEMO?[]:await db.all("SELECT user_id FROM settings WHERE executionMode='LIVE'");
      for(const u of users){
        const rec=await reconcileAllLivePositions(Number(u.user_id));
        if(!rec.ok){
          engageKillSwitch('Canlı protective-order reconciliation hatası.');
          await db.run('INSERT INTO system_health_log (id,component,severity,message,created_at) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(),'LIVE_RECONCILIATION','CRITICAL',JSON.stringify(rec),Date.now()]);
        }
      }
    }catch(e:any){ console.error('V11 live reconciliation manager error',e?.message||e); }
    finally{liveManagerBusy=false;}
  },30_000);

  let testnetManagerBusy=false;
  setInterval(async()=>{
    if(testnetManagerBusy) return; testnetManagerBusy=true;
    try{
      const db=await getDb();
      const users=PAPER_ONLY_DEMO?[]:await db.all("SELECT user_id FROM settings WHERE executionMode='TESTNET'");
      for(const u of users){
        const rec=await reconcileAllTestnetPositions(Number(u.user_id));
        if(!rec.ok){
          engageKillSwitch('Testnet reconciliation uyuşmazlığı tespit edildi.');
          await db.run('INSERT INTO system_health_log (id,component,severity,message,created_at) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(),'TESTNET_RECONCILIATION','CRITICAL',JSON.stringify(rec),Date.now()]);
          continue;
        }
        const rows=await db.all("SELECT symbol FROM testnet_positions WHERE user_id=? AND status='OPEN'",[u.user_id]);
        for(const p of rows){
          try{
            const m=await getUsdtMarket(String(p.symbol));
            await manageTestnetPositionTick(Number(u.user_id),String(p.symbol),m.bidPrice||m.price);
          }catch(e:any){
            console.error('V10 testnet position manager',p.symbol,e.message);
          }
        }
      }
    }catch(e:any){ console.error('V10 testnet reconciliation manager error',e?.message||e); }
    finally{testnetManagerBusy=false;}
  },30_000);

  let autoBusy=false;
  setInterval(async()=>{
    if(autoBusy) return; autoBusy=true;
    try{
      const db=await getDb();
      const users=await db.all("SELECT user_id FROM settings WHERE automationMode = 'FULL_AUTO' AND executionMode = 'PAPER' AND safeMode = 0");
      if(!users.length) return;

      const universe=await getTopUsdtMarkets(50);
      const batchSize=Math.max(5,Math.min(20,Number(process.env.AUTO_SCAN_BATCH_SIZE||12)));
      const batch=[] as typeof universe;
      for(let i=0;i<Math.min(batchSize,universe.length);i++) batch.push(universe[(autoScanCursor+i)%universe.length]);
      autoScanCursor=universe.length?(autoScanCursor+batch.length)%universe.length:0;
      const th=combinedThresholds();

      for(const u of users){
        const userId=Number(u.user_id);
        const safety=await getExecutionSafety(userId);
        const rows:any[]=[];
        let buyCandidates=0, riskAllowed=0, executed=0;
        const executable:any[]=[];

        if(!safety.newEntriesAllowed){
          autoDiagnostics.set(userId,{generatedAt:Date.now(),universeSize:universe.length,batchSize:batch.length,thresholds:{...th,mode:'PAPER100_TEST'},scanned:0,buyCandidates:0,riskAllowed:0,executed:0,blocked:batch.length,globalBlock:safety.reasons,rows:[]});
          continue;
        }

        for(const m of batch){
          const symbol=String(m.symbol);
          const existing=await db.get('SELECT 1 FROM portfolio_positions WHERE user_id = ? AND symbol = ?',[userId,symbol]);
          if(existing){ rows.push({symbol,finalAction:'SKIP',reason:'Açık pozisyon zaten var.'}); continue; }
          try{
            const decision=await buildStrategyDecision(symbol);
            const base:any={symbol,opportunity:decision.opportunity,risk:decision.risk,confidence:decision.confidence,primaryStrategy:decision.primaryStrategy,consensusCount:decision.consensusCount,marketRegime:decision.regime?.label,newsLevel:decision.news?.level,veto:Boolean(decision.veto?.active),thresholds:decision.thresholds};
            if(decision.action!=='BUY_CANDIDATE'||decision.veto?.active){
              const reasons:string[]=[];
              if(decision.veto?.active) reasons.push(decision.veto.reason||'VETO aktif');
              if(decision.consensusCount<=0) reasons.push('Hiçbir strateji motoru BUY_CANDIDATE değil.');
              if(decision.opportunity<th.opportunity) reasons.push(`Opportunity ${decision.opportunity} < ${th.opportunity}`);
              if(decision.risk>th.maxRisk) reasons.push(`Risk ${decision.risk} > ${th.maxRisk}`);
              if(decision.confidence<th.confidence) reasons.push(`Confidence ${decision.confidence} < ${th.confidence}`);
              rows.push({...base,finalAction:'NO_TRADE',riskAllowed:false,reason:reasons.join(' ')||'Birleşik karar uygun değil.'});
              continue;
            }
            buyCandidates++;
            const plan=await buildRiskPlan(userId,symbol);
            if(!plan.allowed){
              rows.push({...base,finalAction:'BLOCKED',riskAllowed:false,reason:plan.blocks.join(' '),suggestedSpend:plan.execution?.suggestedSpend});
              continue;
            }
            riskAllowed++;
            const candidate={...base,finalAction:'READY',riskAllowed:true,reason:'Strategy + Risk Manager uygun.',suggestedSpend:plan.execution?.suggestedSpend,score:decision.opportunity-decision.risk*.35+decision.confidence*.20};
            rows.push(candidate); executable.push({symbol,decision,market:m,diag:candidate});
          }catch(e:any){
            rows.push({symbol,finalAction:'ERROR',riskAllowed:false,reason:e.message});
          }
        }

        if(executable.length){
          executable.sort((a,b)=>b.diag.score-a.diag.score);
          const best=executable[0];
          try{
            const market=await getUsdtMarket(best.symbol);
            const result=await executeSpotBuy(userId,best.symbol,0,market.askPrice||market.price,true);
            executed=1;
            const r=rows.find(x=>x.symbol===best.symbol&&x.finalAction==='READY');
            if(r){r.finalAction='EXECUTED';r.actualSpend=result.spend;r.reason='Paper BUY açıldı.';}
            await db.run('INSERT INTO signals_log (id,user_id,symbol,type,price,aiScore,analysis,status,source,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)',
              [crypto.randomUUID(),userId,best.symbol,'BUY',market.askPrice||market.price,best.decision.opportunity,`PAPER100 FULL_AUTO • ${best.decision.primaryStrategy} • teyit ${best.decision.consensusCount}/3`,'EXECUTED','paper100-auto-scanner',Date.now()]);
          }catch(e:any){
            const r=rows.find(x=>x.symbol===best.symbol&&x.finalAction==='READY');
            if(r){r.finalAction='BLOCKED';r.reason=`Execution: ${e.message}`;}
          }
        }

        autoDiagnostics.set(userId,{
          generatedAt:Date.now(),universeSize:universe.length,batchSize:batch.length,nextCursor:autoScanCursor,
          thresholds:{...th,mode:PAPER100_TEST_MODE?'PAPER100_TEST':'PRODUCTION'},
          scanned:rows.length,buyCandidates,riskAllowed,executed,blocked:rows.filter(x=>!['EXECUTED','READY'].includes(x.finalAction)).length,rows
        });
      }
    }catch(e){ console.error('Paper100 auto scanner error',e); }
    finally{autoBusy=false;}
  },60_000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist'); app.use(express.static(distPath)); app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Kripto AI V11 Paper100 running on http://localhost:${PORT} (research-enabled news-aware multi-strategy paper spot, live Binance market data)`));
}
startServer();
