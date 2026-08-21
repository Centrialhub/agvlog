# Auditoria — Estado real do banco vinculado (rodada de estabilização)

- **Projeto:** AGVLog (`78c32e78-fdf2-4bcb-a20e-f095849c9e86`)
- **Ambiente consultado:** banco Postgres vinculado ao projeto (Lovable Cloud / Supabase), banco `postgres`, papel de leitura `supabase_read_only_user` (somente leitura; nenhum segredo exposto)
- **Horário da coleta:** 2026-08-21 09:59 UTC (`now()` do servidor: `2026-08-21 09:59:23.924696+00`)
- **Escopo:** diagnóstico apenas. Nenhuma migration, schema, dado ou código de aplicação foi alterado nesta auditoria.

---

## 1. Migrations aplicadas no intervalo 20260821004409 → 20260821021913

Consulta:

```sql
select version
from supabase_migrations.schema_migrations
where version >= '20260821004409' and version <= '20260821021913'
order by version;
```

Observação: a tabela `supabase_migrations.schema_migrations` neste projeto possui as colunas
`version, statements, name, created_by, idempotency_key, rollback` (não há `inserted_at`,
portanto não há timestamp de aplicação disponível no banco).

Resultado — 14 versões aplicadas, todas presentes:

| # | version |
|---|---------|
| 1 | 20260821004409 |
| 2 | 20260821004537 |
| 3 | 20260821004613 |
| 4 | 20260821004644 |
| 5 | 20260821004750 |
| 6 | 20260821004828 |
| 7 | 20260821004919 |
| 8 | 20260821010306 |
| 9 | 20260821015202 |
| 10 | 20260821020043 |
| 11 | 20260821020512 |
| 12 | 20260821020545 |
| 13 | 20260821020910 |
| 14 | 20260821021913 |

Total de migrations registradas no banco: **293**.

## 2. Assinaturas existentes em `pg_proc` (writers de funcionário, carga, item e despacho)

Consulta:

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as identity_args,
       pg_get_function_result(p.oid) as result,
       p.prosecdef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like '%employee%v%'
       or p.proname like 'create_load%'
       or p.proname like 'update_load%'
       or p.proname like 'delete_load%'
       or p.proname like 'upsert_load_item%'
       or p.proname like 'plan_dispatch_trip%'
       or p.proname like 'link_items_to_load%'
       or p.proname like 'commit_load_import%')
order by p.proname, identity_args;
```

Resultado (todas `SECURITY DEFINER = true`):

| Função | Argumentos de identidade | Retorno |
|---|---|---|
| commit_load_import_v1 | p_tenant_id uuid, p_file_name text, p_source_type text, p_rows jsonb | jsonb |
| create_employee_v1 | p_tenant_id uuid, p_values jsonb | uuid |
| create_load_v1 | p_tenant_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_origin text, p_destination text, p_notes text, p_operation_type text, p_scheduled_load_at timestamp with time zone, p_idempotency_key text | uuid |
| create_load_with_next_number | _tenant_id uuid, _origin text, _destination text, _vehicle_id uuid, _driver_id uuid, _trip_id text, _notes text | loads |
| delete_employee_v1 | p_tenant_id uuid, p_employee_id uuid | void |
| delete_load_if_empty | v_load_id uuid | void |
| delete_load_item_v1 | p_tenant_id uuid, p_item_id uuid | void |
| delete_load_item_v2 | p_tenant_id uuid, p_item_id uuid | boolean |
| delete_load_safely | _tenant_id uuid, _load_id uuid | jsonb |
| delete_load_v1 | p_tenant_id uuid, p_load_id uuid | boolean |
| delete_loads_safely | _tenant_id uuid, _load_ids uuid[] | jsonb |
| link_items_to_load_v2 | p_tenant_id uuid, p_load_id uuid, p_item_ids uuid[] | jsonb |
| list_employees_v1 | p_tenant_id uuid, p_search text, p_status text, p_limit integer, p_offset integer | jsonb |
| plan_dispatch_trip_v2 | p_tenant_id uuid, p_driver_id uuid, p_vehicle_id uuid, p_route_name text, p_load_ids uuid[], p_stops jsonb, p_idempotency_key text | uuid |
| plan_dispatch_trip_v2 | p_tenant_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_load_ids uuid[], p_scheduled_start timestamp with time zone, p_idempotency_key text | uuid |
| plan_dispatch_trip_v3 | p_tenant_id uuid, p_idempotency_key text, p_driver_id uuid, p_vehicle_id uuid, p_route_name text, p_load_ids uuid[], p_stops jsonb | uuid |
| register_employee_advance | _tenant_id uuid, _employee_id uuid, _amount numeric, _advance_date date, _reason text, _payment_method text, _payment_reference text, _create_payable boolean, _mark_paid boolean | uuid |
| sync_employee_advance_from_payable | (sem argumentos) | trigger |
| update_employee_v1 | p_tenant_id uuid, p_employee_id uuid, p_values jsonb, p_expected_version integer | void |
| update_load_v1 | p_tenant_id uuid, p_load_id uuid, p_changes jsonb, p_version integer | jsonb |
| upsert_load_item_v1 | p_tenant_id uuid, p_load_id uuid, p_item_description text, p_quantity numeric, p_pallet_count numeric, p_weight_kg numeric, p_volume_m3 numeric, p_fiscal_document_id uuid, p_item_id uuid | uuid |
| upsert_load_item_v1 | p_tenant_id uuid, p_load_id uuid, p_item_id uuid, p_item_description text, p_quantity numeric, p_pallet_count numeric, p_weight_kg numeric, p_volume_m3 numeric, p_fiscal_document_id uuid | uuid |
| upsert_load_item_v2 | p_tenant_id uuid, p_load_id uuid, p_item_id uuid, p_item_description text, p_quantity numeric, p_pallet_count numeric, p_weight_kg numeric, p_volume_m3 numeric, p_fiscal_document_id uuid | uuid |

Fatos relevantes:

- Há **duas sobrecargas vivas** de `plan_dispatch_trip_v2` (ordens de parâmetros distintas) e **duas de `upsert_load_item_v1`** (posição de `p_item_id` distinta). Qualquer `GRANT/REVOKE/ALTER FUNCTION` sem assinatura exata é ambíguo para essas funções.
- `plan_dispatch_trip_v3` existe com `p_idempotency_key` na 2ª posição.
- Não existe `create_load_v2` nem `update_load_v2`/`delete_load_v2` no banco: os writers canônicos aplicados de carga são `create_load_v1`, `update_load_v1`, `delete_load_v1`, `upsert_load_item_v1/v2`, `delete_load_item_v1/v2`.

## 3. Colunas reais das tabelas citadas

Consulta:

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('idempotency_keys','dispatch_trips','dispatch_stop_documents','vehicle_events')
order by table_name, ordinal_position;
```

Resultado:

**`idempotency_keys`** — `id uuid NOT NULL`, `tenant_id uuid NOT NULL`, `key_value text NOT NULL`, `created_at timestamptz` (nullable).
Não possui colunas de escopo/resultado (`scope`, `operation`, `request_hash`, `response`, `result_id`).

**`dispatch_trips`** — `id uuid NOT NULL`, `tenant_id uuid NOT NULL`, `load_id uuid`, `driver_id uuid`, `vehicle_id uuid`, `status text NOT NULL`, `planned_start_at timestamptz`, `actual_start_at timestamptz`, `planned_end_at timestamptz`, `actual_end_at timestamptz`, `notes text`, `created_by uuid`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`.
Não possui `route_name`, `idempotency_key`, `version` nem `scheduled_start`.

**`dispatch_stop_documents`** — `id uuid NOT NULL`, `tenant_id uuid NOT NULL`, `dispatch_stop_id uuid NOT NULL`, `fiscal_document_id uuid NOT NULL`, `load_id uuid`, `created_at timestamptz NOT NULL`.

**`vehicle_events`** — `id uuid NOT NULL`, `tenant_id uuid NOT NULL`, `vehicle_id uuid NOT NULL`, `event_type text NOT NULL`, `event_at timestamptz NOT NULL`, `lat double precision`, `lng double precision`, `metadata jsonb`, `created_at timestamptz NOT NULL`.
Não possui `payload`, `actor_id` nem `entity_id`; auditoria estruturada precisa caber em `metadata`.

---

## 4. Conclusão objetiva — quais migrations históricas podem ou não ser editadas

**Não podem ser editadas (já aplicadas no banco vinculado).** Todas as 14 versões do intervalo
`20260821004409` … `20260821021913` constam em `supabase_migrations.schema_migrations`, assim como
as 293 versões registradas no total. Editar o conteúdo de qualquer uma dessas migrations:

1. não altera o schema atual (o registro já foi consumido e não é reexecutado);
2. quebra a integridade de hash dos manifestos (`MANIFEST.sha256` e `supabase/migrations/MANIFEST.sha256`), que hoje passam no gate;
3. produz divergência entre repositório e banco em qualquer `supabase db reset` futuro.

Portanto, o histórico até `20260821021913` é **imutável**. Qualquer correção pendente
(sobrecargas duplicadas de `plan_dispatch_trip_v2` e `upsert_load_item_v1`, GRANT/REVOKE com
assinatura ambígua, colunas ausentes em `idempotency_keys`/`dispatch_trips`) deve ser feita em
**novas migrations forward-only**, com timestamp posterior a `20260821021913`, seguidas da
atualização dos dois manifestos.

**Podem ser editadas:** apenas arquivos `.sql` que ainda **não** apareçam em
`supabase_migrations.schema_migrations` — nesta coleta, nenhum arquivo do intervalo auditado se
encaixa nessa condição.

Limitação registrada: a tabela de controle não possui coluna de timestamp de aplicação, logo não é
possível provar pelo banco *quando* cada migration foi aplicada — apenas *que* foi aplicada.
