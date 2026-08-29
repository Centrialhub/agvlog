-- Durable terminal queue for fiscal documents that cannot leave a transient
-- provider state within the operational deadline. Edge Functions write with
-- the service role; authenticated operators receive read-only visibility.

create table if not exists public.fiscal_poll_dead_letters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_kind text not null check (document_kind in ('cte', 'nfse')),
  document_id uuid not null,
  document_number text,
  reason_code text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  first_seen_at timestamptz not null,
  last_attempt_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'resolved')),
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fiscal_poll_dead_letters_open_document_uidx
  on public.fiscal_poll_dead_letters (document_kind, document_id)
  where status = 'open';

create index if not exists fiscal_poll_dead_letters_tenant_status_idx
  on public.fiscal_poll_dead_letters (tenant_id, status, created_at desc);

alter table public.fiscal_poll_dead_letters enable row level security;

revoke all on table public.fiscal_poll_dead_letters from anon;
revoke all on table public.fiscal_poll_dead_letters from authenticated;
grant select on table public.fiscal_poll_dead_letters to authenticated;

drop policy if exists agvlog_select_authenticated on public.fiscal_poll_dead_letters;
create policy agvlog_select_authenticated
  on public.fiscal_poll_dead_letters
  as permissive
  for select
  to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id));

comment on table public.fiscal_poll_dead_letters is
  'Fila terminal de documentos fiscais que excederam o prazo ou o limite de polling; não contém payload fiscal bruto.';
