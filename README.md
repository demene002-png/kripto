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
