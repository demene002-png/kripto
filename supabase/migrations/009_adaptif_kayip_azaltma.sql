-- v1.4.1 Adaptif kayıp azaltma profili
-- PAPER100 test aşamasında daha muhafazakar otomatik risk ve kalite eşikleri.
begin;

update public.trading_settings
set paper_candidate_opportunity = greatest(coalesce(paper_candidate_opportunity,0),82),
    paper_min_confidence = greatest(coalesce(paper_min_confidence,0),75),
    paper_max_risk = least(coalesce(paper_max_risk,50),50),
    risk_per_trade_percent = least(coalesce(risk_per_trade_percent,0.75),0.75),
    max_open_risk_percent = least(coalesce(max_open_risk_percent,1.50),1.50),
    max_positions = least(coalesce(max_positions,3),3),
    updated_at = now();

create index if not exists idx_trade_history_user_symbol_side_created
  on public.trade_history(user_id, symbol, side, created_at desc);

commit;
