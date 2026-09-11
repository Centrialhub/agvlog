-- Proves recording identity only. This is not permission to invalidate money:
-- dependencies, periods, replacement targets and writer readiness are separate.
create function finance_private.movement_origin_uuid(_value text) returns uuid
language plpgsql immutable strict security invoker set search_path='' as $$
begin return _value::uuid;exception when invalid_text_representation then return null;end$$;
revoke all on function finance_private.movement_origin_uuid(text) from public,anon,authenticated,service_role;
create function finance_private.movement_recording_origin(_tenant uuid,_movement uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.finance_movements%rowtype;c public.finance_commands%rowtype;e public.finance_events%rowtype;
 commands jsonb;events jsonb;snapshot jsonb;p jsonb;issue text;expected jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into m from public.finance_movements where tenant_id=_tenant and id=_movement;
 if not found then raise exception 'finance_movement_not_found' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.request_id),'[]'::jsonb) into commands
 from public.finance_commands x where x.tenant_id=_tenant and x.action='record_movement' and finance_private.movement_origin_uuid(x.result->>'movement_id')=_movement;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into events
 from public.finance_events x where x.tenant_id=_tenant and x.entity_type='movement' and x.entity_id=_movement and x.action='recorded';
 snapshot:=jsonb_build_object('movement',to_jsonb(m),'recording_commands',commands,'recording_events',events);
 if jsonb_array_length(commands)=0 then issue:='recording_origin_unproven';
 elsif jsonb_array_length(commands)<>1 then issue:='recording_origin_ambiguous';
 else
  select * into c from public.finance_commands where tenant_id=_tenant and request_id=(commands->0->>'request_id')::uuid;
  p:=c.payload;
  if c.actor_id is distinct from m.created_by or jsonb_typeof(p) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(case when jsonb_typeof(p)='object' then p else '{}'::jsonb end) k
    where k not in('version','tenant_id','request_id','bank_account_id','direction','nature','amount_cents','occurred_on',
     'description','beneficiary_name','beneficiary_document','driver_id','bank_reference','receipt_path','reason'))
   or p->>'version' is distinct from '1' or finance_private.movement_origin_uuid(p->>'tenant_id') is distinct from _tenant or finance_private.movement_origin_uuid(p->>'request_id') is distinct from c.request_id
   or c.result @> jsonb_build_object('version',1,'tenant_id',_tenant,'request_id',c.request_id,'movement_id',_movement,'confirmed',true) is distinct from true
   or finance_private.movement_origin_uuid(p->>'bank_account_id') is distinct from m.bank_account_id
   or p->>'direction' is distinct from m.direction or p->>'nature' is distinct from m.nature
   or p->>'occurred_on' is distinct from m.occurred_on::text
   or btrim(p->>'description') is distinct from m.description
   or btrim(p->>'beneficiary_name') is distinct from m.beneficiary_name
   or nullif(btrim(p->>'beneficiary_document'),'') is distinct from m.beneficiary_document
   or finance_private.movement_origin_uuid(nullif(p->>'driver_id','')) is distinct from m.driver_id
   or (nullif(p->>'driver_id','') is not null and finance_private.movement_origin_uuid(p->>'driver_id') is null)
   or nullif(btrim(p->>'bank_reference'),'') is distinct from m.bank_reference
   or nullif(btrim(p->>'receipt_path'),'') is distinct from m.receipt_path
  then issue:='recording_origin_mismatch';
  elsif coalesce(p->>'amount_cents','') !~ '^[0-9]{1,14}$' then issue:='recording_origin_mismatch';
  elsif (p->>'amount_cents')::numeric<>m.amount_cents then issue:='recording_origin_mismatch';
  elsif jsonb_array_length(events)<>1 then issue:='recording_event_unproven';
  else
   select * into e from public.finance_events where tenant_id=_tenant and id=(events->0->>'id')::uuid;
   expected:=jsonb_build_object('id',m.id,'tenant_id',m.tenant_id,'bank_account_id',m.bank_account_id,
    'direction',m.direction,'nature',m.nature,'amount_cents',m.amount_cents,'occurred_on',m.occurred_on,
    'description',m.description,'beneficiary_name',m.beneficiary_name,'beneficiary_document',m.beneficiary_document,
    'driver_id',m.driver_id,'bank_reference',m.bank_reference,'receipt_path',m.receipt_path,'created_by',m.created_by);
   if e.actor_id is distinct from c.actor_id or e.reason is distinct from btrim(p->>'reason')
    or e.after_data @> expected is distinct from true then issue:='recording_event_mismatch';end if;
  end if;
 end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'movement_id',_movement,
  'verified',issue is null,'issue',issue,'original_request_id',c.request_id,
  'revision',md5(snapshot::text),'snapshot',snapshot);
end$$;
revoke all on function finance_private.movement_recording_origin(uuid,uuid) from public,anon,authenticated,service_role;
