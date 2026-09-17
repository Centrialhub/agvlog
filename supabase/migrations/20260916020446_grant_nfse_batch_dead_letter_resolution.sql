-- The batch preparation RPC is service-role only and SECURITY INVOKER. Grant
-- only the columns it needs to close a stale local polling alert after it has
-- proven that no provider dispatch exists.

grant select (tenant_id, document_kind, document_id, status)
  on table public.fiscal_poll_dead_letters to service_role;

grant update (status, resolved_at, resolved_by, resolution_notes, updated_at)
  on table public.fiscal_poll_dead_letters to service_role;
