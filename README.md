# Kripto AI Asistan — V11 Paper100 Live-Data Test

V6, V4 çoklu strateji ve V3 risk motorunun üzerine **News & Event Intelligence** katmanı ekler. Bu sürüm hâlâ **paper trading** içindir; gerçek Binance emirleri kapalıdır.

## V6 yenilikleri

- Haber/olay karar seviyeleri: `NORMAL`, `INFO`, `CAUTION`, `HIGH_RISK`, `VETO`.
- Pozitif haber tek başına AL üretemez; Opportunity skoruna yalnızca küçük ve sınırlı katkı verir.
- Doğrulanmış kritik negatif olaylar (hack/exploit/delist/network outage vb.) yeni spot alımlarını veto edebilir.
- Kaynak güvenilirliği katmanı: resmi/regülatör kaynaklar > büyük haber kaynakları > bilinmeyen kaynaklar.
- Aynı haberin tekrar/duplicate tespiti ve bağımsız teyit sayısı.
- 48 saatten eski haberleri `stale` kabul ederek karar ağırlığını düşürme.
- Yaklaşan yüksek etkili olaylar: 24 saat içinde `CAUTION`, çok yakın yüksek etkili olaylarda `HIGH_RISK`.
- CoinMarketCal V2 entegrasyonu için canonical coin slug çözümleme (`/v2/coins?q=` -> `/v2/events?coins=slug`).
- CryptoPanic ve generic JSON news provider desteği.
- Opsiyonel makro etkinlik takvimi (`MACRO_EVENTS_JSON`).
- Haber etkisi Strategy Manager'ın Opportunity / Risk / Confidence skorlarına bağlandı.
- VETO artık hem Market Regime hem News Intelligence tarafından üretilebilir.
- Risk planı ve Trade Modal coin haber seviyesini gösterir.
- Ana dashboard'a News & Event Intelligence kartı eklendi.
- Provider/API yoksa sistem kesinlikle haber veya sentiment uydurmaz.

## Haber sağlayıcıları

Tüm anahtarlar **server-side** `.env` içinde tutulur. Browser bundle içine API key koymayın.

```env
CRYPTOPANIC_AUTH_TOKEN=
CRYPTOPANIC_API_URL=https://cryptopanic.com/api/developer/v2/posts/
COINMARKETCAL_API_KEY=
NEWS_JSON_URLS=
MACRO_EVENTS_JSON=[]
```

`COINMARKETCAL_API_KEY` ile V2 API kullanılır. Coin ticker'ları çakışabildiği için V6 önce `/v2/coins?q=SYMBOL` üzerinden canonical slug çözer ve event sorgusunu slug ile yapar.

`NEWS_JSON_URLS` noktalı virgülle ayrılmış JSON endpoint'leri kabul eder. Veri; doğrudan array veya `items`, `data`, `results` alanlarından biri olabilir. Her kayıt için tercihen `title`, `url`, `publishedAt` ve `symbols` alanları sağlanmalıdır.

## Güvenlik davranışı

- Haber sağlayıcısı hata verirse otomatik işlem lehine varsayım yapılmaz.
- Tek ve düşük güvenilirlikli sosyal/anonim haber `VETO` üretemez.
- Pozitif haber, teknik/risk kurallarını geçersiz kılamaz.
- `VETO`, yeni alışları engeller; açık pozisyonların yönetimi mevcut stop/TP/trailing motorunda devam eder.
- Gerçek Binance trading API key'i bu sürümde kullanılmaz.

## Kurulum

```bash
npm install
cp .env.example .env
npm run dev
```

İlk üretim doğrulaması:

```bash
npm run lint
npm run build
```

## API

- `GET /api/news` — piyasa geneli News Intelligence özeti
- `GET /api/news/:symbol` — coin bazlı News Intelligence
- `GET /api/strategy/:symbol` — V6 haber etkili Strategy Manager
- `GET /api/risk/plan/:symbol` — haber filtresi dahil risk/işlem planı
- `POST /api/analyze` — V6 birleşik analiz

## Sonraki aşama

V6 hedefi: backtest + shadow trading + dry-run performans veri tabanı + score bucket analizi + Monte Carlo/robustness testleri.

## V6 - Research Lab / Test Karar Katmani

V6 ile Backtest, Shadow Trading, score bucket analizi ve Monte Carlo robustness raporu eklendi.

### Zorunlu CryptoPanic / Haber Retest Kuralı
Bu proje icin haber motoru kalici olarak faydali kabul edilmeyecektir. Test asamasinda mutlaka:
1. Haber etkisi ACIK karar ile haber etkisi NOTR karar ayni sinyalde karsilastirilir.
2. Engellenen zarar, kacirilan kar, API maliyeti ve AI maliyeti birlikte hesaplanir.
3. En az 50 cozulmus shadow sinyali olmadan CryptoPanic hakkinda kalici karar verilmez.
4. Net katkisi negatif kalirsa ucretli haber saglayicisi kapatilir veya yeniden ayarlanir.

### V6 endpointleri
- `GET /api/research/analytics`
- `POST /api/research/shadow/scan` body: `{ "limit": 5 }`
- `POST /api/research/shadow/resolve`
- `POST /api/research/backtest` body: `{ "symbol": "BTC", "interval": "1h" }`

Not: V6 backtest su anda tarihsel OHLCV uzerindeki research proxy'dir. Tarihsel haber ve order-book replay'i henuz dahil degildir; bu nedenle tek basina canliya gecis kriteri degildir.


## V7 — Safe Execution & Binance Spot Testnet

V7 execution controls:
- `PAPER` and Binance Spot `TESTNET` environments.
- `MANUAL`, `SEMI_AUTO`, `FULL_AUTO` operating modes.
- SAFE MODE and runtime KILL SWITCH.
- Testnet API credentials are server-side environment variables only.
- Manual and approved-signal Testnet MARKET orders are supported and audited.
- PAPER FULL_AUTO scans a small liquid universe every 60 seconds and still requires Strategy + News + Risk approval; at most one new position per user/scan.
- `TESTNET + FULL_AUTO` is intentionally hard-locked until exchange order/position reconciliation and protective-order verification are implemented.
- Real-money Binance trading remains absent.

### Testnet setup
Create Binance Spot Testnet credentials and put them only in your local `.env`:
`BINANCE_TESTNET_API_KEY=...`
`BINANCE_TESTNET_API_SECRET=...`

Never commit `.env`. Withdrawal permissions are irrelevant to Spot Testnet, and future real-money keys must have withdrawals disabled.


## V8 — Reconciled Testnet & Circuit Breakers

V8 hardens Binance Spot Testnet before any autonomous Testnet trading is allowed.

- Binance `exchangeInfo` symbol filters are read dynamically.
- MARKET sell quantities are floored to the allowed MARKET_LOT_SIZE / LOT_SIZE step.
- MIN_NOTIONAL / NOTIONAL limits are validated before Testnet submission.
- Bot-managed Testnet positions are stored separately from PAPER positions.
- Testnet SELL never liquidates the account's entire asset balance; only the bot-managed quantity is eligible.
- Exchange balance vs bot-managed quantity reconciliation runs periodically.
- A reconciliation mismatch engages the runtime Kill Switch and is written to `system_health_log`.
- Public Binance market-data availability/latency is part of the Safety Gate.
- Testnet daily realized P&L is tracked and fed into risk/drawdown limits.
- Local stop/TP/trailing management exists for Testnet, but protection is still application-managed rather than exchange-native.
- For that reason, `TESTNET + FULL_AUTO` remains hard-locked in V8.
- Real-money order endpoints remain absent.


## V9 — Validation Lab / Evidence Gate

V9 does not loosen execution safety. It adds evidence and comparison layers:

- Shadow signals now record primary strategy, market regime, consensus count and veto state.
- Research Lab reports strategy attribution and market-regime attribution.
- PAPER and TESTNET realized performance are reported separately.
- CryptoPanic / News Engine A/B retest remains mandatory and cost-aware.
- Historical backtests now include a chronological 60/40 train vs out-of-sample validation summary.
- Walk-forward/OOS robustness is scored; positive in-sample performance alone is not sufficient.
- Test-readiness gate indicates whether more shadow, walk-forward or Testnet evidence is needed.
- V9 does NOT enable real-money trading or Testnet FULL_AUTO.


## V10 — Live Readiness Gate (NO LIVE ORDERS)

V10 is a pre-live safety and evidence checkpoint. It does **not** contain a real-money order endpoint.

What V10 adds:
- Read-only Binance live API permission preflight through `/sapi/v1/account/apiRestrictions`.
- Hard readiness failure if withdrawal permission is enabled.
- Spot-only permission check: Spot trading expected; Futures and Margin should be disabled for the intended live key.
- IP restriction is surfaced and strongly recommended.
- Configurable future live-capital ceiling; `0` keeps the capital gate locked.
- Absolute readiness ceiling from `LIVE_HARD_CAP_USD`.
- Manual attestations for API review, Testnet review, News A/B review and emergency-exit drill.
- Emergency-exit drill that engages Kill Switch + SAFE MODE and generates a position action plan **without placing real orders**.
- A V11 readiness score/checklist combining research evidence, Testnet sample size, API restrictions and operational checks.

V10 intentionally requires evidence before V11 review:
- >= 50 resolved shadow signals.
- CryptoPanic / News A-B sample threshold met and reviewed.
- >= 3 walk-forward tests with >= 2 robust results.
- >= 20 closed Testnet trades.
- Safe live API permissions.
- Emergency drill reviewed.
- Explicit non-zero live capital cap within the hard ceiling.

A `READY_FOR_MANUAL_V11_REVIEW` result is **not** permission to enable real-money trading. It only means the project is eligible for a human review of the next phase.


## V11 — Controlled Live Spot

V11 introduces a deliberately narrow live Spot path. Live trading is disabled by default and must pass every gate.

### What is allowed
- `PAPER`
- `TESTNET`
- `LIVE` only when `ENABLE_LIVE_MANUAL_TRADING=true`
- LIVE `MANUAL`
- LIVE `SEMI_AUTO` after explicit signal approval

### What remains forbidden
- LIVE `FULL_AUTO`
- Withdrawal-enabled API keys
- Futures or Margin permissions for the intended Spot key
- Live BUY when readiness, risk, news/VETO, market-data safety, capital cap or arming gate fails

### Live arming
A live BUY additionally requires a short-lived in-memory arm session (default 10 minutes). The default explicit phrase is:

`CANLI SPOT 10 DAKIKA`

The phrase is an accidental-action guard, not an authentication secret. Restarting the app clears the arm state.

### Exchange-native downside protection
After a LIVE MARKET BUY is FILLED, V11 immediately submits a Binance `STOP_LOSS` SELL order for the managed position quantity. The stop lives at Binance and therefore provides basic downside protection even if the app process stops.

If the protective stop cannot be created:
1. the runtime Kill Switch is engaged;
2. V11 attempts a best-effort immediate MARKET SELL of the newly acquired managed quantity;
3. critical failures are written to the system health log.

LIVE manual exit first reconciles the protective order, cancels it, then sells only the bot-managed position quantity. Risk-reducing exits remain available even when SAFE MODE or Kill Switch blocks new entries.

### Capital containment
- V10/V11 readiness must pass.
- User live-capital cap and `LIVE_HARD_CAP_USD` both apply.
- Current bot-managed live exposure is deducted from the available cap before a new position can be opened.
- Live position sizing still passes the deterministic Risk Manager.

### Important limitation
V11 provides one exchange-native protective STOP_LOSS per managed live position. It does not yet implement exchange-native multi-stage TP/trailing order lists. LIVE FULL_AUTO remains forbidden.

## Paper100 Test Build

This package is intentionally hard-locked to PAPER execution for safe evaluation.

- Initial virtual balance: **100 USDT**.
- Market prices, spread, candles and scanner inputs: **Binance Global public Spot API**.
- Exchange order submission: **disabled**. No Testnet or Live BUY/SELL is reachable through `/api/trades/execute`.
- Binance private API keys are not required for this test.
- Simulated BUY/SELL, fees, managed stop/TP/trailing and realized P&L are stored only in local SQLite Paper tables.
- Portfolio valuation uses the latest Binance public market prices shown by the app.
- Settings include a **100 USDT Testi Sıfırla** action that clears Paper positions/history/signals and restores 100 USDT.
- MANUAL, SEMI_AUTO and FULL_AUTO can be tested, but every execution remains virtual PAPER.

This build is the recommended first runtime test before Testnet or any live-capital discussion.
