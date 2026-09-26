-- Apply only after the additive API phase and compatible frontend verification.
-- This is the explicit legacy cutover; the additive migration leaves old APIs intact.
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $preflight$
declare v_contract record;v_observed_hash text;
begin
  if to_regprocedure('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)') is null
    or to_regprocedure('public.driver_record_delivery_note(uuid,text,jsonb,uuid)') is null then
    raise exception 'Additive delivery APIs must be installed and verified before legacy cutover';
  end if;
  for v_contract in select * from (values
    ('public.driver_finalize_delivery(uuid,text,text,text[],text,text,text)','4763cb11f881c831b3b632c58018b71d'),
    ('public.driver_update_stop_status(uuid,text,text)','bc46a754cd9e3f9d688b80292d4837dc'),
    ('public.finalize_driver_delivery(uuid,text,text,text[],uuid)','fa2466240c273dee0aa0e9e74c91ff1e'),
    ('public.derive_trip_and_load_status_v1(uuid,uuid)','8c2b9d7ee1dbac08dc3a80fab68aff59'),
    ('public.transition_stop_status_v1(uuid,uuid,text,uuid,text,text,jsonb)','4aaa78a290e6ad9e8ce1ced7396f374d')
  ) expected(signature,hash) loop
    v_observed_hash := md5(replace(pg_get_functiondef(to_regprocedure(v_contract.signature)),chr(13),''));
    if v_observed_hash is distinct from v_contract.hash then
      raise exception 'Legacy contract changed: %; observed hash %; recapture before cutover',
        v_contract.signature,v_observed_hash;
    end if;
  end loop;
  -- Private phase may be installed before this release. Detect drift in every
  -- staged function as well as the old APIs before granting any public access.
  -- Historical preflight compatibility only: five staged APIs were rewritten
  -- by earlier migrations in a clean replay. Both exact reviewed hashes are
  -- accepted for each; this changes no function DDL or authorization grant.
  for v_contract in select * from (values
    ('public._delivery_result_from_statuses(text[])','be12c89528e9935bc76ce89dec420de7','2acc28ff3b14abf6153a535f8b3c23f6'),
    ('public._derive_driver_delivery_result(uuid,uuid)','f9c85c43e7813e316467b95fb09b5963','e34be4cc878f3367b67e0528dc38aae0'),
    ('public._lock_delivery_trip_graph(uuid,uuid)','ffa8920db62358d266660d11685ed9c0','09d1f26d159716d66c588457e02cccd2'),
    ('public._lock_driver_delivery_stop(uuid)','78068242359e41562da395ea27564dd2','78068242359e41562da395ea27564dd2'),
    ('public.driver_record_delivery_note(uuid,text,jsonb,uuid)','65c6456a38ade57bb4c7137bc81d1f16','a30ddc4e484cd3c66b26c57080965726'),
    ('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)','381e01547f4b7b67d1945018151ff3e2','d7cf0a8888b3ecbfef5105efa2685ad5')
  ) expected(signature,hash,replay_hash) loop
    v_observed_hash := md5(replace(pg_get_functiondef(to_regprocedure(v_contract.signature)),chr(13),''));
    if v_observed_hash is distinct from v_contract.hash
      and v_observed_hash is distinct from v_contract.replay_hash then
      raise exception 'Staged API contract changed: %; observed hash %; recapture before cutover',
        v_contract.signature,v_observed_hash;
    end if;
  end loop;
end;
$preflight$;

create or replace function public.driver_finalize_delivery(_stop_id uuid,_receiver_name text,
  _signature_path text default null,_photo_paths text[] default array[]::text[],
  _receiver_document text default null,_receiver_role text default null,_notes text default null)
returns jsonb language sql security definer set search_path = ''
as $fn$
  select public.driver_record_delivery_outcome(_stop_id,'delivered',jsonb_build_object(
    'receiver_name',_receiver_name,'receiver_document',_receiver_document,'receiver_role',_receiver_role,
    'signature_path',_signature_path,'photo_paths',coalesce(to_jsonb(_photo_paths),'[]'::jsonb),'notes',_notes));
$fn$;
revoke all on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) to authenticated,service_role;

create or replace function public.driver_update_stop_status(_stop_id uuid,_new_status text,_reason text default null)
returns jsonb language sql security definer set search_path = ''
as $fn$
  select public.driver_record_delivery_outcome(_stop_id,_new_status,jsonb_build_object('notes',_reason));
$fn$;
revoke all on function public.driver_update_stop_status(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_update_stop_status(uuid,text,text) to authenticated,service_role;

-- Old alias silently ignored a document ID. Never expand an explicitly scoped
-- request into a multi-document stop completion. Lock before checking that scope.
create or replace function public.finalize_driver_delivery(_stop_id uuid,_receiver_name text,
  _signature_path text default null,_photo_paths text[] default array[]::text[],_fiscal_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_stop public.dispatch_stops%rowtype;
begin
  select * into v_stop from public._lock_driver_delivery_stop(_stop_id);
  if _fiscal_document_id is not null and (
    (select count(*) from public.dispatch_stop_documents where dispatch_stop_id=_stop_id and tenant_id=v_stop.tenant_id)<>1
    or not exists(select 1 from public.dispatch_stop_documents where dispatch_stop_id=_stop_id
      and tenant_id=v_stop.tenant_id and fiscal_document_id=_fiscal_document_id)
  ) then
    raise exception 'Documento não corresponde à parada inteira; use o fluxo de entrega da parada' using errcode='22023';
  end if;
  return public.driver_finalize_delivery(_stop_id,_receiver_name,_signature_path,_photo_paths);
end;
$fn$;
revoke all on function public.finalize_driver_delivery(uuid,text,text,text[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.finalize_driver_delivery(uuid,text,text,text[],uuid) to service_role;

-- No app/Edge/internal callers other than the retired pair were found. Do not
-- expose their implicit starts, aggregate delivered fallback, or admin override.
-- Bodies remain for explicit database-owner recovery; no history is rewritten.
revoke all on function public.transition_stop_status_v1(uuid,uuid,text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.derive_trip_and_load_status_v1(uuid,uuid) from public,anon,authenticated,service_role;

-- Expose the new APIs only in the same transaction that removes unsafe writers.
grant execute on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) to authenticated,service_role;
grant execute on function public.driver_record_delivery_note(uuid,text,jsonb,uuid) to authenticated,service_role;
