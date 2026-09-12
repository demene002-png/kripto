-- KRIPTO AI ASISTAN - Supabase migration V2
-- Atomic PAPER100 trade RPCs. PAPER ONLY. No Binance private-order capability.

create or replace function public.paper_buy(
  p_symbol text,
  p_price numeric,
  p_spend_usdt numeric,
  p_fee_rate numeric default 0.001,
  p_strategy text default null,
  p_regime text default null,
  p_opportunity numeric default null,
  p_risk numeric default null,
  p_confidence numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid := auth.uid();
  acc public.paper_accounts%rowtype;
  st public.trading_settings%rowtype;
  pos public.paper_positions%rowtype;
  fee numeric; net_spend numeric; qty numeric; max_spend numeric; new_qty numeric; new_avg numeric;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_price <= 0 or p_spend_usdt <= 0 then raise exception 'Invalid price/spend'; end if;
  select * into acc from public.paper_accounts where user_id=uid for update;
  select * into st from public.trading_settings where user_id=uid;
  if acc.user_id is null or st.user_id is null then raise exception 'Paper account/settings missing'; end if;
  if st.safe_mode then raise exception 'SAFE MODE active'; end if;
  if st.execution_mode <> 'PAPER' then raise exception 'PAPER100 RPC only supports PAPER'; end if;
  if (select count(*) from public.paper_positions where user_id=uid) >= st.max_positions
     and not exists(select 1 from public.paper_positions where user_id=uid and symbol=upper(p_symbol)) then
    raise exception 'Maximum position count reached';
  end if;
  max_spend := least(acc.balance, acc.balance * st.position_size_percent / 100.0);
  if p_spend_usdt > max_spend + 0.00000001 then raise exception 'Position size cap exceeded'; end if;
  fee := p_spend_usdt * p_fee_rate;
  net_spend := p_spend_usdt - fee;
  if net_spend <= 0 or p_spend_usdt > acc.balance then raise exception 'Insufficient paper balance'; end if;
  qty := net_spend / p_price;

  select * into pos from public.paper_positions where user_id=uid and symbol=upper(p_symbol) for update;
  if pos.id is null then
    insert into public.paper_positions(user_id,symbol,quantity,average_entry,invested_usdt,highest_price,risk_amount,primary_strategy,market_regime)
    values(uid,upper(p_symbol),qty,p_price,p_spend_usdt,p_price,0,p_strategy,p_regime);
  else
    new_qty := pos.quantity + qty;
    new_avg := ((pos.quantity*pos.average_entry)+(qty*p_price))/new_qty;
    update public.paper_positions set quantity=new_qty,average_entry=new_avg,invested_usdt=invested_usdt+p_spend_usdt,highest_price=greatest(coalesce(highest_price,p_price),p_price),primary_strategy=coalesce(p_strategy,primary_strategy),market_regime=coalesce(p_regime,market_regime) where id=pos.id;
  end if;
  update public.paper_accounts set balance=balance-p_spend_usdt,total_fees=total_fees+fee where user_id=uid;
  insert into public.trade_history(user_id,symbol,side,quantity,price,gross_value_usdt,fee_usdt,realized_pnl,reason,primary_strategy,market_regime,opportunity,risk,confidence)
  values(uid,upper(p_symbol),'BUY',qty,p_price,p_spend_usdt,fee,0,'MANUAL_PAPER',p_strategy,p_regime,p_opportunity,p_risk,p_confidence);
  return jsonb_build_object('success',true,'symbol',upper(p_symbol),'quantity',qty,'spend',p_spend_usdt,'fee',fee);
end;$$;

create or replace function public.paper_sell_all(
  p_symbol text,
  p_price numeric,
  p_fee_rate numeric default 0.001,
  p_reason text default 'MANUAL_CLOSE'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid := auth.uid(); pos public.paper_positions%rowtype; gross numeric; fee numeric; net numeric; pnl numeric;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_price <= 0 then raise exception 'Invalid price'; end if;
  select * into pos from public.paper_positions where user_id=uid and symbol=upper(p_symbol) for update;
  if pos.id is null then raise exception 'Open paper position not found'; end if;
  gross := pos.quantity*p_price; fee := gross*p_fee_rate; net := gross-fee; pnl := net-(pos.quantity*pos.average_entry);
  update public.paper_accounts set balance=balance+net,realized_pnl=realized_pnl+pnl,total_fees=total_fees+fee where user_id=uid;
  insert into public.trade_history(user_id,symbol,side,quantity,price,gross_value_usdt,fee_usdt,realized_pnl,reason,primary_strategy,market_regime)
  values(uid,pos.symbol,'SELL',pos.quantity,p_price,gross,fee,pnl,p_reason,pos.primary_strategy,pos.market_regime);
  delete from public.paper_positions where id=pos.id;
  return jsonb_build_object('success',true,'symbol',pos.symbol,'quantity',pos.quantity,'gross',gross,'fee',fee,'realized_pnl',pnl);
end;$$;

revoke all on function public.paper_buy(text,numeric,numeric,numeric,text,text,numeric,numeric,numeric) from public;
grant execute on function public.paper_buy(text,numeric,numeric,numeric,text,text,numeric,numeric,numeric) to authenticated;
revoke all on function public.paper_sell_all(text,numeric,numeric,text) from public;
grant execute on function public.paper_sell_all(text,numeric,numeric,text) to authenticated;
