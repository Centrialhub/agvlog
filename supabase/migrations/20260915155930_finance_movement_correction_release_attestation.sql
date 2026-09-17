begin;

-- Finance migrations 20260915040508 and 20260915042209 intentionally extend
-- paid_projection_chain. Attest that exact reviewed change while preserving the
-- fail-closed runtime drift guard for every other protected object.
do $$
declare
  _baseline jsonb;
  _current jsonb := finance_private.movement_correction_runtime_state();
  _readiness jsonb := finance_private.movement_correction_readiness();
  _changed jsonb;
begin
  select snapshot into strict _baseline
  from finance_private.movement_correction_runtime_baseline
  where singleton;

  select coalesce(jsonb_agg(jsonb_build_object(
    'signature', coalesce(b.value->>'signature', c.value->>'signature'),
    'baseline_hash', md5(coalesce(b.value->>'body', '')),
    'current_hash', md5(coalesce(c.value->>'body', ''))
  ) order by coalesce(b.value->>'signature', c.value->>'signature')), '[]'::jsonb)
  into _changed
  from jsonb_array_elements(_baseline->'functions') b(value)
  full join jsonb_array_elements(_current->'functions') c(value)
    on c.value->>'signature' = b.value->>'signature'
  where b.value is null
     or c.value is null
     or b.value is distinct from c.value;

  if _readiness->'missing' is distinct from '["runtime_baseline_drift"]'::jsonb
     or _changed is distinct from '[{"signature":"finance_private.paid_projection_chain(uuid,text,uuid)","baseline_hash":"96a8d86ab05897edc408800fefd0f875","current_hash":"035f2c45183edf2aa0b47d23bdb13ffa"}]'::jsonb
     or _baseline->'triggers' is distinct from _current->'triggers'
     or _baseline->'active_view' is distinct from _current->'active_view'
     or _baseline->'view_options' is distinct from _current->'view_options'
     or _baseline->'view_acl' is distinct from _current->'view_acl'
  then
    raise exception 'finance_movement_correction_unreviewed_runtime_drift' using errcode = '23514';
  end if;

end
$$;

-- The baseline is deliberately immutable at runtime. A release migration may
-- replace it only inside this transaction, after the exact-drift preflight,
-- and must reinstall and verify the preservation trigger before commit.
drop trigger preserve_movement_correction_runtime_baseline
on finance_private.movement_correction_runtime_baseline;

update finance_private.movement_correction_runtime_baseline
set snapshot = finance_private.movement_correction_runtime_state()
where singleton;

create trigger preserve_movement_correction_runtime_baseline
before delete or update on finance_private.movement_correction_runtime_baseline
for each row execute function finance_private.preserve_event();

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'finance_private.movement_correction_runtime_baseline'::regclass
      and tgname = 'preserve_movement_correction_runtime_baseline'
      and tgfoid = 'finance_private.preserve_event()'::regprocedure
      and tgenabled in ('O', 'A')
      and tgtype = 27
      and tgqual is null
      and tgnargs = 0
      and not tgdeferrable
      and not tginitdeferred
  )
     or not coalesce((finance_private.movement_correction_readiness()->>'ready')::boolean, false)
     or not finance_private.manual_movement_void_runtime_ready()
  then
    raise exception 'finance_movement_correction_release_attestation_failed' using errcode = '23514';
  end if;
end
$$;

commit;
