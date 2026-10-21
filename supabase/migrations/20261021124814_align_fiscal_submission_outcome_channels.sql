-- Retrieval success is independent of fiscal success. No data repair or retry.
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create or replace function public.fiscal_submission_failure_is_definitive(_response jsonb)
returns boolean language sql immutable security invoker set search_path='' as $fn$
 with receipt as (
  select coalesce(_response->'document','{}'::jsonb) d,
   coalesce(_response->'document','{}'::jsonb) || _response facts,
   coalesce(_response->'error',_response#>'{document,error}') err
 )
 select coalesce(
  facts @> '{"processing":false,"terminal":true,"requiresReconciliation":false}'::jsonb
  and d->>'status'='error'
  and jsonb_typeof(d->'id')='string' and nullif(d->>'id','') is not null
  and jsonb_typeof(d->'idIntegracao')='string' and nullif(d->>'idIntegracao','') is not null
  and (not (facts ? 'submissionOutcome') or facts->>'submissionOutcome'='not_submitted')
  and err @> '{"submissionOutcome":"not_submitted","automaticRetry":false}'::jsonb
  and not exists (
   select 1 from (values ('processing'),('terminal'),('requiresReconciliation'),('submissionOutcome')) as keys(k)
   where _response ? k and d ? k and _response->k is distinct from d->k
  ),false)
 from receipt
$fn$;
revoke all on function public.fiscal_submission_failure_is_definitive(jsonb) from public,anon,authenticated;
grant execute on function public.fiscal_submission_failure_is_definitive(jsonb) to service_role;
