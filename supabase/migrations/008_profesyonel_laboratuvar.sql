-- v1.4.0 Profesyonel Strateji Laboratuvarı
create table if not exists public.professional_backtest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  interval text not null,
  days int not null,
  candle_count int not null default 0,
  net_return_pct numeric,
  benchmark_pct numeric,
  win_rate numeric,
  profit_factor numeric,
  max_drawdown_pct numeric,
  sharpe numeric,
  trades int,
  validation_return_pct numeric,
  validation_profit_factor numeric,
  best_parameters jsonb,
  created_at timestamptz not null default now()
);
alter table public.professional_backtest_runs enable row level security;
drop policy if exists "Kullanici kendi profesyonel testlerini okur" on public.professional_backtest_runs;
create policy "Kullanici kendi profesyonel testlerini okur" on public.professional_backtest_runs for select to authenticated using (auth.uid()=user_id);
drop policy if exists "Kullanici kendi profesyonel testlerini yazar" on public.professional_backtest_runs;
create policy "Kullanici kendi profesyonel testlerini yazar" on public.professional_backtest_runs for insert to authenticated with check (auth.uid()=user_id);
create index if not exists idx_prof_backtest_user_created on public.professional_backtest_runs(user_id,created_at desc);
