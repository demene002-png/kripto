-- KRIPTO AI ASISTAN - Supabase Migration 003
-- PAPER100 hızlı test: Gölge sinyali değerlendirme ufku 1 dakika.
-- Bu migration gerçek Binance emri açmaz.

begin;

alter table public.trading_settings
  drop constraint if exists trading_settings_shadow_horizon_minutes_check;

alter table public.trading_settings
  alter column shadow_horizon_minutes set default 1;

alter table public.trading_settings
  add constraint trading_settings_shadow_horizon_minutes_check
  check (shadow_horizon_minutes between 1 and 1440);

update public.trading_settings
set shadow_horizon_minutes = 1,
    updated_at = now()
where shadow_horizon_minutes is distinct from 1;

alter table public.shadow_signals
  alter column horizon_minutes set default 1;

-- Test sırasında daha önce açılmış ve daha uzun bekleme süresi olan kayıtları
-- 1 dakikalık ufka çek. Resolver devreye girdiğinde zamanı dolanlar çözülebilir.
update public.shadow_signals
set horizon_minutes = 1,
    resolve_at = least(resolve_at, created_at + interval '1 minute')
where status = 'OPEN'
  and (horizon_minutes is distinct from 1
       or resolve_at > created_at + interval '1 minute');

commit;
