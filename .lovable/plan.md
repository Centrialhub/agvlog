## Hardening pré-beta AGVLog — Plano de execução

Escopo grande (8 frentes). Vou entregar em **3 migrations + 1 lote de frontend**, para o usuário revisar cada migration antes do próximo passo.

---

### Fase A — Package manager (rápido, sem migration)
- Adoção oficial **Bun** (já é o padrão Lovable, `bun.lockb` existe).
- Adicionar em `package.json`:
  - `"packageManager": "bun@1.x"`
  - scripts equivalentes: `install`, `test` (vitest run), `lint`, `build`.
- Criar `docs/ci.md` com comandos: `bun install --frozen-lockfile`, `bun run lint`, `bun run test`, `bun run build`.
- Garantir que `package-lock.json` continua removido.

---

### Fase B — Migration 1: Driver RPCs + RLS + Storage receipts

**Reescrever `finalize_driver_delivery`** (priority 2):
- Não confiar em `_fiscal_document_id` do frontend.
- Resolver `fiscal_document_ids` via `dispatch_stop_documents` da parada.
- Validar `auth.uid() → drivers.user_id → dispatch_trips.driver_id`.
- Validar tenant em `dispatch_stop_documents` e `fiscal_documents`.
- Upsert `proof_of_delivery` para cada doc (`proof_type='receiver_confirmation'`, `status='uploaded'`).
- Retornar `pod_ids uuid[]`.

**Novas RPCs SECURITY DEFINER** (priority 3), todas com guard `_assert_driver_owns_trip(trip_id)`:
- `driver_mark_arrival(_stop_id)` → insere `dispatch_events('arrival')` + atualiza `dispatch_stops.status='arrived'`, `actual_arrival_at=now()`.
- `driver_create_event(_trip_id, _event_type, _payload, _stop_id?)`.
- `driver_save_checklist(_trip_id, _kind, _payload)` (`pre`|`post`).
- `driver_create_expense(_trip_id, _category, _amount, _description, _receipt_path?)`.
- `driver_finalize_delivery(_stop_id, _receiver_name, _signature_path, _photo_paths)` — wrapper sobre lógica de finalize.

**Helper de portal** (`_can_view_financial_doc`) usado por todas as RPCs do portal.

**RLS** (priority 4):
- `dispatch_events`, `dispatch_stops`, `driver_expenses`: revogar insert/update direto de roles client/driver; manter SELECT apenas dentro da própria trip via `dispatch_trips.driver_id IN (SELECT id FROM drivers WHERE user_id=auth.uid())`.
- `dispatch_planned_route`: trocar guard `is_tenant_member` por `is_tenant_admin OR has_tenant_role(_,'operator')`. Reject `role='client'` e `role='driver'`.

**Storage `receipts`** (priority 4):
- Remover policy de leitura `client`. Cliente baixa apenas via `get_client_pod_metadata` + signed URL.
- Manter authenticated com tenant_id no path (já feito na fase anterior).

---

### Fase C — Migration 2: Portal + Control Tower + Roteirização

**Portal** (priority 5):
- `get_client_portal_shipment_detail`: usar `planned_start_at`, `actual_start_at`, `planned_end_at`, `actual_end_at` (remover `started_at`/`ended_at`).
- Criar `get_user_portal_tenants()` → tenants do usuário via `client_portal_access`.
- Mascaramento financeiro consistente em `search_client_portal_shipments`, `list_client_documents`, `list_client_pods`, `get_client_pod_metadata`, `get_client_portal_summary`.

**Control Tower** (priority 6):
- `get_active_trips_live`: `ORDER BY ps.sequence`/`pe.sequence` corretamente (subselects nomeados).
- Próxima parada: incluir `arrived` em `('pending','arriving','arrived','in_progress')`.

**Roteirização** (priority 7):
- `dispatch_planned_route`:
  - Validar que cada `fiscal_document_id` da stop pertence a uma `load_id` da lista despachada.
  - RAISE EXCEPTION se documento órfão.
  - Persistir `latitude`/`longitude` em `dispatch_stops` quando o draft trouxer coordenadas.

---

### Fase D — Frontend (último lote)

- `RouteStopDraft`: adicionar `latitude?: number | null; longitude?: number | null`. Propagar do draft para o RPC.
- `useDispatchRoutePlan`: incluir lat/lng nos stops, e ordenar com `manual_order ?? optimized_order ?? original_order ?? 9999`.
- `DriverDeliveries`, `DriverHome`, `DriverChecklist`, `DriverExpenses`, `DriverJourney`, `DriverEvents`: substituir inserts diretos em `dispatch_events`/`dispatch_stops`/`driver_expenses` por `supabase.rpc('driver_*')`.
- `PortalShipments`: debounce com `useEffect`+`setTimeout` (não `useMemo`).
- `PortalLayout`: remover input de busca global solto.
- `App.tsx` (router) e menu do portal: esconder rotas `PortalTracking`, `PortalReports`, `PortalSettings`. Remover duplicidade `/product-traceability`.
- `useTenant` / novo `usePortalTenants`: portal usa `get_user_portal_tenants` quando usuário é client-only.

---

### Detalhes técnicos relevantes

```text
proof_of_delivery upsert key  = (fiscal_document_id, proof_type)
driver guard                  = EXISTS(drivers d JOIN dispatch_trips t
                                       ON t.driver_id=d.id
                                       WHERE d.user_id=auth.uid()
                                         AND t.id=_trip_id
                                         AND t.status IN ('planned','loading','dispatched','in_progress'))
operator guard (dispatch)     = is_tenant_admin(_t) OR has_tenant_role(_t,'operator')
portal tenant resolution      = UNION DISTINCT(tenant_memberships, client_portal_access)
```

### Ordem de entrega proposta
1. Fase A (package manager) + Fase D parcial (rotas/menu) numa única passada de frontend.
2. Migration 1 (driver + RLS + storage) — usuário revisa.
3. Migration 2 (portal + tower + roteirização) — usuário revisa.
4. Frontend final (driver RPCs + portal tenants + debounce + RouteStopDraft lat/lng).

Posso ir direto na ordem acima, ou prefere que eu pause em algum ponto específico?