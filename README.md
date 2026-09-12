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
