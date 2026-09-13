-- KRIPTO AI ASISTAN - Supabase migration V6
-- Islem gecmisi denetlenebilirligi + komisyon dahil net K/Z muhasebesi.
-- PAPER ONLY. Binance gercek emir yetenegi eklemez.

begin;

alter table public.trade_history add column if not exists cost_basis_usdt numeric(20,8);
alter table public.trade_history add column if not exists entry_fee_usdt numeric(20,8);
alter table public.trade_history add column if not exists net_return_pct numeric(16,8);

-- Eski SELL kayitlari mevcut motorun %0,10 giris komisyonu mantigina gore
-- net K/Z'ye donusturulur. Bu blok sadece cost_basis_usdt bos eski kayitlarda calisir.
with old_sells as (
  select
    id,
    greatest(0::numeric, (coalesce(gross_value_usdt,0)-coalesce(fee_usdt,0)-coalesce(realized_pnl,0)) / 0.999) as gross_entry_cost,
    greatest(0::numeric, (coalesce(gross_value_usdt,0)-coalesce(fee_usdt,0)-coalesce(realized_pnl,0)) / 0.999
      - (coalesce(gross_value_usdt,0)-coalesce(fee_usdt,0)-coalesce(realized_pnl,0))) as estimated_entry_fee,
    coalesce(gross_value_usdt,0)-coalesce(fee_usdt,0) as net_exit
  from public.trade_history
  where side='SELL' and cost_basis_usdt is null
)
update public.trade_history t
set
  cost_basis_usdt = o.gross_entry_cost,
  entry_fee_usdt = o.estimated_entry_fee,
  realized_pnl = o.net_exit - o.gross_entry_cost,
  net_return_pct = case when o.gross_entry_cost > 0 then ((o.net_exit-o.gross_entry_cost)/o.gross_entry_cost)*100 else 0 end
from old_sells o
where t.id=o.id;

-- BUY satirlarinda gercek harcanan tutar ve giris komisyonu zaten kayitli.
update public.trade_history
set
  cost_basis_usdt = coalesce(cost_basis_usdt,gross_value_usdt),
  entry_fee_usdt = coalesce(entry_fee_usdt,fee_usdt),
  net_return_pct = coalesce(net_return_pct,0)
where side='BUY';

-- Hesap gerceklesen net K/Z'sini bakiye + kalan acik maliyet - baslangic bakiyesi
-- kimligi ile yeniden kur. Bu, kapatilmis kisimlarda alis ve satis komisyonlarini birlikte icerir.
update public.paper_accounts a
set realized_pnl = a.balance + coalesce((
  select sum(p.invested_usdt) from public.paper_positions p where p.user_id=a.user_id
),0) - a.starting_balance,
updated_at = now();

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
  update public.paper_accounts set balance=balance-p_spend_usdt,total_fees=total_fees+fee,updated_at=now() where user_id=uid;
  insert into public.trade_history(user_id,symbol,side,quantity,price,gross_value_usdt,fee_usdt,realized_pnl,reason,primary_strategy,market_regime,opportunity,risk,confidence,cost_basis_usdt,entry_fee_usdt,net_return_pct)
  values(uid,upper(p_symbol),'BUY',qty,p_price,p_spend_usdt,fee,0,'MANUAL_PAPER',p_strategy,p_regime,p_opportunity,p_risk,p_confidence,p_spend_usdt,fee,0);
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
  uid uuid := auth.uid();
  pos public.paper_positions%rowtype;
  gross numeric;
  exit_fee numeric;
  net numeric;
  cost_basis numeric;
  entry_fee numeric;
  pnl numeric;
  ret_pct numeric;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_price <= 0 then raise exception 'Invalid price'; end if;

  select * into pos from public.paper_positions
  where user_id=uid and symbol=upper(p_symbol)
  for update;

  if pos.id is null then raise exception 'Open paper position not found'; end if;

  gross := pos.quantity*p_price;
  exit_fee := gross*p_fee_rate;
  net := gross-exit_fee;
  cost_basis := coalesce(pos.invested_usdt, pos.quantity*pos.average_entry);
  entry_fee := greatest(0, cost_basis-(pos.quantity*pos.average_entry));
  pnl := net-cost_basis;
  ret_pct := case when cost_basis>0 then (pnl/cost_basis)*100 else 0 end;

  update public.paper_accounts
  set balance=balance+net,
      realized_pnl=realized_pnl+pnl,
      total_fees=total_fees+exit_fee,
      updated_at=now()
  where user_id=uid;

  insert into public.trade_history(
    user_id,symbol,side,quantity,price,gross_value_usdt,fee_usdt,
    realized_pnl,reason,primary_strategy,market_regime,
    cost_basis_usdt,entry_fee_usdt,net_return_pct
  ) values(
    uid,pos.symbol,'SELL',pos.quantity,p_price,gross,exit_fee,
    pnl,p_reason,pos.primary_strategy,pos.market_regime,
    cost_basis,entry_fee,ret_pct
  );

  delete from public.paper_positions where id=pos.id;

  return jsonb_build_object(
    'success',true,'symbol',pos.symbol,'quantity',pos.quantity,
    'gross',gross,'entry_fee',entry_fee,'exit_fee',exit_fee,
    'cost_basis',cost_basis,'realized_pnl',pnl,'net_return_pct',ret_pct
  );
end;$$;

create or replace function public.paper_buy_for_user(
  p_user_id uuid,p_symbol text,p_price numeric,p_spend numeric,p_stop numeric,
  p_tp1 numeric,p_tp2 numeric,p_trail_activation numeric,p_trail_pct numeric,
  p_strategy text,p_regime text,p_opp numeric,p_risk numeric,p_conf numeric
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.paper_accounts%rowtype; s public.trading_settings%rowtype; q numeric; fee numeric; cap numeric;
begin
 select * into a from public.paper_accounts where user_id=p_user_id for update;
 select * into s from public.trading_settings where user_id=p_user_id;
 if a.user_id is null or s.user_id is null or s.safe_mode or s.execution_mode<>'PAPER' or s.automation_mode<>'FULL_AUTO' then raise exception 'AUTO_BLOCKED'; end if;
 if exists(select 1 from public.paper_positions where user_id=p_user_id and symbol=upper(p_symbol)) then raise exception 'POSITION_EXISTS'; end if;
 if (select count(*) from public.paper_positions where user_id=p_user_id)>=s.max_positions then raise exception 'MAX_POSITIONS'; end if;
 cap:=least(a.balance,a.starting_balance*s.position_size_percent/100.0);
 if p_spend<=0 or p_spend>cap then raise exception 'SPEND_CAP'; end if;
 fee:=p_spend*0.001;
 q:=(p_spend-fee)/p_price;
 insert into public.paper_positions(user_id,symbol,quantity,average_entry,invested_usdt,stop_loss,take_profit_1,take_profit_2,trailing_activation,trailing_distance_percent,highest_price,risk_amount,primary_strategy,market_regime)
 values(p_user_id,upper(p_symbol),q,p_price,p_spend,p_stop,p_tp1,p_tp2,p_trail_activation,p_trail_pct,p_price,greatest(0,(p_price-p_stop)*q),p_strategy,p_regime);
 update public.paper_accounts set balance=balance-p_spend,total_fees=total_fees+fee,updated_at=now() where user_id=p_user_id;
 insert into public.trade_history(user_id,symbol,side,quantity,price,gross_value_usdt,fee_usdt,realized_pnl,reason,primary_strategy,market_regime,opportunity,risk,confidence,cost_basis_usdt,entry_fee_usdt,net_return_pct)
 values(p_user_id,upper(p_symbol),'BUY',q,p_price,p_spend,fee,0,'AUTO_PAPER',p_strategy,p_regime,p_opp,p_risk,p_conf,p_spend,fee,0);
 return jsonb_build_object('success',true,'quantity',q,'spend',p_spend,'fee',fee);
end;$$;

create or replace function public.paper_sell_fraction_for_user(
  p_user_id uuid,p_symbol text,p_price numeric,p_fraction numeric,p_reason text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  p public.paper_positions%rowtype;
  sellq numeric;
  gross numeric;
  exit_fee numeric;
  net numeric;
  cost_basis numeric;
  entry_fee numeric;
  pnl numeric;
  ret_pct numeric;
  remain numeric;
  fraction numeric;
begin
 select * into p from public.paper_positions where user_id=p_user_id and symbol=upper(p_symbol) for update;
 if p.id is null then raise exception 'NO_POSITION'; end if;

 fraction:=greatest(0.000001,least(1,p_fraction));
 sellq:=p.quantity*fraction;
 gross:=sellq*p_price;
 exit_fee:=gross*0.001;
 net:=gross-exit_fee;
 cost_basis:=coalesce(p.invested_usdt,p.quantity*p.average_entry)*fraction;
 entry_fee:=greatest(0,cost_basis-(sellq*p.average_entry));
 pnl:=net-cost_basis;
 ret_pct:=case when cost_basis>0 then (pnl/cost_basis)*100 else 0 end;
 remain:=p.quantity-sellq;

 update public.paper_accounts
 set balance=balance+net,
     realized_pnl=realized_pnl+pnl,
     total_fees=total_fees+exit_fee,
     updated_at=now()
 where user_id=p_user_id;

 insert into public.trade_history(
   user_id,symbol,side,quantity,price,gross_value_usdt,fee_usdt,realized_pnl,
   reason,primary_strategy,market_regime,cost_basis_usdt,entry_fee_usdt,net_return_pct
 ) values(
   p_user_id,p.symbol,'SELL',sellq,p_price,gross,exit_fee,pnl,
   p_reason,p.primary_strategy,p.market_regime,cost_basis,entry_fee,ret_pct
 );

 if remain<0.00000001 then
   delete from public.paper_positions where id=p.id;
 else
   update public.paper_positions
   set quantity=remain,
       invested_usdt=greatest(0,coalesce(invested_usdt,p.quantity*p.average_entry)-cost_basis)
   where id=p.id;
 end if;

 return jsonb_build_object(
   'success',true,'sold',sellq,'remaining',greatest(0,remain),
   'entry_fee',entry_fee,'exit_fee',exit_fee,'cost_basis',cost_basis,
   'pnl',pnl,'net_return_pct',ret_pct
 );
end;$$;

revoke all on function public.paper_buy(text,numeric,numeric,numeric,text,text,numeric,numeric,numeric) from public;
grant execute on function public.paper_buy(text,numeric,numeric,numeric,text,text,numeric,numeric,numeric) to authenticated;

revoke all on function public.paper_sell_all(text,numeric,numeric,text) from public;
grant execute on function public.paper_sell_all(text,numeric,numeric,text) to authenticated;

revoke all on function public.paper_buy_for_user(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric,numeric) from public,authenticated;
grant execute on function public.paper_buy_for_user(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric,numeric) to service_role;

revoke all on function public.paper_sell_fraction_for_user(uuid,text,numeric,numeric,text) from public,authenticated;
grant execute on function public.paper_sell_fraction_for_user(uuid,text,numeric,numeric,text) to service_role;

commit;
