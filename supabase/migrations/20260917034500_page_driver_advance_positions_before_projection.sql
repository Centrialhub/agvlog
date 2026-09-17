-- Bug 183: page immutable advance identities before building expensive history.
create or replace function finance_private.driver_advance_positions(_tenant uuid,_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare rows jsonb:='[]';r record;p jsonb;total integer;revision text;
begin
 perform finance_private.require_access(_tenant);
 if _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 select count(*),md5(coalesce(string_agg(md5(concat_ws('|',m.id::text,m.occurred_on::text,m.amount_cents::text,
   coalesce((select sum(x.amount_cents)::text from finance_private.driver_advance_returns x where x.tenant_id=_tenant and x.advance_movement_id=m.id),'0'))),'' order by m.occurred_on desc,m.id),''))
 into total,revision from finance_private.active_movements m
 where m.tenant_id=_tenant and m.direction='out' and m.nature='driver_advance';
 for r in select m.id,b.name account_name,coalesce(d.name,m.beneficiary_name) driver_name
  from finance_private.active_movements m join public.bank_accounts b on b.tenant_id=m.tenant_id and b.id=m.bank_account_id
  left join public.drivers d on d.tenant_id=m.tenant_id and d.id=m.driver_id
  where m.tenant_id=_tenant and m.direction='out' and m.nature='driver_advance'
  order by m.occurred_on desc,m.id limit 30 offset (_page-1)*30
 loop
  p:=finance_private.driver_advance_position(_tenant,r.id);
  rows:=rows||jsonb_build_array(p||jsonb_build_object('account_name',r.account_name,'driver_name',r.driver_name,'history_count',jsonb_array_length(p->'history')));
 end loop;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'page',_page,'page_size',30,'total',total,'revision',revision,'rows',rows);
end;$fn$;
revoke all on function finance_private.driver_advance_positions(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.driver_advance_positions(uuid,integer) to authenticated;
