create function finance_private.account_period_closure_evidence(_tenant uuid,_account uuid,_closure uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.finance_account_period_closures%rowtype;r public.finance_account_period_reopenings%rowtype;deps jsonb;expected jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into c from public.finance_account_period_closures where tenant_id=_tenant and account_id=_account and id=_closure;
 if not found then raise exception 'finance_period_closure_not_found' using errcode='22023';end if;
 select * into r from public.finance_account_period_reopenings where tenant_id=_tenant and closure_id=_closure;
 select coalesce(jsonb_agg(to_jsonb(d)-'tenant_id'-'closure_id' order by source_kind,source_id),'[]'::jsonb) into deps
 from public.finance_account_period_dependencies d where tenant_id=_tenant and closure_id=_closure;
 if jsonb_typeof(c.snapshot->'dependencies')='array' then
  select coalesce(jsonb_agg(value order by value->>'source_kind',value->>'source_id'),'[]'::jsonb) into expected from jsonb_array_elements(c.snapshot->'dependencies');
 end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'closure_id',_closure,
 'closure',jsonb_build_object('from',c.period_start,'to',c.period_end,'revision',c.snapshot_revision,'actor_id',c.actor_id,'actor_name',c.actor_name,'reason',c.reason,'created_at',c.created_at),
 'snapshot',c.snapshot,'dependencies',deps,
 'integrity',jsonb_build_object('snapshot_matches_revision',coalesce(c.snapshot->>'revision'=c.snapshot_revision and md5((c.snapshot-'revision')::text)=c.snapshot_revision,false),
 'dependencies_match',coalesce(expected=deps,false)),
 'reopening',case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end);
end$$;
revoke all on function finance_private.account_period_closure_evidence(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function finance_private.account_period_closure_evidence(uuid,uuid,uuid) to authenticated;
create function public.get_finance_account_period_evidence(_tenant_id uuid,_account_id uuid,_closure_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.account_period_closure_evidence(_tenant_id,_account_id,_closure_id)$$;
revoke all on function public.get_finance_account_period_evidence(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.get_finance_account_period_evidence(uuid,uuid,uuid) to authenticated;
