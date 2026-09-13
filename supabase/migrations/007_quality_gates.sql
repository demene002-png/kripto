-- v1.3.9: PAPER100 kalite kapilari ve sorgu indeksleri
begin;

-- Mevcut test kullanicilarini daha secici kalite esiklerine getir.
update public.trading_settings
set paper_candidate_opportunity = greatest(coalesce(paper_candidate_opportunity,0),80),
    paper_min_confidence = greatest(coalesce(paper_min_confidence,0),70),
    paper_max_risk = least(coalesce(paper_max_risk,55),55),
    paper_strong_opportunity = greatest(coalesce(paper_strong_opportunity,0),88),
    paper_strong_confidence = greatest(coalesce(paper_strong_confidence,0),75),
    paper_strong_max_risk = least(coalesce(paper_strong_max_risk,45),45),
    updated_at = now();

-- Runner her dakika son satislari ve gunluk P/L'yi okur; bu indeksler sorguyu hafifletir.
create index if not exists idx_trade_history_user_side_created
  on public.trade_history(user_id, side, created_at desc);
create index if not exists idx_shadow_signals_user_status_resolve
  on public.shadow_signals(user_id, status, resolve_at);
create index if not exists idx_positions_user_symbol
  on public.paper_positions(user_id, symbol);

commit;
