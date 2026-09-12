-- PAPER100 bulut otomasyonu: 7/24 tarama, otomatik sanal işlem ve pozisyon yonetimi.
begin;
alter table public.trading_settings add column if not exists cloud_runner_enabled boolean not null default true;
alter table public.trading_settings add column if not exists runner_last_seen_at timestamptz;
alter table public.autopilot_scan_runs add column if not exists market_regime text;
alter table public.autopilot_scan_runs add column if not exists market_risk numeric;
alter table public.autopilot_scan_runs add column if not exists market_breadth numeric;
alter table public.autopilot_scan_runs add column if not exists market_avg_change numeric;
alter table public.autopilot_scan_runs add column if not exists market_volatility numeric;
create table if not exists public.paper_runner_state(id int primary key check(id=1), last_run_at timestamptz, cursor int not null default 0);
insert into public.paper_runner_state(id,cursor) values(1,0) on conflict(id) do nothing;

create or replace function public.claim_paper_runner()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.paper_runner_state%rowtype;
begin
 select * into s from public.paper_runner_state where id=1 for update;
 if s.last_run_at is not null and s.last_run_at > now()-interval '45 seconds' then return jsonb_build_object('claimed',false,'cursor',s.cursor); end if;
 update public.paper_runner_state set last_run_at=now() where id=1;
 return jsonb_build_object('claimed',true,'cursor',s.cursor);
end;$$;
revoke all on function public.claim_paper_runner() from public, authenticated;
grant execute on function public.claim_paper_runner() to service_role;

create or replace function public.advance_paper_runner(p_cursor int)
returns void language sql security definer set search_path=public as $$ update public.paper_runner_state set cursor=p_cursor where id=1; $$;
revoke all on function public.advance_paper_runner(int) from public, authenticated;
grant execute on function public.advance_paper_runner(int) to service_role;

create or replace function public.paper_buy_for_user(p_user_id uuid,p_symbol text,p_price numeric,p_spend numeric,p_stop numeric,p_tp1 numeric,p_tp2 numeric,p_trail_activation numeric,p_trail_pct numeric,p_strategy text,p_regime text,p_opp numeric,p_risk numeric,p_conf numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.paper_accounts%rowtype; s public.trading_settings%rowtype; q numeric; fee numeric; cap numeric;
begin
 select * into a from public.paper_accounts where user_id=p_user_id for update; select * into s from public.trading_settings where user_id=p_user_id;
 if a.user_id is null or s.user_id is null or s.safe_mode or s.execution_mode<>'PAPER' or s.automation_mode<>'FULL_AUTO' then raise exception 'AUTO_BLOCKED'; end if;
 if exists(select 1 from public.paper_positions where user_id=p_user_id and symbol=upper(p_symbol)) then raise exception 'POSITION_EXISTS'; end if;
 if (select count(*) from public.paper_positions where user_id=p_user_id)>=s.max_positions then raise exception 'MAX_POSITIONS'; end if;
 cap:=least(a.balance,a.starting_balance*s.position_size_percent/100.0); if p_spend<=0 or p_spend>cap then raise exception 'SPEND_CAP'; end if;
 fee:=p_spend*0.001; q:=(p_spend-fee)/p_price;
 insert into public.paper_positions(user_id,symbol,quantity,average_entry,invested_usdt,stop_loss,take_profit_1,take_profit_2,trailing_activation,trailing_distance_percent,highest_price,risk_amount,primary_strategy,market_regime)
 values(p_user_id,upper(p_symbol),q,p_price,p_spend,p_stop,p_tp1,p_tp2,p_trail_activation,p_trail_pct,p_price,greatest(0,(p_price-p_stop)*q),p_strategy,p_regime);
 update public.paper_accounts set balance=balance-p_spend,total_fees=total_fees+fee where user_id=p_user_id;
 insert into public.trade_history(user_id,symbol,side,quantity,price,gross_value_usdt,fee_usdt,realized_pnl,reason,primary_strategy,market_regime,opportunity,risk,confidence) values(p_user_id,upper(p_symbol),'BUY',q,p_price,p_spend,fee,0,'AUTO_PAPER',p_strategy,p_regime,p_opp,p_risk,p_conf);
 return jsonb_build_object('success',true,'quantity',q,'spend',p_spend);
end;$$;
revoke all on function public.paper_buy_for_user(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric,numeric) from public,authenticated;
grant execute on function public.paper_buy_for_user(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric,numeric) to service_role;

create or replace function public.paper_sell_fraction_for_user(p_user_id uuid,p_symbol text,p_price numeric,p_fraction numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.paper_positions%rowtype; sellq numeric; gross numeric; fee numeric; net numeric; pnl numeric; remain numeric;
begin
 select * into p from public.paper_positions where user_id=p_user_id and symbol=upper(p_symbol) for update; if p.id is null then raise exception 'NO_POSITION'; end if;
 sellq:=p.quantity*greatest(0.000001,least(1,p_fraction)); gross:=sellq*p_price; fee:=gross*0.001; net:=gross-fee; pnl:=net-sellq*p.average_entry; remain:=p.quantity-sellq;
 update public.paper_accounts set balance=balance+net,realized_pnl=realized_pnl+pnl,total_fees=total_fees+fee where user_id=p_user_id;
 insert into public.trade_history(user_id,symbol,side,quantity,price,gross_value_usdt,fee_usdt,realized_pnl,reason,primary_strategy,market_regime) values(p_user_id,p.symbol,'SELL',sellq,p_price,gross,fee,pnl,p_reason,p.primary_strategy,p.market_regime);
 if remain<0.00000001 then delete from public.paper_positions where id=p.id; else update public.paper_positions set quantity=remain,invested_usdt=greatest(0,invested_usdt*(remain/p.quantity)) where id=p.id; end if;
 return jsonb_build_object('success',true,'sold',sellq,'remaining',greatest(0,remain),'pnl',pnl);
end;$$;
revoke all on function public.paper_sell_fraction_for_user(uuid,text,numeric,numeric,text) from public,authenticated;
grant execute on function public.paper_sell_fraction_for_user(uuid,text,numeric,numeric,text) to service_role;
commit;
