# Kripto AI Asistan — Supabase + Vercel Sanal Test

Bu sürüm, GitHub + Supabase + Vercel mimarisinde çalışan 100 USDT sanal kripto işlem test uygulamasıdır.

## Temel yapı

- Binance Global genel Spot piyasa verileri canlı olarak okunur.
- Gerçek Binance alış/satış emri gönderilmez.
- Kullanıcı girişi, sanal bakiye, ayarlar, pozisyonlar, sinyaller ve test kayıtları Supabase üzerinde tutulur.
- Vercel yalnız web uygulamasını yayınlar.
- Kullanıcıya görünen arayüz, coin/sembol ve marka adları dışında Türkçedir.

## Vercel ortam değişkenleri

- `VITE_SUPABASE_URL` → yalnız `https://...supabase.co` biçiminde olmalıdır; sonunda `/rest/v1/` olmamalıdır.
- `VITE_SUPABASE_PUBLISHABLE_KEY` → Supabase yayımlanabilir anahtarıdır.
- `sb_secret_...` anahtarı tarayıcı ortam değişkenlerine kesinlikle eklenmemelidir.

## Ayar ekranı

Google AI Studio dönemindeki kapsamlı V11 ayar görünümü Supabase sürümüne taşınmıştır. Risk profilleri, risk ve sermaye oranları, otomasyon, Güvenli Mod, Acil Durdurma, mutabakat/koruma bilgileri ve 100 USDT sıfırlama aynı paneldedir.

## Güvenlik

Bu paket yalnız sanal test içindir. Gerçek para emirleri kapalıdır.


### v1.3.3 — Vercel public market-data compatibility
The cloud PAPER100 runner now validates Binance responses and automatically falls back to Binance market-data/public API hosts when a Vercel region cannot use the primary host. Existing Cron SQL does not need to be rerun.


## v1.3.4 Runner Dayaniklilik Duzeltmesi
- Her turda 10 yerine 5 coin taranir; Top 50 rotasyonu 10 dakikada tamamlanir.
- 15m/1h/4h mum istekleri paralel calisir.
- Binance istek timeout'u 4 saniyedir ve yedek hostlar kullanilir.
- Supabase gecici gateway/network hatalarinda kritik sorgular 3 kez yeniden denenir.
- Acik golge sinyalleri tek sorguda okunur, yeni golge kayitlari toplu yazilir.
- Amac Vercel fonksiyonunun 60 saniye sinirina yaklasmadan tamamlanmasidir.

### v1.3.5
- Portföy K/Z ve düşük fiyatlı coin gösterimi daha hassas hale getirildi.
- Gerçekleşmemiş K/Z ve son fiyat güncelleme saati eklendi.
- Stablecoin/stable benzeri USDT pariteleri otomatik işlem evreninden çıkarıldı (USD1 dahil).


## v1.3.6 — Manuel satış güvenilirliği
- Otomatik tarama evreninden çıkarılan stablecoin/legacy açık pozisyonların manuel satış yolu açık tutulur.
- Açık pozisyon tarama listesinde yoksa Binance public Spot'tan doğrudan taze bid/last fiyatı alınır.
- Açık pozisyon fiyatları, otomatik alım filtresinden bağımsız olarak portföy görünümüne eklenir.
- `Sat` butonu işlem sırasında `Satılıyor…` durumu gösterir ve çift tıklamayı engeller.
- Risk azaltıcı manuel SELL, stablecoin filtresi nedeniyle hiçbir zaman engellenmemelidir.


### v1.3.7 stablecoin filtresi
USDT nakit/quote olarak tutulur, BNB işlem evreninde kalır. U dahil diğer stablecoin ve fiat-benzeri taban varlıklar yeni otomatik PAPER alışlarına kapatılmıştır.


## v1.3.9 - Secici Giris ve Zarar Koruma
- Otomatik PAPER alimi icin asgari firsat puani 80'dir.
- 75-79 puan arasi yalniz Golge Testi icin izlenir; otomatik alis acilmaz.
- En az iki zaman diliminde 75+ mutabakat ve trend hizasi gerekir.
- RSI, hacim, EMA9 uzakligi ve kisa vadeli tepeye yakinlik giris teyidi olarak kullanilir.
- AYI ve PANIK piyasa rejimlerinde yeni long spot alisi acilmaz; test verisi toplanmaya devam eder.
- Stop ATR/volatiliteye gore ayarlanir; TP1 1.8R, TP2 3.0R ve komisyon duyarlı R/R kapisi vardir.
- 80-84 puanli islem yarim boy, 85-89 %75 boy, 90+ tam boy risk sermayesi kullanir.
- Stop sonrasi ayni coine 60 dk, diger kapanislar sonrasi 30 dk yeniden giris bekleme suresi vardir.
- Gunluk zarar limiti ve son 3 zararli kapanis icin 60 dakikalik devre kesici yeni alislari durdurur.
- Toplam acik risk limiti yeni pozisyon riskine dahil edilir.
- Bu surum halen PAPER100 sanal testtir; gercek Binance emri gondermez.


## v1.4.0 — Profesyonel Ücretsiz Paket

Bu sürüm ücretli API zorunluluğu olmadan aşağıdaki katmanları ekler:
- Profesyonel Strateji Laboratuvarı: Binance public verisiyle backtest
- Walk-forward: %70 eğitim / %30 görülmemiş doğrulama
- Grid tabanlı parametre optimizasyonu
- Strateji topluluğu: Trend, Momentum, Kırılım, Hacim, Ortalamaya Dönüş, Geri Çekilme
- Piyasa Rejim Motoru 2.0: Güçlü Boğa, Zayıf Boğa, Yatay, Toparlanma, Dağıtım, Ayı, Panik, Yüksek Oynaklık
- Dinamik coin kalite filtresi: minimum hacim ve aşırı günlük hareket filtresi
- Portföy korelasyon koruması
- Max drawdown guard (%5), günlük zarar limiti, art arda zarar devre kesici, düşük performanslı coin kilidi
- Komisyon + slippage simülasyonu
- Strateji katkı analizi, MAE/MFE, Sharpe, profit factor, maksimum düşüş, benchmark
- Backtest sonuçlarının Supabase'e kaydı

### Ücretsiz veri ilkesi
Piyasa ve geçmiş mum verileri Binance public Spot uçlarından alınır. Zorunlu ücretli yapay zeka veya haber API'si yoktur. CryptoPanic gibi anahtar isteyen haber sağlayıcıları opsiyonel kalır.

### Kurulum
Mevcut migration'lara ek olarak `supabase/migrations/008_profesyonel_laboratuvar.sql` dosyasını Supabase SQL Editor'da bir kez çalıştırın. Sonra projeyi Vercel'e deploy edin.
