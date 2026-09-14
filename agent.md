# Kripto AI Asistan - Agent Handoff / Critical Project Notes

## Agent Dosyası Süreklilik Kuralı — ZORUNLU

Bu proje için bundan sonraki tüm geliştirme oturumlarında `agent.md` yaşayan proje hafızası ve karar kaydı olarak kullanılacaktır.

- Kullanıcının onayladığı veya talep ettiği her **kritik ürün kararı, risk kuralı, güvenlik kuralı, mimari değişiklik, strateji değişikliği, test/retest şartı, entegrasyon kararı, varsayım veya önemli yol haritası değişikliği** ilgili kod değişikliğiyle aynı geliştirme turunda `agent.md` dosyasına da işlenmelidir.
- Kritik bir karar değişirse eski bilgi sessizce bırakılmamalı; ilgili bölüm güncellenmeli ve gerekiyorsa kararın değiştiği açıkça belirtilmelidir.
- Bir geliştirme sürümü tamamlandığında `agent.md` içindeki mevcut durum/yol haritası da gerçek kod durumuyla uyumlu hale getirilmelidir.
- `agent.md` güncellenmeden kritik bir özellik tamamlanmış kabul edilmemelidir.
- Küçük kozmetik değişiklikler veya kritik olmayan metin düzeltmeleri için gereksiz kayıt oluşturulmamalıdır.
- Güvenlik açısından API anahtarları, secret'lar, şifreler veya diğer gizli değerler `agent.md` içine kesinlikle yazılmamalıdır.
- Test aşamasında daha önce kararlaştırılmış zorunlu retest maddeleri otomatik olarak kontrol listesine dahil edilmelidir; özellikle CryptoPanic / News Engine A/B retest şartı atlanmamalıdır.

Bu kural kullanıcı tarafından 2026-09-12 tarihinde kalıcı proje çalışma prensibi olarak onaylanmıştır.


## 1. Project goal
Build a safety-first Binance Global Spot algorithmic trading platform. The goal is NOT to force a fixed daily return. The system should trade only when expected net opportunity is good enough, preserve capital, and be able to decide NO TRADE.

Current baseline: Spot V11 Controlled Live. Live Spot is available only behind strict MANUAL/SEMI_AUTO gates; LIVE FULL_AUTO is forbidden. Real-money Binance orders are intentionally disabled.

## 2. Non-negotiable product decisions
- Exchange: Binance Global.
- Market: Spot first. Futures/leverage only after the Spot system is proven and must be a separate later module.
- Universe: dynamic approximately top 50 liquid/reputable USDT Spot assets, not a hard-coded coin list. Exclude stablecoins, leveraged tokens, unsuitable/new/illiquid pairs and high-spread assets.
- Capital amount is intentionally undecided until testing is complete.
- Operating modes planned: MANUAL, SEMI_AUTO, FULL_AUTO.
- Risk profiles: CONSERVATIVE, BALANCED, AGGRESSIVE, CUSTOM.
- Strategy families: SCALP, DAY, SWING.
- Daily ~3% is a reference/profit-protection zone, never a quota. Do not open bad trades to hit a target.
- Strong profitable positions may continue beyond +3% (including +5-10% or more when justified) using dynamic profit protection/trailing rather than arbitrary forced exits.
- NO TRADE is a first-class valid decision.
- News can veto a trade; positive news alone must never create a BUY.
- AI/LLM output must never directly place an order. Deterministic risk/execution gates have final authority.

## 3. High-level decision pipeline
Binance Market Data
-> Dynamic Coin Scanner
-> Market Regime
-> Multi-timeframe Technical Analysis
-> BTC/ETH Market Context
-> Scalp / Day / Swing Strategy Manager
-> News/Event Intelligence
-> Opportunity / Risk / Confidence
-> VETO / safety gates
-> Fee + spread + slippage check
-> Correlation / portfolio risk
-> Position sizing
-> Execution
-> Stop / partial TP / dynamic trailing
-> Profit Protection
-> Shadow Trading / Analytics / Retest

## 4. Scores and initial thresholds
Three separate concepts must remain separate:
- Opportunity Score: how attractive is the trade?
- Risk Score: how dangerous is it? Higher is worse.
- Confidence Score: how strongly do independent inputs agree?

Initial candidate thresholds discussed:
- Candidate: Opportunity >= 80, Risk <= 45, Confidence >= 70.
- Strong candidate: Opportunity >= 88, Risk <= 35, Confidence >= 80.
These are V1 research defaults, NOT permanent truth. Backtest/shadow/paper results should tune them without overfitting.

Initial Opportunity weighting concept:
- Trend 20%
- Momentum 15%
- Volume 15%
- Order book 15% (future/next work if not implemented)
- BTC/ETH market direction 10%
- News/events 10%
- Volatility suitability 5%
- Liquidity/spread 5%
- Net potential after fees/slippage 5%

Initial Risk weighting concept:
- Excess volatility/pump 20%
- BTC/systemic market risk 15%
- News uncertainty 15%
- Liquidity/spread 10%
- Stop distance / poor R:R 15%
- Correlation with open positions 10%
- Daily drawdown state 10%
- Technical conflict 5%

## 5. Market Regime rules
Regime classes should include at least:
- STRONG_BULL
- BULL
- RANGE
- HIGH_VOLATILITY
- BEAR
- PANIC

Regime must change strategy permissions/thresholds. PANIC can hard-veto new Spot BUYs. Bear regimes should strongly restrict long swing entries. Do not run one strategy identically in every regime.

## 6. Strategy Manager
SCALP, DAY and SWING use different timeframes/weights but share the same market-data foundation.
- Scalp emphasizes short timeframes, momentum, spread, order-book/microstructure and transaction costs.
- Day emphasizes 15m/1h/4h trend, momentum, volume and BTC/ETH context.
- Swing emphasizes 4h/1D structure, broader trend and news/events.

Strategy consensus matters. Multiple engines agreeing should increase confidence. Material disagreement should create a conflict penalty. Multiple strategy signals on the same asset must not accidentally become uncontrolled duplicate exposure.

## 7. Risk and execution principles
- Position sizing is risk-based, not a fixed dollar amount.
- Concept: allowed account risk / stop distance -> position size, subject to capital and exchange constraints.
- Wider stop -> smaller position.
- Stop should be structure/ATR/volatility-aware, not one fixed percentage for all assets.
- Prefer limit orders in normal conditions when sensible; market orders only when execution urgency justifies it.
- Chase protection: if price runs away after signal, reassess instead of blindly following.
- Partial profit-taking plus a runner is preferred: e.g. TP1 partial, TP2 partial, remainder dynamically trailed. Exact percentages are research parameters.
- Dynamic trailing should use volatility/ATR and market structure.
- Total open risk, simultaneous positions, daily loss limits and correlation exposure must be bounded.
- Earlier design target: normally around 3 simultaneous positions, hard maximum around 5 only when justified; final limits must be validated in testing.

## 8. Daily profit protection
Daily profit target is NOT a requirement.
Intended behavior:
- 0-2%: normal selection rules.
- 2-3%: become more selective.
- Around +3%: raise entry-quality threshold substantially.
- Around +5%: largely stop new exposure; manage strong existing winners.
- +7-10%+: capital preservation becomes dominant, but exceptional existing trends may continue under tight dynamic protection.
Exact thresholds remain configurable and subject to testing.

## 9. Fees, spread and slippage
Never evaluate gross return alone. Every trade decision should consider estimated round-trip trading fees, bid/ask spread and slippage. Scalp requires the strictest cost filter. Binance symbol filters/minimums should be read dynamically rather than hard-coded where possible.

## 10. News/Event Intelligence
News is a risk/factual intelligence layer, not a standalone trading oracle.
Desired source hierarchy:
1. First-party/official sources: Binance announcements, project official channels/sites, regulators, official releases.
2. High-quality independent reporting.
3. Aggregators/social sources as secondary/early-warning inputs.

Required concepts:
- Source reliability score.
- Recency/event-date validation.
- Duplicate/old-news detection.
- Independent confirmation count.
- Affected-asset mapping.
- Sentiment/impact classification.
- Upcoming events: macro releases, token unlocks, upgrades, maintenance, regulatory events, etc.
- Social signals are anomaly detectors only; they cannot directly BUY.

News levels:
NORMAL -> INFO -> CAUTION -> HIGH_RISK -> VETO.
VETO overrides attractive Opportunity scores for new entries. A VETO does NOT automatically mean blind market-sell of an existing position; an Emergency Position Manager should assess existing exposure separately.

## 11. CRITICAL RETEST REQUIREMENT - DO NOT FORGET
The user explicitly requested that CryptoPanic / paid news / AI news processing be justified by retest before keeping it.

At test time ALWAYS remind the user and run/inspect an A/B or counterfactual comparison:
A) News engine active.
B) News effect neutralized/off.

Measure at minimum:
- Resolved shadow sample count.
- Trades/news vetoes that prevented losses.
- Profitable trades that news filtering caused us to miss.
- P&L with news vs counterfactual P&L without news.
- API/provider cost.
- AI/LLM analysis cost.
- Net contribution after all news/AI costs.

Current research rule: DO NOT make a permanent CryptoPanic decision before at least 50 resolved shadow signals; preferably use materially more data before real capital. If net contribution after cost is negative or not robust, disable the paid provider. The application should continue functioning without CryptoPanic.

## 12. Research / testing philosophy
Required progression:
1. Historical backtest.
2. Robustness checks / Monte Carlo where meaningful.
3. Shadow trading, including rejected signals (what would have happened?).
4. Live-market paper/dry-run.
5. Review costs, drawdown, score buckets, strategy-specific results and news A/B.
6. Only then discuss initial real capital.
7. Only then consider live Spot orders with minimal permissions.

Do not optimize solely for total return. Track at least drawdown, expectancy, win rate, profit factor, Sharpe/Sortino/Calmar where appropriate, fees, slippage, strategy contribution, regime contribution and tail risk. Avoid overfitting.

Shadow trading is important: record signals the bot rejects as well as accepts so thresholds can be evaluated honestly.

## 13. CryptoPanic / API / AI cost policy
An API token/key is authentication, not necessarily a consumable LLM token. Nevertheless all paid data and AI inference must have cost accounting.
Track separately:
- News/API Cost
- AI Analysis Cost
- Estimated/realized P&L impact from News Engine

Do not send every raw headline to an LLM. First perform deterministic filtering/deduplication/relevance checks, then send only important candidates for semantic interpretation.

## 14. Security requirements
- NEVER commit API keys/secrets.
- Use environment variables / secret storage.
- Real Binance API keys must not be requested until testing is ready.
- Binance withdrawal permission must remain OFF.
- Prefer IP restrictions when live keys are eventually used.
- Live trading must be impossible to enable accidentally.
- Default/demo credentials and plaintext password storage are forbidden.
- Authentication secrets must not use insecure hard-coded production defaults.
- Circuit breaker / SAFE MODE must stop new entries on stale data, Binance/API problems, inconsistent prices, abnormal spread, DB failures, repeated order errors, or critical subsystem failure.
- Existing protective orders/position safety should be handled separately from opening new exposure.

## 15. Current project status (Spot V11)
V1: replaced fake/random market behavior with Binance Spot-oriented real public market data foundation; removed short/leverage assumptions; improved basic security; no random fallback AI scores.
V2: Market Regime + multi-timeframe technical analysis + BTC/ETH market context.
V3: Risk Manager, risk-based position sizing, ATR/structure stop concepts, TP/trailing, fee/spread/slippage filtering, daily profit protection.
V4: Scalp/Day/Swing Strategy Manager and consensus/conflict handling.
V5: News/Event Intelligence and multi-level VETO integration.
V6: Research Lab: backtest/shadow/dry-run analytics concepts, score-bucket analysis, Monte Carlo/robustness, news-on vs news-neutral counterfactual tracking and news/AI cost accounting.
V7: Safe execution control, PAPER/TESTNET environments, MANUAL/SEMI_AUTO/FULL_AUTO modes, SAFE MODE, runtime KILL SWITCH, server-only Testnet credentials, Testnet execution audit.
V8: Testnet reconciliation, bot-managed Testnet positions, dynamic Binance exchange filters/rounding, MIN_NOTIONAL validation, market-data circuit breaker, Testnet daily realized-P&L drawdown input, system-health logging, and app-managed Testnet stop/TP/trailing. TESTNET FULL_AUTO remains hard-locked because protection is not yet exchange-native.
V9: Validation Lab / Evidence Gate: strategy and market-regime attribution, PAPER vs TESTNET realized-performance comparison, mandatory CryptoPanic/news A-B cost-benefit retest, chronological 60/40 out-of-sample validation, walk-forward stability scoring, and explicit test-readiness gating.
V10: Live Readiness Gate: read-only Binance live API permission preflight, withdrawal-disabled/Spot-only permission checks, IP-restriction visibility, future live-capital ceiling, emergency-exit drill, manual operational attestations, and an evidence-based V11 readiness checklist.
V11: Controlled Live Spot: LIVE environment behind server gate, MANUAL/SEMI_AUTO only, short-lived explicit arming for live BUYs, hard capital containment, bot-managed live position ledger, exchange-native STOP_LOSS immediately after filled BUY, stop-order reconciliation, best-effort emergency flatten if protection creation fails, and always-available explicit risk-reducing exits. LIVE FULL_AUTO remains forbidden.

Important: previous environment could not complete full npm dependency installation/build due to package-download timeout. Syntax/transpile checks were performed during development, but on a normal development machine the project MUST be validated with dependency install, type-check/build and runtime tests before relying on it.

## 16. Historical planned milestone (V7, completed/superseded)
V7 should focus on:
- Binance Spot Testnet / safe execution adapter where available/appropriate.
- MANUAL / SEMI_AUTO / FULL_AUTO controller.
- Secure API key management.
- Hard separation between PAPER/TEST and LIVE.
- Server-side order validation and Binance exchange filters.
- Idempotent order handling, retries, reconciliation and order-state tracking.
- Circuit breaker / SAFE MODE.
- Audit logs.
- Live mode remains OFF by default.

Do NOT jump straight to real-money execution.

## 17. Future work after V7
- Improve order-book/microstructure engine.
- Correlation/portfolio exposure engine if incomplete.
- Emergency Position Manager.
- Provider redundancy and official Binance announcement ingestion.
- Better macro calendar/event ingestion.
- Strategy and regime performance attribution.
- Parameter optimization with walk-forward/out-of-sample validation.
- Dashboard controls for operating mode, risk profile, provider toggles and kill switch.
- Alerts/notifications.
- Futures only as a separate later project/module after Spot has robust evidence.

## 18. Engineering rules for future agents
- Read this file before changing trading logic.
- Preserve safety gates and NO TRADE behavior.
- Never introduce random scores/fake market data as a fallback in production logic.
- Missing data should lower confidence or block a trade, not fabricate certainty.
- Keep analysis, risk, execution, news and research modules separated.
- New features must be measurable in Research Lab; avoid features that cannot be evaluated.
- Every paid provider/AI feature should have an OFF switch and cost/benefit measurement.
- Do not silently change agreed thresholds; document changes and why.
- Backward-compatible UI is preferred, but correctness/safety outrank preserving demo behavior.
- Any code path capable of live orders requires explicit mode gating and auditable logs.

## 19. User intent summary
The user is not asking for a toy indicator bot. The desired end state is a comprehensive, understandable platform that can monitor a broad but quality-filtered crypto universe 24/7, combine technical/market/news/risk evidence, avoid overtrading and fee leakage, protect profits, continue exceptional winners when justified, and prove its edge through testing before real capital is exposed.

## 16. V7 Safe Execution / Testnet decisions (2026-09-12)
V7 adds the execution-control layer while preserving the safety-first progression.

Critical decisions:
- Supported execution environments are `PAPER` and Binance Spot `TESTNET`. Real-money Binance order endpoints remain intentionally absent.
- Binance Testnet credentials are read only from server environment variables (`BINANCE_TESTNET_API_KEY`, `BINANCE_TESTNET_API_SECRET`). Secrets must never be stored in the database, frontend, logs, README, or this `agent.md`.
- Operating modes are now explicit: `MANUAL`, `SEMI_AUTO`, `FULL_AUTO`.
  - MANUAL: user-initiated execution only.
  - SEMI_AUTO: manual execution plus explicit approval of generated signals; no autonomous entry.
  - FULL_AUTO: autonomous scanner/execution is implemented for PAPER only, with all existing Strategy/News/Risk gates. It may open at most one new position per scan/user.
- Binance TESTNET supports manual/semi-auto market order execution in V7. `TESTNET + FULL_AUTO` is deliberately HARD-LOCKED until exchange-side position/order reconciliation and protective-order verification are implemented and tested. Do not bypass this lock merely for convenience.
- SAFE MODE blocks new entries without disabling research/monitoring.
- Runtime KILL SWITCH immediately blocks new entries. Releasing it is a separate explicit action.
- BUY execution still requires deterministic Risk Manager approval. News VETO and other upstream safety gates remain authoritative.
- Testnet market BUY uses quote-order value; SELL uses available base-asset balance. Every Testnet order response is written to an execution audit table.
- Testnet is not real capital and must not be described as live trading.
- Before any future real-money mode: require testnet reconciliation, exchange filters/rounding validation, protective-order behavior, stale-data/circuit-breaker tests, API permission review (withdrawals OFF), and the previously required CryptoPanic/news A/B retest.

## 20. V8 Reconciled Testnet / Circuit Breaker decisions (2026-09-12)
Critical V8 rules:
- Binance symbol filters are never hard-coded. Read `exchangeInfo` and obey relevant `LOT_SIZE`, `MARKET_LOT_SIZE`, `MIN_NOTIONAL` / `NOTIONAL` constraints.
- Testnet sell quantity must be floored to allowed step size. Never sell the user's entire free asset balance merely because a bot position is being closed.
- Every bot-created Testnet position is tracked in `testnet_positions`; reconciliation checks that exchange free balance can cover the bot-managed quantity.
- Reconciliation mismatch is a critical event: engage runtime Kill Switch, log it, and stop new entries.
- Public Binance market-data failure or extreme latency is a circuit-breaker condition for new entries.
- Testnet risk sizing must use Testnet equity/open-risk context rather than PAPER account equity.
- Testnet realized P&L is tracked separately and contributes to the daily drawdown gate.
- V8 stop/TP/trailing protection for Testnet is application-managed and therefore depends on the app being alive and connected. This is NOT equivalent to an exchange-native protective order.
- Because of the previous point, `TESTNET + FULL_AUTO` stays hard-locked. Do not unlock it until exchange-native protective order behavior (or an equivalently robust independently supervised mechanism) is implemented, reconciled, and failure-tested.
- V8 does not add LIVE/real-money Binance execution.

## 21. V9 Validation Lab / Evidence Gate decisions (2026-09-12)
Critical V9 rules:
- No execution safety is relaxed in V9. Real-money trading remains absent; TESTNET FULL_AUTO remains hard-locked.
- Every new shadow signal records primary strategy, market regime, consensus count and VETO state so performance can be attributed instead of judged only in aggregate.
- PAPER and TESTNET realized results must remain separate. Good PAPER results cannot substitute for poor TESTNET execution results.
- Historical validation must include chronological out-of-sample testing. Current V9 baseline uses first 60% of generated trades as train/in-sample and final 40% as untouched test/out-of-sample.
- A backtest is not considered robust merely because total return is positive. OOS average trade, profit factor, drawdown and stability must remain acceptable.
- Parameter/threshold changes should be based on repeated evidence across multiple symbols/timeframes/regimes, not one favorable backtest.
- CryptoPanic / News Engine retest is now an explicit V9 evidence gate and remains subject to the >=50 resolved-shadow minimum before any permanent keep/disable decision.
- News evaluation must include API cost + AI cost + prevented losses + missed profits. Negative or non-robust net contribution means paid news should be disabled or revised.
- Test-readiness progression: collect shadow sample -> run multiple walk-forward tests -> collect meaningful Testnet closed trades -> only then review readiness for V10.
- V9 readiness labels are decision aids, not permission to enable live capital automatically.

## 22. V10 Live Readiness Gate decisions (2026-09-12)
Critical V10 rules:
- V10 MUST NOT place real-money Binance orders. There is no LIVE execution environment or live order endpoint.
- Live Binance credentials, if supplied, are used only for read-only permission preflight through Binance's signed `GET /sapi/v1/account/apiRestrictions` endpoint.
- The preflight must fail if `enableWithdrawals=true`.
- Intended future live key policy: reading enabled, Spot trading enabled, withdrawals disabled, Futures disabled, Margin disabled. IP restriction is strongly recommended and displayed as an optional-but-important control.
- Live credentials remain server-side environment variables only and must never be stored in the database, frontend, logs, README, or `agent.md`.
- Future live capital is gated by both a user-set `liveCapitalCapUsd` and an environment hard ceiling `LIVE_HARD_CAP_USD`. A cap of 0 means live capital remains locked.
- The live-capital cap is a readiness parameter only in V10; it does not enable trading.
- V11 review readiness requires, at minimum:
  - >=50 resolved shadow signals;
  - News/CryptoPanic A-B retest sample threshold met and manually reviewed;
  - >=3 walk-forward tests with >=2 robust results;
  - >=20 closed Testnet trades;
  - safe live API permission preflight;
  - Testnet/reconciliation review attested;
  - emergency-exit drill completed/reviewed;
  - non-zero live-capital cap within the hard ceiling.
- Emergency Exit Drill in V10 engages runtime Kill Switch + SAFE MODE and generates an action plan for current PAPER/TESTNET positions. It MUST NOT send real orders.
- `READY_FOR_MANUAL_V11_REVIEW` is not automatic authorization for live capital. A human/manual review remains mandatory.
- The CryptoPanic/news cost-benefit retest remains a required gate and must not be bypassed.

## 23. V11 Controlled Live Spot decisions (2026-09-12)
Critical V11 rules:
- LIVE is disabled by default. Server must have `ENABLE_LIVE_MANUAL_TRADING=true`.
- LIVE FULL_AUTO is forbidden in V11 at both UI and server-validation layers.
- LIVE BUY is allowed only for MANUAL or explicitly approved SEMI_AUTO flows and requires V10/V11 readiness to remain valid at execution time.
- Every LIVE BUY requires a short-lived in-memory arming gate. Default TTL is 10 minutes. Restart clears arming state.
- Arming phrase is an accidental-action guard, not a credential. It must not replace account authentication, API permission checks or risk controls.
- Live API key policy remains: withdrawals OFF, Spot permission ON, Futures OFF, Margin OFF, IP restriction required by V11 readiness.
- Live BUY sizing is constrained by deterministic Risk Manager, free USDT, user `liveCapitalCapUsd`, and `LIVE_HARD_CAP_USD`. Existing bot-managed live exposure reduces remaining capacity.
- After a live MARKET BUY is FILLED, an exchange-native `STOP_LOSS` SELL must be submitted immediately for the bot-managed net base quantity.
- If protective STOP_LOSS creation fails after BUY:
  1. engage Kill Switch;
  2. attempt best-effort immediate MARKET SELL of the newly acquired managed quantity;
  3. log critical failure if flattening also fails.
- Bot-managed live positions are recorded separately in `live_positions`; live realized P&L is recorded separately in `live_trade_history`.
- LIVE reconciliation checks the exchange protective stop order state. Unexpected protective-order state is critical and engages Kill Switch.
- Manual/approved live exit cancels the protective stop first, then sells only the bot-managed quantity. It must never liquidate unrelated holdings in the account.
- Risk-reducing LIVE exits remain permitted when SAFE MODE/Kill Switch blocks new entries. Exits must not depend on an active arming window.
- V11 does NOT yet implement exchange-native multi-stage TP/trailing order lists. Therefore LIVE FULL_AUTO must remain disabled.
- Before any future LIVE FULL_AUTO discussion, implement and failure-test exchange-native profit/trailing protection or an equivalently robust supervised order-list mechanism, plus extended live reconciliation and alerting.
- CryptoPanic / News Engine A-B retest remains mandatory and must stay in the evidence gate.

## 24. Paper100 Live-Data Test Mode (2026-09-12)
User requested the first practical trial to use a **100 USDT virtual balance**, Binance live public market data, and **no exchange order submission**.

Critical rules for this test build:
- Starting Paper cash balance is 100 USDT.
- Execution is hard-locked to `PAPER`; user settings cannot route trades to TESTNET or LIVE in this package.
- `/api/trades/execute` always uses the local Paper engine.
- Binance Global public Spot data remains live and is used for prices/candles/spread/analysis/portfolio mark-to-market.
- No private Binance API key is needed and no exchange BUY/SELL order may be sent by this build.
- MANUAL / SEMI_AUTO / FULL_AUTO behavior may be evaluated safely because all fills remain simulated.
- A Paper reset action clears Paper positions, Paper trade history and signal log, then restores exactly 100 USDT and MANUAL/PAPER defaults.
- Do not interpret Paper profit as proven live profitability. Fees/slippage assumptions, Shadow/Backtest, Testnet and the mandatory CryptoPanic A/B retest remain required before live-capital decisions.

## 25. Paper100 Test Adjustments (2026-09-12)
Comprehensive enhancements implemented for the Paper100 testing environment:

1. **Shadow Trading Horizon & Deduplication**:
   - Default `SHADOW_HORIZON_MINUTES` reduced to 1 minute (minimum threshold 1 minute).
   - Configurable via `.env` / environment variables (`SHADOW_HORIZON_MINUTES=1`).
   - Duplicate prevention: `recordShadowSignal` checks for existing `status = 'OPEN'` signals for the same coin and enforces a 1-minute cooldown per symbol.
   - Periodic 1-minute resolver cron (plus manual "Shadow Çözümle (1 dk)" UI button) resolves mature signals against Binance 1m kline / current market prices with caching.

2. **Percentage-Based Position Sizing**:
   - Replaced fixed dollar limit ("Kullanıcı işlem üst sınırı (USDT)") with percentage-based sizing: `positionSizePercent` ("Pozisyon başına maksimum sermaye oranı (%)").
   - Configurable in Settings (range 5% to 50%, step 5%, default 25%).
   - Preserves mathematical separation between:
     - `riskPerTradePercent` (e.g., 0.50% equity at risk if stop loss is hit);
     - `positionSizePercent` (e.g., 25% maximum capital allocated to a single position).
   - Dynamic sizing formula:
     `spend = min(RiskManager.suggestedSpend, equityApprox * (positionSizePercent / 100), availableBalance, maxByOpenRisk)`.
   - UI displays transparent breakdowns for risk per trade, capital cap, max open risk, and max open positions.

3. **Paper Execution Engine Protection**:
   - `executeSpotBuy` does not trust client-submitted `requestedSpend`. It recalculates and strictly enforces the minimum of the Risk Manager suggested spend, position capital cap, and available balance.
   - Preserved all VETO, news intelligence, market regime, risk profiles, and Kill Switch safeguards.

## 26. Çoklu Piyasa Backtest Sistemi (Multi-Market Backtest Architecture) (2026-09-12)
Kullanıcı talebi doğrultusunda eski tekil "BTC 1h Backtest" yapısı kaldırılarak projenin gerçek strateji ve risk mimarisini yansıtan **Çoklu Piyasa Backtest** (Multi-Market Backtest) sistemine geçilmiştir.

### Temel İlkeler ve Kritik Proje Kararları:
1. **Single BTC/1h Backtest Artık Ana Validasyon Yöntemi Değildir**:
   - Tek bir coin ve tek bir timeframe (BTC/1h) üzerinde yapılan testler piyasa geneli dinamiklerini yansıtamaz.
   - Ana backtest; dinamik likit coin evreni, çoklu timeframe ve strateji ailesi bazlı yürütülür.
   - BTC sonucu tek başına sistem başarısı sayılmaz.

2. **Dinamik Spot Likit Evren (Top 10 USDT Spot)**:
   - Binance Global public Spot verilerinden en likit 10 USDT paritesi taranır.
   - Stablecoin/stablecoin çiftleri (USDC, FDUSD, TUSD, DAI, USD1, USDE vb.) ve leveraged token'lar (UP, DOWN, BULL, BEAR) hariç tutulur.
   - Coin listesi hard-code edilmez; sistemin dinamik scanner altyapısı kullanılır.

3. **Strateji Bazlı Backtest & Timeframe Matrisi**:
   - **SCALP**: 5m, 15m, 1h (kısa vade momentum, sıkı spread/ATR cezası, minScore: 82, minConfidence: 76, maxRisk: 40, maxHold: 12 bar).
   - **DAY**: 15m, 1h, 4h (dengeli trend/momentum, minScore: 80, minConfidence: 72, maxRisk: 45, maxHold: 24 bar).
   - **SWING**: 1h, 4h, 1d (yapısal 4h/1d trend ağırlığı, minScore: 78, minConfidence: 70, maxRisk: 48, maxHold: 36 bar).

4. **Look-Ahead Bias Yasağı (Gelecek Bilgisi Kesinlikle Kullanılamaz)**:
   - Karar anında yalnızca geçmiş ve mevcut mum verisi kullanılır (`candles.slice(0, i + 1)`).
   - Mum `i` kapanışında teyit edilen sinyalin girişi en erken bir sonraki mumun (`i + 1`) açılış fiyatından (`candles[i + 1].open`) simüle edilir.
   - **Konservatif Intrabar Sıralama**: Aynı mum içinde hem stop hem TP fiyatı görülüyorsa iyimser varsayım yapılmaz; önce stop gerçekleşmiş kabul edilir.

5. **Net Sonuç Esası (Fees + Spread + Slippage Dahil)**:
   - Her işlemde Binance Spot komisyonu (0.10% alış + 0.10% satış), spread ve slippage (0.08% per leg) düşülür.
   - Brüt getiri değil, tüm masraflar düşüldükten sonraki NET getiri ve NET P&L raporlanır.

6. **Walk-Forward / Out-of-Sample Zorunluluğu**:
   - Tüm işlemler kronolojik olarak %60 In-Sample (Eğitim) ve %40 Out-of-Sample (Test) olarak ayrılır.
   - Yalnızca in-sample'da karlı olup out-of-sample'da zarar eden veya PF < 1.0 üreten modeller **ROBUST KABUL EDİLMEZ** (`OVERFITTED`).

7. **Detaylı Raporlama ve Attribution**:
   - Toplam sonuçlar: Test edilen coin sayısı, toplam işlem, Win Rate, Net Getiri %, Net P&L ($10k bazında), Profit Factor, Max DD, Average Trade, Sharpe-like, Toplam Maliyet.
   - Strateji Attribution: SCALP, DAY, SWING ayrımı.
   - Coin Attribution: Her coin için tek tek işlem, WR, Net %, PF (böylece tek başına BTC etkisi sistemi maskeleyemez).
   - Timeframe Attribution: 5m, 15m, 1h, 4h, 1d bazında sonuçlar.

8. **PAPER100 İle Kesin Ayrım**:
   - Backtest simülasyonları kullanıcı Paper bakiyesini, açık pozisyonlarını veya işlem geçmişini kesinlikle etkilemez.
   - Sonuçlar yalnızca bağımsız `backtest_runs` tablosunda saklanır.

9. **CryptoPanic / News Engine A-B Retest Şartı Korunmuştur**:
   - Haber motorunun en az 50 çözülmüş shadow sinyali üzerinden A-B testi şartı geçerliliğini ve zorunluluğunu korumaktadır.



## 27. Paper100 Data-Driven Calibration & Scanner Diagnostics (2026-09-12)
This change is based on the first collected Paper100 dataset (105 legacy 1-minute shadow observations and the multi-market validation run).

Critical decisions:
- The earlier 1-minute shadow horizon is considered too noisy for meaningful News/CryptoPanic validation. New shadow observations use **15 minutes by default**, with a hard minimum of 10 minutes.
- Existing resolved shadow rows with `horizon_minutes < 15` are retained for audit/history but are **excluded from the >=50 valid-shadow readiness/retest count**. The UI reports them separately as legacy data.
- Only one open shadow observation per symbol is allowed. A symbol must also wait at least one full shadow horizon before another independent observation is created.
- PAPER100 entry thresholds are now explicitly separated from production thresholds. They are intentionally looser for safe virtual data collection only:
  - Combined PAPER100: Opportunity >= 66, Risk <= 55, Confidence >= 70.
  - PAPER100 strategy-engine thresholds: SCALP 66/70/55, DAY 68/70/55, SWING 70/70/55 (score/confidence/maxRisk).
  - Production/Testnet/Live reference thresholds remain unchanged in `tradingConfig.ts`.
- PAPER100 daily profit-protection quality thresholds are 66 NORMAL, 72 CAUTION, 78 TARGET_REACHED, 86 LOCKDOWN. News VETO, PANIC veto, daily drawdown, open-risk, max-position, stop/TP/trailing, spread/fee/slippage and Safe/Kill controls remain intact.
- PAPER100 minimum risk-sized spend is reduced to 5 USDT for the 100 USDT virtual account; this change is test-only.
- FULL_AUTO scanner now uses a **dynamic Top-50 liquid USDT universe**, but scans it in rotating batches (default 12 symbols/minute) to control Binance request load. The entire universe is covered over successive scans instead of only the previous Top 8.
- Auto Scanner Diagnostics records per-symbol Opportunity/Risk/Confidence, primary strategy, consensus, regime, news/VETO, Risk Manager block reasons, suggested spend and final action. This is required before any further threshold relaxation.
- FULL_AUTO still opens at most one new Paper position per scan and selects the best risk-approved candidate from the current batch.
- The current multi-market backtest showed materially weak out-of-sample robustness. Therefore these looser PAPER100 thresholds are for **data collection, not proof of profitability**, and must never be copied into LIVE without new robust evidence.
- CryptoPanic/News A-B retest remains mandatory; PAPER100 hızlı test sürümünde geçerli örnekler >=1 dakikalık shadow/gölge gözlemleridir.
- Paper performance analytics now counts only closing `SELL:*` rows as closed trades; BUY fee ledger rows are no longer misclassified as closed trades in win-rate/profit-factor statistics.

## 28. GitHub + Supabase + Vercel cloud architecture (2026-09-12)
This is now a critical project architecture decision.
- GitHub is the canonical source repository and version history.
- Supabase is the persistent backend platform: Auth + PostgreSQL + later Edge Functions/Cron/Realtime.
- Vercel hosts the Vite/React web application from GitHub.
- Google AI Studio is no longer part of the development/deployment pipeline.
- Local SQLite/custom JWT login is deprecated for the cloud deployment. Supabase Auth is the active login system.
- Browser environment variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never expose `sb_secret_*`, service-role, Binance private keys, or other privileged secrets through VITE variables.
- PAPER100 account/settings/positions/signals/research records are stored in Supabase PostgreSQL under RLS.
- Manual PAPER100 buy/sell uses authenticated Supabase RPCs and remains simulation-only.
- Binance public Spot data may be fetched without private API credentials.
- Cloud migration must NOT fabricate Strategy/Regime/News/Scanner results if the corresponding runner is not deployed. Missing runner => explicit no-data/pending state.
- 24/7 Strategy Manager, Market Regime, News/VETO, Shadow resolver, Auto Scanner and backtest workers will be moved to Supabase Edge Functions + Cron in the next cloud phase.
- Real Binance order execution remains outside the current cloud migration and must not be enabled implicitly.
- CryptoPanic/news A-B retest remains mandatory after the cloud runner is collecting valid >=1 minute PAPER100 test shadow samples.

## Supabase Settings Synchronization Fix — 2026-09-12
- PAPER100 settings UI previously issued one Supabase write per slider movement and then reloaded the full settings row after every write. Concurrent responses could arrive out of order and overwrite a newer local slider value with an older database snapshot.
- Settings updates now use optimistic functional React state updates, merge rapid changes into a single pending patch, and debounce Supabase writes by 350 ms.
- Successful settings writes no longer trigger an immediate full portfolio/settings reload.
- Background portfolio polling temporarily preserves locally dirty settings so a poll cannot overwrite a setting while it is being edited/saved.
- On an actual Supabase settings write failure, the application reloads authoritative state from Supabase.
- This synchronization rule is critical for every future cloud settings field; do not reintroduce full settings refetch-after-each-slider-change behavior.

## 27. Tam Türkçe Arayüz + V11 Ayar Paneli Geri Yükleme (2026-09-12)

Kritik proje kararı:
- Kullanıcıya görünen arayüz, coin/sembol ve marka/ürün adları dışında Türkçe olacaktır.
- Google AI Studio dönemindeki kapsamlı V11 ayar paneli, Supabase bulut sürümüne geri taşınmıştır.
- Ayar panelinde Risk Profili (Muhafazakâr/Dengeli/Agresif/Özel), işlem başına risk, günlük zarar, toplam açık risk, maksimum pozisyon, pozisyon sermaye oranı, günlük hedef, otomasyon modu, Güvenli Mod, Acil Durdurma/Kilidi Aç, mutabakat, koruma, piyasa verisi ve Binance/Supabase bağlantı bilgileri birlikte gösterilir.
- ACİL DURDUR ve GÜVENLİ MOD, Supabase `safe_mode` alanını kullanır ve yeni sanal alışları engeller; risk azaltıcı satışları engellemez.
- Ayar değişiklikleri iyimser arayüz güncellemesi + 350 ms toplu Supabase kaydıyla yapılır; eski yanıtların yeni slider değerlerini ezmesine izin verilmez.
- `automationMode` açıkça gönderilmişse eski `autoPilot` uyumluluk alanı bu modu MANUAL'a geri çeviremez; Yarı Otomatik modu kalıcı olarak doğru kaydedilir.
- Bu sürüm yalnız 100 USDT sanal testtir. Gerçek Binance emirleri kapalıdır.
- Bu aşamada bulut arka plan otomatik tarayıcısı/strateji motoru henüz devrede değilse arayüz bunu açıkça Türkçe olarak belirtir ve sahte sonuç üretmez.


## Paper100 1 Dakikalık Gölge Testi (2026-09-12)
- Bulut/Supabase PAPER100 testinde gölge sinyali değerlendirme ufku **1 dakika** olarak ayarlanmıştır.
- Bu karar yalnız hızlı veri toplama/test amacı taşır; 1 dakikalık sonuçların yüksek piyasa gürültüsü içerdiği kabul edilir ve canlı sermaye uygunluğu için tek başına kanıt sayılmaz.
- Geçerli CryptoPanic/Haber Motoru yeniden test örneklemi bu test sürümünde `horizon_minutes >= 1` kayıtları sayar ve yine en az 50 çözülmüş örnek ister.
- Supabase `trading_settings.shadow_horizon_minutes` varsayılanı 1 dakikadır; mevcut kullanıcı ayarları migration ile 1'e çekilir.
- Açık eski gölge kayıtlarının ufku 1 dakikaya normalize edilir.
- ÖNEMLİ: Bu süre değişikliği kendi başına gölge sinyali üretmez veya çözmez. 7/24 Supabase Edge Function/Cron tarayıcısı ve resolver devreye alınmadan Doğrulama Laboratuvarı yalnız veritabanındaki mevcut kayıtları okur.
- Önceki 15 dakikalık varsayılan bu PAPER100 hızlı test kararıyla geçici olarak superseded edilmiştir.


## 29. 7/24 PAPER100 Cloud Runner + Manuel Kapatma (2026-09-12)
- Vercel serverless `/api/paper-runner` Supabase Cron tarafından her dakika tetiklenir.
- Runner Top-50 likit USDT evrenini dönüşümlü tarar; SCALP 15m, DAY 1h, SWING 4h verilerinden fırsat/risk/güven puanı üretir.
- FULL_AUTO + safe_mode=false olduğunda risk/sermaye limitlerini geçen en iyi aday için tur başına en fazla 1 PAPER alış açılır. Gerçek Binance emri yoktur.
- Açık PAPER pozisyonlar stop, TP1, TP2 ve trailing kurallarıyla her dakika yönetilir.
- Kullanıcı arayüzde açık pozisyon yanındaki `Sat` butonuyla istediği zaman pozisyonu tamamen manuel kapatabilir; güvenli mod manuel risk azaltıcı satışı engellemez.
- Gölge sinyalleri otomatik üretilir ve 1 dakika sonra otomatik çözülür.
- Otomatik worker servis anahtarı yalnız Vercel server-side `SUPABASE_SECRET_KEY` değişkeninde tutulur; VITE değişkenine konmaz.
- Supabase Cron endpoint'i yalnız PAPER simülasyonunu tetikler ve DB lock sayesinde 45 saniyeden sık çalışamaz.

## 26. v1.3.3 Vercel Binance public data fallback fix (2026-09-12)
- PAPER100 Cron was confirmed to call `/api/paper-runner` every minute, but Vercel logs showed `TypeError: tr.filter is not a function`.
- Root cause: `api.binance.com/api/v3/ticker/24hr` can return an error JSON object instead of the expected ticker array from some Vercel regions; the old runner called `.filter()` without validating the response type.
- Runner now uses Binance market-data-only `https://data-api.binance.vision` first, with `api.binance.com`, `api1`, `api2`, and `api3` as fallbacks.
- Every Binance response is checked for HTTP status, JSON parseability and expected array shape before strategy logic executes.
- Kline requests use the same fallback layer; one failed coin no longer aborts the whole scan and is recorded as a diagnostics row.
- Runner failures are written to `system_health_log` when possible and returned with a Turkish error message.
- Existing Supabase Cron and database migrations do not need to be rerun for this fix.
- PAPER100 remains simulation-only; no real Binance order endpoints are introduced.


## Cloud Runner v1.3.4 timeout policy (2026-09-12)
- Intermittent 200/500 Gateway Timeout observed on Vercel cloud runner.
- Keep cron at once per minute, but process only 5 symbols per run and rotate through the Top 50.
- Fetch strategy klines concurrently for the current batch; one symbol failure must not abort the run.
- Binance request timeout is 4 seconds with market-data/public host fallback.
- Critical Supabase operations retry up to 3 times on transient gateway/network failures.
- Shadow open-symbol lookup is batched per user and new shadow rows are inserted in bulk.
- PAPER100 remains cloud-only and must not send real Binance orders.

## 30. v1.3.5 Portföy K/Z hassasiyeti + stablecoin filtresi (2026-09-12)
- Portföyde coin fiyatı 1 USD altındaysa 6, 1-100 USD arasındaysa 4, daha yüksek fiyatlarda 2 ondalık gösterilir.
- Açık pozisyon K/Z alanı küçük hareketleri görünür kılmak için 2-4 ondalık USD hassasiyetinde, yüzde K/Z ise 4 ondalıkla gösterilir.
- Portföy üst özetine `Gerçekleşmemiş K/Z` kutusu ve son Binance fiyat güncelleme saati eklenmiştir.
- Otomatik işlem evreninden stablecoin/stable benzeri taban varlıklar çıkarılır: USDC, FDUSD, TUSD, USDP, DAI, BUSD, USD1, USDE, USDS, PYUSD, GUSD, USDD, FRAX, LUSD, USD0, USTC ve USDT.
- Bu filtre hem frontend Top-50 piyasa listesinde hem Vercel cloud runner seçiminde uygulanır; sistem bu varlıklarda yeni otomatik PAPER alış açmaz.
- Filtre mevcut açık stablecoin PAPER pozisyonunu zorla kapatmaz. Kullanıcı `Sat` düğmesiyle manuel kapatabilir; böylece test portföyünde beklenmedik otomatik tasfiye yapılmaz.


## v1.3.6 — Manuel satış güvenilirliği
- Otomatik tarama evreninden çıkarılan stablecoin/legacy açık pozisyonların manuel satış yolu açık tutulur.
- Açık pozisyon tarama listesinde yoksa Binance public Spot'tan doğrudan taze bid/last fiyatı alınır.
- Açık pozisyon fiyatları, otomatik alım filtresinden bağımsız olarak portföy görünümüne eklenir.
- `Sat` butonu işlem sırasında `Satılıyor…` durumu gösterir ve çift tıklamayı engeller.
- Risk azaltıcı manuel SELL, stablecoin filtresi nedeniyle hiçbir zaman engellenmemelidir.


## v1.3.7 — Stablecoin evreni sert filtresi
- USDT yalnız nakit/quote varlığıdır; otomatik alış için taban varlık olarak kullanılmaz.
- BNB stablecoin değildir ve normal işlem evreninde kalır.
- U (UUSDT), USD1, USDC, FDUSD, TUSD, USDP, DAI, BUSD, USDE, USDS, PYUSD, GUSD, USDD, FRAX, LUSD, USD0, USTC, RLUSD, AEUR, EURI, XUSD, AUSD, BFUSD, USDX ve fiat-benzeri tabanlar otomatik tarama/alım evreninden çıkarılır.
- Stablecoin filtresi frontend piyasa listesi, Vercel PAPER100 runner ve legacy server market katmanında aynı listeyle uygulanır.
- Mevcut açık stablecoin pozisyonları zorla kapatılmaz; kullanıcı manuel `Sat` ile kapatabilir.


## v1.3.8 - İşlem geçmişi ve net komisyon muhasebesi
- Kullanıcı kapanan işlemin neden kapandığını her zaman görebilmelidir. İşlem geçmişi arayüzde kalıcı bir karttır.
- PAPER100 komisyon varsayımı %0,10 alış + %0,10 satıştır.
- SELL realized_pnl artık giriş ve çıkış komisyonları dahil gerçek net K/Z'dir.
- paper_positions.invested_usdt açık pozisyonun komisyon dahil kalan maliyet bazıdır; kısmi satışlarda oransal azaltılır.
- Açık pozisyon K/Z'si tahmini satış komisyonunu da içerir.
- Kapanış nedenleri (ZARAR_DURDUR, IZ_SUREN_STOP, KAR_AL_1, KAR_AL_2, MANUAL_CLOSE) Türkçe arayüzde açıkça gösterilir.
- Mevcut eski SELL satırları migration 006 ile %0,10 eski giriş komisyonu varsayımı üzerinden net K/Z'ye düzeltilir.


## v1.3.9 - Secici Giris Motoru ve Zarar Devre Kesicileri (2026-09-13)
- Otomatik PAPER100 alimi icin kod seviyesinde sert taban firsat puani 80'dir; DB ayari daha dusuk olsa bile 80 altina inmez.
- 75-79 firsat puani yalniz Golge Testi/veri toplama icindir; gercek PAPER pozisyon acmaz.
- Otomatik alis icin en az 2/3 zaman diliminde 75+ firsat mutabakati ve en az 2/3 trend hizasi gerekir.
- Giris teyidi: secilen zaman diliminde EMA9>EMA21>EMA50, RSI 50-68, son mum hacmi 20 mum ortalamasinin en az 0.90 kati, fiyat EMA9'dan %-1.25 ile %+1.80 araliginda ve son 10 mum tepesinden en fazla %3 uzakta olmalidir.
- Long-only PAPER spot sistemi AYI ve PANIK rejiminde yeni alis acmaz; Golge Testi toplamaya devam eder.
- Stop ATR'nin 1.6 katiyla hesaplanir ve %1.5-%4.5 araliginda sinirlanir. TP1=1.8R, TP2=3.0R, trailing aktivasyon=2.1R; TP1 sonrasi stop komisyonu da kapsayan yaklasik %0.22 ustu maliyet seviyesine tasinir.
- Komisyon duyarlı tahmini TP1 net R/R 1.30 altindaysa islem acilmaz.
- Firsat puanina gore pozisyon boyutu: 80-84 => x0.50, 85-89 => x0.75, 90+ => x1.00.
- Gunluk gerceklesmis zarar `max_daily_loss_percent` limitine ulasirsa yeni alislar durur.
- Son 3 kapanis zararliysa ve en son zarar son 60 dakika icindeyse yeni alislar gecici olarak durur.
- Stop/iz suren stop sonrasi ayni sembole 60 dk; diger kapanislar sonrasi 30 dk yeniden giris bekleme suresi uygulanir.
- `max_open_risk_percent` artik yeni pozisyon risk butcesine dogrudan uygulanir.
- Supabase migration 007 mevcut esikleri en az 80 firsat / 70 guven / en fazla 55 risk seviyesine getirir ve runner sorgu indekslerini ekler.
- Bu degisiklikler test performansini garanti etmez; amac gereksiz ve dusuk kaliteli girisleri azaltmak ve daha guvenilir retest verisi toplamaktir.


## v1.4.0 KRİTİK PROFESYONEL KURALLAR
- Kullanıcıya görünen arayüz Türkçe olmalı; coin sembolleri ve standart finans kısaltmaları istisnadır.
- Ücretli API zorunluluğu oluşturulmayacak. Binance public veri + Supabase/Vercel mevcut ücretsiz katmanları önceliklidir.
- Otomatik PAPER alış için en az 80 fırsat, en az 4/6 strateji oyu, zaman dilimi mutabakatı, giriş teyidi ve izin verilen piyasa rejimi gerekir.
- Korelasyon >=0.92 ise yeni benzer pozisyon açma; 0.82-0.92 ise pozisyon boyutunu %60'a düşür.
- Hesap başlangıca göre %5 drawdown'a gelirse yeni alışları durdur.
- Aynı coin son 24 saatte en az 3 kapanışta toplam zarar yazdıysa geçici kilitle.
- Backtest/optimizasyon sonucu doğrudan otomatik ayara uygulanmaz; walk-forward ve PAPER doğrulaması gerekir.
- Backtestte komisyon %0.10/alım + %0.10/satım ve varsayılan 5 bp kayma dikkate alınır.
- CryptoPanic opsiyoneldir; maliyet/katkı kararı retest verisine göre verilir.


## v1.4.1 KRİTİK KAYIP AZALTMA KURALLARI
- PAPER doğrulama aşamasında otomatik işlem başına risk sert olarak %0,75 ile sınırlandırılır.
- Otomatik giriş tabanı 82 skor / 75 güven / maksimum 50 risk.
- 1h trend hizası zorunludur; 4h RSI zemini ayrıca kontrol edilir.
- BTC 1h zayıfsa BTC harici yeni alış açılmaz.
- YATAY rejimde +6 skor, TOPARLANMA rejiminde +2 skor ek kalite gereksinimi uygulanır.
- Son 12 kapanış en az 6 örnek olduğunda adaptif performans kapısı çalışır: win rate < %45 veya PF < 1 ise +4 skor ve 5/6 oy; çok zayıfsa +8 skor.
- Aynı sembolde 24 saatte 2 negatif ZARAR_DURDUR varsa sembol 24 saat kilitlidir.
- Stop sonrası 120 dk, manuel/diğer kapanış sonrası 30 dk tekrar giriş beklenir.
- Üç ardışık negatif kapanış sonrası 4 saat global yeni alış devre kesicisi uygulanır.
- Kullanıcıya görünen işlem geçmişinde giriş kalitesi görünür olmalıdır.
